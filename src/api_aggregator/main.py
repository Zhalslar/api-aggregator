from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path

from .config import APIConfig
from .dashboard import DashboardServer
from .data_service import DataService, LocalDataService, RemoteDataService
from .database import SQLiteDatabase
from .entry import APIEntry, APIEntryManager, SiteEntryManager
from .log import logger, setup_default_logging
from .model import DataResource
from .scheduler import APISchedulerService
from .service import (
    ApiDeleteService,
    ApiTestService,
    FileAccessService,
    PoolIOService,
    RuntimeControlService,
    SiteSyncService,
    UpdateService,
)

CronEntryHandler = Callable[[APIEntry], Awaitable[None]]


class APICoreApp:
    """API aggregator runtime facade for framework integration.

    Typical usage:
    1. Create one `APICoreApp` instance per bot process.
    2. Call `await start()` on framework startup.
    3. Use `api_mgr.match_entries(...)` + `data_service.fetch(...)` in message handlers.
    4. Call `await stop()` on framework shutdown.
    """

    def __init__(self):
        """Initialize runtime components"""

        self.cfg = APIConfig()
        setup_default_logging()
        self.db = SQLiteDatabase(self.cfg)

        self.local = LocalDataService(self.cfg)
        self.api_mgr = APIEntryManager(self.cfg, self.db)
        self.site_mgr = SiteEntryManager(self.cfg, self.db)
        self.remote = RemoteDataService(self.cfg, self.api_mgr, self.site_mgr)
        self.data_service = DataService(self.remote, self.local)
        self.scheduler = APISchedulerService(self.api_mgr, self._noop_on_entry_cron)
        self.dashboard_enabled = bool(self.cfg.dashboard.enabled)
        self.dashboard: DashboardServer | None = None
        if self.dashboard_enabled:
            dashboard_assets_dir = (
                Path(__file__).resolve().parent / "dashboard" / "assets"
            )
            update_service = UpdateService(
                restart_process_handler=self.restart_process
            )
            site_sync_service = SiteSyncService(self.api_mgr, self.site_mgr)
            api_delete_service = ApiDeleteService(self.api_mgr)
            file_access_service = FileAccessService(
                local_root=self.cfg.local_dir,
                assets_root=dashboard_assets_dir,
                logo_path=dashboard_assets_dir / "images" / "logo.png",
            )
            runtime_control_service = RuntimeControlService(
                restart_handler=self.restart_core_services,
                restart_process_handler=self.restart_process,
            )
            api_test_service = ApiTestService(self.remote, self.local, self.api_mgr)
            pool_io_service = PoolIOService(
                self.db,
                self.api_mgr,
                self.site_mgr,
                pool_files_dir=self.cfg.pool_files_dir,
                resolve_site_name=site_sync_service.resolve_api_site_name,
                sync_sites=site_sync_service.sync_all_api_sites,
            )
            self.dashboard = DashboardServer(
                self.cfg,
                self.db,
                self.remote,
                self.local,
                self.api_mgr,
                self.site_mgr,
                update_service,
                site_sync_service,
                api_delete_service,
                file_access_service,
                runtime_control_service,
                api_test_service,
                pool_io_service,
            )

        self._started = False
        self._restart_lock = asyncio.Lock()
        self._process_restart_lock = asyncio.Lock()

    async def start(self) -> None:
        """Start core services.

        Safe to call multiple times.
        Repeated calls after successful startup are ignored.
        """
        if self._started:
            logger.info("[app] start skipped: already running")
            return
        logger.info("[app] starting api-aggregator")
        logger.info("[app] data dir: %s", self.cfg.data_dir)
        self.db.reload_from_database()
        logger.info(
            "[app] database loaded: sites=%d, apis=%d",
            len(self.db.site_pool),
            len(self.db.api_pool),
        )
        await asyncio.gather(
            self.api_mgr.initialize(),
            self.site_mgr.initialize(),
        )
        logger.info("[app] api entries: %d", len(self.api_mgr.entries))
        logger.info("[app] site entries: %d", len(self.site_mgr.entries))
        self.scheduler.start()
        logger.info("[app] scheduler started")
        if self.dashboard:
            await self.dashboard.start()
        if self.dashboard_enabled:
            logger.info(
                "[app] dashboard enabled at http://%s:%s",
                self.cfg.dashboard.host,
                self.cfg.dashboard.port,
            )
        else:
            logger.info("[app] dashboard disabled")
        self._started = True
        logger.info("[app] startup complete")

    async def stop(self) -> None:
        """Stop core services and release network resources.

        Safe to call multiple times. Repeated calls after shutdown are ignored.
        """
        if not self._started:
            logger.info("[app] stop skipped: not running")
            return
        logger.info("[app] shutting down")
        self.scheduler.shutdown()
        logger.info("[app] scheduler stopped")
        if self.dashboard:
            await self.dashboard.stop()
            logger.info("[app] dashboard stopped")
        await self.remote.close()
        logger.info("[app] remote session closed")
        self._started = False
        logger.info("[app] shutdown complete")

    async def run_forever(self) -> None:
        """Start app and block forever until interrupted."""
        await self.start()
        try:
            await asyncio.Event().wait()
        except KeyboardInterrupt:
            logger.info("[app] received KeyboardInterrupt")
        finally:
            await self.stop()

    async def restart_core_services(self) -> None:
        """Reload DB state and restart runtime services in-place.

        Used by dashboard/system hooks after config data changes.
        """
        async with self._restart_lock:
            if not self._started:
                raise RuntimeError("app is not running")

            logger.info("[app] restarting core services")
            await self.remote.close()
            self.db.reload_from_database()
            await asyncio.gather(
                self.api_mgr.initialize(),
                self.site_mgr.initialize(),
            )
            self.scheduler.start()
            self.scheduler.reload()
            logger.info("[app] core services restarted")

    async def restart_process(self) -> None:
        """Restart current Python process for full app/frontend refresh."""
        async with self._process_restart_lock:
            if not self._started:
                raise RuntimeError("app is not running")
            logger.info("[app] full process restart requested")
            await asyncio.sleep(1.0)
            python_exe = sys.executable
            argv = [python_exe, *sys.argv]
            logger.info("[app] execv: %s %s", python_exe, " ".join(sys.argv))
            os.execv(python_exe, argv)

    def set_cron_entry_handler(self, handler: CronEntryHandler | None) -> None:
        """Register cron callback for triggered API entries.

        Args:
            handler: Async callback receiving the matched `APIEntry`.
                If None, a no-op handler is used.
        """
        self.scheduler.set_on_entry_trigger(handler or self._noop_on_entry_cron)

    async def fetch_cron_data(
        self, entry: APIEntry, *, use_local: bool = True
    ) -> DataResource | None:
        """Fetch data for a cron-triggered entry.

        Args:
            entry: API entry being triggered by scheduler.
            use_local: Whether local fallback is allowed when remote fetch fails.

        Returns:
            `DataResource` on success, otherwise `None`.
        """
        entry.updated_params = dict(entry.params or {})
        try:
            data = await self.data_service.fetch(entry, use_local=use_local)
        except Exception as exc:
            logger.error("[cron] fetch failed for %s: %s", entry.name, exc)
            return

        return data

    @staticmethod
    async def _noop_on_entry_cron(entry: APIEntry) -> None:
        _ = entry

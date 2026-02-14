from __future__ import annotations

from collections.abc import Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from .entry import APIEntry, APIEntryManager
from .log import logger


class APISchedulerService:
    """Framework-agnostic scheduler service for API cron triggers.

    This service subscribes to `api_mgr.on_changed` and rebuilds jobs automatically
    after API pool changes.
    """

    def __init__(
        self,
        api_mgr: APIEntryManager,
        on_entry_trigger: Callable[[APIEntry], Awaitable[None]],
    ):
        """Create scheduler service.

        Args:
            api_mgr: Entry manager used to discover enabled cron entries.
            on_entry_trigger: Async callback called when a cron job is fired.
        """
        self.api_mgr = api_mgr
        self._on_entry_trigger = on_entry_trigger

        self._scheduler = AsyncIOScheduler()
        self._started = False

        self.api_mgr.on_changed.append(self.reload)

    def start(self) -> None:
        """Start scheduler and register all enabled cron entries."""
        if self._started:
            return

        if getattr(self._scheduler, "running", False):
            self._scheduler.remove_all_jobs()
            self._register_all()
            self._started = True
            logger.debug("[cron] scheduler already running, jobs reloaded")
            return

        self._register_all()
        self._scheduler.start()
        self._started = True
        logger.debug("[cron] scheduler started")

    def shutdown(self) -> None:
        """Shutdown scheduler safely."""
        if not getattr(self._scheduler, "running", False):
            self._started = False
            logger.debug("[cron] scheduler already stopped")
            return

        try:
            self._scheduler.shutdown(wait=True)
            logger.debug("[cron] scheduler stopped")
        except Exception as exc:
            logger.debug("[cron] scheduler shutdown ignored: %s", exc)
        finally:
            self._started = False

    def reload(self) -> None:
        """Rebuild all jobs from current enabled entries."""
        if not self._started:
            return

        self._scheduler.remove_all_jobs()
        self._register_all()
        logger.debug("[cron] scheduler reloaded")

    def set_on_entry_trigger(
        self, on_entry_trigger: Callable[[APIEntry], Awaitable[None]]
    ) -> None:
        """Replace the callback used by cron jobs."""
        self._on_entry_trigger = on_entry_trigger

    def _register_all(self) -> None:
        for entry in self.api_mgr.list_enabled_entries():
            self._try_register_entry(entry)

    def _try_register_entry(self, entry: APIEntry) -> None:
        cron_expr = str(entry.cron or "").strip()
        if not cron_expr:
            return
        try:
            trigger = CronTrigger.from_crontab(cron_expr)
        except Exception as exc:
            logger.warning(
                "[cron] invalid cron ignored for %s: %s (%s)",
                entry.name,
                cron_expr,
                exc,
            )
            return

        self._scheduler.add_job(
            self._on_trigger,
            trigger=trigger,
            args=[entry.name],
            id=f"loreentry:{entry.name}",
            replace_existing=True,
        )
        logger.debug("[cron] registered entry: %s (%s)", entry.name, cron_expr)

    async def _on_trigger(self, entry_name: str) -> None:
        entry = self.api_mgr.get_entry(entry_name)
        if not entry or not entry.enabled or not entry.valid:
            return

        try:
            await self._on_entry_trigger(entry)
        except Exception as exc:
            logger.error("[cron] trigger failed for %s: %s", entry.name, exc)

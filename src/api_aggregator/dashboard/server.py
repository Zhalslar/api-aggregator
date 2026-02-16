from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from aiohttp import web

from ..config import APIConfig
from ..data_service.local_data import LocalDataService
from ..data_service.remote_data import RemoteDataService
from ..database import SQLiteDatabase
from ..entry import APIEntryManager, SiteEntryManager
from ..log import logger
from ..model import ItemsBatch, NamesBatch, TargetsBatch, UpdateItemsBatch
from ..service import (
    ApiDeleteService,
    ApiTestService,
    FileAccessError,
    FileAccessService,
    PoolIOService,
    RestartInProgressError,
    RestartUnavailableError,
    RuntimeControlService,
    SiteSyncService,
    UpdateService,
)
from ..version import __version__

DASHBOARD_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = DASHBOARD_DIR / "templates"
EDITOR_TEMPLATES_DIR = TEMPLATES_DIR / "editor"
ASSETS_DIR = DASHBOARD_DIR / "assets"
HTML_PAGE = (
    (TEMPLATES_DIR / "page.html")
    .read_text(encoding="utf-8")
    .replace("{{APP_VERSION}}", f"v{__version__}")
)
CSS_PAGE = (ASSETS_DIR / "css" / "page.css").read_text(encoding="utf-8")
I18N_PAGE = (ASSETS_DIR / "js" / "i18n.js").read_text(encoding="utf-8")
SITE_FORM_PAGE = (EDITOR_TEMPLATES_DIR / "site_form.html").read_text(encoding="utf-8")
API_FORM_PAGE = (EDITOR_TEMPLATES_DIR / "api_form.html").read_text(encoding="utf-8")
LOGO_PATH = ASSETS_DIR / "images" / "logo.png"
BOOT_ID = uuid4().hex


class DashboardServer:
    """Aiohttp dashboard server exposing management and test HTTP APIs."""

    def __init__(
        self,
        config: APIConfig,
        db: SQLiteDatabase,
        remote: RemoteDataService,
        local: LocalDataService,
        api_mgr: APIEntryManager,
        site_mgr: SiteEntryManager,
        update_service: UpdateService,
        site_sync_service: SiteSyncService,
        api_delete_service: ApiDeleteService,
        file_access_service: FileAccessService,
        runtime_control_service: RuntimeControlService,
        api_test_service: ApiTestService,
        pool_io_service: PoolIOService,
    ) -> None:
        self.cfg = config
        self.db = db
        self.remote = remote
        self.local = local
        self.api_mgr = api_mgr
        self.site_mgr = site_mgr
        self.update_service = update_service
        self.site_sync_service = site_sync_service
        self.api_delete_service = api_delete_service
        self.file_access_service = file_access_service
        self.runtime_control_service = runtime_control_service
        self.api_test_service = api_test_service
        self.pool_io_service = pool_io_service

        self._runner: web.AppRunner | None = None
        self._site: web.TCPSite | None = None

    async def start(self) -> None:
        """Create aiohttp app, register routes, and start listening."""
        app = web.Application()
        app.add_routes(
            [
                web.get("/", self.index),
                web.get("/page.css", self.styles),
                web.get("/i18n.js", self.i18n_script),
                web.get("/logo.png", self.logo),
                web.get("/assets/{path:.*}", self.asset_file),
                web.get("/editor/site-form.html", self.site_form),
                web.get("/editor/api-form.html", self.api_form),
                web.get("/api/pool", self.get_pool),
                web.get("/api/pool/files", self.get_pool_files),
                web.post("/api/pool/files/delete", self.delete_pool_files),
                web.get("/api/pool/sorted", self.get_pool_sorted),
                web.get("/api/pool/export/{pool_type}", self.export_pool_file),
                web.post("/api/pool/export/{pool_type}", self.export_pool_to_path),
                web.post("/api/pool/import/{pool_type}", self.import_pool_file),
                web.post(
                    "/api/pool/import/{pool_type}/path",
                    self.import_pool_from_default_path,
                ),
                web.post("/api/site/batch", self.create_sites_batch),
                web.put("/api/site/batch", self.update_sites_batch),
                web.delete("/api/site/batch", self.delete_sites_batch),
                web.post("/api/api/batch", self.create_apis_batch),
                web.put("/api/api/batch", self.update_apis_batch),
                web.delete("/api/api/batch", self.delete_apis_batch),
                web.get("/api/test/stream", self.test_api_stream),
                web.post("/api/test/preview/batch", self.test_api_preview_batch),
                web.get("/api/local-file", self.local_file),
                web.get("/api/local-data", self.get_local_data),
                web.post(
                    "/api/local-data/items/batch",
                    self.get_local_data_items_batch,
                ),
                web.delete("/api/local-data/batch", self.delete_local_data_batch),
                web.delete(
                    "/api/local-data-item/batch",
                    self.delete_local_data_items_batch,
                ),
                web.post("/api/system/restart", self.restart_system),
                web.post("/api/system/restart/full", self.restart_system_full),
                web.post("/api/system/update/check", self.check_update),
                web.post("/api/system/update/start", self.start_update),
                web.get("/api/system/update/status", self.get_update_status),
            ]
        )

        self._runner = web.AppRunner(app)
        await self._runner.setup()
        self._site = web.TCPSite(
            self._runner,
            host=self.cfg.dashboard.host,
            port=self.cfg.dashboard.port,
        )
        await self._site.start()
        logger.info(
            f"[api_aggregator] WebUI started: "
            f"http://{self.cfg.dashboard.host}:{self.cfg.dashboard.port}"
        )

    async def stop(self) -> None:
        """Stop aiohttp runner/site gracefully."""
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
            self._site = None

    @staticmethod
    def _ok(data: Any = None, message: str = "") -> web.Response:
        return web.json_response(
            {"status": "ok", "message": message, "data": data or {}}
        )

    @staticmethod
    def _error(message: str, status: int = 400) -> web.Response:
        return web.json_response(
            {"status": "error", "message": message, "data": {}},
            status=status,
        )

    @staticmethod
    def _to_int(value: Any, *, default: int, minimum: int | None = None) -> int:
        try:
            parsed = int(str(value).strip())
        except Exception:
            parsed = default
        if minimum is not None and parsed < minimum:
            return default
        return parsed

    async def _read_json(self, request: web.Request) -> dict[str, Any]:
        try:
            data = await request.json()
        except Exception as exc:
            raise ValueError(f"invalid json body: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError("request body must be an object")
        return data

    @staticmethod
    def _parse_query_values(
        request: web.Request,
        *,
        item_key: str,
        csv_key: str,
    ) -> list[str]:
        values = [
            str(item).strip()
            for item in request.query.getall(item_key, [])
            if str(item).strip()
        ]
        csv_values = str(request.query.get(csv_key, "")).strip()
        if csv_values:
            values.extend(
                [item.strip() for item in csv_values.split(",") if item.strip()]
            )
        return values

    @staticmethod
    def _pick_pagination(data: dict[str, Any]) -> dict[str, Any]:
        return {
            key: data[key]
            for key in ("page", "page_size", "total", "total_pages", "start", "end")
        }

    async def index(self, _: web.Request) -> web.Response:
        """GET / : return dashboard main HTML page."""
        return web.Response(text=HTML_PAGE, content_type="text/html")

    async def styles(self, _: web.Request) -> web.Response:
        """GET /page.css : return embedded dashboard CSS."""
        return web.Response(text=CSS_PAGE, content_type="text/css")

    async def i18n_script(self, _: web.Request) -> web.Response:
        """GET /i18n.js : return dashboard i18n script."""
        return web.Response(text=I18N_PAGE, content_type="application/javascript")

    async def asset_file(self, request: web.Request) -> web.StreamResponse:
        """GET /assets/{path} : serve static assets under dashboard assets dir."""
        try:
            target, content_type, text_mode = self.file_access_service.resolve_asset(
                request.match_info.get("path", "")
            )
            if text_mode:
                return web.Response(
                    text=target.read_text(encoding="utf-8"), content_type=content_type
                )
            return web.FileResponse(path=target)
        except FileAccessError as exc:
            return self._error(str(exc), status=exc.status)

    async def logo(self, _: web.Request) -> web.StreamResponse:
        """GET /logo.png : return dashboard logo file."""
        try:
            return web.FileResponse(path=self.file_access_service.resolve_logo())
        except FileAccessError as exc:
            return self._error(str(exc), status=exc.status)

    async def site_form(self, _: web.Request) -> web.Response:
        """GET /editor/site-form.html : return site editor template."""
        return web.Response(text=SITE_FORM_PAGE, content_type="text/html")

    async def api_form(self, _: web.Request) -> web.Response:
        """GET /editor/api-form.html : return API editor template."""
        return web.Response(text=API_FORM_PAGE, content_type="text/html")

    async def get_pool(self, _: web.Request) -> web.Response:
        """GET /api/pool : return current site/API pools."""
        self.site_sync_service.sync_all_api_sites()
        apis = [entry.to_dict() for entry in self.api_mgr.list_entries()]
        sites = self.site_mgr.attach_api_counts(
            [entry.to_dict() for entry in self.site_mgr.list_entries()],
            apis,
        )
        return self._ok(
            {
                "sites": sites,
                "apis": apis,
                "pool_io_default_dir": str(
                    self.pool_io_service.pool_files_dir.resolve()
                ),
                "boot_id": BOOT_ID,
            }
        )

    async def get_pool_files(self, _: web.Request) -> web.Response:
        """GET /api/pool/files : list json files under default pool files dir."""
        try:
            rows = self.pool_io_service.list_pool_files()
            return self._ok(
                {
                    "files": rows,
                    "base_dir": str(self.pool_io_service.pool_files_dir.resolve()),
                },
                "pool files listed",
            )
        except Exception as exc:
            return self._error(str(exc), status=500)

    async def delete_pool_files(self, request: web.Request) -> web.Response:
        """POST /api/pool/files/delete : delete json files in default pool dir."""
        try:
            payload = await self._read_json(request)
            raw_names = payload.get("names", [])
            if not isinstance(raw_names, list):
                return self._error("names must be a list", status=400)
            names = [str(item or "").strip() for item in raw_names]
            result = self.pool_io_service.delete_pool_files(names)
            return self._ok(result, "pool files deleted")
        except ValueError as exc:
            return self._error(str(exc), status=400)
        except Exception as exc:
            logger.error("[api_aggregator] delete pool files failed: %s", exc)
            return self._error(f"delete failed: {exc}", status=500)

    async def get_pool_sorted(self, request: web.Request) -> web.Response:
        """GET /api/pool/sorted : return pools sorted by query rules."""
        site_sort = request.query.get("site_sort", "name_asc")
        api_sort = request.query.get("api_sort", "name_asc")
        site_search = request.query.get("site_search", "")
        api_search = request.query.get("api_search", "")
        site_page = self._to_int(
            request.query.get("site_page", "1"), default=1, minimum=1
        )
        api_page = self._to_int(
            request.query.get("api_page", "1"), default=1, minimum=1
        )
        site_page_size = request.query.get("site_page_size", "all")
        api_page_size = request.query.get("api_page_size", "all")
        raw_api_sites = self._parse_query_values(
            request,
            item_key="api_site",
            csv_key="api_sites",
        )

        self.site_sync_service.sync_all_api_sites()
        site_page_data = self.db.query_site_pool(
            rule=site_sort,
            query=site_search,
            page=site_page,
            page_size=site_page_size,
        )
        api_page_data = self.db.query_api_pool(
            rule=api_sort,
            query=api_search,
            page=api_page,
            page_size=api_page_size,
            site_names=raw_api_sites or None,
        )
        return self._ok(
            {
                "sites": site_page_data["items"],
                "apis": api_page_data["items"],
                "site_filter_options": sorted(
                    {
                        str(item.get("name", "")).strip()
                        for item in self.db.site_pool
                        if str(item.get("name", "")).strip()
                    }
                ),
                "site_pagination": {
                    **self._pick_pagination(site_page_data)
                },
                "api_pagination": {
                    **self._pick_pagination(api_page_data)
                },
            }
        )

    async def export_pool_file(self, request: web.Request) -> web.StreamResponse:
        """GET /api/pool/export/{pool_type} : export pool to file and download."""
        pool_type = request.match_info.get("pool_type", "")
        try:
            custom_path = request.query.get("path", "")
            file_path = self.pool_io_service.export_pool_to_file(pool_type, custom_path)
            response = web.FileResponse(path=file_path)
            response.headers["Content-Disposition"] = (
                f'attachment; filename="{file_path.name}"'
            )
            return response
        except ValueError as exc:
            return self._error(str(exc), status=400)
        except Exception as exc:
            logger.error("[api_aggregator] export pool failed: %s", exc)
            return self._error(f"export failed: {exc}", status=500)

    async def export_pool_to_path(self, request: web.Request) -> web.Response:
        """POST /api/pool/export/{pool_type} : export pool to custom path."""
        pool_type = request.match_info.get("pool_type", "")
        try:
            payload = await self._read_json(request)
            custom_path = str(payload.get("path", "")).strip()
            raw_items = payload.get("items")
            items: list[dict[str, Any]] | None = None
            if raw_items is not None:
                if not isinstance(raw_items, list):
                    return self._error("items must be a list", status=400)
                items = [dict(item) for item in raw_items if isinstance(item, dict)]
            file_path = self.pool_io_service.export_pool_to_file(
                pool_type,
                custom_path,
                rows=items,
            )
            return self._ok(
                {"pool_type": pool_type, "path": str(file_path)},
                "pool exported",
            )
        except ValueError as exc:
            return self._error(str(exc), status=400)
        except Exception as exc:
            logger.error("[api_aggregator] export pool failed: %s", exc)
            return self._error(f"export failed: {exc}", status=500)

    async def import_pool_file(self, request: web.Request) -> web.Response:
        """POST /api/pool/import/{pool_type} : import pool from uploaded file."""
        pool_type = request.match_info.get("pool_type", "")
        try:
            raw_bytes: bytes
            content_type = str(request.content_type or "").lower()
            if "multipart/form-data" in content_type:
                post_data = await request.post()
                file_field = post_data.get("file")
                if file_field is None or not hasattr(file_field, "file"):
                    return self._error("missing upload file field: file", status=400)
                raw_bytes = file_field.file.read()  # type: ignore[attr-defined]
            elif "application/json" in content_type:
                payload = await self._read_json(request)
                content = payload.get("content")
                if isinstance(content, str):
                    raw_bytes = content.encode("utf-8")
                else:
                    return self._error("json body requires string field: content")
            else:
                raw_bytes = await request.read()

            if not raw_bytes:
                return self._error("import file is empty", status=400)

            result = self.pool_io_service.import_pool_from_bytes(pool_type, raw_bytes)
            return self._ok(result, "pool imported")
        except ValueError as exc:
            return self._error(str(exc), status=400)
        except Exception as exc:
            logger.error("[api_aggregator] import pool failed: %s", exc)
            return self._error(f"import failed: {exc}", status=500)

    async def import_pool_from_default_path(self, request: web.Request) -> web.Response:
        """POST /api/pool/import/{pool_type}/path : import pool from default dir."""
        pool_type = request.match_info.get("pool_type", "")
        try:
            payload = await self._read_json(request)
            file_name = str(payload.get("name", "")).strip()
            result = self.pool_io_service.import_pool_from_file(pool_type, file_name)
            return self._ok(result, "pool imported")
        except ValueError as exc:
            return self._error(str(exc), status=400)
        except Exception as exc:
            logger.error("[api_aggregator] import by path failed: %s", exc)
            return self._error(f"import failed: {exc}", status=500)

    async def create_sites_batch(self, request: web.Request) -> web.Response:
        """POST /api/site/batch : create site entries in explicit batch payload."""
        try:
            payload = await self._read_json(request)
            result = await self._create_sites_from_payload(payload)
            return self._ok(result, "sites created")
        except Exception as exc:
            return self._error(str(exc))

    async def _create_sites_from_payload(
        self, payload: dict[str, Any]
    ) -> dict[str, Any]:
        items = ItemsBatch.from_raw(payload).items
        entries = self.site_mgr.add_entries(items, save=True)
        self.site_sync_service.sync_all_api_sites()
        return {"items": [entry.to_dict() for entry in entries]}

    async def update_sites_batch(self, request: web.Request) -> web.Response:
        """PUT /api/site/batch : update site entries in explicit batch payload."""
        try:
            payload = await self._read_json(request)
            result = await self._update_sites_from_payload(payload)
            return self._ok(result, "sites updated")
        except LookupError as exc:
            return self._error(str(exc), status=404)
        except Exception as exc:
            return self._error(str(exc))

    async def _update_sites_from_payload(
        self, payload: dict[str, Any]
    ) -> dict[str, Any]:
        updates = [
            {"name": item.name, "payload": item.payload}
            for item in UpdateItemsBatch.from_raw(payload).items
        ]
        changed = self.site_mgr.update_entries(updates, save=True)
        self.site_sync_service.sync_all_api_sites()
        return {"items": changed}

    async def delete_sites_batch(self, request: web.Request) -> web.Response:
        """DELETE /api/site/batch : delete site entries in explicit batch payload."""
        try:
            payload = await self._read_json(request)
            result = await self._delete_sites_from_payload(payload)
            if not result["deleted"]:
                return self._error("no sites were deleted", status=404)
            return self._ok(result, "sites deleted")
        except Exception as exc:
            return self._error(str(exc))

    async def _delete_sites_from_payload(
        self, payload: dict[str, Any]
    ) -> dict[str, Any]:
        names = NamesBatch.from_raw(payload).names
        success, failed = self.site_mgr.remove_entries(names, save=True)
        if success:
            self.site_sync_service.sync_all_api_sites()
        return {
            "requested": names,
            "deleted": success,
            "failed": failed,
        }

    async def create_apis_batch(self, request: web.Request) -> web.Response:
        """POST /api/api/batch : create API entries in explicit batch payload."""
        try:
            payload = await self._read_json(request)
            result = await self._create_apis_from_payload(payload)
            return self._ok(result, "apis created")
        except Exception as exc:
            return self._error(str(exc))

    async def _create_apis_from_payload(
        self, payload: dict[str, Any]
    ) -> dict[str, Any]:
        items = ItemsBatch.from_raw(payload).items
        normalized_items = [
            self.api_mgr.normalize_payload(
                item,
                require_unique_name=False,
                resolve_site_name=self.site_sync_service.resolve_api_site_name,
            )
            for item in items
        ]
        entries = self.api_mgr.add_entries(
            normalized_items,
            save=True,
            emit_changed=True,
        )
        return {"items": [entry.to_dict() for entry in entries]}

    async def update_apis_batch(self, request: web.Request) -> web.Response:
        """PUT /api/api/batch : update API entries in explicit batch payload."""
        try:
            payload = await self._read_json(request)
            result = await self._update_apis_from_payload(payload)
            return self._ok(result, "apis updated")
        except LookupError as exc:
            return self._error(str(exc), status=404)
        except Exception as exc:
            return self._error(str(exc))

    async def _update_apis_from_payload(
        self, payload: dict[str, Any]
    ) -> dict[str, Any]:
        updates = [
            {"name": item.name, "payload": item.payload}
            for item in UpdateItemsBatch.from_raw(payload).items
        ]
        changed = self.api_mgr.update_entries(
            updates,
            resolve_site_name=self.site_sync_service.resolve_api_site_name,
            save=True,
        )
        return {"items": changed}

    async def delete_apis_batch(self, request: web.Request) -> web.Response:
        """DELETE /api/api/batch : delete API entries in explicit batch payload."""
        try:
            payload = await self._read_json(request)
            names = NamesBatch.from_raw(payload).names
        except ValueError as exc:
            return self._error(str(exc))
        result = self.api_delete_service.delete_by_names(names)
        if result.ok:
            return self._ok(result.data, result.message)
        return self._error(result.message, status=result.status)

    async def test_api_stream(self, request: web.Request) -> web.StreamResponse:
        """GET /api/test/stream : stream API test events as NDJSON."""
        names = request.query.getall("name", [])
        site_names = request.query.getall("site", [])
        csv_site_names = request.query.get("sites", "")
        if csv_site_names:
            site_names.extend(
                [item.strip() for item in csv_site_names.split(",") if item.strip()]
            )
        query_text = str(request.query.get("query", "")).strip()

        response = web.StreamResponse(
            status=200,
            headers={
                "Content-Type": "application/x-ndjson; charset=utf-8",
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )
        await response.prepare(request)

        try:
            async for event in self.api_test_service.stream_test_apis(
                names=names,
                site_names=site_names,
                query=query_text,
            ):
                line = f"{json.dumps(event, ensure_ascii=False)}\n"
                await response.write(line.encode("utf-8"))
        except ConnectionResetError:
            logger.info("[api_aggregator] test stream client disconnected")
        except Exception as exc:
            logger.exception("[api_aggregator] test stream failed: %s", exc)
            try:
                error_event = {
                    "event": "error",
                    "message": str(exc),
                }
                line = f"{json.dumps(error_event, ensure_ascii=False)}\n"
                await response.write(line.encode("utf-8"))
            except ConnectionResetError:
                logger.info("[api_aggregator] test stream client disconnected")
        finally:
            if not response.prepared:
                return response
            try:
                await response.write_eof()
            except ConnectionResetError:
                pass

        return response

    async def test_api_preview_batch(self, request: web.Request) -> web.Response:
        """POST /api/test/preview/batch : preview test APIs with batch payload."""
        try:
            payload = await self._read_json(request)
            items = ItemsBatch.from_raw(payload).items
            details = await self._build_preview_batch(items)
            return self._ok({"items": details}, "tests finished")
        except Exception as exc:
            return self._error(str(exc))

    async def _build_preview_batch(
        self, items: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        return [
            await self.api_test_service.build_preview(
                item,
                resolve_site_name=self.site_sync_service.resolve_api_site_name,
            )
            for item in items
        ]

    async def local_file(self, request: web.Request) -> web.StreamResponse:
        """GET /api/local-file?path=... : serve file under local data root."""
        try:
            target = self.file_access_service.resolve_local_file(
                request.query.get("path", "")
            )
            return web.FileResponse(path=target)
        except FileAccessError as exc:
            return self._error(str(exc), status=exc.status)

    async def get_local_data(self, request: web.Request) -> web.Response:
        """GET /api/local-data : list local data collections."""
        try:
            # keep old behavior by default (`all`) and support paged query when provided
            page = self._to_int(request.query.get("page", "1"), default=1, minimum=1)
            page_size_raw = request.query.get("page_size", "all").strip().lower()
            page_size: int | str
            if page_size_raw == "all":
                page_size = "all"
            else:
                page_size = self._to_int(page_size_raw, default=20, minimum=1)
            query = request.query.get("search", "")
            sort_rule = request.query.get("sort", "name_asc")
            raw_types = self._parse_query_values(
                request,
                item_key="type",
                csv_key="types",
            )
            paged = self.local.list_collections_page(
                page=page,
                page_size=page_size,
                query=query,
                sort_rule=sort_rule,
                type_values=raw_types or None,
            )
            return self._ok(
                {
                    "collections": paged["items"],
                    "pagination": self._pick_pagination(paged),
                }
            )
        except Exception as exc:
            return self._error(str(exc))

    async def get_local_data_items_batch(self, request: web.Request) -> web.Response:
        """POST /api/local-data/items/batch : get local collection details in batch."""
        try:
            payload = await self._read_json(request)
            targets = TargetsBatch.from_raw(payload).targets
            result = self.local.get_collection_items_batch(targets)
            return self._ok(result)
        except Exception as exc:
            return self._error(str(exc))

    async def delete_local_data_batch(self, request: web.Request) -> web.Response:
        """DELETE /api/local-data/batch : delete local collections in explicit batch."""
        try:
            payload = await self._read_json(request)
            targets = TargetsBatch.from_raw(payload).targets
            result = self.local.delete_collections_batch(targets)
            return self._ok(result, "local data deleted")
        except Exception as exc:
            return self._error(str(exc))

    async def delete_local_data_items_batch(self, request: web.Request) -> web.Response:
        """DELETE /api/local-data-item/batch : delete local items in explicit batch."""
        try:
            payload = await self._read_json(request)
            targets = TargetsBatch.from_raw(payload).targets
            result = self.local.delete_items_multi_batch(targets)
            return self._ok(result, "local data item deleted")
        except Exception as exc:
            return self._error(str(exc))

    async def restart_system(self, _: web.Request) -> web.Response:
        """POST /api/system/restart : restart core services via callback."""
        try:
            await self.runtime_control_service.restart_system()
            return self._ok(message="core services restarted")
        except RestartUnavailableError as exc:
            return self._error(str(exc), status=503)
        except RestartInProgressError as exc:
            return self._error(str(exc), status=409)
        except Exception as exc:
            logger.error("[api_aggregator] restart failed: %s", exc)
            return self._error(f"restart failed: {exc}", status=500)

    async def restart_system_full(self, _: web.Request) -> web.Response:
        """POST /api/system/restart/full : restart full Python process async."""
        try:
            await self.runtime_control_service.restart_process_async()
            return self._ok({"accepted": True}, "process restart scheduled")
        except RestartUnavailableError as exc:
            return self._error(str(exc), status=503)
        except RestartInProgressError as exc:
            return self._error(str(exc), status=409)
        except Exception as exc:
            logger.error("[api_aggregator] full restart failed: %s", exc)
            return self._error(f"restart failed: {exc}", status=500)

    async def check_update(self, _: web.Request) -> web.Response:
        """POST /api/system/update/check : detect whether git update is available."""
        if self.update_service.is_running():
            return self._ok(self.update_service.get_status(), "update task is running")
        try:
            state = await self.update_service.check()
            return self._ok(state, str(state.get("message") or ""))
        except Exception as exc:
            return self._error(str(exc), status=500)

    async def start_update(self, _: web.Request) -> web.Response:
        """POST /api/system/update/start : run update in background."""
        started = await self.update_service.start()
        if not started:
            return self._error("update already in progress", status=409)
        return self._ok({"accepted": True}, "update task started")

    async def get_update_status(self, _: web.Request) -> web.Response:
        """GET /api/system/update/status : get update task status snapshot."""
        return self._ok(self.update_service.get_status())

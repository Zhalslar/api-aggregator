from __future__ import annotations

import asyncio
import json
import sys
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from aiohttp import web

from ..config import APIConfig
from ..data_service.local_data import LocalDataService
from ..data_service.remote_data import RemoteDataService
from ..database import SQLiteDatabase
from ..entry import APIEntry, APIEntryManager, SiteEntry, SiteEntryManager
from ..log import logger
from ..model import DataResource, DataType
from ..version import __version__

DASHBOARD_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = DASHBOARD_DIR / "templates"
EDITOR_TEMPLATES_DIR = TEMPLATES_DIR / "editor"
ASSETS_DIR = DASHBOARD_DIR / "assets"
HTML_PAGE = (TEMPLATES_DIR / "page.html").read_text(encoding="utf-8").replace(
    "{{APP_VERSION}}", f"v{__version__}"
)
CSS_PAGE = (ASSETS_DIR / "css" / "page.css").read_text(encoding="utf-8")
I18N_PAGE = (ASSETS_DIR / "js" / "i18n.js").read_text(encoding="utf-8")
SITE_FORM_PAGE = (EDITOR_TEMPLATES_DIR / "site_form.html").read_text(encoding="utf-8")
API_FORM_PAGE = (EDITOR_TEMPLATES_DIR / "api_form.html").read_text(encoding="utf-8")
LOGO_PATH = ASSETS_DIR / "images" / "logo.png"


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
        restart_handler: Callable[[], Awaitable[None]] | None = None,
        restart_process_handler: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self.cfg = config
        self.db = db
        self.remote = remote
        self.local = local
        self.api_mgr = api_mgr
        self.site_mgr = site_mgr
        self.restart_handler = restart_handler
        self.restart_process_handler = restart_process_handler
        self._restart_lock = asyncio.Lock()
        self._update_lock = asyncio.Lock()
        self._update_task: asyncio.Task[None] | None = None
        self._update_state: dict[str, Any] = self._new_update_state()

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
                web.get("/api/pool/sorted", self.get_pool_sorted),
                web.post("/api/site", self.create_site),
                web.put("/api/site/{name}", self.update_site),
                web.delete("/api/site/{name}", self.delete_site),
                web.post("/api/api", self.create_api),
                web.put("/api/api/{name}", self.update_api),
                web.delete("/api/api/{name}", self.delete_api),
                web.get("/api/test/stream", self.test_api_stream),
                web.post("/api/test/preview", self.test_api_preview),
                web.get("/api/local-file", self.local_file),
                web.get("/api/local-data", self.get_local_data),
                web.get(
                    "/api/local-data/{data_type}/{name}", self.get_local_data_items
                ),
                web.delete(
                    "/api/local-data/{data_type}/{name}", self.delete_local_data
                ),
                web.delete("/api/local-data-item", self.delete_local_data_item),
                web.post("/api/system/restart", self.restart_system),
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
    def _new_update_state() -> dict[str, Any]:
        return {
            "status": "idle",
            "progress": 0,
            "message": "",
            "check": {},
            "logs": [],
            "started_at": 0,
            "ended_at": 0,
        }

    def _update_state_patch(self, **patch: Any) -> None:
        self._update_state.update(patch)

    def _append_update_log(self, text: str) -> None:
        logs = self._update_state.get("logs")
        if not isinstance(logs, list):
            logs = []
            self._update_state["logs"] = logs
        stamp = datetime.now().strftime("%H:%M:%S")
        logs.append(f"[{stamp}] {text}")
        if len(logs) > 120:
            self._update_state["logs"] = logs[-120:]

    @staticmethod
    async def _run_cmd(
        args: list[str], *, cwd: Path, timeout: float = 300
    ) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(
                f"command timed out after {int(timeout)}s: {' '.join(args)}"
            ) from None
        out_text = stdout.decode("utf-8", errors="replace").strip()
        err_text = stderr.decode("utf-8", errors="replace").strip()
        return proc.returncode, out_text, err_text

    async def _inspect_update(self) -> dict[str, Any]:
        project_root = Path.cwd()
        result: dict[str, Any] = {
            "available": False,
            "has_update": False,
            "dirty": False,
            "branch": "",
            "ahead": 0,
            "behind": 0,
            "current": "",
            "current_short": "",
            "remote": "",
            "remote_short": "",
            "reason": "",
        }

        code, out, err = await self._run_cmd(
            ["git", "rev-parse", "--is-inside-work-tree"], cwd=project_root, timeout=20
        )
        if code != 0 or out.lower() != "true":
            result["reason"] = err or "not a git repository"
            return result

        code, _, _ = await self._run_cmd(
            ["git", "fetch", "--all", "--prune"], cwd=project_root, timeout=120
        )
        if code != 0:
            result["reason"] = "git fetch failed"
            return result

        code, out, _ = await self._run_cmd(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=project_root,
            timeout=20,
        )
        if code == 0:
            result["branch"] = out.strip()

        code, out, _ = await self._run_cmd(
            ["git", "rev-parse", "HEAD"], cwd=project_root, timeout=20
        )
        if code == 0:
            result["current"] = out.strip()

        code, out, _ = await self._run_cmd(
            ["git", "rev-parse", "--short", "HEAD"], cwd=project_root, timeout=20
        )
        if code == 0:
            result["current_short"] = out.strip()

        code, out, _ = await self._run_cmd(
            ["git", "status", "--porcelain"], cwd=project_root, timeout=20
        )
        if code == 0:
            result["dirty"] = bool(out.strip())

        code, out, err = await self._run_cmd(
            ["git", "rev-parse", "@{u}"], cwd=project_root, timeout=20
        )
        if code != 0:
            result["available"] = True
            result["reason"] = err or "no upstream tracking branch"
            return result
        result["remote"] = out.strip()

        code, out, _ = await self._run_cmd(
            ["git", "rev-parse", "--short", "@{u}"], cwd=project_root, timeout=20
        )
        if code == 0:
            result["remote_short"] = out.strip()

        code, out, err = await self._run_cmd(
            ["git", "rev-list", "--left-right", "--count", "HEAD...@{u}"],
            cwd=project_root,
            timeout=20,
        )
        if code != 0:
            result["reason"] = err or "failed to compare local/remote commits"
            return result

        parts = out.split()
        if len(parts) >= 2:
            try:
                result["ahead"] = int(parts[0])
                result["behind"] = int(parts[1])
            except Exception:
                result["ahead"] = 0
                result["behind"] = 0

        result["available"] = True
        result["has_update"] = result["behind"] > 0
        return result

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
        relative_path = request.match_info.get("path", "").strip().replace("\\", "/")
        if not relative_path:
            return self._error("missing asset path", status=400)

        root = ASSETS_DIR.resolve()
        target = (root / relative_path).resolve()
        if target != root and root not in target.parents:
            return self._error("invalid asset path", status=403)
        if not target.exists() or not target.is_file():
            return self._error("asset not found", status=404)

        content_type = "application/octet-stream"
        if target.suffix == ".js":
            content_type = "application/javascript"
        elif target.suffix == ".css":
            content_type = "text/css"
        elif target.suffix == ".html":
            content_type = "text/html"

        if target.suffix in {".js", ".css", ".html"}:
            return web.Response(
                text=target.read_text(encoding="utf-8"), content_type=content_type
            )
        return web.FileResponse(path=target)

    async def logo(self, _: web.Request) -> web.StreamResponse:
        """GET /logo.png : return dashboard logo file."""
        if not LOGO_PATH.exists():
            return self._error("logo not found", status=404)
        return web.FileResponse(path=LOGO_PATH)

    async def site_form(self, _: web.Request) -> web.Response:
        """GET /editor/site-form.html : return site editor template."""
        return web.Response(text=SITE_FORM_PAGE, content_type="text/html")

    async def api_form(self, _: web.Request) -> web.Response:
        """GET /editor/api-form.html : return API editor template."""
        return web.Response(text=API_FORM_PAGE, content_type="text/html")

    async def get_pool(self, _: web.Request) -> web.Response:
        """GET /api/pool : return current site/API pools."""
        self._sync_all_api_sites()
        apis = [entry.to_dict() for entry in self.api_mgr.list_entries()]
        sites = self._attach_site_api_counts(
            [entry._data for entry in self.site_mgr.list_entries()],
            apis,
        )
        return self._ok(
            {
                "sites": sites,
                "apis": apis,
            }
        )

    async def get_pool_sorted(self, request: web.Request) -> web.Response:
        """GET /api/pool/sorted : return pools sorted by query rules."""
        site_sort = request.query.get("site_sort", "name_asc")
        api_sort = request.query.get("api_sort", "name_asc")
        site_search = request.query.get("site_search", "")
        api_search = request.query.get("api_search", "")
        site_page = self._to_int(request.query.get("site_page", "1"), default=1, minimum=1)
        api_page = self._to_int(request.query.get("api_page", "1"), default=1, minimum=1)
        site_page_size = request.query.get("site_page_size", "all")
        api_page_size = request.query.get("api_page_size", "all")
        raw_api_sites = request.query.getall("api_site", [])
        csv_api_sites = request.query.get("api_sites", "")
        if csv_api_sites:
            raw_api_sites.extend(
                [item.strip() for item in csv_api_sites.split(",") if item.strip()]
            )

        self._sync_all_api_sites()
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
                    k: site_page_data[k]
                    for k in ("page", "page_size", "total", "total_pages", "start", "end")
                },
                "api_pagination": {
                    k: api_page_data[k]
                    for k in ("page", "page_size", "total", "total_pages", "start", "end")
                },
            }
        )

    async def create_site(self, request: web.Request) -> web.Response:
        """POST /api/site : create one site entry from JSON body."""
        try:
            payload = await self._read_json(request)
            entry = self.site_mgr.add_entry(data=payload)
            self._sync_all_api_sites()
            return self._ok(entry._data, "site created")
        except Exception as exc:
            return self._error(str(exc))

    async def update_site(self, request: web.Request) -> web.Response:
        """PUT /api/site/{name} : update an existing site entry."""
        name = request.match_info.get("name", "")
        if not name:
            return self._error("missing site name")
        try:
            payload = await self._read_json(request)
            idx_cfg, idx_entry = self._find_site_index(name)
            if idx_cfg < 0 or idx_entry < 0:
                return self._error(f"site not found: {name}", status=404)

            data = dict(self.db.site_pool[idx_cfg])
            data.update(payload)

            new_name = str(data.get("name", "")).strip()
            new_url = str(data.get("url", "")).strip()
            if not new_name:
                return self._error("site name is required")
            if not new_url:
                return self._error("site url is required")

            if new_name != name and self.site_mgr.get_entry(new_name):
                return self._error(f"site name already exists: {new_name}")

            data["name"] = new_name
            data["url"] = new_url
            data["enabled"] = bool(data.get("enabled", True))
            data["headers"] = data.get("headers", {})
            data["keys"] = data.get("keys", {})
            data["timeout"] = int(data.get("timeout", 60))
            data["__template_key"] = "default"

            self.db.site_pool[idx_cfg] = data
            self.site_mgr.entries[idx_entry] = SiteEntry(data)
            self.db.save_site_pool()
            self._sync_all_api_sites()
            return self._ok(data, "site updated")
        except Exception as exc:
            return self._error(str(exc))

    async def delete_site(self, request: web.Request) -> web.Response:
        """DELETE /api/site/{name} : delete one site entry."""
        name = request.match_info.get("name", "")
        if not name:
            return self._error("missing site name")
        idx_cfg, idx_entry = self._find_site_index(name)
        if idx_cfg < 0 or idx_entry < 0:
            return self._error(f"site not found: {name}", status=404)
        self.db.site_pool.pop(idx_cfg)
        self.site_mgr.entries.pop(idx_entry)
        self.db.save_site_pool()
        self._sync_all_api_sites()
        return self._ok(message="site deleted")

    async def create_api(self, request: web.Request) -> web.Response:
        """POST /api/api : create one API entry from JSON body."""
        try:
            payload = await self._read_json(request)
            normalized = self._normalize_api_payload(payload, require_unique_name=False)
            entry = self.api_mgr.add_entry(data=normalized)
            return self._ok(entry.to_dict(), "api created")
        except Exception as exc:
            return self._error(str(exc))

    async def update_api(self, request: web.Request) -> web.Response:
        """PUT /api/api/{name} : update an existing API entry."""
        name = request.match_info.get("name", "")
        if not name:
            return self._error("missing api name")
        try:
            payload = await self._read_json(request)
            idx_cfg, idx_entry = self._find_api_index(name)
            if idx_cfg < 0 or idx_entry < 0:
                return self._error(f"api not found: {name}", status=404)

            data = dict(self.db.api_pool[idx_cfg])
            data.update(payload)

            new_name = str(data.get("name", "")).strip()
            new_url = str(data.get("url", "")).strip()
            if not new_name:
                return self._error("api name is required")
            if not new_url:
                return self._error("api url is required")

            duplicate = self.api_mgr.get_entry(new_name)
            if new_name != name and duplicate:
                return self._error(f"api name already exists: {new_name}")

            data["name"] = new_name
            data["url"] = new_url
            data["type"] = str(data.get("type", "text"))
            data["params"] = data.get("params", {})
            data["parse"] = str(data.get("parse", ""))
            data["enabled"] = bool(data.get("enabled", True))
            data["scope"] = data.get("scope", [])
            data["keywords"] = data.get("keywords", [])
            data["cron"] = str(data.get("cron", ""))
            data["valid"] = bool(data.get("valid", True))
            data["site"] = self._resolve_api_site_name(data["url"])
            data["template"] = data.get("template", "default")
            data["__template_key"] = data.get("__template_key", data["template"])

            self.db.api_pool[idx_cfg] = data
            self.api_mgr.entries[idx_entry] = APIEntry(data)
            self.db.save_api_pool()
            return self._ok(data, "api updated")
        except Exception as exc:
            return self._error(str(exc))

    async def delete_api(self, request: web.Request) -> web.Response:
        """DELETE /api/api/{name} : delete one API entry by name."""
        name = request.match_info.get("name", "")
        if not name:
            return self._error("missing api name")
        success, _ = self.api_mgr.remove_entries([name])
        if not success:
            return self._error(f"api not found: {name}", status=404)
        return self._ok(message="api deleted")

    async def test_api_stream(self, request: web.Request) -> web.StreamResponse:
        """GET /api/test/stream : stream API test events as NDJSON."""
        names = request.query.getall("name", [])
        entries: list[APIEntry] | None = None
        if names:
            selected = [
                entry
                for n in names
                if (entry := self.api_mgr.get_entry(str(n))) is not None
            ]
            entries = selected

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
            async for event in self.remote.stream_test_apis(entries):
                line = f"{json.dumps(event, ensure_ascii=False)}\n"
                await response.write(line.encode("utf-8"))
        except ConnectionResetError:
            logger.info("[api_aggregator] test stream client disconnected")
        except Exception as exc:
            logger.exception("[api_aggregator] test stream failed: %s", exc)
            try:
                line = (
                    f"{json.dumps({'event': 'error', 'message': str(exc)}, ensure_ascii=False)}\n"
                )
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

    async def test_api_preview(self, request: web.Request) -> web.Response:
        """POST /api/test/preview : test one API payload and return preview."""
        try:
            payload = await self._read_json(request)
            normalized = self._normalize_api_payload(payload, require_unique_name=False)
            entry = APIEntry(normalized)
            result = await self.remote.get_data(entry)
            is_valid = result.is_valid()
            detail: dict[str, Any] = {
                "name": entry.name,
                "url": entry.url,
                "valid": is_valid,
                "is_duplicate": False,
                "status": result.status,
                "content_type": result.content_type or "",
                "final_url": result.final_url or "",
                "reason": self.remote._build_test_reason(result),
                "preview": self.remote._build_result_preview(result),
            }

            if is_valid:
                try:
                    data = DataResource(
                        data_type=entry.data_type,
                        name=entry.name,
                        text=result.raw_text,
                        binary=result.raw_content,
                    )
                    saved = await self.local.save_data(data)
                    detail["is_duplicate"] = bool(saved.is_duplicate)
                    if detail["is_duplicate"]:
                        detail["duplicate_skipped"] = True
                        note = "duplicate data detected: skipped saving and reused local data"
                        reason_text = str(detail.get("reason", "")).strip()
                        detail["reason"] = (
                            f"{reason_text} | {note}" if reason_text else note
                        )
                    if saved.saved_text is not None:
                        detail["saved_type"] = "text"
                        detail["saved_text"] = saved.saved_text
                        text_file = (
                            self.local.get_type_dir(entry.data_type)
                            / f"{entry.name}{entry.data_type.get_default_ext()}"
                        )
                        detail["saved_path"] = str(text_file)
                    elif saved.saved_path is not None:
                        relative = saved.saved_path.resolve().relative_to(
                            self.cfg.local_dir.resolve()
                        )
                        rel_text = relative.as_posix()
                        detail["saved_type"] = entry.type
                        detail["saved_path"] = str(saved.saved_path)
                        detail["saved_file_url"] = (
                            f"/api/local-file?path={quote(rel_text)}"
                        )
                except Exception as save_exc:
                    detail["valid"] = False
                    detail["reason"] = f"save failed: {save_exc}"
                    detail["save_error"] = str(save_exc)

            if self.api_mgr.get_entry(entry.name):
                self.api_mgr.set_entries_valid([entry.name], bool(detail["valid"]))

            return self._ok(detail, "test finished")
        except Exception as exc:
            return self._error(str(exc))

    async def local_file(self, request: web.Request) -> web.StreamResponse:
        """GET /api/local-file?path=... : serve file under local data root."""
        rel = request.query.get("path", "").strip().replace("\\", "/")
        if not rel:
            return self._error("missing path", status=400)

        root = self.cfg.local_dir.resolve()
        target = (root / rel).resolve()
        if target != root and root not in target.parents:
            return self._error("invalid path", status=403)
        if not target.exists() or not target.is_file():
            return self._error("file not found", status=404)

        return web.FileResponse(path=target)

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
            paged = self.local.list_collections_page(
                page=page,
                page_size=page_size,
                query=query,
                sort_rule=sort_rule,
            )
            return self._ok(
                {
                    "collections": paged["items"],
                    "pagination": {
                        k: paged[k]
                        for k in ("page", "page_size", "total", "total_pages", "start", "end")
                    },
                }
            )
        except Exception as exc:
            return self._error(str(exc))

    async def get_local_data_items(self, request: web.Request) -> web.Response:
        """GET /api/local-data/{type}/{name} : get collection item details."""
        data_type_raw = request.match_info.get("data_type", "").strip().lower()
        name = request.match_info.get("name", "").strip()
        if not data_type_raw or not name:
            return self._error("missing data_type or name", status=400)
        try:
            data_type = DataType.from_str(data_type_raw)
            detail = self.local.get_collection_items(data_type, name)
            return self._ok(detail)
        except Exception as exc:
            return self._error(str(exc))

    async def delete_local_data(self, request: web.Request) -> web.Response:
        """DELETE /api/local-data/{type}/{name} : delete one local collection."""
        data_type_raw = request.match_info.get("data_type", "").strip().lower()
        name = request.match_info.get("name", "").strip()
        if not data_type_raw or not name:
            return self._error("missing data_type or name", status=400)
        try:
            data_type = DataType.from_str(data_type_raw)
            result = self.local.delete_collection(data_type, name)
            return self._ok(result, "local data deleted")
        except Exception as exc:
            return self._error(str(exc))

    async def delete_local_data_item(self, request: web.Request) -> web.Response:
        """DELETE /api/local-data-item : batch delete items by JSON payload."""
        try:
            payload = await self._read_json(request)
            data_type_raw = str(payload.get("type", "")).strip().lower()
            name = str(payload.get("name", "")).strip()
            if not data_type_raw or not name:
                return self._error("missing type or name", status=400)

            data_type = DataType.from_str(data_type_raw)
            raw_items = payload.get("items")
            items: list[dict[str, Any]] = []

            if isinstance(raw_items, list):
                for item in raw_items:
                    if isinstance(item, dict):
                        items.append(dict(item))
            else:
                return self._error("items must be a list", status=400)

            result = self.local.delete_items_batch(data_type, name, items)
            return self._ok(result, "local data item deleted")
        except Exception as exc:
            return self._error(str(exc))

    async def restart_system(self, _: web.Request) -> web.Response:
        """POST /api/system/restart : restart core services via callback."""
        if self.restart_handler is None:
            return self._error("restart handler is not configured", status=503)

        if self._restart_lock.locked():
            return self._error("restart already in progress", status=409)

        async with self._restart_lock:
            try:
                await self.restart_handler()
                return self._ok(message="core services restarted")
            except Exception as exc:
                logger.error("[api_aggregator] restart failed: %s", exc)
                return self._error(f"restart failed: {exc}", status=500)

    async def check_update(self, _: web.Request) -> web.Response:
        """POST /api/system/update/check : detect whether git update is available."""
        if self._update_lock.locked():
            return self._ok(dict(self._update_state), "update task is running")
        try:
            check = await self._inspect_update()
            if not check.get("available"):
                status = "unavailable"
                msg = str(check.get("reason") or "update check unavailable")
            elif check.get("has_update"):
                status = "ready"
                msg = "update is available"
            else:
                status = "up_to_date"
                msg = "already up-to-date"
            self._update_state_patch(
                status=status,
                progress=0,
                message=msg,
                check=check,
                logs=[],
                started_at=0,
                ended_at=0,
            )
            return self._ok(dict(self._update_state), msg)
        except Exception as exc:
            logger.error("[api_aggregator] update check failed: %s", exc)
            self._update_state_patch(
                status="error",
                progress=0,
                message=f"update check failed: {exc}",
                check={},
                logs=[],
                started_at=0,
                ended_at=0,
            )
            return self._error(str(exc), status=500)

    async def start_update(self, _: web.Request) -> web.Response:
        """POST /api/system/update/start : run update in background."""
        if self._update_lock.locked():
            return self._error("update already in progress", status=409)
        self._update_task = asyncio.create_task(self._run_update_task())
        return self._ok({"accepted": True}, "update task started")

    async def get_update_status(self, _: web.Request) -> web.Response:
        """GET /api/system/update/status : get update task status snapshot."""
        return self._ok(dict(self._update_state))

    async def _run_update_task(self) -> None:
        async with self._update_lock:
            started_at = int(asyncio.get_running_loop().time() * 1000)
            self._update_state = self._new_update_state()
            self._update_state_patch(
                status="running",
                progress=2,
                message="checking update status",
                started_at=started_at,
                ended_at=0,
            )
            self._append_update_log("Starting update task.")
            try:
                check = await self._inspect_update()
                self._update_state_patch(check=check, progress=12)
                if not check.get("available"):
                    message = str(check.get("reason") or "update is unavailable")
                    self._append_update_log(f"Update unavailable: {message}")
                    self._update_state_patch(
                        status="error",
                        progress=12,
                        message=message,
                        ended_at=int(asyncio.get_running_loop().time() * 1000),
                    )
                    return
                if check.get("dirty"):
                    message = "working tree has local changes; update aborted"
                    self._append_update_log(message)
                    self._update_state_patch(
                        status="error",
                        progress=12,
                        message=message,
                        ended_at=int(asyncio.get_running_loop().time() * 1000),
                    )
                    return
                if not check.get("has_update"):
                    self._append_update_log("No update available.")
                    self._update_state_patch(
                        status="up_to_date",
                        progress=100,
                        message="already up-to-date",
                        ended_at=int(asyncio.get_running_loop().time() * 1000),
                    )
                    return

                root = Path.cwd()
                self._append_update_log("Pulling latest commits.")
                self._update_state_patch(progress=28, message="pulling latest commits")
                code, out, err = await self._run_cmd(
                    ["git", "pull", "--ff-only"], cwd=root, timeout=240
                )
                if out:
                    self._append_update_log(out)
                if code != 0:
                    self._append_update_log(err or "git pull failed")
                    self._update_state_patch(
                        status="error",
                        progress=28,
                        message=err or "git pull failed",
                        ended_at=int(asyncio.get_running_loop().time() * 1000),
                    )
                    return

                self._append_update_log("Installing updated package.")
                self._update_state_patch(progress=62, message="installing package")
                code, out, err = await self._run_cmd(
                    [sys.executable, "-m", "pip", "install", "-e", ".[scheduler]"],
                    cwd=root,
                    timeout=600,
                )
                if code != 0:
                    self._append_update_log(
                        "Install with scheduler extra failed, retrying with -e ."
                    )
                    code, out, err = await self._run_cmd(
                        [sys.executable, "-m", "pip", "install", "-e", "."],
                        cwd=root,
                        timeout=600,
                    )
                if out:
                    self._append_update_log(out)
                if code != 0:
                    self._append_update_log(err or "pip install failed")
                    self._update_state_patch(
                        status="error",
                        progress=62,
                        message=err or "pip install failed",
                        ended_at=int(asyncio.get_running_loop().time() * 1000),
                    )
                    return

                self._append_update_log("Update succeeded. Restarting process.")
                self._update_state_patch(
                    status="restarting",
                    progress=100,
                    message="update applied, restarting process",
                    ended_at=int(asyncio.get_running_loop().time() * 1000),
                )
                if self.restart_process_handler is None:
                    self._update_state_patch(
                        status="success", message="update finished (restart unavailable)"
                    )
                    return
                await self.restart_process_handler()
            except Exception as exc:
                logger.error("[api_aggregator] update failed: %s", exc)
                self._append_update_log(f"Update failed: {exc}")
                self._update_state_patch(
                    status="error",
                    message=f"update failed: {exc}",
                    ended_at=int(asyncio.get_running_loop().time() * 1000),
                )

    def _find_site_index(self, name: str) -> tuple[int, int]:
        cfg_idx = -1
        entry_idx = -1
        for i, item in enumerate(self.db.site_pool):
            if item.get("name") == name:
                cfg_idx = i
                break
        for i, entry in enumerate(self.site_mgr.entries):
            if entry.name == name:
                entry_idx = i
                break
        return cfg_idx, entry_idx

    def _find_api_index(self, name: str) -> tuple[int, int]:
        cfg_idx = -1
        entry_idx = -1
        for i, item in enumerate(self.db.api_pool):
            if item.get("name") == name:
                cfg_idx = i
                break
        for i, entry in enumerate(self.api_mgr.entries):
            if entry.name == name:
                entry_idx = i
                break
        return cfg_idx, entry_idx

    def _normalize_api_payload(
        self, payload: dict[str, Any], *, require_unique_name: bool
    ) -> dict[str, Any]:
        data = dict(payload)
        name = str(data.get("name", "")).strip()
        url = str(data.get("url", "")).strip()
        if not name:
            raise ValueError("api name is required")
        if not url:
            raise ValueError("api url is required")

        if require_unique_name and self.api_mgr.get_entry(name):
            raise ValueError(f"api name already exists: {name}")

        data["name"] = name
        data["url"] = url
        data["type"] = str(data.get("type", "text"))
        data["params"] = data.get("params", {})
        data["parse"] = str(data.get("parse", ""))
        data["enabled"] = bool(data.get("enabled", True))
        data["scope"] = data.get("scope", [])
        data["keywords"] = data.get("keywords", [])
        data["cron"] = str(data.get("cron", ""))
        data["valid"] = bool(data.get("valid", True))
        data["site"] = self._resolve_api_site_name(data["url"])
        data["template"] = data.get("template", "default")
        data["__template_key"] = data.get("__template_key", data["template"])
        return data

    @staticmethod
    def _sort_sites(items: list[dict[str, Any]], rule: str) -> list[dict[str, Any]]:
        data = list(items)
        if rule == "name_desc":
            return sorted(
                data, key=lambda x: str(x.get("name", "")).lower(), reverse=True
            )
        if rule == "url_asc":
            return sorted(data, key=lambda x: str(x.get("url", "")).lower())
        if rule == "url_desc":
            return sorted(
                data, key=lambda x: str(x.get("url", "")).lower(), reverse=True
            )
        if rule == "timeout_asc":
            return sorted(data, key=lambda x: int(x.get("timeout", 60)))
        if rule == "timeout_desc":
            return sorted(data, key=lambda x: int(x.get("timeout", 60)), reverse=True)
        if rule == "api_count_asc":
            return sorted(
                data,
                key=lambda x: (
                    int(x.get("api_count", 0)),
                    str(x.get("name", "")).lower(),
                ),
            )
        if rule == "api_count_desc":
            return sorted(
                data,
                key=lambda x: (
                    -int(x.get("api_count", 0)),
                    str(x.get("name", "")).lower(),
                ),
            )
        if rule == "enabled_first":
            return sorted(
                data,
                key=lambda x: (
                    not bool(x.get("enabled", True)),
                    str(x.get("name", "")).lower(),
                ),
            )
        if rule == "disabled_first":
            return sorted(
                data,
                key=lambda x: (
                    bool(x.get("enabled", True)),
                    str(x.get("name", "")).lower(),
                ),
            )
        return sorted(data, key=lambda x: str(x.get("name", "")).lower())

    @staticmethod
    def _sort_apis(items: list[dict[str, Any]], rule: str) -> list[dict[str, Any]]:
        data = list(items)
        if rule == "name_desc":
            return sorted(
                data, key=lambda x: str(x.get("name", "")).lower(), reverse=True
            )
        if rule == "url_asc":
            return sorted(data, key=lambda x: str(x.get("url", "")).lower())
        if rule == "url_desc":
            return sorted(
                data, key=lambda x: str(x.get("url", "")).lower(), reverse=True
            )
        if rule == "type_asc":
            return sorted(data, key=lambda x: str(x.get("type", "")).lower())
        if rule == "type_desc":
            return sorted(
                data, key=lambda x: str(x.get("type", "")).lower(), reverse=True
            )
        if rule == "valid_first":
            return sorted(
                data,
                key=lambda x: (
                    not bool(x.get("valid", True)),
                    str(x.get("name", "")).lower(),
                ),
            )
        if rule == "invalid_first":
            return sorted(
                data,
                key=lambda x: (
                    bool(x.get("valid", True)),
                    str(x.get("name", "")).lower(),
                ),
            )
        if rule == "keywords_desc":
            return sorted(
                data,
                key=lambda x: (
                    -len(
                        x.get("keywords", [])
                        if isinstance(x.get("keywords"), list)
                        else []
                    ),
                    str(x.get("name", "")).lower(),
                ),
            )
        return sorted(data, key=lambda x: str(x.get("name", "")).lower())

    def _resolve_api_site_name(self, url: str) -> str:
        full_url = str(url or "").strip()
        if not full_url:
            return ""
        site = self.site_mgr.match_entry(full_url, only_enabled=False)
        return str(site.name) if site else ""

    def _sync_all_api_sites(self) -> bool:
        changed = False
        for index, api_cfg in enumerate(self.db.api_pool):
            if not isinstance(api_cfg, dict):
                continue
            next_site = self._resolve_api_site_name(str(api_cfg.get("url", "")))
            if str(api_cfg.get("site", "")).strip() == next_site:
                continue
            api_cfg["site"] = next_site
            if index < len(self.api_mgr.entries):
                self.api_mgr.entries[index] = APIEntry(dict(api_cfg))
            changed = True
        if changed:
            self.db.save_api_pool()
        return changed

    @staticmethod
    def _attach_site_api_counts(
        sites: list[dict[str, Any]], apis: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        count_by_site: dict[str, int] = {}
        for api in apis:
            site_name = str(api.get("site", "")).strip()
            if not site_name:
                continue
            count_by_site[site_name] = count_by_site.get(site_name, 0) + 1

        result: list[dict[str, Any]] = []
        for site in sites:
            row = dict(site)
            site_name = str(row.get("name", "")).strip()
            row["api_count"] = int(count_by_site.get(site_name, 0))
            result.append(row)
        return result

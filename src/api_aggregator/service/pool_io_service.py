from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from ..config import APIConfig
from ..database import SQLiteDatabase
from ..entry import APIEntryManager, SiteEntryManager
from ..model import ApiPayload, SitePayload

DEFAULT_POOL_FILES_DIR = Path(APIConfig().pool_files_dir)


class PoolIOService:
    """Import/export site pool and api pool data files."""

    def __init__(
        self,
        db: SQLiteDatabase,
        api_mgr: APIEntryManager,
        site_mgr: SiteEntryManager,
        *,
        pool_files_dir: Path | None = None,
        resolve_site_name: Callable[[str], str] | None = None,
        sync_sites: Callable[[], bool] | None = None,
    ) -> None:
        self.db = db
        self.api_mgr = api_mgr
        self.site_mgr = site_mgr
        self.pool_files_dir = (
            Path(pool_files_dir)
            if pool_files_dir is not None
            else DEFAULT_POOL_FILES_DIR
        )
        self._resolve_site_name = resolve_site_name
        self._sync_sites = sync_sites

    def _resolve_pool_file_path(self, file_name: str) -> Path:
        text = str(file_name or "").strip()
        if not text:
            raise ValueError("file name is required")
        # Restrict to configured pool files dir and plain file names.
        if any(sep in text for sep in ("/", "\\")) or text in {".", ".."}:
            raise ValueError("invalid file name")
        path = (self.pool_files_dir / text).resolve()
        root = self.pool_files_dir.resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("file path is outside pool files dir") from exc
        if path.suffix.lower() != ".json":
            raise ValueError("only .json files are supported")
        if not path.exists() or not path.is_file():
            raise ValueError(f"file not found: {text}")
        return path

    def list_pool_files(self) -> list[dict[str, Any]]:
        self.pool_files_dir.mkdir(parents=True, exist_ok=True)
        rows: list[dict[str, Any]] = []
        for item in sorted(self.pool_files_dir.glob("*.json")):
            try:
                stat = item.stat()
            except OSError:
                continue
            rows.append(
                {
                    "name": item.name,
                    "size": int(stat.st_size),
                    "modified_at": int(stat.st_mtime),
                }
            )
        return rows

    def delete_pool_files(self, names: list[str]) -> dict[str, Any]:
        deleted: list[str] = []
        failed: list[str] = []
        self.pool_files_dir.mkdir(parents=True, exist_ok=True)
        for raw in names:
            name = str(raw or "").strip()
            if not name:
                continue
            try:
                path = self._resolve_pool_file_path(name)
                path.unlink()
                deleted.append(name)
            except Exception:
                failed.append(name)
        return {
            "deleted": deleted,
            "failed": failed,
        }

    @staticmethod
    def _normalize_pool_type(pool_type: str) -> str:
        text = str(pool_type or "").strip().lower()
        if text in {"site", "sites", "site_pool"}:
            return "site"
        if text in {"api", "apis", "api_pool"}:
            return "api"
        raise ValueError(f"unsupported pool type: {pool_type}")

    @staticmethod
    def _sanitize_site_row(row: dict[str, Any]) -> dict[str, Any]:
        data = dict(row)
        data.pop("enabled", None)
        return data

    @staticmethod
    def _sanitize_api_row(row: dict[str, Any]) -> dict[str, Any]:
        data = dict(row)
        data.pop("enabled", None)
        data.pop("valid", None)
        data.pop("site", None)
        return data

    def _build_export_rows(
        self, pool_type: str, rows: list[dict[str, Any]] | None = None
    ) -> list[dict[str, Any]]:
        safe_type = self._normalize_pool_type(pool_type)
        source_rows: list[dict[str, Any]]
        if rows is not None:
            source_rows = [dict(item) for item in rows if isinstance(item, dict)]
        elif safe_type == "site":
            source_rows = [
                dict(item) for item in self.db.site_pool if isinstance(item, dict)
            ]
        else:
            source_rows = [
                dict(item) for item in self.db.api_pool if isinstance(item, dict)
            ]

        if safe_type == "site":
            return [self._sanitize_site_row(item) for item in source_rows]
        return [self._sanitize_api_row(item) for item in source_rows]

    @staticmethod
    def _resolve_target_path(
        default_dir: Path,
        pool_type: str,
        custom_path: str | None = None,
    ) -> Path:
        safe_type = PoolIOService._normalize_pool_type(pool_type)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        default_file = default_dir / f"{safe_type}_pool_{stamp}.json"
        text = str(custom_path or "").strip()
        if not text:
            return default_file

        target = Path(text)
        if not target.is_absolute():
            target = (Path.cwd() / target).resolve()
        if target.suffix.lower() == ".json":
            target.parent.mkdir(parents=True, exist_ok=True)
            return target

        target.mkdir(parents=True, exist_ok=True)
        return target / default_file.name

    def export_pool_to_file(
        self,
        pool_type: str,
        custom_path: str | None = None,
        rows: list[dict[str, Any]] | None = None,
    ) -> Path:
        safe_type = self._normalize_pool_type(pool_type)
        export_rows = self._build_export_rows(safe_type, rows=rows)
        self.pool_files_dir.mkdir(parents=True, exist_ok=True)
        file_path = self._resolve_target_path(
            self.pool_files_dir,
            safe_type,
            custom_path,
        )
        file_path.write_text(
            json.dumps(export_rows, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return file_path

    @staticmethod
    def _parse_import_bytes(raw: bytes) -> list[dict[str, Any]]:
        try:
            parsed = json.loads(raw.decode("utf-8-sig"))
        except Exception as exc:
            raise ValueError(f"invalid json file: {exc}") from exc
        if not isinstance(parsed, list):
            raise ValueError("import file must be a JSON array")
        rows: list[dict[str, Any]] = []
        for item in parsed:
            if isinstance(item, dict):
                rows.append(dict(item))
        return rows

    def import_pool_from_bytes(self, pool_type: str, raw: bytes) -> dict[str, Any]:
        safe_type = self._normalize_pool_type(pool_type)
        rows = self._parse_import_bytes(raw)

        if safe_type == "site":
            existing_names = {
                str(item.get("name", "")).strip()
                for item in self.db.site_pool
                if isinstance(item, dict) and str(item.get("name", "")).strip()
            }
            pending_names: set[str] = set()
            accepted_rows: list[dict[str, Any]] = []
            skipped = 0
            failed = 0
            for item in rows:
                try:
                    normalized = SitePayload.from_raw(
                        item,
                        require_name=True,
                        require_url=True,
                    ).to_dict()
                    normalized.pop("template", None)
                    normalized.pop("__template_key", None)
                    name = str(normalized.get("name", "")).strip()
                    if not name:
                        failed += 1
                        continue
                    if name in existing_names or name in pending_names:
                        skipped += 1
                        continue
                    pending_names.add(name)
                    accepted_rows.append(normalized)
                except Exception:
                    failed += 1
            created = self.site_mgr.add_entries(accepted_rows, save=False) if accepted_rows else []
            if created:
                self.db.batch_update_site_pool(
                    upserts=[entry.to_dict() for entry in created],
                )
            if callable(self._sync_sites):
                self._sync_sites()
            return {
                "pool_type": "site",
                "imported": len(created),
                "skipped": skipped,
                "failed": failed,
            }

        existing_names = {
            str(item.get("name", "")).strip()
            for item in self.db.api_pool
            if isinstance(item, dict) and str(item.get("name", "")).strip()
        }
        pending_names: set[str] = set()
        resolver = (
            self._resolve_site_name if callable(self._resolve_site_name) else None
        )
        normalized_rows: list[dict[str, Any]] = []
        skipped = 0
        failed = 0
        for item in rows:
            try:
                normalized = ApiPayload.from_raw(
                    item,
                    require_name=True,
                    require_url=True,
                    resolve_site_name=resolver,
                ).to_dict()
                normalized.pop("template", None)
                normalized.pop("__template_key", None)
                name = str(normalized.get("name", "")).strip()
                if not name:
                    failed += 1
                    continue
                if name in existing_names or name in pending_names:
                    skipped += 1
                    continue
                pending_names.add(name)
                normalized_rows.append(normalized)
            except Exception:
                failed += 1
        created = self.api_mgr.add_entries(
            normalized_rows,
            save=False,
            emit_changed=True,
        ) if normalized_rows else []
        if created:
            self.db.batch_update_api_pool(
                upserts=[entry.to_dict() for entry in created],
            )
        return {
            "pool_type": "api",
            "imported": len(created),
            "skipped": skipped,
            "failed": failed,
        }

    def import_pool_from_file(self, pool_type: str, file_name: str) -> dict[str, Any]:
        path = self._resolve_pool_file_path(file_name)
        result = self.import_pool_from_bytes(pool_type, path.read_bytes())
        result["file_name"] = path.name
        return result

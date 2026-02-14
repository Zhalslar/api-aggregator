from __future__ import annotations

import ast
import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ..config import APIConfig
from ..database import SQLiteDatabase
from ..log import logger
from ..model import DataType
from .api_entry import APIEntry


class APIEntryManager:
    """Manage API entries and persistence mapping."""

    def __init__(self, config: APIConfig, db: SQLiteDatabase | None = None):
        self.cfg = config
        self.db = db or SQLiteDatabase(self.cfg)
        self.builtin_file = self.cfg.builtin_apis_file
        self.pool = self.db.api_pool
        self.entries: list[APIEntry] = []
        self.on_changed: list[Callable[[], None]] = []

    def _save_to_database(self) -> None:
        self.db.save_api_pool()

    async def initialize(self) -> None:
        # Support restart: rebuild in-memory entries from current pool state.
        self.entries.clear()

        if not self.pool:
            builtin_entries = self.load_entry_file(self.builtin_file)
            logger.info("load builtin api entries: %s", self.builtin_file)
            for item in builtin_entries:
                try:
                    self.add_entry(data=item, save=False, emit_changed=False)
                except Exception as exc:
                    logger.error(
                        "load builtin api failed: %s -> %s", item.get("name"), exc
                    )
            self._save_to_database()
            return

        stored_entries = [dict(item) for item in self.pool if isinstance(item, dict)]
        self.pool.clear()
        for item in stored_entries:
            try:
                self.add_entry(data=item, save=False, emit_changed=False)
            except Exception as exc:
                logger.error(
                    "load api from database failed: %s -> %s", item.get("name"), exc
                )
        self._save_to_database()

    @staticmethod
    def load_entry_file(file: Path) -> list[dict[str, Any]]:
        try:
            with file.open(encoding="utf-8-sig") as f:
                return json.loads(f.read())
        except Exception as exc:
            logger.error("load api file failed: %s -> %s", file, exc)
            return []

    def _emit_changed(self) -> None:
        for cb in self.on_changed:
            cb()

    def get_entry(self, name: str) -> APIEntry | None:
        for entry in self.entries:
            if entry.name == name:
                return entry
        return None

    def list_entries(self) -> list[APIEntry]:
        return list(self.entries)

    def list_entries_names(self) -> list[str]:
        return [entry.name for entry in self.entries]

    def list_enabled_entries(self) -> list[APIEntry]:
        return [entry for entry in self.entries if entry.enabled]

    def list_disabled_entries(self) -> list[APIEntry]:
        return [entry for entry in self.entries if not entry.enabled]

    def list_invalid_entries(self) -> list[APIEntry]:
        return [entry for entry in self.entries if not entry.valid]

    def list_valid_entries(self) -> list[APIEntry]:
        return [entry for entry in self.entries if entry.valid]

    def set_entries_valid(
        self,
        names: list[str],
        valid: bool,
    ) -> tuple[list[str], list[str]]:
        success: list[str] = []
        failed: list[str] = []
        changed = False

        cfg_map = {cfg.get("name"): cfg for cfg in self.pool}
        for name in names:
            entry = self.get_entry(name)
            if not entry:
                failed.append(name)
                continue

            if entry.valid != valid:
                entry.valid = valid
                cfg = cfg_map.get(name)
                if isinstance(cfg, dict):
                    cfg["valid"] = valid
                changed = True
            success.append(name)

        if changed:
            self._save_to_database()
            self._emit_changed()

        return success, failed

    def match_entries(
        self,
        text: str,
        *,
        user_id: str = "",
        group_id: str = "",
        session_id: str = "",
        is_admin: bool = False,
        only_enabled: bool = True,
    ) -> list[APIEntry]:
        """Match entries by text and runtime context.

        Returns deep-copied entries so callers can safely mutate runtime params
        (for example `entry.updated_params`) without affecting manager state.
        """
        candidates = self.list_enabled_entries() if only_enabled else self.entries
        matched: list[APIEntry] = []
        for entry in candidates:
            if entry.check_activate(
                text=text,
                user_id=user_id,
                group_id=group_id,
                session_id=session_id,
                is_admin=is_admin,
            ):
                matched.append(copy.deepcopy(entry))
        return matched

    def _resolve_unique_name(self, name: str) -> str:
        if not self.get_entry(name):
            return name
        index = 2
        while True:
            new_name = f"{name}_{index}"
            if not self.get_entry(new_name):
                return new_name
            index += 1

    @staticmethod
    def _to_bool(value: Any, default: bool = True) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"1", "true", "yes", "on"}:
                return True
            if lowered in {"0", "false", "no", "off", ""}:
                return False
        return bool(value)

    @staticmethod
    def _to_dict(value: Any, default: dict[str, Any] | None = None) -> dict[str, Any]:
        if isinstance(value, dict):
            return dict(value)
        return dict(default or {})

    @staticmethod
    def _to_str_list(value: Any, default: list[str] | None = None) -> list[str]:
        if value is None:
            return list(default or [])
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            text = value.strip()
            return [text] if text else list(default or [])
        return list(default or [])

    def add_entry(
        self,
        data: dict | None = None,
        *,
        name: str | None = None,
        url: str | None = None,
        save: bool = True,
        emit_changed: bool = True,
    ) -> APIEntry:
        payload = dict(data or {})
        if name is not None:
            payload["name"] = name.strip()
        if url is not None:
            payload["url"] = url.strip()

        if not payload.get("name"):
            raise ValueError("add_entry missing required field: name")
        if not payload.get("url"):
            raise ValueError("add_entry missing required field: url")

        entry_name = self._resolve_unique_name(payload["name"])
        full_data = {
            "name": entry_name,
            "url": payload["url"],
            "type": payload.get("type") or "text",
            "params": self._to_dict(payload.get("params")),
            "parse": payload.get("parse") or "",
            "enabled": self._to_bool(payload.get("enabled"), default=True),
            "scope": self._to_str_list(payload.get("scope")),
            "keywords": self._to_str_list(
                payload.get("keywords"), default=[entry_name]
            ),
            "cron": payload.get("cron") or "",
            "valid": self._to_bool(payload.get("valid"), default=True),
            "site": str(payload.get("site") or "").strip(),
        }

        entry = APIEntry(full_data)
        self.entries.append(entry)
        self.pool.append(full_data)
        if save:
            self._save_to_database()
        if emit_changed and entry.enabled_cron:
            self._emit_changed()
        return entry

    def remove_entries(self, names: list[str]) -> tuple[list[str], list[str]]:
        success: list[str] = []
        failed: list[str] = []

        remaining_entries: list[APIEntry] = []
        remaining_configs: list[dict[str, Any]] = []
        name_set = set(names)

        for entry, cfg in zip(self.entries, self.pool):
            if entry.name in name_set:
                success.append(entry.name)
            else:
                remaining_entries.append(entry)
                remaining_configs.append(cfg)

        for name in names:
            if name not in success:
                failed.append(name)

        self.entries[:] = remaining_entries
        self.pool[:] = remaining_configs
        if success:
            self._save_to_database()
            self._emit_changed()
        return success, failed

    def add_scope_to_entry(self, name: str, scope: str) -> bool:
        entry = self.get_entry(name)
        if not entry:
            return False
        changed = entry.add_scope(scope)
        if changed:
            self._save_to_database()
        return True

    def remove_scope_from_entry(self, name: str, scope: str) -> bool:
        entry = self.get_entry(name)
        if not entry:
            return False
        changed = entry.remove_scope(scope)
        if changed:
            self._save_to_database()
        return True

    def update_keywords(self, name: str, keywords: list[str]) -> bool:
        entry = self.get_entry(name)
        if not entry:
            return False
        entry.set_keywords(keywords)
        self._save_to_database()
        return True

    def display_entries(self) -> str:
        if not self.entries:
            return "No API entries registered."
        api_types: dict[str, list[APIEntry]] = {t: [] for t in DataType.values()}
        api_types.setdefault("unknown", [])
        for entry in self.entries:
            api_type = entry.type or "unknown"
            api_types.setdefault(api_type, [])
            api_types[api_type].append(entry)

        lines = [f"---- total {len(self.entries)} APIs ----", ""]
        for api_type, items in api_types.items():
            if not items:
                continue
            lines.append(f"[{api_type}] {len(items)}:")
            lines.append(" | ".join(item.name for item in items))
            lines.append("")
        return "\n".join(lines).strip()

    @staticmethod
    def parse_display_text(text: str) -> dict[str, Any] | None:
        if not text or not text.strip():
            return None
        data: dict[str, Any] = {}
        field_map = {
            "api name": "name",
            "api url": "url",
            "api type": "type",
            "params": "params",
            "parse path": "parse",
            "enabled": "enabled",
            "scope": "scope",
            "regex triggers": "keywords",
            "cron trigger": "cron",
            "valid": "valid",
        }
        for raw_line in text.strip().splitlines():
            line = raw_line.strip()
            if not line or ":" not in line:
                continue
            key, value = line.split(":", 1)
            field = field_map.get(key.strip())
            if not field:
                continue
            value = value.strip()
            if field in ("params", "scope", "keywords"):
                if value:
                    data[field] = ast.literal_eval(value)
                else:
                    data[field] = {} if field == "params" else []
            elif field in ("enabled", "valid"):
                data[field] = value.lower() == "true"
            else:
                data[field] = value
        return data

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..config import APIConfig
from ..database import JSONDatabase
from ..log import logger
from .site_entry import SiteEntry


class SiteEntryManager:
    """Manage site entries and persistence mapping."""

    def __init__(self, config: APIConfig, db: JSONDatabase):
        self.cfg = config
        self.db = db
        self.builtin_file = self.cfg.builtin_sites_file
        self.pool = self.db.site_pool
        self.entries: list[SiteEntry] = []

    def _save_to_database(self) -> None:
        self.db.save_to_database()

    async def initialize(self) -> None:
        # Support restart: rebuild in-memory entries from current pool state.
        self.entries.clear()

        if not self.pool:
            builtin_entries = self.load_entry_file(self.builtin_file)
            logger.info("load builtin site entries: %s", self.builtin_file)
            for item in builtin_entries:
                try:
                    self.add_entry(data=item, save=False)
                except Exception as exc:
                    logger.error(
                        "load builtin site failed: %s -> %s", item.get("name"), exc
                    )
            self._save_to_database()
            return

        for item in self.pool:
            self.entries.append(SiteEntry(item))

    @staticmethod
    def load_entry_file(file: Path) -> list[dict[str, Any]]:
        try:
            with file.open(encoding="utf-8-sig") as f:
                return json.loads(f.read())
        except Exception as exc:
            logger.error("load site file failed: %s -> %s", file, exc)
            return []

    def _resolve_unique_name(self, name: str) -> str:
        if not self.get_entry(name):
            return name
        index = 2
        while True:
            new_name = f"{name}_{index}"
            if not self.get_entry(new_name):
                return new_name
            index += 1

    def add_entry(
        self,
        data: dict | None = None,
        *,
        name: str | None = None,
        url: str | None = None,
        save: bool = True,
    ) -> SiteEntry:
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
            "__template_key": "default",
            "name": entry_name,
            "url": payload["url"],
            "enabled": bool(payload.get("enabled", True)),
            "headers": payload.get("headers", {}),
            "keys": payload.get("keys", {}),
            "timeout": int(payload.get("timeout", 60)),
        }

        entry = SiteEntry(full_data)
        self.entries.append(entry)
        self.pool.append(full_data)
        if save:
            self._save_to_database()
        return entry

    def get_entry(self, name: str) -> SiteEntry | None:
        for entry in self.entries:
            if entry.name == name:
                return entry
        return None

    def list_entries(self) -> list[SiteEntry]:
        return list(self.entries)

    def list_enabled_entries(self) -> list[SiteEntry]:
        return [entry for entry in self.entries if entry.enabled]

    def list_disabled_entries(self) -> list[SiteEntry]:
        return [entry for entry in self.entries if not entry.enabled]

    def match_entry(
        self,
        full_url: str,
        *,
        only_enabled: bool = True,
    ) -> SiteEntry | None:
        candidates = self.list_enabled_entries() if only_enabled else self.entries
        for entry in candidates:
            if entry.is_vested(full_url):
                return entry
        return None

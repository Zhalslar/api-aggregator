from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .log import get_logger

logger = get_logger("database")


class JSONDatabase:
    """JSON-backed storage for site/api pools."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)

        self.site_pool_file = self.data_dir / "site_pool.json"
        self.api_pool_file = self.data_dir / "api_pool.json"

        self.site_pool: list[dict[str, Any]] = self._load_pool_file(self.site_pool_file)
        self.api_pool: list[dict[str, Any]] = self._load_pool_file(self.api_pool_file)

    def _load_pool_file(self, file: Path) -> list[dict[str, Any]]:
        if file.exists():
            try:
                with file.open("r", encoding="utf-8-sig") as f:
                    return self._normalize_pool_data(json.load(f))
            except Exception as exc:
                logger.error("load pool file failed: %s -> %s", file, exc)

        self._save_pool_file(file, [])
        return []

    @staticmethod
    def _normalize_pool_data(data: Any) -> list[dict[str, Any]]:
        if not isinstance(data, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in data:
            if isinstance(item, dict):
                normalized.append(dict(item))
        return normalized

    def _save_pool_file(self, file: Path, data: list[dict[str, Any]]) -> None:
        try:
            file.parent.mkdir(parents=True, exist_ok=True)
            with file.open("w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as exc:
            logger.error("save pool file failed: %s -> %s", file, exc)

    def save_to_database(self) -> None:
        self._save_pool_file(self.site_pool_file, self.site_pool)
        self._save_pool_file(self.api_pool_file, self.api_pool)

    def reload_from_database(self) -> None:
        self.site_pool[:] = self._load_pool_file(self.site_pool_file)
        self.api_pool[:] = self._load_pool_file(self.api_pool_file)

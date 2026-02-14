from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class DashboardConfig:
    enabled: bool = True
    host: str = "0.0.0.0"
    port: int = 4141


class APIConfig:
    """Core plugin config independent from AstrBot internals."""

    def __init__(self, data_dir: Path | None):
        project_root = Path.cwd()

        self.data_dir = data_dir or project_root / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.data_dir / "app_config.json"

        persisted = self._load_or_init_persisted_config(
            project_root, raw_file=self.config_file
        )

        dashboard_cfg = persisted.get("dashboard", {})
        self.dashboard = DashboardConfig(
            enabled=bool(dashboard_cfg.get("enabled", True)),
            host=str(dashboard_cfg.get("host", "0.0.0.0")),
            port=self._to_int(dashboard_cfg.get("port"), default=4141, minimum=1),
        )

        self.local_dir = self.data_dir / "local"
        self.local_dir.mkdir(parents=True, exist_ok=True)

        paths_cfg = persisted.get("paths", {})
        presets_dir_raw = str(paths_cfg.get("presets_dir", "presets")).strip()
        presets_dir = Path(presets_dir_raw) if presets_dir_raw else Path("presets")
        if not presets_dir.is_absolute():
            presets_dir = project_root / presets_dir
        self.presets_dir = presets_dir
        self.builtin_sites_file = self.presets_dir / "builtin_sites.json"
        self.builtin_apis_file = self.presets_dir / "builtin_apis.json"

        http_cfg = persisted.get("http", {})
        self.default_request_timeout = self._to_int(
            http_cfg.get("default_timeout"), default=60, minimum=1
        )
        headers = http_cfg.get("default_headers", {})
        self.default_request_headers = (
            {str(k): str(v) for k, v in headers.items()}
            if isinstance(headers, dict)
            else {}
        )

        logging_cfg = persisted.get("logging", {})
        self.log_level = self._parse_log_level(logging_cfg.get("level", "INFO"))

    @staticmethod
    def _default_persisted_config(project_root: Path) -> dict[str, Any]:
        return {
            "dashboard": {
                "enabled": True,
                "host": "0.0.0.0",
                "port": 4141,
            },
            "http": {
                "default_timeout": 60,
                "default_headers": {
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/122.0.0.0 Safari/537.36"
                    ),
                    "Accept": "*/*",
                },
            },
            "logging": {
                "level": "INFO",
            },
            "paths": {
                "presets_dir": "presets",
            },
        }

    @classmethod
    def _load_or_init_persisted_config(
        cls, project_root: Path, raw_file: Path | None = None
    ) -> dict[str, Any]:
        defaults = cls._default_persisted_config(project_root)
        cfg_file = raw_file or (project_root / "data" / "app_config.json")
        loaded: dict[str, Any] = {}
        if cfg_file.exists():
            try:
                with cfg_file.open("r", encoding="utf-8-sig") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    loaded = data
            except Exception:
                loaded = {}

        merged = cls._merge_dict(defaults, loaded)
        cfg_file.parent.mkdir(parents=True, exist_ok=True)
        with cfg_file.open("w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        return merged

    @staticmethod
    def _merge_dict(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        merged: dict[str, Any] = dict(base)
        for key, value in incoming.items():
            if (
                key in merged
                and isinstance(merged[key], dict)
                and isinstance(value, dict)
            ):
                merged[key] = APIConfig._merge_dict(merged[key], value)
            else:
                merged[key] = value
        return merged

    @staticmethod
    def _parse_log_level(value: Any) -> int:
        text = str(value).strip().upper()
        if not text:
            return logging.INFO
        return logging._nameToLevel.get(text, logging.INFO)

    @staticmethod
    def _to_int(value: Any, *, default: int, minimum: int | None = None) -> int:
        try:
            parsed = int(value)
        except Exception:
            parsed = default
        if minimum is not None and parsed < minimum:
            return default
        return parsed

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class DashboardConfig:
    enabled: bool = True
    host: str = "0.0.0.0"
    port: int = 4141


class APIConfig:
    """Core plugin config independent from AstrBot internals."""

    def __init__(self):
        project_root = Path.cwd()

        self.data_dir = project_root / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.data_dir / "app_config.json"

        self.dashboard = DashboardConfig()

        self.local_dir = self.data_dir / "local"
        self.local_dir.mkdir(parents=True, exist_ok=True)

        self.pool_files_dir = Path("pool_files")

        self.default_request_timeout = 60
        self.default_request_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept": "*/*",
        }

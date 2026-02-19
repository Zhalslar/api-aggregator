from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class DashboardConfig:
    enabled: bool = True
    host: str = "0.0.0.0"
    port: int = 4141


class APIConfig:
    def __init__(self, *, data_dir: Path | None = None):
        self.dashboard = DashboardConfig()

        self.dashboard_assets_dir = (
                Path(__file__).resolve().parent / "dashboard" / "assets"
            )
        self.logo_path = self.dashboard_assets_dir / "images" / "logo.png"

        project_root = Path(__file__).resolve().parents[2]
        self.data_dir = (data_dir or (project_root / "data")).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)

        self.local_dir = self.data_dir / "local"
        self.local_dir.mkdir(parents=True, exist_ok=True)

        self.pool_files_dir = (project_root / "pool_files").resolve()
        self.pool_files_dir.mkdir(parents=True, exist_ok=True)

        self.default_request_timeout = 60
        self.default_request_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept": "*/*",
        }

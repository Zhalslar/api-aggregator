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

    def __init__(self, data_dir: Path | None):
        self.data_dir = data_dir or Path(__file__).parent / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)

        self.dashboard = DashboardConfig()

        self.local_dir = self.data_dir / "local"
        self.local_dir.mkdir(parents=True, exist_ok=True)

        self.source_dir = Path(__file__).parent / "source"
        self.builtin_sites_file = self.source_dir / "builtin_sites.json"
        self.builtin_apis_file = self.source_dir / "builtin_apis.json"

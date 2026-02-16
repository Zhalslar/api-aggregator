from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..config import APIConfig


@dataclass
class FileAccessError(Exception):
    message: str
    status: int = 400

    def __str__(self) -> str:
        return self.message


class FileAccessService:
    """Resolve and validate file access under controlled roots."""

    def __init__(self, config: APIConfig) -> None:
        self.local_dir = config.local_dir
        self.assets_root = config.dashboard_assets_dir
        self.logo_path = config.logo_path

    @staticmethod
    def _normalize_rel_path(value: str) -> str:
        return str(value or "").strip().replace("\\", "/")

    @staticmethod
    def _content_type_for(path: Path) -> str:
        if path.suffix == ".js":
            return "application/javascript"
        if path.suffix == ".css":
            return "text/css"
        if path.suffix == ".html":
            return "text/html"
        return "application/octet-stream"

    def _ensure_within(self, root: Path, target: Path, *, field: str) -> None:
        if target != root and root not in target.parents:
            raise FileAccessError(f"invalid {field}", status=403)

    def resolve_asset(self, relative_path: str) -> tuple[Path, str, bool]:
        rel = self._normalize_rel_path(relative_path)
        if not rel:
            raise FileAccessError("missing asset path", status=400)

        target = (self.assets_root / rel).resolve()
        self._ensure_within(self.assets_root, target, field="asset path")
        if not target.exists() or not target.is_file():
            raise FileAccessError("asset not found", status=404)

        content_type = self._content_type_for(target)
        text_mode = target.suffix in {".js", ".css", ".html"}
        return target, content_type, text_mode

    def resolve_logo(self) -> Path:
        if not self.logo_path.exists():
            raise FileAccessError("logo not found", status=404)
        return self.logo_path

    def resolve_local_file(self, relative_path: str) -> Path:
        rel = self._normalize_rel_path(relative_path)
        if not rel:
            raise FileAccessError("missing path", status=400)

        target = (self.local_dir / rel).resolve()
        self._ensure_within(self.local_dir, target, field="path")
        if not target.exists() or not target.is_file():
            raise FileAccessError("file not found", status=404)
        return target

# core/entry.py
from __future__ import annotations

from ..model import ConfigNode


class SiteEntry(ConfigNode):
    """站点条目"""

    name: str
    url: str
    enabled: bool
    headers: dict[str, str]
    keys: dict[str, str]
    timeout: int

    def __init__(self, data: dict):
        super().__init__(data)

    def is_vested(self, full_url: str):
        return full_url.startswith(self.url)

    def get_headers(self) -> dict[str, str]:
        return self.headers.copy()

    def get_keys(self) -> dict[str, str]:
        return self.keys.copy()


# core/entry.py
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from ..log import logger
from ..model import ConfigNode, DataType


class APIEntry(ConfigNode):
    """API entry."""

    name: str
    url: str
    type: str
    params: dict[str, Any]
    parse: str
    enabled: bool
    scope: list[str]
    keywords: list[str]
    cron: str
    valid: bool
    site: str

    @staticmethod
    def _to_bool(value: Any, default: bool) -> bool:
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
    def _to_dict(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return dict(value)
        return {}

    @staticmethod
    def _to_str_list(value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            text = value.strip()
            return [text] if text else []
        return []

    @classmethod
    def _normalize_data(cls, data: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(data)
        name = str(normalized.get("name", "")).strip()
        normalized["name"] = name
        normalized["url"] = str(normalized.get("url", "")).strip()
        normalized["type"] = str(normalized.get("type") or "text").strip() or "text"
        normalized["params"] = cls._to_dict(normalized.get("params"))
        normalized["parse"] = str(normalized.get("parse") or "")
        normalized["enabled"] = cls._to_bool(normalized.get("enabled"), True)
        normalized["scope"] = cls._to_str_list(normalized.get("scope"))
        keywords = cls._to_str_list(normalized.get("keywords"))
        normalized["keywords"] = keywords or ([name] if name else [])
        normalized["cron"] = str(normalized.get("cron") or "")
        normalized["valid"] = cls._to_bool(normalized.get("valid"), True)
        normalized["site"] = str(normalized.get("site") or "").strip()
        return normalized

    def __init__(self, data: dict):
        normalized = self._normalize_data(data if isinstance(data, dict) else {})
        super().__init__(normalized)
        try:
            self._data_type = DataType.from_str(self.type)
        except Exception:
            self.type = DataType.TEXT.value
            self._data_type = DataType.TEXT
        self._compiled_patterns: list[re.Pattern] = []
        self._compile_patterns()
        self.updated_params: dict[str, Any] = {}

    def to_dict(self) -> dict[str, Any]:
        """Convert to dict."""
        return {
            "name": self.name,
            "url": self.url,
            "type": self.type,
            "params": self._to_dict(self.params),
            "parse": self.parse,
            "enabled": self.enabled,
            "scope": self._to_str_list(self.scope),
            "keywords": self._to_str_list(self.keywords),
            "cron": self.cron,
            "valid": self.valid,
            "site": self.site,
        }

    def display(self):
        """Render entry as display text."""
        return (
            f"api name: {self.name}\n"
            f"api url: {self.url}\n"
            f"api type: {self.type}\n"
            f"params: {self.params}\n"
            f"parse path: {self.parse}\n"
            f"enabled: {self.enabled}\n"
            f"scope: {self.scope}\n"
            f"regex triggers: {self.keywords}\n"
            f"cron trigger: {self.cron}\n"
            f"valid: {self.valid}"
        )

    # =============== Status ==================

    @property
    def enabled_cron(self) -> bool:
        """Whether cron is enabled (standard 5-field cron)."""
        if not self.enabled:
            return False
        return len(str(self.cron).split()) == 5

    @property
    def data_type(self) -> DataType:
        """Data type."""
        return self._data_type

    def get_base_url(self) -> str:
        """Get base URL."""
        parsed = urlparse(self.url)
        return (
            f"{parsed.scheme}://{parsed.netloc}"
            if parsed.scheme and parsed.netloc
            else self.url
        )

    # =============== Regex ===================

    def _compile_patterns(self) -> None:
        """Compile keyword regex patterns."""
        self._compiled_patterns.clear()
        if self.keywords:
            self.keywords = [k for k in self.keywords if k.strip()]

            for pattern in self.keywords:
                try:
                    self._compiled_patterns.append(re.compile(pattern))
                except re.error as e:
                    logger.warning(
                        f"[entry:{self.name}] regex compile failed: {pattern} ({e})"
                    )

    def _match_keywords(self, text: str) -> bool:
        """Whether any keyword regex matches."""
        for p in self._compiled_patterns:
            if p.search(text):
                return True
        return False

    # =============== Activation decision ==================

    def _allow_scope(
        self,
        *,
        user_id: str,
        group_id: str,
        session_id: str,
        is_admin: bool,
    ) -> bool:
        """Scope access gate."""
        if not self.scope:
            return True

        for s in self.scope:
            if s == "admin" and is_admin:
                return True
            if s == user_id:
                return True
            if s == group_id:
                return True
            if s == session_id:
                return True
        return False

    def check_activate(
        self,
        *,
        text: str,
        user_id: str,
        group_id: str,
        session_id: str,
        is_admin: bool,
    ) -> bool:
        """Unified activation check."""

        # Gate 1: global switch
        if not self.enabled:
            return False

        # Gate 2: validity
        if not self.valid:
            return False

        # Gate 3: scope gate
        if not self._allow_scope(
            user_id=user_id,
            group_id=group_id,
            session_id=session_id,
            is_admin=is_admin,
        ):
            return False

        # Gate 4: regex match
        if not self._match_keywords(text):
            return False

        return True

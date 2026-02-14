# core/entry.py
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from ..log import logger
from ..model import ConfigNode, DataType


class APIEntry(ConfigNode):
    """API 条目"""

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

    def __init__(self, data: dict):
        super().__init__(data)
        self._data_type = DataType.from_str(self.type)
        self._compiled_patterns: list[re.Pattern] = []
        self._compile_patterns()
        self.updated_params: dict[str, Any] = {}

    def to_dict(self) -> dict[str, Any]:
        """转化为字典"""
        return {
            "name": self.name,
            "url": self.url,
            "type": self.type,
            "params": self.params,
            "parse": self.parse,
            "enabled": self.enabled,
            "scope": list(self.scope),
            "keywords": list(self.keywords),
            "cron": self.cron,
            "valid": self.valid,
        }

    def display(self):
        """展示条目"""
        return (
            f"api名称：{self.name}\n"
            f"api地址：{self.url}\n"
            f"api类型：{self.type}\n"
            f"所需参数：{self.params}\n"
            f"解析路径：{self.parse}\n"
            f"是否启用：{self.enabled}\n"
            f"触发范围：{self.scope}\n"
            f"正则触发：{self.keywords}\n"
            f"定时触发：{self.cron}\n"
            f"是否有效：{self.valid}"
        )

    # =============== 状态 ==================

    @property
    def enabled_cron(self) -> bool:
        """是否启用定时任务 (标准 5 段 cron)"""
        if not self.enabled:
            return False
        return len(str(self.cron).split()) == 5

    @property
    def data_type(self) -> DataType:
        """数据类型"""
        return self._data_type

    def get_base_url(self) -> str:
        """获取基础 URL"""
        parsed = urlparse(self.url)
        return (
            f"{parsed.scheme}://{parsed.netloc}"
            if parsed.scheme and parsed.netloc
            else self.url
        )

    # =============== 正则 ===================

    def _compile_patterns(self) -> None:
        """编译正则"""
        self._compiled_patterns.clear()
        if self.keywords:
            self.keywords = [k for k in self.keywords if k.strip()]

            for pattern in self.keywords:
                try:
                    self._compiled_patterns.append(re.compile(pattern))
                except re.error as e:
                    logger.warning(f"[条目:{self.name}] 正则编译失败: {pattern} ({e})")

    def _match_keywords(self, text: str) -> bool:
        """是否命中任一关键词正则"""
        for p in self._compiled_patterns:
            if p.search(text):
                return True
        return False

    # =============== 激活决策 ==================

    def _allow_scope(
        self,
        *,
        user_id: str,
        group_id: str,
        session_id: str,
        is_admin: bool,
    ) -> bool:
        """scope 权限大门"""
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
        """统一激活判决"""

        # Gate 1: 总开关
        if not self.enabled:
            return False

        # Gate 2: 有效性
        if not self.valid:
            return False

        # Gate 3: scope 权限大门
        if not self._allow_scope(
            user_id=user_id,
            group_id=group_id,
            session_id=session_id,
            is_admin=is_admin,
        ):
            return False

        # Gate 4: 匹配正则
        if not self._match_keywords(text):
            return False

        return True

import json
import random
import re
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

from bs4 import BeautifulSoup


@dataclass
class RequestResult:
    """请求结果对象"""

    status: int | None = None
    raw_text: str | None = None
    raw_content: bytes | None = None
    content_type: str | None = None
    error: str | None = None
    final_url: str | None = None

    # --------------------------
    # 基础属性
    # --------------------------

    @property
    def ok(self) -> bool:
        return self.error is None

    @property
    def is_text(self) -> bool:
        return self.raw_text is not None

    @property
    def is_binary(self) -> bool:
        return self.raw_content is not None

    @property
    def text(self) -> str | None:
        return self.raw_text

    @property
    def content(self) -> bytes | None:
        return self.raw_content

    # --------------------------
    # 数据处理逻辑
    # --------------------------

    def parse_nested(self, parse_rule: str):
        """JSON嵌套解析"""
        if not self.raw_text:
            return self

        try:
            data = json.loads(self.raw_text)
            value = self._get_nested_value(data, parse_rule)

            if isinstance(value, dict):
                self.raw_text = self.dict_to_string(value)
            else:
                self.raw_text = str(value)

        except Exception:
            pass

        return self

    def extract_html_text(self):
        """HTML纯文本提取"""
        if self.raw_text and self.raw_text.strip().startswith("<!DOCTYPE html>"):
            soup = BeautifulSoup(self.raw_text, "html.parser")
            self.raw_text = soup.get_text(strip=True)
        return self

    def extract_urls(self, *, unique: bool = True) -> list[str]:
        """提取URL"""
        if not self.raw_text:
            return []

        regex = re.compile(
            r'(https?://[^\s<>"{}|\\^`\[\]\')(),;]+\b)',
            re.IGNORECASE,
        )
        candidates = regex.findall(self.raw_text)

        valid, seen = [], set()

        for raw in candidates:
            raw = raw.strip("\"'")
            raw = unquote(raw)
            parsed = urlparse(raw)

            if parsed.scheme in {"http", "https"} and parsed.netloc:
                if unique and raw in seen:
                    continue
                if unique:
                    seen.add(raw)
                valid.append(raw)

        return valid

    def dict_to_string(self, input_dict) -> str:
        """
        将字典转换为指定格式的字符串，支持嵌套字典。
        每一级缩进增加两个空格，直到解析到没有字典嵌套为止。
        """

        def recursive_parse(d, level):
            result = ""
            indent = " " * (level * 2)  # 当前层级的缩进
            for key, value in d.items():
                if isinstance(value, dict):  # 如果值是字典，则递归处理
                    result += f"{indent}{key}:\n"
                    result += recursive_parse(value, level + 1)  # 增加缩进
                elif isinstance(value, list):
                    for item in value:
                        result += "\n\n"
                        result += recursive_parse(item, level)  # 增加缩进
                else:
                    result += f"{indent}{key}: {value}\n"
            return result.strip()

        return recursive_parse(input_dict, 0)

    @staticmethod
    def _get_nested_value(result: dict, target: str):
        keys = [key for key in re.split(r"\.|(\[\d*\])", target) if key and key.strip()]

        value = result

        for key in keys:
            key = key.strip("[]")

            if isinstance(value, dict):
                value = value.get(key, "")
            elif isinstance(value, list):
                if key == "":
                    if value:
                        value = random.choice(value)
                    else:
                        return ""
                elif key.isdigit():
                    index = int(key)
                    if 0 <= index < len(value):
                        value = value[index]
                    else:
                        return ""
                else:
                    return ""
            else:
                return ""

        return value

    def is_valid(self) -> bool:
        """
        判断该请求结果是否“业务有效”

        规则：
        1. 网络必须成功 (ok)
        2. HTTP status 必须是 2xx
        3. 二进制数据：长度 > 0 即认为有效
        4. JSON：
            - 可正常解析
            - 若存在 code 且不在 (0, 200)，判定无效
            - 若存在明显错误字段，判定无效
        5. HTML：
            - 不包含常见错误关键词
        6. 普通文本：
            - 非空即可
        """

        # 网络层判断
        if not self.ok:
            return False

        if not self.status or not (200 <= self.status < 300):
            return False

        # 二进制数据
        if self.is_binary:
            return bool(self.raw_content and len(self.raw_content) > 0)

        # 文本数据必须存在
        if not self.raw_text:
            return False

        text = self.raw_text.strip()
        if not text:
            return False

        content_type = (self.content_type or "").lower()

        # JSON 判断
        if (
            "application/json" in content_type
            or (text.startswith("{") and text.endswith("}"))
            or (text.startswith("[") and text.endswith("]"))
        ):
            try:
                parsed = json.loads(text)
            except Exception:
                return False

            if isinstance(parsed, dict):
                # ---- 常见 code 字段判断 ----
                code = parsed.get("code")
                if isinstance(code, int) and code not in (0, 200):
                    return False

                # ---- 常见错误字段判断 ----
                for key in ("error", "err", "message", "msg"):
                    val = parsed.get(key)
                    if isinstance(val, str):
                        lowered = val.lower()
                        if any(
                            kw in lowered
                            for kw in (
                                "error",
                                "invalid",
                                "fail",
                                "denied",
                                "unauthorized",
                                "forbidden",
                            )
                        ):
                            return False

            return True

        # HTML 判断
        if "text/html" in content_type or "<html" in text.lower():
            lowered = text.lower()

            error_keywords = [
                "access denied",
                "forbidden",
                "unauthorized",
                "not found",
                "bad request",
                "service unavailable",
                "too many requests",
                "error 403",
                "error 404",
                "error 500",
            ]

            if any(k in lowered for k in error_keywords):
                return False

            return True

        # 普通文本
        return True

from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from types import MappingProxyType, UnionType
from typing import Any, Union, get_args, get_origin, get_type_hints


class ConfigNode:
    """
    配置节点, 把 dict 变成强类型对象。

    规则：
    - schema 来自子类类型注解
    - 声明字段：读写，写回底层 dict
    - 未声明字段和下划线字段：仅挂载属性，不写回
    - 支持 ConfigNode 多层嵌套（lazy + cache）
    """

    _SCHEMA_CACHE: dict[type, dict[str, type]] = {}
    _FIELDS_CACHE: dict[type, set[str]] = {}

    @classmethod
    def _schema(cls) -> dict[str, type]:
        return cls._SCHEMA_CACHE.setdefault(cls, get_type_hints(cls))

    @classmethod
    def _fields(cls) -> set[str]:
        return cls._FIELDS_CACHE.setdefault(
            cls,
            {k for k in cls._schema() if not k.startswith("_")},
        )

    @staticmethod
    def _is_optional(tp: type) -> bool:
        if get_origin(tp) in (Union, UnionType):
            return type(None) in get_args(tp)
        return False

    def __init__(self, data: MutableMapping[str, Any]):
        object.__setattr__(self, "_data", data)
        object.__setattr__(self, "_children", {})
        for key, tp in self._schema().items():
            if key.startswith("_"):
                continue
            if key in data:
                continue
            if hasattr(self.__class__, key):
                continue
            if self._is_optional(tp):
                continue
            print(f"[config:{self.__class__.__name__}] 缺少字段: {key}")

    def __getattr__(self, key: str) -> Any:
        if key in self._fields():
            value = self._data.get(key)
            tp = self._schema().get(key)

            if isinstance(tp, type) and issubclass(tp, ConfigNode):
                children: dict[str, ConfigNode] = self.__dict__["_children"]
                if key not in children:
                    if not isinstance(value, MutableMapping):
                        raise TypeError(
                            f"[config:{self.__class__.__name__}] "
                            f"字段 {key} 期望 dict，实际是 {type(value).__name__}"
                        )
                    children[key] = tp(value)
                return children[key]

            return value

        if key in self.__dict__:
            return self.__dict__[key]

        raise AttributeError(key)

    def __setattr__(self, key: str, value: Any) -> None:
        if key in self._fields():
            self._data[key] = value
            return
        object.__setattr__(self, key, value)

    def raw_data(self) -> Mapping[str, Any]:
        """
        底层配置 dict 的只读视图
        """
        return MappingProxyType(self._data)



class DataType(str, Enum):
    TEXT = "text"
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"

    # ===============================
    # 基础增强
    # ===============================

    @classmethod
    def from_str(cls, value: str) -> "DataType":
        """安全从字符串转换为枚举"""
        try:
            return cls(value.lower())
        except ValueError:
            raise ValueError(f"不支持的数据类型: {value}")

    @classmethod
    def values(cls) -> list[str]:
        """返回所有字符串值"""
        return [item.value for item in cls]

    @classmethod
    def is_valid(cls, value: str) -> bool:
        """判断字符串是否合法"""
        return value.lower() in cls.values()

    # ===============================
    # 业务相关增强
    # ===============================
    @property
    def is_text(self) -> bool:
        """是否为文本类型"""
        return self == DataType.TEXT

    @property
    def is_image(self) -> bool:
        """是否为图片类型"""
        return self == DataType.IMAGE

    @property
    def is_video(self) -> bool:
        """是否为视频类型"""
        return self == DataType.VIDEO

    @property
    def is_audio(self) -> bool:
        """是否为音频类型"""
        return self == DataType.AUDIO

    @property
    def is_binary(self) -> bool:
        """是否为二进制类型"""
        return self in {DataType.IMAGE, DataType.VIDEO, DataType.AUDIO}

    def get_default_ext(self) -> str:
        """返回默认文件扩展名"""
        return {
            DataType.TEXT: ".json",
            DataType.IMAGE: ".jpg",
            DataType.VIDEO: ".mp4",
            DataType.AUDIO: ".mp3",
        }[self]

    def __str__(self) -> str:
        """打印时更友好"""
        return self.value


@dataclass
class DataResource:
    """通用数据资源"""

    data_type: DataType
    name: str

    # 输入数据
    text: str | None = None
    binary: bytes | None = None

    # 存储结果
    saved_text: str | None = None
    saved_path: Path | None = None
    is_duplicate: bool = False

    @property
    def final_text(self) -> str | None:
        return self.saved_text or self.text

    @property
    def final_bytes(self) -> bytes | Path | None:
        return self.saved_path or self.binary

    def validate_for_save(self) -> None:
        """保存前校验"""
        if self.data_type.is_text and not self.text:
            raise ValueError("文本类型必须提供 text")

        if self.data_type.is_binary and not self.binary:
            raise ValueError("二进制类型必须提供 binary")

        if self.text and self.binary:
            raise ValueError("不能同时提供 text 和 binary")



    def unlink(self) -> None:
        """删除数据并解除数据关联"""
        if self.saved_path and self.saved_path.exists():
            try:
                self.saved_path.unlink()
                self.saved_path = None
            except Exception:
                pass

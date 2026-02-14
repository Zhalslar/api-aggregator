from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from types import MappingProxyType, UnionType
from typing import Any, Union, get_args, get_origin, get_type_hints


class ConfigNode:
    """
    Config node that wraps a dict into a typed object.

    Rules:
    - schema comes from subclass type hints
    - declared fields: readable/writable, writes back to underlying dict
    - undeclared fields and underscore fields: attached only, not persisted
    - supports multi-level ConfigNode nesting (lazy + cache)
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
            print(f"[config:{self.__class__.__name__}] missing field: {key}")

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
                            f"field {key} expected dict, got {type(value).__name__}"
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
        Read-only view of the underlying config dict.
        """
        return MappingProxyType(self._data)



class DataType(str, Enum):
    TEXT = "text"
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"

    # ===============================
    # Basic helpers
    # ===============================

    @classmethod
    def from_str(cls, value: str) -> "DataType":
        """Safely convert string to enum."""
        try:
            return cls(value.lower())
        except ValueError:
            raise ValueError(f"Unsupported data type: {value}")

    @classmethod
    def values(cls) -> list[str]:
        """Return all string values."""
        return [item.value for item in cls]

    @classmethod
    def is_valid(cls, value: str) -> bool:
        """Check whether the string value is valid."""
        return value.lower() in cls.values()

    # ===============================
    # Business helpers
    # ===============================
    @property
    def is_text(self) -> bool:
        """Whether it is text type."""
        return self == DataType.TEXT

    @property
    def is_image(self) -> bool:
        """Whether it is image type."""
        return self == DataType.IMAGE

    @property
    def is_video(self) -> bool:
        """Whether it is video type."""
        return self == DataType.VIDEO

    @property
    def is_audio(self) -> bool:
        """Whether it is audio type."""
        return self == DataType.AUDIO

    @property
    def is_binary(self) -> bool:
        """Whether it is a binary type."""
        return self in {DataType.IMAGE, DataType.VIDEO, DataType.AUDIO}

    def get_default_ext(self) -> str:
        """Return default file extension."""
        return {
            DataType.TEXT: ".json",
            DataType.IMAGE: ".jpg",
            DataType.VIDEO: ".mp4",
            DataType.AUDIO: ".mp3",
        }[self]

    def __str__(self) -> str:
        """User-friendly display."""
        return self.value


@dataclass
class DataResource:
    """Generic data resource."""

    data_type: DataType
    name: str

    # Input data
    text: str | None = None
    binary: bytes | None = None

    # Persisted results
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
        """Validate before saving."""
        if self.data_type.is_text and not self.text:
            raise ValueError("Text type requires text")

        if self.data_type.is_binary and not self.binary:
            raise ValueError("Binary type requires binary")

        if self.text and self.binary:
            raise ValueError("Cannot provide text and binary at the same time")

    def unlink(self) -> None:
        """Delete saved data and clear linkage."""
        if self.saved_path and self.saved_path.exists():
            try:
                self.saved_path.unlink()
                self.saved_path = None
            except Exception:
                pass

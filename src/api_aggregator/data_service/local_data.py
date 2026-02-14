import asyncio
import hashlib
import json
import random
import shutil
from pathlib import Path
from typing import Any

from ..config import APIConfig
from ..log import logger
from ..model import DataResource, DataType


class LocalDataError(Exception):
    """Local data service error."""


class LocalDataService:
    """Local data service for text/image/video/audio persistence."""

    TEXT_INDEX_SUFFIX = ".index.json"
    BINARY_INDEX_FILE = ".index.json"

    def __init__(self, config: APIConfig) -> None:
        self.cfg = config
        self.local_dir = config.local_dir

        self.text_dir = self.local_dir / "text"
        self.image_dir = self.local_dir / "image"
        self.video_dir = self.local_dir / "video"
        self.audio_dir = self.local_dir / "audio"

        self._dataset_locks: dict[tuple[str, str], asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()

        self._init_dirs()

    def _init_dirs(self) -> None:
        for d in (
            self.text_dir,
            self.image_dir,
            self.video_dir,
            self.audio_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)

    def get_type_dir(self, data_type: DataType) -> Path:
        mapping = {
            DataType.TEXT: self.text_dir,
            DataType.IMAGE: self.image_dir,
            DataType.VIDEO: self.video_dir,
            DataType.AUDIO: self.audio_dir,
        }
        return mapping[data_type]

    async def save_data(self, data: DataResource) -> DataResource:
        """
        Save data and update saved_* fields in-place.
        """
        data.validate_for_save()
        lock = await self._get_dataset_lock(data.data_type, data.name)

        async with lock:
            if data.data_type.is_text:
                saved_text, is_duplicate = self._save_text(data)
                data.saved_text = saved_text
                data.is_duplicate = is_duplicate
                return data

            if data.data_type.is_binary:
                saved_path, is_duplicate = self._save_binary(data)
                data.saved_path = saved_path
                data.is_duplicate = is_duplicate
                return data

            raise LocalDataError(f"unsupported data type: {data.data_type}")

    async def _get_dataset_lock(self, data_type: DataType, name: str) -> asyncio.Lock:
        key = (data_type.value, name)
        existing = self._dataset_locks.get(key)
        if existing is not None:
            return existing
        async with self._locks_guard:
            lock = self._dataset_locks.get(key)
            if lock is None:
                lock = asyncio.Lock()
                self._dataset_locks[key] = lock
            return lock

    @staticmethod
    def _hash_text(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    @staticmethod
    def _hash_binary(binary: bytes) -> str:
        return hashlib.sha256(binary).hexdigest()

    @staticmethod
    def _load_json_list(path: Path) -> list[Any]:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return []
        return raw if isinstance(raw, list) else []

    @staticmethod
    def _write_json(path: Path, payload: Any) -> None:
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=4),
            encoding="utf-8",
        )

    @classmethod
    def _is_text_data_file(cls, path: Path) -> bool:
        return (
            path.is_file()
            and path.suffix == ".json"
            and not path.name.endswith(cls.TEXT_INDEX_SUFFIX)
        )

    @classmethod
    def _is_binary_data_file(cls, path: Path) -> bool:
        return (
            path.is_file()
            and path.name != cls.BINARY_INDEX_FILE
            and not path.name.startswith(".")
        )

    def _text_data_file(self, data_type: DataType, name: str) -> Path:
        return self.get_type_dir(data_type) / f"{name}{data_type.get_default_ext()}"

    def _text_index_file(self, data_type: DataType, name: str) -> Path:
        return self.get_type_dir(data_type) / f"{name}{self.TEXT_INDEX_SUFFIX}"

    @staticmethod
    def _text_file_signature(text_file: Path) -> tuple[int, int]:
        stat = text_file.stat()
        return int(stat.st_mtime_ns), int(stat.st_size)

    def _load_text_hashes(
        self, text_file: Path, index_file: Path, items: list[str]
    ) -> set[str]:
        current_mtime, current_size = self._text_file_signature(text_file)
        try:
            payload = json.loads(index_file.read_text(encoding="utf-8"))
            hashes = payload.get("hashes", [])
            source_mtime = int(payload.get("source_mtime_ns", -1))
            source_size = int(payload.get("source_size", -1))
            if (
                isinstance(hashes, list)
                and source_mtime == current_mtime
                and source_size == current_size
            ):
                return {str(item) for item in hashes if str(item)}
        except Exception:
            pass

        rebuilt = {self._hash_text(str(item)) for item in items}
        self._save_text_hashes(text_file, index_file, rebuilt)
        return rebuilt

    def _save_text_hashes(
        self, text_file: Path, index_file: Path, hashes: set[str]
    ) -> None:
        mtime_ns, size = self._text_file_signature(text_file)
        payload = {
            "version": 1,
            "source_mtime_ns": mtime_ns,
            "source_size": size,
            "hashes": sorted(hashes),
        }
        self._write_json(index_file, payload)

    @staticmethod
    def _load_binary_index(index_file: Path) -> dict[str, str]:
        try:
            payload = json.loads(index_file.read_text(encoding="utf-8"))
        except Exception:
            return {}

        mapping = payload.get("hash_to_file", {})
        if not isinstance(mapping, dict):
            return {}

        result: dict[str, str] = {}
        for content_hash, file_name in mapping.items():
            hash_text = str(content_hash).strip()
            file_text = str(file_name).strip()
            if hash_text and file_text:
                result[hash_text] = file_text
        return result

    def _save_binary_index(
        self, index_file: Path, hash_to_file: dict[str, str]
    ) -> None:
        payload = {
            "version": 1,
            "hash_to_file": dict(
                sorted(hash_to_file.items(), key=lambda item: item[0])
            ),
        }
        self._write_json(index_file, payload)

    def _list_binary_files(self, folder: Path) -> list[Path]:
        return [p for p in folder.iterdir() if self._is_binary_data_file(p)]

    def _next_binary_sequence(self, folder: Path, dataset_name: str) -> int:
        """
        Find next sequence number for filenames like:
        {dataset_name}_{seq}_{hash_prefix}.ext
        """
        prefix = f"{dataset_name}_"
        max_seq = -1
        for file in self._list_binary_files(folder):
            stem = file.stem
            if not stem.startswith(prefix):
                continue
            # stem example: name_12_ab12cd34
            parts = stem[len(prefix) :].split("_", 1)
            if not parts:
                continue
            try:
                seq = int(parts[0])
            except ValueError:
                continue
            if seq > max_seq:
                max_seq = seq
        return max_seq + 1

    def _save_text(self, data: DataResource) -> tuple[str, bool]:
        data.validate_for_save()
        json_file = self._text_data_file(data.data_type, data.name)
        index_file = self._text_index_file(data.data_type, data.name)

        if not json_file.exists():
            self._write_json(json_file, [])

        items = [str(item) for item in self._load_json_list(json_file)]
        hashes = self._load_text_hashes(json_file, index_file, items)

        saved_text = str(data.text or "").replace("\r", "\n")
        text_hash = self._hash_text(saved_text)

        dedup_hit = text_hash in hashes
        if not dedup_hit:
            items.append(saved_text)
            self._write_json(json_file, items)
            hashes.add(text_hash)
            self._save_text_hashes(json_file, index_file, hashes)
        elif not index_file.exists():
            self._save_text_hashes(json_file, index_file, hashes)

        logger.debug(
            "local text saved data_type=%s, name=%s, dedup=%s",
            data.data_type,
            data.name,
            "hit" if dedup_hit else "miss",
        )

        return saved_text, dedup_hit

    def _save_binary(self, data: DataResource) -> tuple[Path, bool]:
        if data.binary is None:
            raise LocalDataError("binary data is empty")

        save_dir = self.get_type_dir(data.data_type) / data.name
        save_dir.mkdir(parents=True, exist_ok=True)

        index_file = save_dir / self.BINARY_INDEX_FILE
        hash_to_file = self._load_binary_index(index_file)
        binary_hash = self._hash_binary(data.binary)
        ext = data.data_type.get_default_ext()

        existing_name = hash_to_file.get(binary_hash)
        if existing_name:
            existing_path = save_dir / existing_name
            if existing_path.exists() and existing_path.is_file():
                return existing_path, True
            hash_to_file.pop(binary_hash, None)

        seq = self._next_binary_sequence(save_dir, data.name)
        hash_prefix = binary_hash[:8]
        file_name = f"{data.name}_{seq}_{hash_prefix}{ext}"
        saved_path = save_dir / file_name
        while saved_path.exists():
            seq += 1
            file_name = f"{data.name}_{seq}_{hash_prefix}{ext}"
            saved_path = save_dir / file_name

        dedup_hit = False
        saved_path.write_bytes(data.binary)

        hash_to_file[binary_hash] = file_name
        self._save_binary_index(index_file, hash_to_file)

        logger.debug(
            "local file saved data_type=%s, path=%s, size=%s, hash=%s",
            data.data_type,
            saved_path,
            len(data.binary),
            binary_hash,
        )

        return saved_path, dedup_hit

    async def get_random_data(
        self,
        data_type: DataType,
        name: str,
    ) -> DataResource:
        """
        Return one random saved item from local storage.
        """

        if data_type.is_text:
            items = self._get_text(data_type, name)
            text = random.choice(items)

            logger.debug(f"local text loaded data_type={data_type}, name={name}")

            return DataResource(
                data_type=data_type,
                name=name,
                saved_text=text,
            )

        if data_type.is_binary:
            files = self._get_binary(data_type, name)
            path = random.choice(files).absolute()

            logger.debug(f"local file loaded data_type={data_type}, path={path}")

            return DataResource(
                data_type=data_type,
                name=name,
                saved_path=path,
            )

        raise LocalDataError(f"unsupported data type: {data_type}")

    def _get_text(self, data_type: DataType, name: str) -> list[str]:
        json_file = self._text_data_file(data_type, name)

        if not json_file.exists():
            raise LocalDataError(f"text dataset not found: {json_file}")

        try:
            items = json.loads(json_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise LocalDataError(
                f"json parse failed: {json_file}, error: {exc}"
            ) from exc

        if not isinstance(items, list) or not items:
            raise LocalDataError(f"text dataset empty or invalid: {json_file}")

        return [str(item) for item in items]

    def _get_binary(self, data_type: DataType, name: str) -> list[Path]:
        folder = self.get_type_dir(data_type) / name

        if not folder.exists():
            raise LocalDataError(f"folder not found: {folder}")

        files = self._list_binary_files(folder)
        if not files:
            raise LocalDataError(f"folder empty: {folder}")

        return files

    # ================== management ==================

    def _relative_path_text(self, path: Path) -> str:
        return path.resolve().relative_to(self.local_dir.resolve()).as_posix()

    @staticmethod
    def _safe_int(value: int | float) -> int:
        return max(0, int(value))

    def _build_text_summary(self, json_file: Path) -> dict[str, Any]:
        try:
            raw = json.loads(json_file.read_text(encoding="utf-8"))
            items = raw if isinstance(raw, list) else []
        except Exception:
            items = []

        stat = json_file.stat()
        return {
            "type": DataType.TEXT.value,
            "name": json_file.stem,
            "count": len(items),
            "size_bytes": self._safe_int(stat.st_size),
            "updated_at": self._safe_int(stat.st_mtime),
            "path": self._relative_path_text(json_file),
        }

    def _build_binary_summary(
        self, data_type: DataType, folder: Path
    ) -> dict[str, Any]:
        files = self._list_binary_files(folder)
        total_size = 0
        updated_at = 0

        for file in files:
            stat = file.stat()
            total_size += self._safe_int(stat.st_size)
            updated_at = max(updated_at, self._safe_int(stat.st_mtime))

        return {
            "type": data_type.value,
            "name": folder.name,
            "count": len(files),
            "size_bytes": total_size,
            "updated_at": updated_at,
            "path": self._relative_path_text(folder),
        }

    def list_collections(self) -> list[dict[str, Any]]:
        collections: list[dict[str, Any]] = []

        for json_file in sorted(
            self.text_dir.glob("*.json"), key=lambda p: p.name.lower()
        ):
            if self._is_text_data_file(json_file):
                collections.append(self._build_text_summary(json_file))

        for data_type in (DataType.IMAGE, DataType.VIDEO, DataType.AUDIO):
            type_dir = self.get_type_dir(data_type)
            for folder in sorted(type_dir.iterdir(), key=lambda p: p.name.lower()):
                if folder.is_dir():
                    collections.append(self._build_binary_summary(data_type, folder))

        collections.sort(
            key=lambda item: (
                str(item.get("type", "")),
                str(item.get("name", "")).lower(),
            )
        )
        return collections

    def get_collection_items(self, data_type: DataType, name: str) -> dict[str, Any]:
        if data_type.is_text:
            json_file = self._text_data_file(data_type, name)
            if not json_file.exists():
                raise LocalDataError(f"text dataset not found: {json_file}")

            try:
                raw = json.loads(json_file.read_text(encoding="utf-8"))
                items = raw if isinstance(raw, list) else []
            except Exception as exc:
                raise LocalDataError(
                    f"json parse failed: {json_file}, error: {exc}"
                ) from exc

            summary = self._build_text_summary(json_file)
            summary["items"] = [
                {
                    "index": idx,
                    "text": str(item),
                }
                for idx, item in enumerate(items)
            ]
            return summary

        folder = self.get_type_dir(data_type) / name
        if not folder.exists() or not folder.is_dir():
            raise LocalDataError(f"folder not found: {folder}")

        files = self._list_binary_files(folder)
        files.sort(key=lambda p: p.name.lower())

        summary = self._build_binary_summary(data_type, folder)
        summary["items"] = [
            {
                "name": file.name,
                "path": self._relative_path_text(file),
                "size_bytes": self._safe_int(file.stat().st_size),
                "updated_at": self._safe_int(file.stat().st_mtime),
            }
            for file in files
        ]
        return summary

    def delete_collection(self, data_type: DataType, name: str) -> dict[str, Any]:
        if data_type.is_text:
            json_file = self._text_data_file(data_type, name)
            index_file = self._text_index_file(data_type, name)
            if not json_file.exists():
                raise LocalDataError(f"text dataset not found: {json_file}")
            json_file.unlink()
            if index_file.exists():
                index_file.unlink()
            return {"deleted": 1}

        folder = self.get_type_dir(data_type) / name
        if not folder.exists() or not folder.is_dir():
            raise LocalDataError(f"folder not found: {folder}")

        deleted = 0
        for child in list(folder.iterdir()):
            if child.is_file():
                child.unlink()
                if self._is_binary_data_file(child):
                    deleted += 1
            elif child.is_dir():
                shutil.rmtree(child)

        folder.rmdir()
        return {"deleted": deleted}

    def delete_item(
        self,
        data_type: DataType,
        name: str,
        *,
        index: int | None = None,
        relative_path: str | None = None,
    ) -> dict[str, Any]:
        items: list[dict[str, Any]] = []
        if index is not None:
            items.append({"index": index})
        if relative_path:
            items.append({"path": relative_path})
        if not items:
            raise LocalDataError("missing delete target")
        return self.delete_items_batch(data_type, name, items)

    def delete_items_batch(
        self,
        data_type: DataType,
        name: str,
        items: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not isinstance(items, list) or not items:
            raise LocalDataError("items must be a non-empty list")

        if data_type.is_text:
            json_file = self._text_data_file(data_type, name)
            index_file = self._text_index_file(data_type, name)
            if not json_file.exists():
                raise LocalDataError(f"text dataset not found: {json_file}")

            try:
                raw = json.loads(json_file.read_text(encoding="utf-8"))
                items = raw if isinstance(raw, list) else []
            except Exception as exc:
                raise LocalDataError(
                    f"json parse failed: {json_file}, error: {exc}"
                ) from exc

            dataset_items = raw if isinstance(raw, list) else []
            unique_indices: set[int] = set()
            for item in items:
                if not isinstance(item, dict):
                    continue
                value = item.get("index")
                if isinstance(value, bool):
                    continue
                try:
                    idx = int(value)
                except (TypeError, ValueError):
                    continue
                if idx >= 0:
                    unique_indices.add(idx)

            if not unique_indices:
                raise LocalDataError("text type requires at least one valid index")

            removed_count = 0
            failed_count = 0
            for idx in sorted(unique_indices, reverse=True):
                if idx < 0 or idx >= len(dataset_items):
                    failed_count += 1
                    continue
                dataset_items.pop(idx)
                removed_count += 1

            if removed_count <= 0:
                raise LocalDataError("no valid items to delete")

            self._write_json(json_file, dataset_items)
            rebuilt_hashes = {self._hash_text(str(item)) for item in dataset_items}
            self._save_text_hashes(json_file, index_file, rebuilt_hashes)

            return {
                "deleted": removed_count,
                "failed": failed_count,
                "remain": len(dataset_items),
            }

        expected_folder = (self.get_type_dir(data_type) / name).resolve()
        if not expected_folder.exists() or not expected_folder.is_dir():
            raise LocalDataError(f"folder not found: {expected_folder}")

        root = self.local_dir.resolve()
        targets: dict[str, Path] = {}
        failed_count = 0
        for item in items:
            if not isinstance(item, dict):
                failed_count += 1
                continue
            relative_path = str(item.get("path", "")).strip().replace("\\", "/")
            if not relative_path:
                failed_count += 1
                continue
            target = (root / relative_path).resolve()
            if target != root and root not in target.parents:
                failed_count += 1
                continue
            if target.parent.resolve() != expected_folder:
                failed_count += 1
                continue
            if not target.exists() or not target.is_file():
                failed_count += 1
                continue
            targets[target.name] = target

        if not targets:
            raise LocalDataError("binary type requires at least one valid path")

        for target in targets.values():
            target.unlink()

        deleted_count = len(targets)
        index_file = expected_folder / self.BINARY_INDEX_FILE
        if index_file.exists():
            hash_to_file = self._load_binary_index(index_file)
            changed = False
            for content_hash, file_name in list(hash_to_file.items()):
                if file_name in targets:
                    hash_to_file.pop(content_hash, None)
                    changed = True
            if changed:
                if hash_to_file:
                    self._save_binary_index(index_file, hash_to_file)
                else:
                    index_file.unlink()

        if not self._list_binary_files(expected_folder):
            if index_file.exists():
                index_file.unlink()
            expected_folder.rmdir()

        remain = (
            len(self._list_binary_files(expected_folder))
            if expected_folder.exists()
            else 0
        )
        return {
            "deleted": deleted_count,
            "failed": failed_count,
            "remain": remain,
        }

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from .config import APIConfig
from .log import get_logger

logger = get_logger("database")


class SQLiteDatabase:
    """SQLite-backed storage for site/api pools."""

    def __init__(self, config: APIConfig) -> None:
        self.cfg: APIConfig = config
        self.data_dir = config.data_dir

        self.db_file = self.data_dir / "api_aggregator.db"
        self._init_schema()

        self.site_pool: list[dict[str, Any]] = []
        self.api_pool: list[dict[str, Any]] = []
        self.reload_from_database()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_file))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS site_pool (
                    pos INTEGER PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    payload TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS api_pool (
                    pos INTEGER PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    payload TEXT NOT NULL
                )
                """
            )
            conn.commit()

    @staticmethod
    def _load_json_file(file: Path) -> list[dict[str, Any]]:
        if not file.exists():
            return []
        try:
            with file.open("r", encoding="utf-8-sig") as f:
                raw = json.load(f)
        except Exception as exc:
            logger.error("load preset file failed: %s -> %s", file, exc)
            return []
        return SQLiteDatabase._normalize_pool_data(raw)

    def reload_from_presets(self) -> None:
        if self.cfg is None:
            raise RuntimeError("reload_from_presets requires APIConfig")
        self.site_pool = self._load_json_file(self.cfg.builtin_sites_file)
        self.api_pool = self._load_json_file(self.cfg.builtin_apis_file)
        self.save_to_database()

    @staticmethod
    def _to_bool(value: Any, *, default: bool = True) -> bool:
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
    def _normalize_pool_data(data: Any) -> list[dict[str, Any]]:
        if not isinstance(data, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in data:
            if isinstance(item, dict):
                row = dict(item)
                if "enabled" not in row or row.get("enabled") is None:
                    row["enabled"] = True
                else:
                    row["enabled"] = SQLiteDatabase._to_bool(
                        row.get("enabled"), default=True
                    )
                normalized.append(row)
        return normalized

    def _save_pool_table(self, table: str, rows: list[dict[str, Any]]) -> None:
        sql = f"INSERT INTO {table}(pos, name, payload) VALUES (?, ?, ?)"
        try:
            with self._connect() as conn:
                conn.execute(f"DELETE FROM {table}")
                for index, item in enumerate(rows):
                    conn.execute(
                        sql,
                        (
                            index,
                            str(item.get("name", "")).strip(),
                            json.dumps(item, ensure_ascii=False),
                        ),
                    )
                conn.commit()
        except Exception as exc:
            logger.error("save sqlite table failed (%s): %s", table, exc)

    def save_site_pool(self) -> None:
        self._save_pool_table("site_pool", self.site_pool)

    def save_api_pool(self) -> None:
        self._save_pool_table("api_pool", self.api_pool)

    def save_to_database(self) -> None:
        self.save_site_pool()
        self.save_api_pool()

    def reload_from_database(self) -> None:
        try:
            with self._connect() as conn:
                site_rows = conn.execute(
                    "SELECT payload FROM site_pool ORDER BY pos ASC"
                ).fetchall()
                api_rows = conn.execute(
                    "SELECT payload FROM api_pool ORDER BY pos ASC"
                ).fetchall()
        except Exception as exc:
            logger.error("load sqlite database failed: %s", exc)
            self.site_pool = []
            self.api_pool = []
            return

        self.site_pool = self._normalize_pool_data(
            [json.loads(str(row["payload"])) for row in site_rows]
        )
        self.api_pool = self._normalize_pool_data(
            [json.loads(str(row["payload"])) for row in api_rows]
        )

    @staticmethod
    def _to_page_size(value: Any) -> int | str:
        text = str(value).strip().lower()
        if not text or text == "all":
            return "all"
        try:
            size = int(text)
        except Exception:
            return 20
        return max(1, size)

    @staticmethod
    def _to_page(value: Any) -> int:
        try:
            page = int(str(value).strip())
        except Exception:
            return 1
        return max(1, page)

    @staticmethod
    def _paginate(
        items: list[dict[str, Any]], page: int, page_size: int | str
    ) -> dict[str, Any]:
        total = len(items)
        if page_size == "all":
            return {
                "items": items,
                "page": 1,
                "page_size": "all",
                "total": total,
                "total_pages": 1,
                "start": 1 if total else 0,
                "end": total,
            }
        size = max(1, int(page_size))
        total_pages = max(1, (total + size - 1) // size)
        safe_page = min(max(1, page), total_pages)
        start_index = (safe_page - 1) * size
        end_index = min(start_index + size, total)
        page_items = items[start_index:end_index]
        return {
            "items": page_items,
            "page": safe_page,
            "page_size": size,
            "total": total,
            "total_pages": total_pages,
            "start": start_index + 1 if total else 0,
            "end": end_index,
        }

    @staticmethod
    def _site_filter(items: list[dict[str, Any]], query: str) -> list[dict[str, Any]]:
        q = str(query or "").strip().lower()
        if not q:
            return list(items)
        result: list[dict[str, Any]] = []
        for item in items:
            name = str(item.get("name", "")).lower()
            url = str(item.get("url", "")).lower()
            headers = item.get("headers", {})
            keys = item.get("keys", {})
            header_keys = (
                [str(k).lower() for k in headers.keys()]
                if isinstance(headers, dict)
                else []
            )
            key_keys = (
                [str(k).lower() for k in keys.keys()] if isinstance(keys, dict) else []
            )
            if (
                q in name
                or q in url
                or any(q in k for k in header_keys)
                or any(q in k for k in key_keys)
            ):
                result.append(item)
        return result

    @staticmethod
    def _api_filter(
        items: list[dict[str, Any]], query: str, site_names: set[str] | None = None
    ) -> list[dict[str, Any]]:
        q = str(query or "").strip().lower()
        filtered: list[dict[str, Any]] = []
        for item in items:
            if (
                site_names is not None
                and str(item.get("site", "")).strip() not in site_names
            ):
                continue
            if not q:
                filtered.append(item)
                continue
            name = str(item.get("name", "")).lower()
            url = str(item.get("url", "")).lower()
            keywords_raw = item.get("keywords", [])
            keywords = (
                [str(k).lower() for k in keywords_raw]
                if isinstance(keywords_raw, list)
                else []
            )
            if q in name or q in url or any(q in k for k in keywords):
                filtered.append(item)
        return filtered

    @staticmethod
    def _sort_sites(items: list[dict[str, Any]], rule: str) -> list[dict[str, Any]]:
        data = list(items)
        if rule == "name_desc":
            return sorted(
                data, key=lambda x: str(x.get("name", "")).lower(), reverse=True
            )
        if rule == "url_asc":
            return sorted(data, key=lambda x: str(x.get("url", "")).lower())
        if rule == "url_desc":
            return sorted(
                data, key=lambda x: str(x.get("url", "")).lower(), reverse=True
            )
        if rule == "timeout_asc":
            return sorted(data, key=lambda x: int(x.get("timeout", 60)))
        if rule == "timeout_desc":
            return sorted(data, key=lambda x: int(x.get("timeout", 60)), reverse=True)
        if rule == "api_count_asc":
            return sorted(
                data,
                key=lambda x: (
                    int(x.get("api_count", 0)),
                    str(x.get("name", "")).lower(),
                ),
            )
        if rule == "api_count_desc":
            return sorted(
                data,
                key=lambda x: (
                    -int(x.get("api_count", 0)),
                    str(x.get("name", "")).lower(),
                ),
            )
        if rule == "enabled_first":
            return sorted(
                data,
                key=lambda x: (
                    not bool(x.get("enabled", True)),
                    str(x.get("name", "")).lower(),
                ),
            )
        if rule == "disabled_first":
            return sorted(
                data,
                key=lambda x: (
                    bool(x.get("enabled", True)),
                    str(x.get("name", "")).lower(),
                ),
            )
        return sorted(data, key=lambda x: str(x.get("name", "")).lower())

    @staticmethod
    def _sort_apis(items: list[dict[str, Any]], rule: str) -> list[dict[str, Any]]:
        data = list(items)
        if rule == "name_desc":
            return sorted(
                data, key=lambda x: str(x.get("name", "")).lower(), reverse=True
            )
        if rule == "url_asc":
            return sorted(data, key=lambda x: str(x.get("url", "")).lower())
        if rule == "url_desc":
            return sorted(
                data, key=lambda x: str(x.get("url", "")).lower(), reverse=True
            )
        if rule == "type_asc":
            return sorted(data, key=lambda x: str(x.get("type", "")).lower())
        if rule == "type_desc":
            return sorted(
                data, key=lambda x: str(x.get("type", "")).lower(), reverse=True
            )
        if rule == "valid_first":
            return sorted(
                data,
                key=lambda x: (
                    not bool(x.get("valid", True)),
                    str(x.get("name", "")).lower(),
                ),
            )
        if rule == "invalid_first":
            return sorted(
                data,
                key=lambda x: (
                    bool(x.get("valid", True)),
                    str(x.get("name", "")).lower(),
                ),
            )
        if rule == "keywords_desc":
            return sorted(
                data,
                key=lambda x: (
                    -len(
                        x.get("keywords", [])
                        if isinstance(x.get("keywords"), list)
                        else []
                    ),
                    str(x.get("name", "")).lower(),
                ),
            )
        return sorted(data, key=lambda x: str(x.get("name", "")).lower())

    def query_site_pool(
        self,
        *,
        rule: str = "name_asc",
        query: str = "",
        page: int = 1,
        page_size: int | str = 20,
    ) -> dict[str, Any]:
        safe_page = self._to_page(page)
        safe_page_size = self._to_page_size(page_size)
        query_text = str(query or "").strip().lower()

        site_name_expr = "LOWER(COALESCE(json_extract(s.payload, '$.name'), ''))"
        site_url_expr = "LOWER(COALESCE(json_extract(s.payload, '$.url'), ''))"
        enabled_expr = (
            "COALESCE(CAST(json_extract(s.payload, '$.enabled') AS INTEGER), 1)"
        )
        timeout_expr = (
            "COALESCE(CAST(json_extract(s.payload, '$.timeout') AS INTEGER), 60)"
        )
        api_count_expr = (
            "(SELECT COUNT(1) FROM api_pool a "
            "WHERE TRIM(COALESCE(json_extract(a.payload, '$.site'), '')) = "
            "TRIM(COALESCE(json_extract(s.payload, '$.name'), '')))"
        )

        order_map: dict[str, str] = {
            "name_desc": f"{site_name_expr} DESC",
            "url_asc": f"{site_url_expr} ASC, {site_name_expr} ASC",
            "url_desc": f"{site_url_expr} DESC, {site_name_expr} ASC",
            "timeout_asc": f"{timeout_expr} ASC, {site_name_expr} ASC",
            "timeout_desc": f"{timeout_expr} DESC, {site_name_expr} ASC",
            "api_count_asc": f"{api_count_expr} ASC, {site_name_expr} ASC",
            "api_count_desc": f"{api_count_expr} DESC, {site_name_expr} ASC",
            "enabled_first": f"{enabled_expr} DESC, {site_name_expr} ASC",
            "disabled_first": f"{enabled_expr} ASC, {site_name_expr} ASC",
            "name_asc": f"{site_name_expr} ASC",
        }
        order_clause = order_map.get(
            str(rule or "").strip().lower(), order_map["name_asc"]
        )

        where_parts: list[str] = []
        params: list[Any] = []
        if query_text:
            like_value = f"%{query_text}%"
            where_parts.append(
                f"({site_name_expr} LIKE ? OR {site_url_expr} LIKE ? OR LOWER(COALESCE(s.payload, '')) LIKE ?)"
            )
            params.extend([like_value, like_value, like_value])
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

        with self._connect() as conn:
            total_row = conn.execute(
                f"SELECT COUNT(1) AS total FROM site_pool s {where_sql}",
                params,
            ).fetchone()
            total = int(total_row["total"]) if total_row else 0

            if safe_page_size == "all":
                page_no = 1
                total_pages = 1
                start = 1 if total else 0
                end = total
                item_rows = conn.execute(
                    (
                        "SELECT s.payload AS payload, "
                        f"{api_count_expr} AS api_count "
                        f"FROM site_pool s {where_sql} "
                        f"ORDER BY {order_clause}"
                    ),
                    params,
                ).fetchall()
            else:
                size = max(1, int(safe_page_size))
                total_pages = max(1, (total + size - 1) // size)
                page_no = min(max(1, safe_page), total_pages)
                offset = (page_no - 1) * size
                start = offset + 1 if total else 0
                item_rows = conn.execute(
                    (
                        "SELECT s.payload AS payload, "
                        f"{api_count_expr} AS api_count "
                        f"FROM site_pool s {where_sql} "
                        f"ORDER BY {order_clause} LIMIT ? OFFSET ?"
                    ),
                    [*params, size, offset],
                ).fetchall()
                end = offset + len(item_rows)

        items: list[dict[str, Any]] = []
        for row in item_rows:
            payload = json.loads(str(row["payload"]))
            payload["api_count"] = int(row["api_count"] or 0)
            items.append(payload)

        return {
            "items": items,
            "page": page_no,
            "page_size": safe_page_size,
            "total": total,
            "total_pages": total_pages,
            "start": start,
            "end": end,
        }

    def query_api_pool(
        self,
        *,
        rule: str = "name_asc",
        query: str = "",
        page: int = 1,
        page_size: int | str = 20,
        site_names: list[str] | None = None,
    ) -> dict[str, Any]:
        safe_page = self._to_page(page)
        safe_page_size = self._to_page_size(page_size)
        query_text = str(query or "").strip().lower()

        normalized_site_names = sorted(
            {str(name).strip() for name in (site_names or []) if str(name).strip()}
        )

        api_name_expr = "LOWER(COALESCE(json_extract(a.payload, '$.name'), ''))"
        api_url_expr = "LOWER(COALESCE(json_extract(a.payload, '$.url'), ''))"
        api_type_expr = "LOWER(COALESCE(json_extract(a.payload, '$.type'), ''))"
        valid_expr = "COALESCE(CAST(json_extract(a.payload, '$.valid') AS INTEGER), 1)"
        keywords_len_expr = (
            "COALESCE(json_array_length(json_extract(a.payload, '$.keywords')), 0)"
        )

        order_map: dict[str, str] = {
            "name_desc": f"{api_name_expr} DESC",
            "url_asc": f"{api_url_expr} ASC, {api_name_expr} ASC",
            "url_desc": f"{api_url_expr} DESC, {api_name_expr} ASC",
            "type_asc": f"{api_type_expr} ASC, {api_name_expr} ASC",
            "type_desc": f"{api_type_expr} DESC, {api_name_expr} ASC",
            "valid_first": f"{valid_expr} DESC, {api_name_expr} ASC",
            "invalid_first": f"{valid_expr} ASC, {api_name_expr} ASC",
            "keywords_desc": f"{keywords_len_expr} DESC, {api_name_expr} ASC",
            "name_asc": f"{api_name_expr} ASC",
        }
        order_clause = order_map.get(
            str(rule or "").strip().lower(), order_map["name_asc"]
        )

        where_parts: list[str] = []
        params: list[Any] = []
        if query_text:
            like_value = f"%{query_text}%"
            where_parts.append(
                f"({api_name_expr} LIKE ? OR {api_url_expr} LIKE ? OR LOWER(COALESCE(a.payload, '')) LIKE ?)"
            )
            params.extend([like_value, like_value, like_value])
        if normalized_site_names:
            placeholders = ",".join("?" for _ in normalized_site_names)
            where_parts.append(
                "TRIM(COALESCE(json_extract(a.payload, '$.site'), '')) IN "
                f"({placeholders})"
            )
            params.extend(normalized_site_names)
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

        with self._connect() as conn:
            total_row = conn.execute(
                f"SELECT COUNT(1) AS total FROM api_pool a {where_sql}",
                params,
            ).fetchone()
            total = int(total_row["total"]) if total_row else 0

            if safe_page_size == "all":
                page_no = 1
                total_pages = 1
                start = 1 if total else 0
                end = total
                item_rows = conn.execute(
                    f"SELECT a.payload AS payload FROM api_pool a {where_sql} ORDER BY {order_clause}",
                    params,
                ).fetchall()
            else:
                size = max(1, int(safe_page_size))
                total_pages = max(1, (total + size - 1) // size)
                page_no = min(max(1, safe_page), total_pages)
                offset = (page_no - 1) * size
                start = offset + 1 if total else 0
                item_rows = conn.execute(
                    (
                        f"SELECT a.payload AS payload FROM api_pool a {where_sql} "
                        f"ORDER BY {order_clause} LIMIT ? OFFSET ?"
                    ),
                    [*params, size, offset],
                ).fetchall()
                end = offset + len(item_rows)

        items = [json.loads(str(row["payload"])) for row in item_rows]
        return {
            "items": items,
            "page": page_no,
            "page_size": safe_page_size,
            "total": total,
            "total_pages": total_pages,
            "start": start,
            "end": end,
        }

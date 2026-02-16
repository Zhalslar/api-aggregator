from __future__ import annotations

import json
import sqlite3
from typing import Any

from .config import APIConfig
from .log import get_logger
from .model import FieldCaster

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
                    row["enabled"] = FieldCaster.to_bool(
                        row.get("enabled"), default=True
                    )
                normalized.append(row)
        return normalized

    @classmethod
    def _normalize_upserts(cls, value: Any) -> list[dict[str, Any]]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("upserts must be a list")
        rows: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                raise ValueError("upsert item must be an object")
            normalized = cls._normalize_pool_data([item])
            if not normalized:
                continue
            row = normalized[0]
            name = FieldCaster.normalize_name(row.get("name"))
            if not name:
                raise ValueError("upsert item missing name")
            row["name"] = name
            rows.append(row)
        return rows

    @classmethod
    def _normalize_delete_names(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            names = [value]
        elif isinstance(value, list):
            names = value
        else:
            raise ValueError("delete_names must be a string or list")
        result: list[str] = []
        seen: set[str] = set()
        for item in names:
            name = FieldCaster.normalize_name(item)
            if not name or name in seen:
                continue
            result.append(name)
            seen.add(name)
        return result

    @staticmethod
    def _write_pool_table(
        conn: sqlite3.Connection, table: str, rows: list[dict[str, Any]]
    ) -> None:
        conn.execute(f"DELETE FROM {table}")
        payload_rows = [
            (
                index,
                str(item.get("name", "")).strip(),
                json.dumps(item, ensure_ascii=False),
            )
            for index, item in enumerate(rows)
        ]
        if payload_rows:
            conn.executemany(
                f"INSERT INTO {table}(pos, name, payload) VALUES (?, ?, ?)",
                payload_rows,
            )

    @staticmethod
    def _load_table_pos_map(conn: sqlite3.Connection, table: str) -> dict[str, int]:
        rows = conn.execute(f"SELECT name, pos FROM {table}").fetchall()
        pos_map: dict[str, int] = {}
        for row in rows:
            name = FieldCaster.normalize_name(row["name"])
            if not name:
                continue
            try:
                pos_map[name] = int(row["pos"])
            except Exception:
                continue
        return pos_map

    @classmethod
    def _apply_pool_table_batch(
        cls,
        conn: sqlite3.Connection,
        table: str,
        *,
        upserts: list[dict[str, Any]],
        delete_names: list[str],
    ) -> None:
        if not upserts and not delete_names:
            return

        pos_map = cls._load_table_pos_map(conn, table)

        if delete_names:
            conn.executemany(
                f"DELETE FROM {table} WHERE name = ?",
                [(name,) for name in delete_names],
            )
            for name in delete_names:
                pos_map.pop(name, None)

        next_pos = (max(pos_map.values()) + 1) if pos_map else 0
        updates: list[tuple[str, str]] = []
        inserts: list[tuple[int, str, str]] = []
        for row in upserts:
            name = FieldCaster.normalize_name(row.get("name"))
            if not name:
                continue
            payload = json.dumps(row, ensure_ascii=False)
            if name in pos_map:
                updates.append((payload, name))
                continue
            inserts.append((next_pos, name, payload))
            pos_map[name] = next_pos
            next_pos += 1

        if updates:
            conn.executemany(
                f"UPDATE {table} SET payload = ? WHERE name = ?",
                updates,
            )
        if inserts:
            conn.executemany(
                f"INSERT INTO {table}(pos, name, payload) VALUES (?, ?, ?)",
                inserts,
            )

    def _save_pool_table(self, table: str, rows: list[dict[str, Any]]) -> None:
        try:
            with self._connect() as conn:
                self._write_pool_table(conn, table, rows)
                conn.commit()
        except Exception as exc:
            logger.error("save sqlite table failed (%s): %s", table, exc)

    @classmethod
    def _apply_pool_batch(
        cls,
        pool: list[dict[str, Any]],
        *,
        upserts: list[dict[str, Any]],
        delete_names: list[str],
    ) -> dict[str, Any]:
        delete_set = set(delete_names)
        updated = 0
        deleted = 0
        inserted = 0
        changed = False

        if delete_set:
            before = len(pool)
            pool[:] = [
                row
                for row in pool
                if FieldCaster.normalize_name(row.get("name")) not in delete_set
            ]
            deleted = before - len(pool)
            changed = deleted > 0

        index_by_name = {
            FieldCaster.normalize_name(row.get("name")): index
            for index, row in enumerate(pool)
            if FieldCaster.normalize_name(row.get("name"))
        }
        for row in upserts:
            name = FieldCaster.normalize_name(row.get("name"))
            if not name:
                continue
            index = index_by_name.get(name)
            if index is None:
                pool.append(row)
                index_by_name[name] = len(pool) - 1
                inserted += 1
                changed = True
            else:
                if pool[index] != row:
                    pool[index] = row
                    updated += 1
                    changed = True

        return {
            "changed": changed,
            "inserted": inserted,
            "updated": updated,
            "deleted": deleted,
            "total": len(pool),
        }

    def save_site_pool(self) -> None:
        self._save_pool_table("site_pool", self.site_pool)

    def save_api_pool(self) -> None:
        self._save_pool_table("api_pool", self.api_pool)

    def save_to_database(self) -> None:
        self.save_site_pool()
        self.save_api_pool()

    def batch_update_pools(
        self,
        *,
        site_upserts: list[dict[str, Any]] | None = None,
        site_delete_names: list[str] | str | None = None,
        api_upserts: list[dict[str, Any]] | None = None,
        api_delete_names: list[str] | str | None = None,
    ) -> dict[str, Any]:
        normalized_site_upserts = self._normalize_upserts(site_upserts)
        normalized_site_deletes = self._normalize_delete_names(site_delete_names)
        normalized_api_upserts = self._normalize_upserts(api_upserts)
        normalized_api_deletes = self._normalize_delete_names(api_delete_names)

        site_stats = self._apply_pool_batch(
            self.site_pool,
            upserts=normalized_site_upserts,
            delete_names=normalized_site_deletes,
        )
        api_stats = self._apply_pool_batch(
            self.api_pool,
            upserts=normalized_api_upserts,
            delete_names=normalized_api_deletes,
        )
        changed_tables: list[str] = []
        try:
            with self._connect() as conn:
                if site_stats["changed"]:
                    self._apply_pool_table_batch(
                        conn,
                        "site_pool",
                        upserts=normalized_site_upserts,
                        delete_names=normalized_site_deletes,
                    )
                    changed_tables.append("site_pool")
                if api_stats["changed"]:
                    self._apply_pool_table_batch(
                        conn,
                        "api_pool",
                        upserts=normalized_api_upserts,
                        delete_names=normalized_api_deletes,
                    )
                    changed_tables.append("api_pool")
                if changed_tables:
                    conn.commit()
        except Exception:
            self.reload_from_database()
            raise

        return {
            "changed_tables": changed_tables,
            "site": {k: v for k, v in site_stats.items() if k != "changed"},
            "api": {k: v for k, v in api_stats.items() if k != "changed"},
        }

    def batch_update_site_pool(
        self,
        *,
        upserts: list[dict[str, Any]] | None = None,
        delete_names: list[str] | str | None = None,
    ) -> dict[str, Any]:
        return self.batch_update_pools(
            site_upserts=upserts,
            site_delete_names=delete_names,
        )["site"]

    def batch_update_api_pool(
        self,
        *,
        upserts: list[dict[str, Any]] | None = None,
        delete_names: list[str] | str | None = None,
    ) -> dict[str, Any]:
        return self.batch_update_pools(
            api_upserts=upserts,
            api_delete_names=delete_names,
        )["api"]

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
                "("
                f"{site_name_expr} LIKE ? OR "
                f"{site_url_expr} LIKE ? OR "
                "LOWER(COALESCE(s.payload, '')) LIKE ?"
                ")"
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
                "("
                f"{api_name_expr} LIKE ? OR "
                f"{api_url_expr} LIKE ? OR "
                "LOWER(COALESCE(a.payload, '')) LIKE ?"
                ")"
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
                    (
                        "SELECT a.payload AS payload "
                        f"FROM api_pool a {where_sql} "
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

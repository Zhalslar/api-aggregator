from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from api_aggregator.config import APIConfig  # noqa: E402
from api_aggregator.database import SQLiteDatabase  # noqa: E402
from api_aggregator.entry import APIEntryManager, SiteEntryManager  # noqa: E402
from api_aggregator.service.pool_io_service import PoolIOService  # noqa: E402


@contextmanager
def _temp_cwd():
    old_cwd = Path.cwd()
    with tempfile.TemporaryDirectory(
        prefix="api_agg_poolio_",
        ignore_cleanup_errors=True,
    ) as tmp:
        os.chdir(tmp)
        try:
            yield Path(tmp)
        finally:
            os.chdir(old_cwd)


class PoolIOServiceTest(unittest.TestCase):
    def _make_service(self) -> tuple[SQLiteDatabase, PoolIOService]:
        cfg = APIConfig()
        db = SQLiteDatabase(cfg)
        api_mgr = APIEntryManager(cfg, db)
        site_mgr = SiteEntryManager(cfg, db)
        service = PoolIOService(
            db,
            api_mgr,
            site_mgr,
            pool_files_dir=Path("pool_files"),
        )
        return db, service

    def test_export_site_pool_strips_enabled_field(self) -> None:
        with _temp_cwd():
            db, service = self._make_service()
            db.batch_update_site_pool(
                upserts=[
                    {
                        "name": "demo-site",
                        "url": "https://example.com",
                        "enabled": False,
                        "headers": {"X-Test": "1"},
                        "keys": {"token": "abc"},
                        "timeout": 30,
                    }
                ]
            )

            path = service.export_pool_to_file(
                "site",
                custom_path="pool_files/site_export.json",
            )
            rows = json.loads(path.read_text(encoding="utf-8"))

            self.assertEqual(len(rows), 1)
            self.assertNotIn("enabled", rows[0])
            self.assertEqual(rows[0]["name"], "demo-site")

    def test_import_api_pool_bytes_reports_imported_skipped_failed(self) -> None:
        with _temp_cwd():
            db, service = self._make_service()
            db.batch_update_api_pool(
                upserts=[
                    {
                        "name": "existing",
                        "url": "https://example.com/existing",
                        "type": "text",
                        "params": {},
                        "parse": "",
                        "enabled": True,
                        "scope": [],
                        "keywords": ["existing"],
                        "cron": "",
                        "valid": True,
                        "site": "",
                    }
                ]
            )

            raw = json.dumps(
                [
                    {"name": "existing", "url": "https://example.com/a"},
                    {"name": "new_api", "url": "https://example.com/b"},
                    {"name": "invalid_only_name"},
                ],
                ensure_ascii=False,
            ).encode("utf-8")
            result = service.import_pool_from_bytes("api", raw)

            self.assertEqual(result["pool_type"], "api")
            self.assertEqual(result["imported"], 1)
            self.assertEqual(result["skipped"], 1)
            self.assertEqual(result["failed"], 1)

            names = {
                str(item.get("name"))
                for item in db.api_pool
                if isinstance(item, dict)
            }
            self.assertIn("existing", names)
            self.assertIn("new_api", names)

    def test_import_pool_from_file_rejects_invalid_file_name(self) -> None:
        with _temp_cwd():
            _, service = self._make_service()
            with self.assertRaises(ValueError):
                service.import_pool_from_file("api", "../outside.json")


if __name__ == "__main__":
    unittest.main()

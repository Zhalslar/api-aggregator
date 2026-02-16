from __future__ import annotations

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
from api_aggregator.entry.api_mgr import APIEntryManager  # noqa: E402


@contextmanager
def _temp_cwd():
    old_cwd = Path.cwd()
    with tempfile.TemporaryDirectory(
        prefix="api_agg_test_",
        ignore_cleanup_errors=True,
    ) as tmp:
        os.chdir(tmp)
        try:
            yield Path(tmp)
        finally:
            os.chdir(old_cwd)


class APIEntryManagerDefaultsTest(unittest.TestCase):
    def test_add_entries_defaults_are_normalized(self) -> None:
        with _temp_cwd():
            cfg = APIConfig()
            mgr = APIEntryManager(cfg)

            created = mgr.add_entries(
                [{"name": "demo", "url": "https://example.com"}],
                save=False,
                emit_changed=False,
            )
            entry = created[0]

            self.assertIs(entry.enabled, True)
            self.assertEqual(entry.scope, [])
            self.assertEqual(entry.params, {})
            self.assertEqual(entry.keywords, ["demo"])
            self.assertEqual(entry.site, "")

            saved = mgr.pool[0]
            self.assertIs(saved["enabled"], True)
            self.assertEqual(saved["scope"], [])
            self.assertEqual(saved["params"], {})

    def test_add_entries_string_bool_and_collections(self) -> None:
        with _temp_cwd():
            cfg = APIConfig()
            mgr = APIEntryManager(cfg)

            entry = mgr.add_entries(
                [
                    {
                        "name": "demo2",
                        "url": "https://example.com/2",
                        "enabled": "false",
                        "scope": "group_1",
                        "keywords": "kw",
                        "params": ["invalid"],
                        "valid": "0",
                    }
                ],
                save=False,
                emit_changed=False,
            )[0]

            self.assertIs(entry.enabled, False)
            self.assertEqual(entry.scope, ["group_1"])
            self.assertEqual(entry.keywords, ["kw"])
            self.assertEqual(entry.params, {})
            self.assertIs(entry.valid, False)

    def test_match_entries_checks_scope_and_regex(self) -> None:
        with _temp_cwd():
            cfg = APIConfig()
            mgr = APIEntryManager(cfg)
            mgr.add_entries(
                [
                    {
                        "name": "admin_only",
                        "url": "https://example.com/admin",
                        "keywords": ["hello"],
                        "scope": ["admin"],
                    },
                    {
                        "name": "group_only",
                        "url": "https://example.com/group",
                        "keywords": ["hello"],
                        "scope": ["group_2"],
                    },
                ],
                save=False,
                emit_changed=False,
            )

            matched = mgr.match_entries(
                "hello world",
                user_id="u1",
                group_id="group_1",
                session_id="s1",
                is_admin=True,
                only_enabled=True,
            )
            self.assertEqual([item.name for item in matched], ["admin_only"])


if __name__ == "__main__":
    unittest.main()


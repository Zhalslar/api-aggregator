from __future__ import annotations

import shutil
import sys
import types
import unittest
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ROOT = REPO_ROOT / "src" / "api_aggregator"
PKG_NAME = "api_aggregator"


def _load_package() -> None:
    if PKG_NAME in sys.modules:
        return

    module = types.ModuleType(PKG_NAME)
    module.__path__ = [str(ROOT)]
    module.__package__ = PKG_NAME
    sys.modules[PKG_NAME] = module


_load_package()

from api_aggregator.config import APIConfig  # noqa: E402
from api_aggregator.entry.api_mgr import APIEntryManager  # noqa: E402


class APIEntryManagerDefaultsTest(unittest.TestCase):
    def _make_tempdir(self) -> Path:
        base = REPO_ROOT / "tests" / "_tmp"
        base.mkdir(parents=True, exist_ok=True)
        path = base / f"case_{uuid.uuid4().hex}"
        path.mkdir(parents=True, exist_ok=False)
        return path

    def test_add_entry_defaults_are_normalized(self) -> None:
        tmp = self._make_tempdir()
        try:
            cfg = APIConfig(tmp)
            mgr = APIEntryManager(cfg)

            entry = mgr.add_entry(data={"name": "demo", "url": "https://example.com"})

            self.assertIs(entry.enabled, True)
            self.assertEqual(entry.scope, [])
            self.assertEqual(entry.params, {})
            self.assertEqual(entry.keywords, ["demo"])

            saved = mgr.pool[0]
            self.assertIs(saved["enabled"], True)
            self.assertEqual(saved["scope"], [])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_add_entry_string_bool_and_collections(self) -> None:
        tmp = self._make_tempdir()
        try:
            cfg = APIConfig(tmp)
            mgr = APIEntryManager(cfg)

            entry = mgr.add_entry(
                data={
                    "name": "demo2",
                    "url": "https://example.com/2",
                    "enabled": "false",
                    "scope": "group_1",
                    "keywords": "kw",
                    "params": ["invalid"],
                    "valid": "0",
                }
            )

            self.assertIs(entry.enabled, False)
            self.assertEqual(entry.scope, ["group_1"])
            self.assertEqual(entry.keywords, ["kw"])
            self.assertEqual(entry.params, {})
            self.assertIs(entry.valid, False)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()


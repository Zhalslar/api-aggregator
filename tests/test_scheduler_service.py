from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from api_aggregator import scheduler as scheduler_module  # noqa: E402


class _DummyEntry:
    def __init__(self, name: str, cron: str) -> None:
        self.name = name
        self.cron = cron
        self.enabled = True
        self.valid = True


class _DummyMgr:
    def __init__(self, entries: list[_DummyEntry]) -> None:
        self.on_changed = []
        self._entries = entries

    def list_enabled_entries(self):
        return self._entries

    def get_entry(self, name: str):
        for entry in self._entries:
            if entry.name == name:
                return entry
        return None


class _DummyScheduler:
    def __init__(self) -> None:
        self.running = False
        self.jobs: list[dict] = []

    def start(self) -> None:
        self.running = True

    def shutdown(self, wait: bool = True) -> None:
        _ = wait
        self.running = False

    def remove_all_jobs(self) -> None:
        self.jobs.clear()

    def add_job(self, fn, trigger, args, id, replace_existing):  # noqa: A002
        self.jobs.append(
            {
                "fn": fn,
                "trigger": trigger,
                "args": args,
                "id": id,
                "replace_existing": replace_existing,
            }
        )


class SchedulerServiceTest(unittest.TestCase):
    def test_registers_only_valid_cron_entries(self) -> None:
        entries = [_DummyEntry("ok", "* * * * *"), _DummyEntry("bad", "invalid")]
        mgr = _DummyMgr(entries)
        dummy_scheduler = _DummyScheduler()

        def _from_crontab(expr: str) -> str:
            if expr == "* * * * *":
                return expr
            raise ValueError("bad cron")

        with (
            patch.object(
                scheduler_module, "AsyncIOScheduler", return_value=dummy_scheduler
            ),
            patch.object(
                scheduler_module.CronTrigger,
                "from_crontab",
                side_effect=_from_crontab,
            ),
        ):
            service = scheduler_module.APISchedulerService(
                mgr,
                lambda _entry: None,  # type: ignore[arg-type]
            )
            service.start()

        self.assertTrue(service._started)
        self.assertEqual(len(dummy_scheduler.jobs), 1)
        self.assertEqual(dummy_scheduler.jobs[0]["id"], "loreentry:ok")
        self.assertEqual(dummy_scheduler.jobs[0]["args"], ["ok"])


if __name__ == "__main__":
    unittest.main()

# api-aggregator

<p align="center">
  <img src="./src/api_aggregator/dashboard/assets/images/logo.png" alt="api-aggregator logo" width="160" />
</p>

<p align="center">
  <a href="https://github.com/Zhalslar/api-aggregator"><img alt="repo" src="https://img.shields.io/badge/repo-GitHub-181717?logo=github"></a>
  <img alt="python" src="https://img.shields.io/badge/python-3.11%2B-3776AB?logo=python&logoColor=white">
  <img alt="license" src="https://img.shields.io/badge/license-GPL--3.0--only-blue">
</p>

<p align="center">
  <a href="README.md">中文</a> | English
</p>

A lightweight API aggregation core runtime for API/site registry, fetching, local persistence, scheduling, and dashboard management.

Repository: `https://github.com/Zhalslar/api-aggregator`

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Virtual Environment](#virtual-environment)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Framework Integration (AstrBot-style)](#framework-integration-astrbot-style)
- [Dashboard](#dashboard)
- [Project Layout](#project-layout)
- [Development and Release](#development-and-release)
- [FAQ](#faq)

## Features

- API and site registry management (builtin + local pools)
- Remote response parsing (text/JSON/binary)
- Local deduplication and persistence
- Dashboard UI for operations
- Cron scheduler (`APScheduler`, installed by default)

## Installation

| Scenario | Command |
| --- | --- |
| Default install (recommended, includes scheduler) | `pip install -r requirements.txt` |
| Install package directly | `pip install .` |
| Use uv to sync environment | `uv sync` |

Notes:
- Distribution package name: `api-aggregator`
- Import package name: `api_aggregator`

## Virtual Environment

- Quick guide: `docs/zh-CN/virtualenv.md` (Chinese, default)
- English guide: `docs/en/virtualenv.md`
- One-command bootstrap (PowerShell): `.\scripts\bootstrap.ps1`

## Quick Start

```python
import asyncio
from api_aggregator import APICoreApp


async def main() -> None:
    app = APICoreApp()
    await app.start()
    try:
        await asyncio.Event().wait()
    finally:
        await app.stop()


asyncio.run(main())
```

## Configuration

`APICoreApp()` uses `APIConfig` internally. Main defaults:

| Key | Default | Description |
| --- | --- | --- |
| `data_dir` | `src/api_aggregator/data` | Data root directory |
| `dashboard.enabled` | `True` | Enable dashboard |
| `dashboard.host` | `0.0.0.0` | Dashboard bind host |
| `dashboard.port` | `4141` | Dashboard port |

Request-level fallback strategy: `DataService.fetch(..., use_local=True)`. 

## Framework Integration (AstrBot-style)


<details>
<summary>Click to expand integration guide and example code</summary>

Use this 3-layer pattern for bot framework integration:

1. Lifecycle binding: call `await app.start()` on framework startup and `await app.stop()` on shutdown.
2. Message routing: use `api_mgr.match_entries(...)` to match triggers, then fetch with `data_service.fetch(...)`.
3. Cron binding: register `set_cron_entry_handler(...)`; in callback call `fetch_cron_data(...)` and forward result to bot.

Minimal adapter:

```python
from __future__ import annotations

from pathlib import Path

from api_aggregator import APICoreApp, APIEntry


class BotFrameworkAdapter:
    def __init__(self) -> None:
        self.app = APICoreApp(data_dir=Path("data/api-aggregator"))
        self.app.set_cron_entry_handler(self.on_cron_entry)

    async def on_framework_start(self) -> None:
        await self.app.start()

    async def on_framework_stop(self) -> None:
        await self.app.stop()

    async def on_message(
        self,
        text: str,
        *,
        user_id: str,
        group_id: str,
        session_id: str,
        is_admin: bool,
    ) -> list[str]:
        replies: list[str] = []
        matched = self.app.api_mgr.match_entries(
            text,
            user_id=user_id,
            group_id=group_id,
            session_id=session_id,
            is_admin=is_admin,
            only_enabled=True,
        )
        for entry in matched:
            data = await self.app.data_service.fetch(entry, use_local=True)
            if data and data.final_text:
                replies.append(data.final_text)
        return replies

    async def on_cron_entry(self, entry: APIEntry) -> None:
        data = await self.app.fetch_cron_data(entry, use_local=True)
        if data and data.final_text:
            await self.send_to_admin(f"[cron] {entry.name}: {data.final_text}")

    async def send_to_admin(self, text: str) -> None:
        # Replace with framework-specific send API
        print(text)
```

AstrBot mapping suggestions:

1. Initialize adapter and start `APICoreApp` in plugin startup hooks.
2. Call `on_message(...)` in message-event hooks and send returned messages.
3. Stop `APICoreApp` in plugin shutdown hooks to avoid leaked aiohttp sessions.

</details>

## Dashboard

Default URL after startup: `http://0.0.0.0:4141`

Built-in operations:
- Site pool management
- API pool management
- Batch API testing
- Local data browsing and deletion

Logo asset path: `src/api_aggregator/dashboard/assets/images/logo.png`

## Project Layout

```text
api-aggregator/
  src/
    api_aggregator/
      dashboard/
      data_service/
      entry/
      source/
  tests/
  .github/workflows/ci.yml
  pyproject.toml
  requirements.txt
```

## Development and Release

Local checks:

```bash
python -m compileall src tests
python -m unittest discover -s tests -p "test_*.py"
```

Build distribution:

```bash
uv build
```

Pre-upload check:

```bash
uv run python -m twine check dist/*
```

## FAQ

1. Is `APScheduler` optional?
No. It is installed by default as a core dependency.

2. Why can't I `import api-aggregator` directly?
Python import names cannot contain `-`. The distribution name is `api-aggregator`, while the import name must be `api_aggregator`.

3. Where should logo files live?
Use `src/api_aggregator/dashboard/assets/images/` to keep repository root clean.


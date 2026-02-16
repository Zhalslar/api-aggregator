# api-aggregator

<p align="center">
  <img src="./src/api_aggregator/dashboard/assets/images/logo.png" alt="api-aggregator logo" width="160" />
</p>

<p align="center">
  <a href="https://github.com/Zhalslar/api-aggregator"><img alt="repo" src="https://img.shields.io/badge/repo-GitHub-181717?logo=github"></a>
  <img alt="python" src="https://img.shields.io/badge/python-3.10%2B-3776AB?logo=python&logoColor=white">
  <img alt="license" src="https://img.shields.io/badge/license-GPL--3.0--only-blue">
</p>

<p align="center">
  <a href="README.md">中文</a> | English
</p>

An API aggregation runtime for bots and automation systems, with API/site pool management, remote fetch and parsing, local deduplicated persistence, cron scheduling, and dashboard operations.

## Contents

- [Capabilities](#capabilities)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Runtime and Configuration](#runtime-and-configuration)
- [Project Layout](#project-layout)
- [Dashboard and HTTP API Docs](#dashboard-and-http-api-docs)
- [Bot Framework Integration](#bot-framework-integration)
- [Development and Release](#development-and-release)

## Capabilities

- API/site pool management
  - Persisted in SQLite with CRUD, sorting, filtering, and pagination.
- Batch testing with live progress
  - Streams NDJSON events and writes API `valid` status back automatically.
- Remote fetch and parsing
  - Supports `text/image/video/audio`, JSON path extraction, and HTML text extraction.
- Local dedup and fallback
  - Persists successful remote data with dedup; can fallback to local random history on remote failure.
- Dashboard operations
  - Import/export pool files, batch deletion, local data browsing, restart, and in-place update.

## Installation

Python 3.10+ is required.

```bash
pip install -r requirements.txt
```

Or install package directly:

```bash
pip install .
```

Notes:

- Distribution name: `api-aggregator`
- Import name: `api_aggregator`

## Quick Start

Start directly:

```bash
python start.py
```

Common options:

```bash
python start.py --dashboard-host 127.0.0.1 --dashboard-port 4141
python start.py --no-dashboard
```

Programmatic usage:

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

## Runtime and Configuration

Default runtime paths (relative to project root):

- `data/api_aggregator.db`: persistent site/API pools
- `data/local/`: local cached content (`text/image/video/audio`)
- `pool_files/`: default import/export directory

Default settings (defined in code):

- Dashboard bind: `0.0.0.0:4141`
- Default request timeout: `60s`
- Default request headers: `User-Agent` + `Accept: */*`

Note: in current implementation, `APIConfig` defaults are the source of truth; `data/app_config.json` is not the primary config source.

## Project Layout

```text
api-aggregator/
  src/api_aggregator/
    dashboard/         # Web UI and HTTP API
    data_service/      # remote fetch, local cache, high-level data flow
    entry/             # API/site entities and managers
    service/           # testing, import/export, restart, update
    database.py        # SQLite persistence
    main.py            # APICoreApp lifecycle
  pool_files/          # default pool import/export folder
  data/                # runtime data
  docs/
```

## Dashboard and HTTP API Docs

- Chinese: `docs/zh-CN/dashboard-http-api.md`
- English: `docs/en/dashboard-http-api.md`
- Data schema: `docs/zh-CN/api-data-schema.md`

Default dashboard URL: `http://127.0.0.1:4141`

## Bot Framework Integration

Use a 3-layer integration model:

1. Lifecycle: `await app.start()` on startup, `await app.stop()` on shutdown.
2. Message matching: `api_mgr.match_entries(...)`, then `data_service.fetch(...)`.
3. Scheduled trigger: register callback with `set_cron_entry_handler(...)`, call `fetch_cron_data(...)` inside callback.

Minimal adapter:

```python
from api_aggregator import APICoreApp, APIEntry


class BotFrameworkAdapter:
    def __init__(self) -> None:
        self.app = APICoreApp()
        self.app.set_cron_entry_handler(self.on_cron_entry)

    async def on_framework_start(self) -> None:
        await self.app.start()

    async def on_framework_stop(self) -> None:
        await self.app.stop()

    async def on_message(self, text: str) -> list[str]:
        replies: list[str] = []
        matched = self.app.api_mgr.match_entries(text, only_enabled=True)
        for entry in matched:
            data = await self.app.data_service.fetch(entry, use_local=True)
            if data and data.final_text:
                replies.append(data.final_text)
        return replies

    async def on_cron_entry(self, entry: APIEntry) -> None:
        data = await self.app.fetch_cron_data(entry, use_local=True)
        if data and data.final_text:
            print(f"[cron] {entry.name}: {data.final_text}")
```

## Development and Release

Local checks:

```bash
python -m compileall src tests
python -m unittest discover -s tests -p "test_*.py"
uv run ruff check .
```

Build package:

```bash
uv build
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Zhalslar/api-aggregator&type=Date)](https://star-history.com/#Zhalslar/api-aggregator&Date)

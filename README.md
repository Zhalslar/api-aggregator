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
  中文 | <a href="README.en.md">English</a>
</p>

轻量级 API 聚合核心运行时，提供 API/站点池管理、远程拉取解析、本地持久化、定时调度和 面板 管理。


## 📚 目录

- [✨ 特性](#特性)
- [📦 安装](#安装)
- [🚀 快速开始](#快速开始)
- [⚙️ 配置](#配置)
- [🤖 机器人框架对接（AstrBot 示例）](#机器人框架对接astrbot-示例)
- [🖥️ 面板](#面板)
- [🛠️ 开发与发布](#开发与发布)

## ✨ 特性

- API 与站点池管理（内置 + 本地）
- 远程响应解析（text/JSON/binary）
- 本地去重与持久化
- 面板 可视化管理
- Cron 调度（基于 `APScheduler`，默认安装）

## 📦 安装

| 场景 | 命令 |
| --- | --- |
| 从依赖文件安装（推荐） | `pip install -r requirements.txt` |
| 安装当前项目包 | `pip install .` |
| 使用 uv 同步环境 | `uv sync` |

说明：
- 发布包名：`api-aggregator`
- Python 导入名：`api_aggregator`

## 🚀 快速开始

终端快速启动：

```bash
python start.py
```

可选参数示例：

```bash
python start.py --dashboard-host 127.0.0.1 --dashboard-port 4141
```

代码接入示例：

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

## ⚙️ 配置

`APICoreApp()` 主要默认值：

- `data_dir`: `data/`（仓库根目录）
- `内置目录`: `presets/`（仓库根目录，内置 API/站点配置）
- `面板.enabled`: `True`
- `面板.host`: `0.0.0.0`
- `面板.port`: `4141`

运行时会在 `data/app_config.json` 自动生成可持久化配置，常用可改项：

```json
{
  "dashboard": { "enabled": true, "host": "0.0.0.0", "port": 4141 },
  "http": {
    "default_timeout": 60,
    "default_headers": { "User-Agent": "...", "Accept": "*/*" }
  },
  "logging": { "level": "INFO" },
  "paths": { "presets_dir": "presets" }
}
```

## 🤖 机器人框架对接（AstrBot 示例）


<details>
<summary>点击展开查看对接说明与示例代码</summary>

对接任何机器人框架都建议按这三层做：

1. 生命周期对接：框架启动时 `await app.start()`，停止时 `await app.stop()`。
2. 消息路由对接：收到消息后用 `api_mgr.match_entries(...)` 匹配，再 `data_service.fetch(...)` 拉取数据。
3. 定时任务对接：用 `set_cron_entry_handler(...)` 注册回调，回调里调用 `fetch_cron_data(...)` 并把结果推送回机器人。

最小适配器示例（AstrBot 可直接套这个结构到插件生命周期）：

```python
from __future__ import annotations

from api_aggregator import APICoreApp, APIEntry


class BotFrameworkAdapter:
    def __init__(self) -> None:
        self.app = APICoreApp()
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
        # 这里替换成框架自己的发消息 API
        print(text)
```

AstrBot 实际接入建议：

1. 在插件 `on_load`/`startup` 中初始化适配器并启动 `APICoreApp`。
2. 在消息事件回调中调用 `on_message(...)`，再把返回内容发送到会话。
3. 在插件 `shutdown` 中停止 `APICoreApp`，避免 aiohttp 会话泄漏。

</details>

## 🖥️ 面板

默认地址：`http://0.0.0.0:4141`

## 🛠️ 开发与发布

```bash
python -m compileall src tests
python -m unittest discover -s tests -p "test_*.py"
uv run ruff check .
uv build
```

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Zhalslar/api-aggregator&type=Date)](https://star-history.com/#Zhalslar/api-aggregator&Date)

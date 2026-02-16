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
  中文 | <a href="README.en.md">English</a>
</p>

面向机器人/自动化场景的 API 聚合运行时，提供 API 池与站点池管理、远程拉取与解析、本地去重持久化、定时触发、Web Dashboard 管理。

## 目录

- [核心能力](#核心能力)
- [安装](#安装)
- [Docker 部署](#docker-部署)
- [快速开始](#快速开始)
- [运行与配置](#运行与配置)
- [项目结构](#项目结构)
- [Dashboard 与 HTTP API 文档](#dashboard-与-http-api-文档)
- [与机器人框架集成](#与机器人框架集成)
- [开发与发布](#开发与发布)

## 核心能力

- API/站点池管理
  - 统一在 SQLite 中持久化，支持增删改查、排序、筛选、分页。
- 批量测试与可见化结果
  - 通过 NDJSON 流实时返回测试进度，自动回写 API `valid` 状态。
- 远程数据拉取与解析
  - 支持 `text/image/video/audio` 四类结果，支持 JSON 路径提取与 HTML 纯文本提取。
- 本地去重与回退
  - 远程成功时写入本地（文本/二进制去重）；远程失败时可回退读取本地随机历史数据。
- Dashboard 运维能力
  - 池导入导出、批量删除、本地数据浏览与删除、系统重启、代码更新。

## 安装

推荐 Python 3.10+。

```bash
pip install -r requirements.txt
```

或安装当前项目包：

```bash
pip install .
```

说明：

- 发布包名：`api-aggregator`
- 导入名：`api_aggregator`

## Docker 部署

完整说明见：`docs/zh-CN/docker.md`

### 方式一：直接使用 Docker

构建镜像：

```bash
docker build -t api-aggregator:latest .
```

运行容器：

```bash
docker run -d \
  --name api-aggregator \
  -p 4141:4141 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/pool_files:/app/pool_files" \
  --restart unless-stopped \
  api-aggregator:latest
```

### 方式二：使用 Docker Compose

```bash
docker compose up -d --build
```

停止并移除容器：

```bash
docker compose down
```

说明：

- Dashboard 地址：`http://127.0.0.1:4141`
- 持久化目录：
  - `./data` -> `/app/data`
  - `./pool_files` -> `/app/pool_files`

## 快速开始

直接启动：

```bash
python start.py
```

常用参数：

```bash
python start.py --dashboard-host 127.0.0.1 --dashboard-port 4141
python start.py --no-dashboard
```

代码方式接入：

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

## 运行与配置

默认运行目录（相对仓库根目录）：

- `data/api_aggregator.db`：站点池/API 池持久化数据库
- `data/local/`：本地缓存数据（text/image/video/audio）
- `pool_files/`：池导入导出默认目录

默认配置（代码内置）：

- Dashboard：`0.0.0.0:4141`
- 默认请求超时：`60s`
- 默认请求头：`User-Agent` + `Accept: */*`

注意：当前版本的 `APIConfig` 以代码默认值为主，`data/app_config.json` 并非核心配置来源。

## 项目结构

```text
api-aggregator/
  src/api_aggregator/
    dashboard/         # Web UI 与 HTTP API
    data_service/      # 远程请求、本地缓存、聚合数据服务
    entry/             # API/站点实体与管理器
    service/           # 测试、导入导出、重启、更新等服务
    database.py        # SQLite 持久化
    main.py            # APICoreApp 生命周期
  pool_files/          # 池导入导出默认目录
  data/                # 运行时数据目录
  docs/
```

## Dashboard 与 HTTP API 文档

- 中文：`docs/zh-CN/dashboard-http-api.md`
- English: `docs/en/dashboard-http-api.md`
- 数据结构说明：`docs/zh-CN/api-data-schema.md`
- Docker 部署：`docs/zh-CN/docker.md`

Dashboard 默认地址：`http://127.0.0.1:4141`

## 与机器人框架集成

建议按三层对接：

1. 生命周期：框架启动时 `await app.start()`，关闭时 `await app.stop()`。
2. 消息匹配：`api_mgr.match_entries(...)` 找命中 API，再 `data_service.fetch(...)` 拉取。
3. 定时触发：`set_cron_entry_handler(...)` 注册回调，回调中调用 `fetch_cron_data(...)`。

最小适配器：

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

## 开发与发布

本地检查：

```bash
python -m compileall src tests
python -m unittest discover -s tests -p "test_*.py"
uv run ruff check .
```

构建：

```bash
uv build
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Zhalslar/api-aggregator&type=Date)](https://star-history.com/#Zhalslar/api-aggregator&Date)

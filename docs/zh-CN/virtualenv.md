# 虚拟环境使用

推荐使用项目根目录下的 `.venv`。

## Windows PowerShell（推荐）

1. 创建并安装依赖（默认包含 APScheduler）：

```powershell
.\scripts\bootstrap.ps1
```

2. 激活虚拟环境：

```powershell
.\.venv\Scripts\Activate.ps1
```

3. 启动项目：

```powershell
python -c "import asyncio; from api_aggregator import APICoreApp; asyncio.run(APICoreApp().run_forever())"
```

## Windows 手动方式

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install -e .[scheduler]
```

## macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
pip install -e ".[scheduler]"
python -c "import asyncio; from api_aggregator import APICoreApp; asyncio.run(APICoreApp().run_forever())"
```

## 可选：不安装定时器依赖

如果你不需要 cron，可安装最小依赖：

```powershell
.\scripts\bootstrap.ps1 -NoScheduler
```

或手动：

```bash
pip install .
```

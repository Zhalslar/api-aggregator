# Virtual Environment Guide

Use a project-local `.venv` as the default workflow.

## Windows PowerShell (Recommended)

1. Create venv and install dependencies (includes APScheduler by default):

```powershell
.\scripts\bootstrap.ps1
```

2. Activate:

```powershell
.\.venv\Scripts\Activate.ps1
```

3. Start the app:

```powershell
python -c "import asyncio; from api_aggregator import APICoreApp; asyncio.run(APICoreApp().run_forever())"
```

## Windows Manual Setup

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

## Optional: Skip scheduler dependency

If you do not need cron scheduling:

```powershell
.\scripts\bootstrap.ps1 -NoScheduler
```

Or manually:

```bash
pip install .
```

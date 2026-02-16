# Virtual Environment Guide

Use a project-local `.venv` and prefer explicit manual commands for reproducible setup.

## Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install -r requirements.txt
python start.py
```

## macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
pip install -r requirements.txt
python start.py
```

## Install as Package (Optional)

```bash
pip install .
```

## Sanity Check

```bash
python -c "import api_aggregator; print('ok')"
```

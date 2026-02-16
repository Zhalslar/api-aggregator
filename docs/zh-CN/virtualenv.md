# 虚拟环境使用

建议使用项目根目录 `.venv`，并优先采用手动命令，确保与当前依赖声明一致。

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

## 以包方式安装（可选）

```bash
pip install .
```

## 校验安装

```bash
python -c "import api_aggregator; print('ok')"
```

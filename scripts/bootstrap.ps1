param(
    [switch]$NoScheduler
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Args
    )
    & $Command @Args
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $Command $($Args -join ' ')"
    }
}

if (-not (Test-Path ".venv")) {
    Invoke-Checked "python" "-m" "venv" ".venv"
}

$python = ".\.venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "virtual environment python not found: $python"
}

& $python -m pip --version | Out-Null
if ($LASTEXITCODE -ne 0) {
    Invoke-Checked $python "-m" "ensurepip" "--upgrade"
}

Invoke-Checked $python "-m" "pip" "install" "--upgrade" "pip"

if ($NoScheduler) {
    Invoke-Checked $python "-m" "pip" "install" "-e" "."
} else {
    Invoke-Checked $python "-m" "pip" "install" "-e" ".[scheduler]"
}

Write-Host ""
Write-Host "Virtual environment is ready."
Write-Host "Activate with: .\.venv\Scripts\Activate.ps1"
Write-Host "Run app with:"
Write-Host "  python -c `"import asyncio; from api_aggregator import APICoreApp; asyncio.run(APICoreApp().run_forever())`""

#requires -Version 5.1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$node = Get-Command node -ErrorAction Stop
$nodeMajor = [int](& $node.Source -p 'Number(process.versions.node.split(".")[0])')
if ($nodeMajor -lt 18) {
    throw "Node.js 18 or newer is required."
}

& powershell.exe -NoLogo -NoProfile -Sta -NonInteractive -ExecutionPolicy Bypass `
    -File (Join-Path $root "plugins\keepkeys\scripts\keepkeys.windows.ps1") `
    --self-test
if ($LASTEXITCODE -ne 0) {
    throw "KeepKeys Windows helper self-test failed."
}

Write-Output "KeepKeys development prerequisites are ready."

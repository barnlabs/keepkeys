#requires -Version 5.1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    & node --test plugins/keepkeys/mcp/server.test.mjs
    if ($LASTEXITCODE -ne 0) {
        throw "KeepKeys Node tests failed."
    }

    & powershell.exe -NoLogo -NoProfile -Sta -NonInteractive -ExecutionPolicy Bypass `
        -File plugins/keepkeys/scripts/keepkeys.windows.ps1 --self-test
    if ($LASTEXITCODE -ne 0) {
        throw "KeepKeys Windows helper tests failed."
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $python) {
        & $python.Source -m unittest `
            adapters.hermes.test_plugin `
            plugins.keepkeys.scripts.test_keepkeys_linux
        if ($LASTEXITCODE -ne 0) {
            throw "KeepKeys Hermes adapter tests failed."
        }
    }
} finally {
    Pop-Location
}

Write-Output "KeepKeys headless tests passed on Windows."

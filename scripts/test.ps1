#requires -Version 5.1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    & node --test `
        plugins/keepkeys/mcp/server.test.mjs `
        plugins/keepkeys/scripts/keepkeys-portal.test.mjs `
        plugins/keepkeys/scripts/check-for-update.test.mjs `
        plugins/keepkeys/scripts/keepkeys-cli.test.mjs
    if ($LASTEXITCODE -ne 0) {
        throw "KeepKeys Node tests failed."
    }

    & powershell.exe -NoLogo -NoProfile -Sta -NonInteractive -ExecutionPolicy Bypass `
        -File plugins/keepkeys/scripts/keepkeys.windows.ps1 --self-test
    if ($LASTEXITCODE -ne 0) {
        throw "KeepKeys Windows helper tests failed."
    }
    $env:KEEPKEYS_PORTAL_COMMIT = "1"
    try {
        "synthetic_secret" | & powershell.exe -NoLogo -NoProfile -Sta `
            -NonInteractive -ExecutionPolicy Bypass `
            -File plugins/keepkeys/scripts/keepkeys.windows.ps1 `
            _portal-commit `
            --name demo `
            --variable DEMO_TOKEN `
            --description "Synthetic test credential" `
            --provider Example `
            --documentation-url https://docs.example.com/api `
            --expect-existing no *> $null
        if ($LASTEXITCODE -eq 0) {
            throw "The Windows helper accepted a forged portal commit."
        }
    } finally {
        Remove-Item Env:KEEPKEYS_PORTAL_COMMIT -ErrorAction SilentlyContinue
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

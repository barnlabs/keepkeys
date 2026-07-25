#requires -Version 5.1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    & node scripts/validate-plugin.mjs
    & node scripts/validate-adapters.mjs
    & node scripts/validate-docs.mjs
    & node --check plugins/keepkeys/mcp/server.mjs
    & node --check plugins/keepkeys/mcp/server.test.mjs
    & node --check plugins/keepkeys/scripts/check-for-update.mjs
    & node --check plugins/keepkeys/scripts/check-for-update.test.mjs
    & node --check plugins/keepkeys/scripts/keepkeys-cli.mjs
    & node --check plugins/keepkeys/scripts/platform.mjs
    & node scripts/scan-secrets.mjs
    if ($LASTEXITCODE -ne 0) {
        throw "KeepKeys Node validation failed."
    }

    $tokens = $null
    $parseErrors = $null
    [void][Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $root "plugins\keepkeys\scripts\keepkeys.windows.ps1"),
        [ref]$tokens,
        [ref]$parseErrors
    )
    if ($parseErrors.Count -ne 0) {
        $messages = $parseErrors | ForEach-Object { $_.Message }
        throw "PowerShell syntax check failed: $($messages -join '; ')"
    }
} finally {
    Pop-Location
}

Write-Output "KeepKeys checks passed."

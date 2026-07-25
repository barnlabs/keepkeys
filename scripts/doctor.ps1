#requires -Version 5.1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    & node plugins/keepkeys/scripts/keepkeys-cli.mjs doctor
    if ($LASTEXITCODE -ne 0) {
        throw "KeepKeys doctor failed."
    }
} finally {
    Pop-Location
}

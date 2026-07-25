#requires -Version 5.1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
& node (Join-Path $root "plugins\keepkeys\scripts\check-for-update.mjs") @args
exit $LASTEXITCODE

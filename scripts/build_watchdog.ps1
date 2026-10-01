param([switch]$Release)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$profile = if ($Release) { 'release' } else { 'debug' }
$cargoArgs = @('build', '--manifest-path', (Join-Path $root 'watchdog\Cargo.toml'), '--locked')
if ($Release) { $cargoArgs += '--release' }
& cargo @cargoArgs
if ($LASTEXITCODE -ne 0) { throw 'Watchdog build failed.' }
$source = Join-Path $root "watchdog\target\$profile\hvideo-watchdog.exe"
foreach ($relative in @("target\$profile", "src-tauri\target\$profile")) {
    $destination = Join-Path $root $relative
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination (Join-Path $destination 'hvideo-watchdog.exe') -Force
}

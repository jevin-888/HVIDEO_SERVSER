$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $packageJson.version
$releaseRoot = Join-Path $root 'release'
$out = Join-Path $releaseRoot "HVideo_Admin_Portable_$version"
$watchdogExe = Join-Path $root 'watchdog\target\release\hvideo-watchdog.exe'
if (-not (Test-Path -LiteralPath $watchdogExe)) {
    throw 'Build the independent watchdog first: scripts/build_watchdog.ps1 -Release'
}

# The portable output is a generated artifact. Recreate it on every run so stale
# or incorrectly encoded launcher files cannot survive from an earlier package.
$releaseRootFull = [System.IO.Path]::GetFullPath($releaseRoot)
$outFull = [System.IO.Path]::GetFullPath($out)
$outParentFull = [System.IO.Path]::GetDirectoryName($outFull)
if (-not [System.String]::Equals($outParentFull, $releaseRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe portable output path: $outFull"
}
if (Test-Path -LiteralPath $outFull) {
    Remove-Item -LiteralPath $outFull -Recurse -Force
}
New-Item -ItemType Directory -Path $outFull -Force | Out-Null

$exeCandidates = @(
    (Join-Path $root 'src-tauri\target\release\HVideo Admin.exe'),
    (Join-Path $root 'src-tauri\target\release\hvideo-admin.exe')
)
$exe = $exeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $exe) {
    throw 'Release executable was not found. Run cargo build --manifest-path src-tauri/Cargo.toml --release first.'
}
Copy-Item -LiteralPath $exe -Destination (Join-Path $outFull 'HVideo Admin.exe') -Force
Copy-Item -LiteralPath $watchdogExe -Destination (Join-Path $outFull 'hvideo-watchdog.exe') -Force

# Never carry the build machine's fixed NIC address into a portable package.
# 0.0.0.0 is an explicit first-run marker: release startup rejects it and opens
# bootstrap.html, where the target machine's real IPv4 can be selected and is
# saved through the same select_server_network API used by the login page.
$configSrc = Join-Path $root 'config.toml'
if (-not (Test-Path -LiteralPath $configSrc)) {
    throw 'config.toml was not found.'
}
$configLines = [System.IO.File]::ReadAllLines($configSrc)
$insideServer = $false
$serverHostCount = 0
for ($index = 0; $index -lt $configLines.Length; $index++) {
    $line = $configLines[$index]
    if ($line -match '^\s*\[([^]]+)\]\s*$') {
        $insideServer = [System.String]::Equals($Matches[1], 'server', [System.StringComparison]::OrdinalIgnoreCase)
        continue
    }
    if ($insideServer -and $line -match '^\s*host\s*=') {
        $configLines[$index] = 'host = "0.0.0.0"'
        $serverHostCount++
    }
}
if ($serverHostCount -ne 1) {
    throw "Expected exactly one server.host in config.toml, found $serverHostCount."
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines((Join-Path $outFull 'config.toml'), $configLines, $utf8NoBom)

foreach ($file in @('config.json', 'yt-dlp.exe')) {
    $src = Join-Path $root $file
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination $outFull -Force
    }
}

foreach ($dir in @('data', 'migrations', 'nginx', 'app')) {
    $src = Join-Path $root $dir
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $outFull $dir) -Recurse -Force
    }
}

$songDbOut = Join-Path $outFull 'song_db'
New-Item -ItemType Directory -Path $songDbOut -Force | Out-Null
$songDb = Join-Path $root 'song_db\song.db'
if (Test-Path -LiteralPath $songDb) {
    Copy-Item -LiteralPath $songDb -Destination (Join-Path $songDbOut 'song.db') -Force
}

$staticOut = Join-Path $outFull 'static'
New-Item -ItemType Directory -Path $staticOut -Force | Out-Null
foreach ($dir in @('admin', 'assets', 'cashier', 'libs', 'vod_song')) {
    $src = Join-Path $root "static\$dir"
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $staticOut $dir) -Recurse -Force
    }
}

$bat = @'
@echo off
cd /d %~dp0
start "" "HVideo Admin.exe"
'@
$vbs = @'
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir
shell.Run """" & appDir & "\HVideo Admin.exe" & """", 0, False
'@

# Build Chinese launcher names from Unicode code points. The .ps1 source stays
# ASCII-only, so Windows PowerShell 5.1 cannot decode the names incorrectly.
$startFileName = "$([char]0x542F)$([char]0x52A8) HVideo Admin.bat"
$silentStartFileName = "$([char]0x9759)$([char]0x9ED8)$([char]0x542F)$([char]0x52A8) HVideo Admin.vbs"
Set-Content -LiteralPath (Join-Path $outFull $startFileName) -Value $bat -Encoding ASCII
Set-Content -LiteralPath (Join-Path $outFull $silentStartFileName) -Value $vbs -Encoding ASCII

$readme = "HVideo Admin Portable`r`n`r`n1. Copy or extract the complete HVideo_Admin_Portable folder. Do not copy only HVideo Admin.exe.`r`n2. On first startup, select this computer's server NIC IPv4. Selection is saved and the server restarts automatically.`r`n3. A license is bound to the target computer. Import a license generated for that computer's machine code.`r`n4. If the window cannot open at all, install Microsoft Edge WebView2 Runtime.`r`n5. Runtime logs are written to the logs folder.`r`n"
$readme += "6. Keep hvideo-watchdog.exe beside HVideo Admin.exe. Use tray Quit to stop both; forced termination triggers automatic recovery.`r`n"
[System.IO.File]::WriteAllText((Join-Path $outFull 'README.txt'), $readme, $utf8NoBom)

$zipPath = Join-Path $releaseRoot "HVideo_Admin_Portable_$version.zip"
$zipFull = [System.IO.Path]::GetFullPath($zipPath)
if (-not [System.String]::Equals([System.IO.Path]::GetDirectoryName($zipFull), $releaseRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe portable ZIP path: $zipFull"
}
if (Test-Path -LiteralPath $zipFull) {
    Remove-Item -LiteralPath $zipFull -Force
}
Compress-Archive -LiteralPath $outFull -DestinationPath $zipFull -CompressionLevel Optimal

Write-Host "Portable folder created: $outFull"
Write-Host "Portable ZIP created: $zipFull"

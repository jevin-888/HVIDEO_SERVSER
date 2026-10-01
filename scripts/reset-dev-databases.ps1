param(
    [switch]$IncludeSongDb,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$archiveRoot = Join-Path $root "data\reset_archives"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$archiveDir = Join-Path $archiveRoot $timestamp

function Assert-UnderRoot {
    param([string]$Path)

    $full = [System.IO.Path]::GetFullPath($Path)
    $rootFull = [System.IO.Path]::GetFullPath($root)
    if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refuse to move path outside project root: $full"
    }
}

function Move-IfExists {
    param(
        [string]$RelativePath,
        [string]$TargetName
    )

    $source = Join-Path $root $RelativePath
    Assert-UnderRoot $source
    if (-not (Test-Path $source)) {
        return
    }

    New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
    $target = Join-Path $archiveDir $TargetName
    Move-Item -LiteralPath $source -Destination $target -Force
    Write-Host "Moved $RelativePath -> data\reset_archives\$timestamp\$TargetName" -ForegroundColor Yellow
}

$running = Get-Process -Name "hvideo_server", "HVideo_Admin" -ErrorAction SilentlyContinue
if ($running -and -not $Force) {
    Write-Host "HVideo server is still running. Stop it first, or rerun with -Force if you are sure." -ForegroundColor Red
    $running | Select-Object ProcessName, Id | Format-Table
    exit 1
}

Move-IfExists "data\hvideo.db" "hvideo.db"
Move-IfExists "data\hvideo.db-wal" "hvideo.db-wal"
Move-IfExists "data\hvideo.db-shm" "hvideo.db-shm"
Move-IfExists "data\backups" "backups"

if ($IncludeSongDb) {
    Move-IfExists "song_db\song.db" "song.db"
    Move-IfExists "song_db\song.db-wal" "song.db-wal"
    Move-IfExists "song_db\song.db-shm" "song.db-shm"
}

if (Test-Path $archiveDir) {
    Write-Host "Development database reset archive created: $archiveDir" -ForegroundColor Green
} else {
    Write-Host "No development database files were found to reset." -ForegroundColor Green
}

Write-Host "Next server startup will create fresh databases from current migrations." -ForegroundColor Cyan

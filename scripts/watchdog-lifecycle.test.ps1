$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
& cargo build --manifest-path (Join-Path $root 'watchdog\Cargo.toml') --locked --bin hvideo-watchdog --example monitored-app
if ($LASTEXITCODE -ne 0) { throw 'Fixture build failed' }
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('HVideo watchdog test ' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
$app = Join-Path $temporary 'HVideo test app.exe'
$guard = Join-Path $temporary 'hvideo-watchdog.exe'
Copy-Item -LiteralPath (Join-Path $root 'watchdog\target\debug\hvideo-watchdog.exe') -Destination $guard
Copy-Item -LiteralPath (Join-Path $root 'watchdog\target\debug\examples\monitored-app.exe') -Destination $app
function Wait-Until([scriptblock]$Condition, [string]$Description, [int]$Seconds = 20) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 50
    }
    throw "Timed out: $Description"
}
function Worker-Id {
    $path = Join-Path $temporary 'worker.pid'
    if (Test-Path -LiteralPath $path) {
        $value = [IO.File]::ReadAllText($path)
        if ($value -match '^\d+$') { return [int]$value }
    }
    return 0
}
function Test-Processes {
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $app -or $_.Path -eq $guard })
}
function Set-Action([string]$Value) {
    $staging = Join-Path $temporary 'action.tmp'
    [IO.File]::WriteAllText($staging, $Value)
    Move-Item -LiteralPath $staging -Destination (Join-Path $temporary 'action')
}
try {
    Start-Process -FilePath $app -WorkingDirectory $temporary -WindowStyle Hidden
    Wait-Until { (Worker-Id) -gt 0 } 'first worker start'
    $guardId = (Test-Processes | Where-Object Path -eq $guard).Id
    if (-not $guardId) { throw 'Independent watchdog missing' }
    $oldWorker = Worker-Id
    # Duplicate launch must not spawn another worker or replace the supervisor.
    $duplicate = Start-Process -FilePath $app -WorkingDirectory $temporary -WindowStyle Hidden -PassThru
    $duplicate.WaitForExit(5000) | Out-Null
    Wait-Until { (Get-Content (Join-Path $temporary 'logs\watchdog.log') -Raw) -match 'ignoring duplicate launch' } 'duplicate ignored'
    if ((Worker-Id) -ne $oldWorker) { throw 'Duplicate replaced worker' }
    Write-Output 'PASS: independent executable and duplicate-launch exclusion'

    $timer = [Diagnostics.Stopwatch]::StartNew()
    Stop-Process -Id $oldWorker -Force
    Wait-Until { (Worker-Id) -ne $oldWorker } 'external termination recovery'
    if ($timer.Elapsed.TotalSeconds -gt 3) { throw 'First recovery was not immediate' }
    if (-not (Get-Process -Id $guardId -ErrorAction SilentlyContinue)) { throw 'Watchdog died with worker' }
    Write-Output "PASS: forced termination recovered in $($timer.ElapsedMilliseconds) ms, watchdog survived"

    foreach ($action in @('zero', 'panic', 'relaunch', 'native')) {
        $oldWorker = Worker-Id
        Set-Action $action
        Wait-Until { (Worker-Id) -ne $oldWorker } "recovery after $action" 40
        Write-Output "PASS: $action exit recovered"
    }
    $dump = Get-ChildItem (Join-Path $temporary 'logs\crashes') -Filter '*.dmp' | Select-Object -First 1
    if (-not $dump) { throw 'Missing native dump' }
    $bytes = [IO.File]::ReadAllBytes($dump.FullName)
    if ([Text.Encoding]::ASCII.GetString($bytes,0,4) -ne 'MDMP') { throw 'Invalid dump header' }
    $streamCount = [BitConverter]::ToUInt32($bytes,8)
    $directory = [BitConverter]::ToUInt32($bytes,12)
    $foundException = $false
    for ($i=0; $i -lt $streamCount; $i++) {
        $entry = $directory + 12*$i
        if ([BitConverter]::ToUInt32($bytes,$entry) -eq 6) {
            $rva = [BitConverter]::ToUInt32($bytes,$entry+8)
            $code = [BitConverter]::ToUInt32($bytes,$rva+8)
            if ($code -ne [Convert]::ToUInt32('E0424242',16)) { throw 'Wrong dump exception code' }
            $foundException = $true
        }
    }
    if (-not $foundException) { throw 'Dump lacks exception stream' }
    Write-Output 'PASS: real native dump contains expected exception code and context'

    Set-Action 'quit'
    Wait-Until { (Test-Processes).Count -eq 0 } 'user quit stops worker and watchdog'
    if (Get-ChildItem (Join-Path $temporary 'logs') -Filter 'guard-stop-*') { throw 'Stale stop marker' }
    # A fresh launch after a deliberate exit must not consume old stop intent.
    Start-Process -FilePath $app -WorkingDirectory $temporary -WindowStyle Hidden
    Wait-Until { (Test-Processes).Count -eq 2 } 'fresh launch after quit'
    Set-Action 'quit'
    Wait-Until { (Test-Processes).Count -eq 0 } 'second deliberate quit'
    Write-Output 'PASS: explicit exit stops both; next launch works; stop markers cleaned'
} finally {
    Test-Processes | Stop-Process -Force -ErrorAction SilentlyContinue
    $resolved = [IO.Path]::GetFullPath($temporary)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved).StartsWith('HVideo watchdog test '))) { throw 'Unsafe test cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

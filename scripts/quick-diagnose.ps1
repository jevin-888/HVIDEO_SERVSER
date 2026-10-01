# Quick Diagnostic Script for Room Binding Issues
# Usage: .\scripts\quick-diagnose.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Room Binding Quick Diagnostic" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if backend is running
Write-Host "1. Checking backend process..." -ForegroundColor Yellow
$process = Get-Process | Where-Object { $_.ProcessName -like "*hvideo*" }
if ($process) {
    Write-Host "   ✓ Backend is running (PID: $($process.Id))" -ForegroundColor Green
} else {
    Write-Host "   ✗ Backend is NOT running!" -ForegroundColor Red
    Write-Host "   Please start the backend first: cargo run" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# Check database
Write-Host "2. Checking database..." -ForegroundColor Yellow
if (Test-Path "data/hvideo.db") {
    Write-Host "   ✓ Database file exists" -ForegroundColor Green
} else {
    Write-Host "   ✗ Database file NOT found!" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Check terminals and rooms
Write-Host "3. Checking terminals and rooms..." -ForegroundColor Yellow
$result = sqlite3 data/hvideo.db "SELECT t.terminalIp, t.name as terminalName, t.onlineStatus, r.name as roomName, r.status as roomStatus FROM terminals t LEFT JOIN rooms r ON r.terminalId = t.id ORDER BY t.terminalIp;"

if ($result) {
    Write-Host "   Terminal IP    | Terminal Name | Online | Room Name | Room Status" -ForegroundColor Cyan
    Write-Host "   " + ("-" * 70) -ForegroundColor Cyan
    
    $lines = $result -split "`n"
    foreach ($line in $lines) {
        if ($line.Trim()) {
            $parts = $line -split "\|"
            $ip = $parts[0].PadRight(15)
            $tname = $parts[1].PadRight(14)
            $online = if ($parts[2] -eq "1") { "Yes".PadRight(7) } else { "No".PadRight(7) }
            $rname = $parts[3].PadRight(10)
            $rstatus = switch ($parts[4]) {
                "0" { "Idle" }
                "1" { "In Use" }
                "2" { "Maintenance" }
                default { "Unknown" }
            }
            
            $color = if ($parts[4] -eq "1") { "Green" } elseif ($parts[4] -eq "0") { "Yellow" } else { "Red" }
            Write-Host "   $ip | $tname | $online | $rname | $rstatus" -ForegroundColor $color
        }
    }
} else {
    Write-Host "   ✗ No terminals found in database!" -ForegroundColor Red
}
Write-Host ""

# Test API endpoint
Write-Host "4. Testing API endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/api/v1/rooms/current/state" -Method GET -ErrorAction Stop
    Write-Host "   ✓ API endpoint is accessible" -ForegroundColor Green
    Write-Host "   Response: $($response.StatusCode)" -ForegroundColor Gray
} catch {
    Write-Host "   ✗ API endpoint test failed!" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Instructions
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "If you see 'Room Status: Idle' above:" -ForegroundColor Yellow
Write-Host "  Run: sqlite3 data/hvideo.db `"UPDATE rooms SET status = 1 WHERE status = 0;`"" -ForegroundColor White
Write-Host ""
Write-Host "If you see 'No terminals found':" -ForegroundColor Yellow
Write-Host "  1. Check your client IP address" -ForegroundColor White
Write-Host "  2. Run: node scripts/diagnose-room-binding.js <YOUR_IP>" -ForegroundColor White
Write-Host ""
Write-Host "To access the frontend:" -ForegroundColor Yellow
Write-Host "  Client: http://<YOUR_IP>:8080/vod_song/client/?roomId=current" -ForegroundColor White
Write-Host "  Mobile: http://<YOUR_IP>:8080/vod_song/mobile/?roomId=current" -ForegroundColor White
Write-Host ""

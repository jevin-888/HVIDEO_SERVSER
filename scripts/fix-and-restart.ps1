# 一键修复并重启系统
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "一键修复并重启系统" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 停止现有进程
Write-Host "[1/4] 停止现有进程..." -ForegroundColor Yellow
Get-Process | Where-Object { $_.ProcessName -like "*hvideo*" -or $_.ProcessName -like "*cargo*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 2. 清理编译缓存
Write-Host "[2/4] 清理编译缓存..." -ForegroundColor Yellow
if (Test-Path "target") {
    Remove-Item "target/debug/hvideo_server.exe" -Force -ErrorAction SilentlyContinue
    Remove-Item "target/debug/hvideo_server.pdb" -Force -ErrorAction SilentlyContinue
}

# 3. 重新编译
Write-Host "[3/4] 重新编译后端..." -ForegroundColor Yellow
cargo build --release
if ($LASTEXITCODE -ne 0) {
    Write-Host "编译失败！" -ForegroundColor Red
    exit 1
}

# 4. 启动服务
Write-Host "[4/4] 启动服务..." -ForegroundColor Yellow
Start-Process -FilePath "target/release/hvideo_server.exe" -WorkingDirectory $PWD

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "系统已重启！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "接下来请：" -ForegroundColor Yellow
Write-Host "1. 打开浏览器，按 Ctrl+Shift+R 强制刷新页面（清除缓存）" -ForegroundColor White
Write-Host "2. 打开调试页面：http://localhost:8080/admin/debug-websocket.html" -ForegroundColor White
Write-Host "3. 点击测试按钮，观察是否收到 roomStateChanged 消息" -ForegroundColor White
Write-Host ""

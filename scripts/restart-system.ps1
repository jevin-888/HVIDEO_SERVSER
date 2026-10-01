# KTV 系统重启脚本
# 用于重新编译并重启后端服务

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  KTV 系统重启脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查当前运行的后端进程
Write-Host "[1/4] 检查当前运行的后端进程..." -ForegroundColor Yellow
$process = Get-Process | Where-Object {$_.Name -like "*hvideo*"}

if ($process) {
    Write-Host "  找到运行中的进程:" -ForegroundColor Green
    $process | Format-Table Name, Id, StartTime -AutoSize
    
    Write-Host "  正在停止进程..." -ForegroundColor Yellow
    try {
        Stop-Process -Name "hvideo-admin" -Force -ErrorAction Stop
        Write-Host "  ✅ 进程已停止" -ForegroundColor Green
        Start-Sleep -Seconds 2
    } catch {
        Write-Host "  ⚠️  停止进程失败: $_" -ForegroundColor Red
        Write-Host "  尝试使用 taskkill..." -ForegroundColor Yellow
        taskkill /F /IM hvideo-admin.exe
        Start-Sleep -Seconds 2
    }
} else {
    Write-Host "  ℹ️  没有找到运行中的后端进程" -ForegroundColor Gray
}

Write-Host ""

# 2. 重新编译后端
Write-Host "[2/4] 重新编译后端（包含新功能）..." -ForegroundColor Yellow
Write-Host "  这可能需要几分钟时间，请耐心等待..." -ForegroundColor Gray

try {
    $buildOutput = cargo build --release 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ 编译成功" -ForegroundColor Green
    } else {
        Write-Host "  ❌ 编译失败" -ForegroundColor Red
        Write-Host "  错误信息:" -ForegroundColor Red
        Write-Host $buildOutput -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  ❌ 编译过程出错: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# 3. 启动新的后端
Write-Host "[3/4] 启动新的后端服务..." -ForegroundColor Yellow

if (Test-Path ".\target\release\hvideo-admin.exe") {
    try {
        # 在后台启动进程
        Start-Process -FilePath ".\target\release\hvideo-admin.exe" -WindowStyle Normal
        Start-Sleep -Seconds 3
        
        # 验证进程是否启动
        $newProcess = Get-Process -Name "hvideo-admin" -ErrorAction SilentlyContinue
        
        if ($newProcess) {
            Write-Host "  ✅ 后端服务已启动" -ForegroundColor Green
            Write-Host "  进程ID: $($newProcess.Id)" -ForegroundColor Gray
            Write-Host "  启动时间: $($newProcess.StartTime)" -ForegroundColor Gray
        } else {
            Write-Host "  ⚠️  无法确认进程是否启动" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  ❌ 启动失败: $_" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  ❌ 找不到编译后的可执行文件" -ForegroundColor Red
    exit 1
}

Write-Host ""

# 4. 显示访问信息
Write-Host "[4/4] 系统重启完成！" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  访问地址" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  诊断工具:" -ForegroundColor Yellow
Write-Host "  http://192.168.1.28:8080/vod_song/diagnostic.html" -ForegroundColor White
Write-Host ""
Write-Host "  触摸屏端（示例）:" -ForegroundColor Yellow
Write-Host "  http://192.168.1.28:8080/vod_song/client/?192.168.1.59" -ForegroundColor White
Write-Host ""
Write-Host "  手机端（示例）:" -ForegroundColor Yellow
Write-Host "  http://192.168.1.28:8080/vod_song/mobile/?192.168.1.59" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚠️  重要提示:" -ForegroundColor Yellow
Write-Host "  1. 请清除浏览器缓存（Ctrl+Shift+R）" -ForegroundColor Gray
Write-Host "  2. 或使用诊断工具的'清除缓存'功能" -ForegroundColor Gray
Write-Host "  3. 首次访问时会收到 WebSocket 初始状态推送" -ForegroundColor Gray
Write-Host ""
Write-Host "✅ 完成！" -ForegroundColor Green

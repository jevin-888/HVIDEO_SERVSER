# 播控系统状态检查脚本

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   播控系统状态检查" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allGood = $true

# 1. 检查修复代码
Write-Host "[1/5] 检查修复代码..." -ForegroundColor Yellow
$fixLine = Select-String -Path "static/vod_song/client/navigation/bottomNav/BottomNavUI.js" -Pattern "let smartlUI = window.smartlUI"
if ($fixLine) {
    Write-Host "      ✅ 修复代码已存在 (第 $($fixLine.LineNumber) 行)" -ForegroundColor Green
} else {
    Write-Host "      ❌ 修复代码未找到" -ForegroundColor Red
    $allGood = $false
}

# 2. 检查后端服务
Write-Host "[2/5] 检查后端服务..." -ForegroundColor Yellow
$process = Get-Process -Name "hvideo_server" -ErrorAction SilentlyContinue
if ($process) {
    Write-Host "      ✅ 后端服务运行中 (PID: $($process.Id))" -ForegroundColor Green
} else {
    Write-Host "      ❌ 后端服务未运行" -ForegroundColor Red
    $allGood = $false
}

# 3. 测试API
Write-Host "[3/5] 测试API端点..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://192.168.1.28:8080/api/v1/rooms/192.168.1.59/state" -Method Get -TimeoutSec 5
    if ($response.code -eq 0) {
        Write-Host "      ✅ API正常响应" -ForegroundColor Green
        Write-Host "         房间: $($response.data.roomName)" -ForegroundColor Gray
        Write-Host "         播放状态: $($response.data.playState)" -ForegroundColor Gray
        Write-Host "         音量: $($response.data.volume)" -ForegroundColor Gray
    } else {
        Write-Host "      ⚠️  API返回错误: $($response.message)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "      ❌ API无法访问: $($_.Exception.Message)" -ForegroundColor Red
    $allGood = $false
}

# 4. 检查数据库
Write-Host "[4/5] 检查数据库..." -ForegroundColor Yellow
if (Test-Path "data/hvideo.db") {
    Write-Host "      ✅ 数据库文件存在" -ForegroundColor Green
    
    try {
        $dbResult = sqlite3 data/hvideo.db "SELECT name, playState, volume, updatedAt FROM rooms WHERE name = 'A02';" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "      ✅ 数据库可访问" -ForegroundColor Green
            Write-Host "         $dbResult" -ForegroundColor Gray
        } else {
            Write-Host "      ⚠️  数据库查询失败" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "      ⚠️  sqlite3 未安装或不可用" -ForegroundColor Yellow
    }
} else {
    Write-Host "      ❌ 数据库文件不存在" -ForegroundColor Red
    $allGood = $false
}

# 5. 检查前端文件
Write-Host "[5/5] 检查前端文件..." -ForegroundColor Yellow
$files = @(
    "static/vod_song/client/navigation/bottomNav/BottomNavUI.js",
    "static/vod_song/shared/navigation/smartl/SmartlService.js",
    "static/vod_song/client/navigation/smartl/SmartlUI.js",
    "static/vod_song/shared/core/ApiService.js"
)

$missingFiles = @()
foreach ($file in $files) {
    if (-not (Test-Path $file)) {
        $missingFiles += $file
    }
}

if ($missingFiles.Count -eq 0) {
    Write-Host "      ✅ 所有前端文件存在" -ForegroundColor Green
} else {
    Write-Host "      ❌ 缺少文件:" -ForegroundColor Red
    foreach ($file in $missingFiles) {
        Write-Host "         - $file" -ForegroundColor Red
    }
    $allGood = $false
}

# 总结
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($allGood) {
    Write-Host "   ✅ 系统状态正常" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  发现问题，请检查上述错误" -ForegroundColor Yellow
}
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 下一步指导
Write-Host "📋 下一步操作：" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 在浏览器中访问检查页面：" -ForegroundColor White
Write-Host "   http://192.168.1.28:8080/vod_song/check-fix.html" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. 在客户端页面按 Ctrl + Shift + R 强制刷新" -ForegroundColor White
Write-Host ""
Write-Host "3. 测试播控功能：" -ForegroundColor White
Write-Host "   - 访问: http://192.168.1.28:8080/vod_song/client/?192.168.1.59" -ForegroundColor Yellow
Write-Host "   - 点击底部导航的'智控'按钮" -ForegroundColor Yellow
Write-Host "   - 切换到'音效'标签" -ForegroundColor Yellow
Write-Host "   - 点击音量 + 按钮" -ForegroundColor Yellow
Write-Host ""
Write-Host "4. 查看详细说明：" -ForegroundColor White
Write-Host "   - 中文: 播控修复说明.md" -ForegroundColor Yellow
Write-Host "   - English: PLAYBACK_FIX_COMPLETE.md" -ForegroundColor Yellow
Write-Host ""

# 测试音量API
Write-Host "🧪 快速测试音量API？(Y/N): " -ForegroundColor Cyan -NoNewline
$test = Read-Host

if ($test -eq "Y" -or $test -eq "y") {
    Write-Host ""
    Write-Host "正在测试音量API..." -ForegroundColor Yellow
    
    try {
        # 获取当前音量
        $state = Invoke-RestMethod -Uri "http://192.168.1.28:8080/api/v1/rooms/192.168.1.59/state" -Method Get
        $currentVolume = $state.data.volume
        Write-Host "当前音量: $currentVolume" -ForegroundColor Cyan
        
        # 增加音量
        $newVolume = $currentVolume + 5
        $body = @{ volume = $newVolume } | ConvertTo-Json
        $result = Invoke-RestMethod -Uri "http://192.168.1.28:8080/api/v1/rooms/192.168.1.59/volume" -Method Post -Body $body -ContentType "application/json"
        
        if ($result.code -eq 0) {
            Write-Host "✅ 音量API调用成功" -ForegroundColor Green
            Write-Host "   新音量: $newVolume" -ForegroundColor Cyan
            
            # 验证
            Start-Sleep -Seconds 1
            $verify = Invoke-RestMethod -Uri "http://192.168.1.28:8080/api/v1/rooms/192.168.1.59/state" -Method Get
            $verifyVolume = $verify.data.volume
            
            if ($verifyVolume -eq $newVolume) {
                Write-Host "✅ 数据库已更新，确认音量: $verifyVolume" -ForegroundColor Green
            } else {
                Write-Host "⚠️  数据库未更新，当前音量: $verifyVolume" -ForegroundColor Yellow
            }
        } else {
            Write-Host "❌ API返回错误: $($result.message)" -ForegroundColor Red
        }
    } catch {
        Write-Host "❌ 测试失败: $($_.Exception.Message)" -ForegroundColor Red
    }
    Write-Host ""
}

Write-Host "完成！" -ForegroundColor Green

# 完整的 APK 构建脚本
# 1. 同步文件到 Android 项目
# 2. 构建 APK
# 3. 显示 APK 位置和大小

param(
    [switch]$SkipSync = $false
)

Write-Host "=== Hvideo APK 完整构建 ===" -ForegroundColor Cyan
Write-Host ""

# 步骤 1: 同步文件
if (-not $SkipSync) {
    Write-Host "[1/2] 同步文件到 Android 项目..." -ForegroundColor Yellow
    & "$PSScriptRoot\sync-to-android.ps1"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n✗ 文件同步失败" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
} else {
    Write-Host "[1/2] 跳过文件同步 (使用 -SkipSync 参数)" -ForegroundColor Yellow
    Write-Host ""
}

# 步骤 2: 构建 APK
Write-Host "[2/2] 构建 APK..." -ForegroundColor Yellow
Push-Location android

try {
    $buildStart = Get-Date
    
    # 运行 Gradle 构建
    & ./gradlew assembleDebug
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n✗ APK 构建失败" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    
    $buildEnd = Get-Date
    $buildDuration = ($buildEnd - $buildStart).TotalSeconds
    
    Write-Host "`n✓ APK 构建成功！" -ForegroundColor Green
    Write-Host "构建耗时: $([math]::Round($buildDuration, 1)) 秒" -ForegroundColor Cyan
    
    # 显示 APK 信息
    $apkPath = "app\build\outputs\apk\debug\app-debug.apk"
    if (Test-Path $apkPath) {
        $apkInfo = Get-Item $apkPath
        $apkSizeMB = [math]::Round($apkInfo.Length / 1MB, 2)
        
        Write-Host "`n=== APK 信息 ===" -ForegroundColor Cyan
        Write-Host "位置: android\$apkPath" -ForegroundColor White
        Write-Host "大小: $apkSizeMB MB" -ForegroundColor White
        Write-Host "修改时间: $($apkInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor White
        
        Write-Host "`n提示: 使用以下命令安装到设备:" -ForegroundColor Yellow
        Write-Host "  adb install -r $apkPath" -ForegroundColor Cyan
    } else {
        Write-Host "`n⚠ 警告: 未找到 APK 文件" -ForegroundColor Yellow
    }
    
} finally {
    Pop-Location
}

Write-Host "`n=== 构建完成 ===" -ForegroundColor Green

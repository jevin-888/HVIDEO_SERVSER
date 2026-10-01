# 同步修改的文件到 Android 项目
# 用于快速部署前端代码更改到 Capacitor Android 项目

Write-Host "=== 同步文件到 Android 项目 ===" -ForegroundColor Green

# 定义需要同步的文件
$filesToSync = @(
    @{
        Source = "static\vod_song\shared\core\ApiService.js"
        Dest = "android\app\src\main\assets\public\shared\core\ApiService.js"
    },
    @{
        Source = "static\vod_song\client\index.js"
        Dest = "android\app\src\main\assets\public\client\index.js"
    },
    @{
        Source = "static\vod_song\client\assets\css\style-client.css"
        Dest = "android\app\src\main\assets\public\client\assets\css\style-client.css"
    },
    @{
        Source = "static\vod_song\shared\config\apiConfig.js"
        Dest = "android\app\src\main\assets\public\shared\config\apiConfig.js"
    }
)

$successCount = 0
$failCount = 0

foreach ($file in $filesToSync) {
    $sourcePath = $file.Source
    $destPath = $file.Dest
    
    if (Test-Path $sourcePath) {
        try {
            Copy-Item -Path $sourcePath -Destination $destPath -Force
            Write-Host "✓ 已同步: $sourcePath" -ForegroundColor Green
            $successCount++
        } catch {
            Write-Host "✗ 同步失败: $sourcePath" -ForegroundColor Red
            Write-Host "  错误: $_" -ForegroundColor Red
            $failCount++
        }
    } else {
        Write-Host "✗ 源文件不存在: $sourcePath" -ForegroundColor Yellow
        $failCount++
    }
}

Write-Host "`n=== 同步完成 ===" -ForegroundColor Green
Write-Host "成功: $successCount 个文件" -ForegroundColor Green
Write-Host "失败: $failCount 个文件" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })

if ($failCount -eq 0) {
    Write-Host "`n提示: 现在可以运行以下命令重新构建 APK:" -ForegroundColor Cyan
    Write-Host "  cd android" -ForegroundColor Yellow
    Write-Host "  ./gradlew assembleDebug" -ForegroundColor Yellow
}

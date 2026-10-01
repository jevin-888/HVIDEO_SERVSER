# 清理构建缓存脚本 (PowerShell)
# 清理 Android 构建缓存、Node.js 缓存等

Write-Host "🧹 开始清理构建缓存..." -ForegroundColor Cyan
Write-Host ""

$projectRoot = $PSScriptRoot | Split-Path -Parent
$cleanedCount = 0
$errorCount = 0

# 需要清理的目录
$cleanDirs = @(
    "$projectRoot\android\app\build",
    "$projectRoot\android\build",
    "$projectRoot\android\capacitor-cordova-android-plugins\build",
    "$projectRoot\android\.gradle",
    "$projectRoot\android\.idea",
    "$projectRoot\android\app\.cxx",
    "$projectRoot\android\.cxx",
    "$projectRoot\.capacitor"
)

# 需要清理的文件
$cleanFiles = @(
    "$projectRoot\android\local.properties"
)

# 清理目录
Write-Host "📁 清理构建目录..." -ForegroundColor Yellow
foreach ($dir in $cleanDirs) {
    if (Test-Path $dir) {
        try {
            Write-Host "  删除目录: $($dir.Replace($projectRoot, '.'))" -ForegroundColor Gray
            Remove-Item -Path $dir -Recurse -Force -ErrorAction Stop
            $cleanedCount++
        }
        catch {
            Write-Host "  ❌ 删除目录失败: $($dir.Replace($projectRoot, '.')) - $($_.Exception.Message)" -ForegroundColor Red
            $errorCount++
        }
    }
}

# 清理文件
Write-Host ""
Write-Host "📄 清理构建文件..." -ForegroundColor Yellow
foreach ($file in $cleanFiles) {
    if (Test-Path $file) {
        try {
            Write-Host "  删除文件: $($file.Replace($projectRoot, '.'))" -ForegroundColor Gray
            Remove-Item -Path $file -Force -ErrorAction Stop
            $cleanedCount++
        }
        catch {
            Write-Host "  ❌ 删除文件失败: $($file.Replace($projectRoot, '.')) - $($_.Exception.Message)" -ForegroundColor Red
            $errorCount++
        }
    }
}

# 清理 Gradle 缓存
Write-Host ""
Write-Host "🔧 清理 Gradle 缓存..." -ForegroundColor Yellow
try {
    $gradleUserHome = $env:GRADLE_USER_HOME
    if (-not $gradleUserHome) {
        $gradleUserHome = "$env:USERPROFILE\.gradle"
    }
    
    $gradleCache = "$gradleUserHome\caches\modules-2"
    if (Test-Path $gradleCache) {
        Write-Host "  清理 Gradle 缓存: $gradleCache" -ForegroundColor Gray
        Remove-Item -Path $gradleCache -Recurse -Force -ErrorAction Stop
        $cleanedCount++
    }
}
catch {
    Write-Host "  ⚠️  清理 Gradle 缓存失败: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 总结
Write-Host ""
Write-Host "✅ 清理完成!" -ForegroundColor Green
Write-Host "  成功清理: $cleanedCount 个项目" -ForegroundColor Green
if ($errorCount -gt 0) {
    Write-Host "  失败: $errorCount 个项目" -ForegroundColor Red
}

Write-Host ""
Write-Host "💡 提示:" -ForegroundColor Cyan
Write-Host "  1. 如果需要重新构建 Android 项目，请运行: npm run build:android" -ForegroundColor Gray
Write-Host "  2. 如果清理了 local.properties，需要重新配置 Android SDK 路径" -ForegroundColor Gray
Write-Host "  3. 如果清理了 node_modules，请运行: npm install" -ForegroundColor Gray


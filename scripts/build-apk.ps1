# 触摸屏端 APK 打包脚本
# 使用 Capacitor 将 Web 应用打包成 Android APK

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  火山点歌 - 触摸屏端 APK 打包工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
Write-Host "[1/6] 检查 Node.js..." -ForegroundColor Yellow
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ 错误: 未安装 Node.js" -ForegroundColor Red
    Write-Host "请访问 https://nodejs.org 下载安装" -ForegroundColor Red
    exit 1
}
$nodeVersion = node --version
Write-Host "✓ Node.js 版本: $nodeVersion" -ForegroundColor Green
Write-Host ""

# 检查 Android Studio
Write-Host "[2/6] 检查 Android Studio..." -ForegroundColor Yellow
$androidHome = $env:ANDROID_HOME
if (-not $androidHome) {
    Write-Host "⚠ 警告: 未设置 ANDROID_HOME 环境变量" -ForegroundColor Yellow
    Write-Host "请确保已安装 Android Studio 并配置环境变量" -ForegroundColor Yellow
} else {
    Write-Host "✓ ANDROID_HOME: $androidHome" -ForegroundColor Green
}
Write-Host ""

# 安装依赖
Write-Host "[3/6] 检查 Capacitor 依赖..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules/@capacitor/core")) {
    Write-Host "正在安装 Capacitor 依赖..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ 依赖安装失败" -ForegroundColor Red
        exit 1
    }
}
Write-Host "✓ 依赖已就绪" -ForegroundColor Green
Write-Host ""

# 检查 Android 平台
Write-Host "[4/6] 检查 Android 平台..." -ForegroundColor Yellow
if (-not (Test-Path "android")) {
    Write-Host "首次运行，正在添加 Android 平台..." -ForegroundColor Yellow
    npx cap add android
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ 添加 Android 平台失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Android 平台已添加" -ForegroundColor Green
} else {
    Write-Host "✓ Android 平台已存在" -ForegroundColor Green
}
Write-Host ""

# 同步代码
Write-Host "[5/6] 同步代码到 Android 项目..." -ForegroundColor Yellow
npx cap sync
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 代码同步失败" -ForegroundColor Red
    exit 1
}
Write-Host "✓ 代码同步完成" -ForegroundColor Green
Write-Host ""

# 打开 Android Studio
Write-Host "[6/6] 打开 Android Studio..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  下一步操作" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Android Studio 将自动打开" -ForegroundColor White
Write-Host "2. 等待 Gradle 同步完成（首次需要下载依赖）" -ForegroundColor White
Write-Host "3. 点击 Build → Build Bundle(s) / APK(s) → Build APK(s)" -ForegroundColor White
Write-Host "4. 等待构建完成" -ForegroundColor White
Write-Host "5. APK 位置: android/app/build/outputs/apk/debug/app-debug.apk" -ForegroundColor White
Write-Host ""
Write-Host "提示: 首次构建可能需要 5-10 分钟" -ForegroundColor Yellow
Write-Host ""

npx cap open android

Write-Host ""
Write-Host "✓ 完成！Android Studio 已打开" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  配置说明" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "默认服务器 IP: 192.168.1.56" -ForegroundColor White
Write-Host "修改方式: 左上角连续点击5次 → 输入密码 989898" -ForegroundColor White
Write-Host ""
Write-Host "详细文档: docs/APK打包指南.md" -ForegroundColor Cyan
Write-Host ""

@echo off
echo ========================================
echo   火山点歌 - 触摸屏端 APK 打包工具
echo ========================================
echo.

echo [1/6] 检查 Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 未安装 Node.js
    echo 请访问 https://nodejs.org 下载安装
    pause
    exit /b 1
)
node --version
echo.

echo [2/6] 检查 Android Studio...
if not defined ANDROID_HOME (
    echo 警告: 未设置 ANDROID_HOME 环境变量
    echo 请确保已安装 Android Studio 并配置环境变量
) else (
    echo ANDROID_HOME: %ANDROID_HOME%
)
echo.

echo [3/6] 安装 Capacitor 依赖...
call npm install
if %errorlevel% neq 0 (
    echo 错误: 依赖安装失败
    pause
    exit /b 1
)
echo.

echo [4/6] 检查 Android 平台...
if not exist "android" (
    echo 首次运行，正在添加 Android 平台...
    call npx cap add android
    if %errorlevel% neq 0 (
        echo 错误: 添加 Android 平台失败
        pause
        exit /b 1
    )
)
echo.

echo [5/6] 同步代码到 Android 项目...
cmd /c "npx cap sync android"
if %errorlevel% neq 0 (
    echo 错误: 代码同步失败
    pause
    exit /b 1
)
echo.

echo [6/6] 打开 Android Studio...
echo.
echo ========================================
echo   下一步操作
echo ========================================
echo.
echo 1. Android Studio 将自动打开
echo 2. 等待 Gradle 同步完成（首次需要下载依赖）
echo 3. 点击 Build - Build Bundle(s) / APK(s) - Build APK(s)
echo 4. 等待构建完成
echo 5. APK 位置: android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo 提示: 首次构建可能需要 5-10 分钟
echo.

call npx cap open android

echo.
echo 完成！Android Studio 已打开
echo.
echo ========================================
echo   配置说明
echo ========================================
echo.
echo 默认服务器 IP: 192.168.1.56
echo 修改方式: 左上角连续点击5次 - 输入密码 989898
echo.
echo 网络配置:
echo - 使用 HTTP 协议（局域网）
echo - shared/ 文件夹已包含在 APK 中
echo - 支持 192.168.x.x 和 10.x.x.x 局域网地址
echo.
echo 详细文档: docs\APK打包指南.md
echo.
pause

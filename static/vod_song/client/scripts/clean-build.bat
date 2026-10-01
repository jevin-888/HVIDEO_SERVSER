@echo off
REM 清理构建缓存脚本 (Batch)
REM 清理 Android 构建缓存、Node.js 缓存等

echo 🧹 开始清理构建缓存...
echo.

set "projectRoot=%~dp0.."
set "cleanedCount=0"
set "errorCount=0"

REM 清理目录
echo 📁 清理构建目录...
call :cleanDir "%projectRoot%\android\app\build"
call :cleanDir "%projectRoot%\android\build"
call :cleanDir "%projectRoot%\android\capacitor-cordova-android-plugins\build"
call :cleanDir "%projectRoot%\android\.gradle"
call :cleanDir "%projectRoot%\android\.idea"
call :cleanDir "%projectRoot%\android\app\.cxx"
call :cleanDir "%projectRoot%\android\.cxx"
call :cleanDir "%projectRoot%\.capacitor"

REM 清理文件
echo.
echo 📄 清理构建文件...
call :cleanFile "%projectRoot%\android\local.properties"

REM 清理 Gradle 缓存
echo.
echo 🔧 清理 Gradle 缓存...
set "gradleUserHome=%USERPROFILE%\.gradle"
if defined GRADLE_USER_HOME set "gradleUserHome=%GRADLE_USER_HOME%"
set "gradleCache=%gradleUserHome%\caches\modules-2"
if exist "%gradleCache%" (
    echo   清理 Gradle 缓存: %gradleCache%
    rmdir /s /q "%gradleCache%" 2>nul
    if %errorlevel% equ 0 (
        set /a cleanedCount+=1
    ) else (
        set /a errorCount+=1
    )
)

REM 总结
echo.
echo ✅ 清理完成!
echo   成功清理: %cleanedCount% 个项目
if %errorCount% gtr 0 (
    echo   失败: %errorCount% 个项目
)

echo.
echo 💡 提示:
echo   1. 如果需要重新构建 Android 项目，请运行: npm run build:android
echo   2. 如果清理了 local.properties，需要重新配置 Android SDK 路径
echo   3. 如果清理了 node_modules，请运行: npm install

goto :eof

:cleanDir
if exist "%~1" (
    echo   删除目录: %~1
    rmdir /s /q "%~1" 2>nul
    if %errorlevel% equ 0 (
        set /a cleanedCount+=1
    ) else (
        echo   ❌ 删除目录失败: %~1
        set /a errorCount+=1
    )
)
goto :eof

:cleanFile
if exist "%~1" (
    echo   删除文件: %~1
    del /f /q "%~1" 2>nul
    if %errorlevel% equ 0 (
        set /a cleanedCount+=1
    ) else (
        echo   ❌ 删除文件失败: %~1
        set /a errorCount+=1
    )
)
goto :eof


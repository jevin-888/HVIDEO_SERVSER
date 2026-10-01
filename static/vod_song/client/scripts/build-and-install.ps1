# 构建并安装 Android APK 脚本 (PowerShell)
# 1. 卸载旧APK（如果已安装）
# 2. 构建新APK
# 3. 安装新APK

param(
    [switch]$Release,
    [switch]$Debug,
    [switch]$SkipUninstall,
    [switch]$SkipBuild,
    [switch]$SkipInstall
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$appId = "com.huoshan.ktv"
$androidDir = Join-Path $projectRoot "android"
$apkDebugPath = Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"
$apkReleasePath = Join-Path $androidDir "app\build\outputs\apk\release\app-release.apk"

# 确定构建类型
$buildType = if ($Release) { "release" } else { "debug" }

Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "构建并安装 Android APK" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "应用ID: $appId" -ForegroundColor Gray
Write-Host "项目根目录: $projectRoot" -ForegroundColor Gray
Write-Host "Android 目录: $androidDir" -ForegroundColor Gray
Write-Host "构建类型: $buildType" -ForegroundColor Gray
if ($SkipUninstall) { Write-Host "跳过卸载: 是" -ForegroundColor Yellow }
if ($SkipBuild) { Write-Host "跳过构建: 是" -ForegroundColor Yellow }
if ($SkipInstall) { Write-Host "跳过安装: 是" -ForegroundColor Yellow }
Write-Host ""

# 检查 adb 命令
function Test-CommandExists {
    param([string]$Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

if (-not (Test-CommandExists "adb")) {
    Write-Host "❌ adb 命令未找到！" -ForegroundColor Red
    Write-Host "请确保已安装 Android SDK 并配置了环境变量" -ForegroundColor Yellow
    Write-Host "或者将 Android SDK platform-tools 目录添加到 PATH" -ForegroundColor Yellow
    exit 1
}

# 检查设备连接
function Test-DeviceConnected {
    try {
        $result = adb devices
        $devices = $result | Select-Object -Skip 1 | Where-Object { $_ -match "device\s*$" }
        return $devices.Count -gt 0
    } catch {
        return $false
    }
}

# 检查应用是否已安装
function Test-AppInstalled {
    try {
        $packages = adb shell pm list packages
        return $packages -match "package:$appId"
    } catch {
        return $false
    }
}

# 卸载APK
function Uninstall-App {
    Write-Host "📱 检查应用是否已安装..." -ForegroundColor Cyan
    
    if (-not (Test-AppInstalled)) {
        Write-Host "   ℹ️  应用未安装，跳过卸载" -ForegroundColor Gray
        return $true
    }
    
    Write-Host "   🗑️  卸载旧APK..." -ForegroundColor Yellow
    try {
        adb uninstall $appId
        Write-Host "   ✅ 旧APK卸载成功" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "   ❌ 卸载失败: $_" -ForegroundColor Red
        return $false
    }
}

# 构建APK
function Build-Apk {
    param([string]$BuildType)
    
    Write-Host "`n🔨 构建 $BuildType APK..." -ForegroundColor Cyan
    
    $gradleCommand = ".\gradlew.bat"
    $buildTypeCapitalized = $BuildType.Substring(0,1).ToUpper() + $BuildType.Substring(1)
    $buildCommand = "$gradleCommand assemble$buildTypeCapitalized"
    
    Write-Host "   执行命令: $buildCommand" -ForegroundColor Gray
    
    try {
        Push-Location $androidDir
        & cmd /c $buildCommand
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   ✅ $BuildType APK 构建成功" -ForegroundColor Green
            return $true
        } else {
            Write-Host "   ❌ $BuildType APK 构建失败" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "   ❌ $BuildType APK 构建失败: $_" -ForegroundColor Red
        return $false
    } finally {
        Pop-Location
    }
}

# 安装APK
function Install-Apk {
    param([string]$BuildType)
    
    Write-Host "`n📦 安装 $BuildType APK..." -ForegroundColor Cyan
    
    $apkPath = if ($BuildType -eq "release") { $apkReleasePath } else { $apkDebugPath }
    
    if (-not (Test-Path $apkPath)) {
        Write-Host "   ❌ APK 文件不存在: $apkPath" -ForegroundColor Red
        return $false
    }
    
    Write-Host "   APK 路径: $apkPath" -ForegroundColor Gray
    
    try {
        adb install -r $apkPath
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   ✅ $BuildType APK 安装成功" -ForegroundColor Green
            return $true
        } else {
            Write-Host "   ❌ $BuildType APK 安装失败" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "   ❌ $BuildType APK 安装失败: $_" -ForegroundColor Red
        return $false
    }
}

# 主流程
try {
    # 检查设备连接
    if (-not $SkipInstall -and -not (Test-DeviceConnected)) {
        Write-Host "❌ 未检测到连接的设备！" -ForegroundColor Red
        Write-Host "请确保：" -ForegroundColor Yellow
        Write-Host "1. 设备已通过 USB 连接到电脑" -ForegroundColor Yellow
        Write-Host "2. 已启用 USB 调试" -ForegroundColor Yellow
        Write-Host "3. 已授权电脑调试" -ForegroundColor Yellow
        Write-Host "`n或者使用 -SkipInstall 跳过安装步骤" -ForegroundColor Yellow
        exit 1
    }
    
    # 步骤1: 卸载旧APK
    if (-not $SkipUninstall -and -not $SkipInstall) {
        if (-not (Uninstall-App)) {
            Write-Host "❌ 卸载失败，终止流程" -ForegroundColor Red
            exit 1
        }
    }
    
    # 步骤2: 构建APK
    if (-not $SkipBuild) {
        # 先复制文件到 Android assets
        Write-Host "`n📋 复制文件到 Android assets..." -ForegroundColor Cyan
        try {
            Push-Location $projectRoot
            npx cap copy
            Write-Host "   ✅ 文件复制成功" -ForegroundColor Green
        } catch {
            Write-Host "   ❌ 文件复制失败: $_" -ForegroundColor Red
            exit 1
        } finally {
            Pop-Location
        }
        
        # 同步 Capacitor
        Write-Host "`n🔄 同步 Capacitor..." -ForegroundColor Cyan
        try {
            Push-Location $projectRoot
            npx cap sync
            Write-Host "   ✅ Capacitor 同步成功" -ForegroundColor Green
        } catch {
            Write-Host "   ❌ Capacitor 同步失败: $_" -ForegroundColor Red
            exit 1
        } finally {
            Pop-Location
        }
        
        # 构建APK
        if (-not (Build-Apk -BuildType $buildType)) {
            Write-Host "❌ APK 构建失败" -ForegroundColor Red
            exit 1
        }
    }
    
    # 步骤3: 安装APK
    if (-not $SkipInstall) {
        if (-not (Install-Apk -BuildType $buildType)) {
            Write-Host "❌ APK 安装失败" -ForegroundColor Red
            exit 1
        }
    }
    
    # 完成
    Write-Host "`n" + "=" * 60 -ForegroundColor Green
    Write-Host "✅ 构建并安装完成！" -ForegroundColor Green
    Write-Host "=" * 60 -ForegroundColor Green
    Write-Host "构建类型: $buildType" -ForegroundColor Gray
    $apkPath = if ($buildType -eq "release") { $apkReleasePath } else { $apkDebugPath }
    Write-Host "APK 路径: $apkPath" -ForegroundColor Gray
    if (-not $SkipInstall) {
        Write-Host "应用已安装到设备: $appId" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ 发生错误: $_" -ForegroundColor Red
    exit 1
}


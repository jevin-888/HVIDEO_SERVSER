# 检查 Android 设备屏幕信息的脚本

Write-Host "=== 检查 Android 设备屏幕信息 ===" -ForegroundColor Cyan
Write-Host ""

# 检查 adb 是否可用
$adbPath = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adbPath) {
    Write-Host "错误: 找不到 adb 命令" -ForegroundColor Red
    Write-Host "请确保 Android SDK Platform Tools 已安装并添加到 PATH" -ForegroundColor Yellow
    exit 1
}

# 检查设备连接
Write-Host "1. 检查连接的设备..." -ForegroundColor Green
adb devices
Write-Host ""

# 获取屏幕物理尺寸（像素）
Write-Host "2. 物理分辨率（像素）:" -ForegroundColor Green
adb shell wm size
Write-Host ""

# 获取屏幕密度
Write-Host "3. 屏幕密度（DPI）:" -ForegroundColor Green
adb shell wm density
Write-Host ""

# 获取详细的显示信息
Write-Host "4. 详细显示信息:" -ForegroundColor Green
adb shell dumpsys display | Select-String -Pattern "mBaseDisplayInfo|mOverrideDisplayInfo|density|size"
Write-Host ""

# 获取设备属性
Write-Host "5. 设备显示属性:" -ForegroundColor Green
Write-Host "   - 物理密度:" -NoNewline
adb shell getprop ro.sf.lcd_density
Write-Host "   - 密度覆盖:" -NoNewline
adb shell getprop qemu.sf.lcd_density
Write-Host ""

# 计算逻辑分辨率
Write-Host "6. 计算逻辑分辨率:" -ForegroundColor Green
$sizeOutput = adb shell wm size 2>$null | Select-String "Physical size:"
$densityOutput = adb shell wm density 2>$null | Select-String "Physical density:"

if ($sizeOutput -and $densityOutput) {
    $size = $sizeOutput -replace "Physical size: ", ""
    $density = $densityOutput -replace "Physical density: ", ""
    
    if ($size -match "(\d+)x(\d+)") {
        $width = [int]$matches[1]
        $height = [int]$matches[2]
        $dpi = [int]$density
        
        # 计算密度比例（相对于 160 DPI 的标准密度）
        $densityRatio = $dpi / 160.0
        
        # 计算逻辑分辨率（CSS 像素）
        $logicalWidth = [math]::Round($width / $densityRatio)
        $logicalHeight = [math]::Round($height / $densityRatio)
        
        Write-Host "   物理分辨率: $width x $height"
        Write-Host "   物理密度: $dpi DPI"
        Write-Host "   密度比例: $densityRatio (devicePixelRatio)"
        Write-Host "   逻辑分辨率: $logicalWidth x $logicalHeight (CSS 像素)"
        Write-Host "   预期 WebView 报告: $logicalWidth x $logicalHeight"
    }
}
Write-Host ""

Write-Host "=== 检查完成 ===" -ForegroundColor Cyan

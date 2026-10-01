# 同步所有修改的文件到安卓项目
Write-Host "开始同步文件到安卓项目..." -ForegroundColor Green

$sourceRoot = "..\static"
$destRoot = "app\src\main\assets\public"

# 递归复制整个 static 目录到安卓项目
Write-Host "正在复制文件..." -ForegroundColor Cyan
Copy-Item -Path $sourceRoot -Destination $destRoot -Recurse -Force

Write-Host "`n✓ 所有文件已同步到安卓项目" -ForegroundColor Green
Write-Host "目标目录: $destRoot" -ForegroundColor Cyan

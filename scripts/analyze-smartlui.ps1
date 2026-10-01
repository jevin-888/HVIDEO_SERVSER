# 分析 SmartlUI.js 文件结构

Write-Host "=== 分析 SmartlUI.js 文件 ===" -ForegroundColor Cyan

$filePath = "static/vod_song/client/navigation/smartl/SmartlUI.js"
$content = Get-Content $filePath -Raw
$lines = $content -split "`n"

# 1. 基本信息
Write-Host "`n【基本信息】" -ForegroundColor Yellow
Write-Host "文件大小: $((Get-Item $filePath).Length) 字节 ($([math]::Round((Get-Item $filePath).Length / 1024, 2)) KB)"
Write-Host "总行数: $($lines.Count)"
Write-Host "最后修改: $((Get-Item $filePath).LastWriteTime)"

# 2. 方法统计
Write-Host "`n【方法统计】" -ForegroundColor Yellow
$methods = [regex]::Matches($content, '^\s+(async\s+)?(\w+)\s*\([^)]*\)\s*\{', 'Multiline')
$methodNames = @()
foreach ($match in $methods) {
    $methodName = $match.Groups[2].Value
    # 过滤掉 if, for, while 等关键字
    if ($methodName -notin @('if', 'for', 'while', 'switch', 'catch', 'logInfo', 'logWarn', 'logError', 'setTimeout', 'clearTimeout', 'String', 'Number', 'Boolean', 'Array', 'Object')) {
        $methodNames += $methodName
    }
}

Write-Host "类方法数量: $($methodNames.Count)"

# 检查重复方法
$duplicates = $methodNames | Group-Object | Where-Object { $_.Count -gt 1 }
if ($duplicates) {
    Write-Host "`n⚠️  发现重复方法:" -ForegroundColor Red
    $duplicates | ForEach-Object {
        Write-Host "  - $($_.Name): $($_.Count) 次" -ForegroundColor Red
    }
} else {
    Write-Host "✅ 没有重复的方法定义" -ForegroundColor Green
}

# 3. 注释统计
Write-Host "`n【注释统计】" -ForegroundColor Yellow
$commentLines = ($lines | Where-Object { $_ -match '^\s*(//|/\*|\*)' }).Count
$commentPercent = [math]::Round(($commentLines / $lines.Count) * 100, 2)
Write-Host "注释行数: $commentLines ($commentPercent%)"

# 4. 空行统计
Write-Host "`n【空行统计】" -ForegroundColor Yellow
$emptyLines = ($lines | Where-Object { $_ -match '^\s*$' }).Count
$emptyPercent = [math]::Round(($emptyLines / $lines.Count) * 100, 2)
Write-Host "空行数: $emptyLines ($emptyPercent%)"

# 5. 代码行统计
$codeLines = $lines.Count - $commentLines - $emptyLines
$codePercent = [math]::Round(($codeLines / $lines.Count) * 100, 2)
Write-Host "代码行数: $codeLines ($codePercent%)"

# 6. API调用检查
Write-Host "`n【API调用检查】" -ForegroundColor Yellow

# 检查旧API
$oldApiPattern = '/api/v1/rooms/[^/]+/command'
$oldApiMatches = [regex]::Matches($content, $oldApiPattern)
if ($oldApiMatches.Count -gt 0) {
    Write-Host "⚠️  发现旧API调用 (/command): $($oldApiMatches.Count) 处" -ForegroundColor Red
} else {
    Write-Host "✅ 没有发现旧API调用 (/command)" -ForegroundColor Green
}

# 检查新API
$newApiPatterns = @(
    '/api/v1/rooms/[^/]+/play',
    '/api/v1/rooms/[^/]+/pause',
    '/api/v1/rooms/[^/]+/skip',
    '/api/v1/rooms/[^/]+/volume'
)

foreach ($pattern in $newApiPatterns) {
    $matches = [regex]::Matches($content, $pattern)
    if ($matches.Count -gt 0) {
        $apiName = $pattern -replace '.*/([^/]+)$', '$1'
        Write-Host "  - $apiName API: $($matches.Count) 处"
    }
}

# 7. 大型方法检查
Write-Host "`n【大型方法检查】" -ForegroundColor Yellow
$methodPattern = '^\s+(async\s+)?(\w+)\s*\([^)]*\)\s*\{'
$methodStarts = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $methodPattern) {
        $methodName = $matches[2]
        if ($methodName -notin @('if', 'for', 'while', 'switch', 'catch', 'logInfo', 'logWarn', 'logError', 'setTimeout', 'clearTimeout')) {
            $methodStarts += @{ Line = $i + 1; Name = $methodName }
        }
    }
}

# 计算每个方法的行数
$largeMethods = @()
for ($i = 0; $i -lt $methodStarts.Count; $i++) {
    $start = $methodStarts[$i].Line
    $end = if ($i -lt $methodStarts.Count - 1) { $methodStarts[$i + 1].Line } else { $lines.Count }
    $size = $end - $start
    
    if ($size -gt 100) {
        $largeMethods += @{ Name = $methodStarts[$i].Name; Start = $start; Size = $size }
    }
}

if ($largeMethods.Count -gt 0) {
    Write-Host "发现 $($largeMethods.Count) 个超过100行的大型方法:" -ForegroundColor Yellow
    $largeMethods | Sort-Object -Property Size -Descending | ForEach-Object {
        Write-Host "  - $($_.Name): $($_.Size) 行 (第 $($_.Start) 行开始)" -ForegroundColor Yellow
    }
} else {
    Write-Host "✅ 没有超过100行的大型方法" -ForegroundColor Green
}

# 8. 导入检查
Write-Host "`n【导入检查】" -ForegroundColor Yellow
$imports = [regex]::Matches($content, "import\s+.*\s+from\s+'([^']+)'")
Write-Host "导入模块数量: $($imports.Count)"
$imports | ForEach-Object {
    Write-Host "  - $($_.Groups[1].Value)"
}

# 9. 建议
Write-Host "`n【优化建议】" -ForegroundColor Cyan

if ($codeLines -gt 2000) {
    Write-Host "⚠️  代码行数较多 ($codeLines 行)，建议考虑拆分文件" -ForegroundColor Yellow
}

if ($largeMethods.Count -gt 5) {
    Write-Host "⚠️  大型方法较多 ($($largeMethods.Count) 个)，建议拆分为更小的函数" -ForegroundColor Yellow
}

if ($duplicates) {
    Write-Host "⚠️  存在重复方法，建议检查并删除" -ForegroundColor Yellow
}

if ($commentPercent -lt 10) {
    Write-Host "⚠️  注释较少 ($commentPercent%)，建议增加注释" -ForegroundColor Yellow
}

Write-Host "`n✅ 分析完成！" -ForegroundColor Green

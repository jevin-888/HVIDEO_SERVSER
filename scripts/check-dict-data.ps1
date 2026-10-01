# 只读检查当前统一 song.db 的字典；维护及 XLSX 导入导出使用后台“字典维护”。
param([string]$DatabasePath = (Join-Path $PSScriptRoot '..\song_db\song.db'))

$ErrorActionPreference = 'Stop'
$dictionaryPath = (Resolve-Path -LiteralPath $DatabasePath).Path
if (-not (Get-Command sqlite3 -ErrorAction SilentlyContinue)) {
    throw '未找到 sqlite3，请安装命令行工具，或直接使用后台字典维护页查看。'
}

Write-Host '字典分组统计（含隐藏项）' -ForegroundColor Cyan
& sqlite3 -readonly -header -column $dictionaryPath 'SELECT dictGroup, COUNT(*) AS total, SUM(CASE WHEN COALESCE(visible, 1)=1 THEN 1 ELSE 0 END) AS visibleCount FROM dicts GROUP BY dictGroup ORDER BY dictGroup;'
if ($LASTEXITCODE -ne 0) { throw '查询字典统计失败。' }

Write-Host '灯光和音效字典' -ForegroundColor Cyan
& sqlite3 -readonly -header -column $dictionaryPath "SELECT id, dictGroup, dictCode, dictName, sortOrder, visible, sourceDictId FROM dicts WHERE dictGroup IN ('light', 'soundEffect') ORDER BY dictGroup, sortOrder, id;"
if ($LASTEXITCODE -ne 0) { throw '查询字典明细失败。' }

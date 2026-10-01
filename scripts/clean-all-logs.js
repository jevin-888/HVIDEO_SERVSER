// 清理项目中所有的调试日志
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

// 定义要处理的文件
const files = [
  // 客户端文件
  path.join(rootDir, 'static/vod_song/client/navigation/smartl/SmartlUI.js'),
  path.join(rootDir, 'static/vod_song/client/navigation/display/DisplayUI.js'),
  path.join(rootDir, 'static/vod_song/client/navigation/selected/SelectedUI.js'),
  path.join(rootDir, 'static/vod_song/client/navigation/bottomNav/BottomNavUI.js'),
  
  // 共享文件
  path.join(rootDir, 'static/vod_song/shared/config/apiConfig.js'),
  path.join(rootDir, 'static/vod_song/shared/websocket/websocket-client.js'),
  path.join(rootDir, 'static/vod_song/shared/utils/AndroidInputOptimization.js'),
  path.join(rootDir, 'static/vod_song/shared/services/LangService/LangService.js'),
  path.join(rootDir, 'static/vod_song/shared/navigation/smartl/SmartlUIIntegration.js'),
  path.join(rootDir, 'static/vod_song/shared/navigation/smartl/SmartlService.js'),
  path.join(rootDir, 'static/vod_song/shared/modules/songs/SongSyncManager.js'),
  path.join(rootDir, 'static/vod_song/shared/modules/songs/SongService.js'),
  
  // 移动端文件
  path.join(rootDir, 'static/vod_song/mobile/navigation/smartl/SmartlUI.js')
];

// 定义要移除的日志模式（使用正则表达式）
const logPatterns = [
  // logInfo 调用
  /^\s*logInfo\([^)]*\);\s*$/gm,
  
  // console.log 调用
  /^\s*console\.log\([^)]*\);\s*$/gm,
  
  // 保留 logError 和关键的 logWarn，只移除调试性质的 logWarn
  /^\s*logWarn\([^)]*'检测到按钮变形[^)]*\);\s*$/gm,
  /^\s*logWarn\([^)]*'检测到父容器变化[^)]*\);\s*$/gm,
  /^\s*logWarn\([^)]*'音效面板还不存在[^)]*\);\s*$/gm,
];

let totalRemoved = 0;
let totalFiles = 0;

files.forEach(filePath => {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠ 文件不存在: ${path.relative(rootDir, filePath)}`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  const originalLength = content.length;
  const originalLines = content.split('\n').length;
  
  // 应用所有日志模式
  logPatterns.forEach(pattern => {
    content = content.replace(pattern, '');
  });
  
  // 移除多余的空行（连续超过2个空行的情况）
  content = content.replace(/\n\n\n+/g, '\n\n');
  
  const newLength = content.length;
  const newLines = content.split('\n').length;
  const removed = originalLines - newLines;
  
  if (removed > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    const saved = originalLength - newLength;
    console.log(`✓ ${path.relative(rootDir, filePath)}: 清理了 ${removed} 行，节省 ${saved} 字节`);
    totalRemoved += removed;
    totalFiles++;
  } else {
    console.log(`- ${path.relative(rootDir, filePath)}: 无需清理`);
  }
});

console.log(`\n✓ 完成！共清理 ${totalFiles} 个文件，${totalRemoved} 行调试日志`);
console.log('建议运行同步脚本将更改同步到安卓项目');

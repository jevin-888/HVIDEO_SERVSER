// 清理绕过 LogService 的直接 console 调用
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

// 需要清理的文件列表（排除工具文件和管理后台）
const filesToClean = [
  'static/vod_song/client/capacitor-config.js',
  'static/vod_song/shared/websocket/websocket-client.js',
  'static/vod_song/shared/utils/BottomPanelPositionManager.js',
  'static/vod_song/shared/navigation/selected/SelectedService.js',
  'static/vod_song/shared/services/LangService/LangService.js',
  'static/vod_song/shared/modules/songs/SongService.js',
  'static/vod_song/shared/config/apiConfig.js',
];

let totalRemoved = 0;
let totalFiles = 0;

console.log('开始清理直接 console 调用...\n');

filesToClean.forEach(relativePath => {
  const filePath = path.join(rootDir, relativePath);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⊘ ${relativePath}: 文件不存在，跳过`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  const originalLines = content.split('\n').length;
  let removed = 0;
  
  // 移除调试性质的 console.log/info/debug 调用
  // 保留 console.warn 和 console.error（它们通常是重要的）
  const patterns = [
    // 移除 console.log
    { pattern: /^\s*console\.log\([^)]*\);\s*$/gm, name: 'console.log' },
    // 移除 console.info
    { pattern: /^\s*console\.info\([^)]*\);\s*$/gm, name: 'console.info' },
    // 移除 console.debug
    { pattern: /^\s*console\.debug\([^)]*\);\s*$/gm, name: 'console.debug' },
  ];
  
  patterns.forEach(({ pattern, name }) => {
    const matches = content.match(pattern);
    if (matches) {
      content = content.replace(pattern, '');
      removed += matches.length;
    }
  });
  
  // 移除多余的空行
  content = content.replace(/\n\n\n+/g, '\n\n');
  
  const newLines = content.split('\n').length;
  const linesRemoved = originalLines - newLines;
  
  if (linesRemoved > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ ${relativePath}: 清理了 ${linesRemoved} 行`);
    totalRemoved += linesRemoved;
    totalFiles++;
  } else {
    console.log(`- ${relativePath}: 无需清理`);
  }
});

console.log(`\n✓ 完成！共清理 ${totalFiles} 个文件，${totalRemoved} 行直接 console 调用`);

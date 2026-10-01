// 激进清理所有调试日志
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

// 递归查找所有JS文件
function findJsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // 跳过 node_modules 和其他不需要的目录
      if (!['node_modules', '.git', 'dist', 'build', '.kiro'].includes(file)) {
        findJsFiles(filePath, fileList);
      }
    } else if (file.endsWith('.js') && !file.includes('.min.js')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

// 定义要移除的日志模式
const logPatterns = [
  // 移除所有 logInfo 调用（保留 logError）
  /^\s*logInfo\([^)]*\);\s*$/gm,
  
  // 移除调试性质的 logWarn
  /^\s*logWarn\([^)]*\);\s*$/gm,
  
  // 移除 logDebug 调用
  /^\s*logDebug\([^)]*\);\s*$/gm,
  
  // 移除 console.log 调用
  /^\s*console\.log\([^)]*\);\s*$/gm,
  
  // 移除 console.debug 调用
  /^\s*console\.debug\([^)]*\);\s*$/gm,
  
  // 移除 console.info 调用
  /^\s*console\.info\([^)]*\);\s*$/gm,
  
  // 移除调试性质的 console.warn（但保留错误相关的）
  /^\s*console\.warn\(\['[^\]]*'\][^)]*\);\s*$/gm,
];

// 需要特别处理的文件（保留某些日志）
const preserveFiles = [
  'Logger.js',  // 日志工具本身
  'LogService.js', // 日志服务
];

let totalRemoved = 0;
let totalFiles = 0;

// 查找所有 static 目录下的 JS 文件
const staticDir = path.join(rootDir, 'static');
const jsFiles = findJsFiles(staticDir);

console.log(`找到 ${jsFiles.length} 个 JS 文件\n`);

jsFiles.forEach(filePath => {
  const fileName = path.basename(filePath);
  
  // 跳过需要保留的文件
  if (preserveFiles.some(f => fileName.includes(f))) {
    console.log(`⊘ ${path.relative(rootDir, filePath)}: 跳过（保留文件）`);
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
  }
});

console.log(`\n✓ 完成！共清理 ${totalFiles} 个文件，${totalRemoved} 行调试日志`);
console.log('\n现在需要同步到安卓项目...');

#!/usr/bin/env node

/**
 * 清理项目中的临时文件和测试文件
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

console.log('='.repeat(60));
console.log('='.repeat(60));
// 要删除的文件模式
const patternsToDelete = [
  // ZIP 压缩包
  '*.zip',
  // 日志文件
  '*.log',
  // 临时文件
  '*.tmp',
  '*.temp',
  // 备份文件
  '*.bak',
  '*.backup',
  // 旧文件
  '*.old',
  // 系统文件
  '.DS_Store',
  'Thumbs.db',
  // 编辑器的临时文件
  '*.swp',
  '*.swo',
  '*~',
  // IDE 配置（如果不需要）
  '.idea/',
  '.vscode/settings.json',
  // 构建产物目录
  '.cache/',
  'dist/',
  'build/',
];

// 要删除的具体文件
const filesToDelete = [
  '1920-1200huoshanKTV.zip',
  'huoshanKTV.zip',
];

// 要保留在项目根目录但可以忽略的文件
const filesToCheck = [];

let deletedCount = 0;
let notFoundCount = 0;
// 删除具体的文件
filesToDelete.forEach(file => {
  const filePath = path.join(projectRoot, file);
  if (fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        fs.unlinkSync(filePath);
        console.log(`✅ 已删除: ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
        deletedCount++;
      } else if (stats.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
        deletedCount++;
      }
    } catch (error) {
      console.error(`❌ 删除失败: ${file} - ${error.message}`);
    }
  } else {
    notFoundCount++;
  }
});

// 查找并删除其他临时文件
function findAndDeleteFiles(dir, patterns) {
  if (!fs.existsSync(dir)) return;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    // 跳过 node_modules、.git、android 等目录
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'android', 'public'].includes(entry.name)) {
        continue;
      }
      findAndDeleteFiles(fullPath, patterns);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const name = entry.name.toLowerCase();
      
      // 检查是否是临时文件
      if (
        ext === '.log' ||
        ext === '.tmp' ||
        ext === '.temp' ||
        ext === '.bak' ||
        ext === '.backup' ||
        ext === '.old' ||
        name === '.ds_store' ||
        name === 'thumbs.db' ||
        name.endsWith('.swp') ||
        name.endsWith('.swo') ||
        name.endsWith('~')
      ) {
        try {
          fs.unlinkSync(fullPath);
          const relativePath = path.relative(projectRoot, fullPath);
          deletedCount++;
        } catch (error) {
          console.error(`❌ 删除失败: ${fullPath} - ${error.message}`);
        }
      }
    }
  }
}

// 从项目根目录开始查找
findAndDeleteFiles(projectRoot, patternsToDelete);

console.log('\n' + '='.repeat(60));
console.log('='.repeat(60));
// 检查 capacitor.plugins.json
const capacitorPluginsPath = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'capacitor.plugins.json');
if (fs.existsSync(capacitorPluginsPath)) {
} else {
}










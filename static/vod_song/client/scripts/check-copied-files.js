#!/usr/bin/env node

/**
 * 检查构建时复制的文件
 * 显示所有已复制的文件和目录结构
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets');

// 递归获取目录中的所有文件
function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    const relativePath = path.relative(baseDir, fullPath);
    
    if (item.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      files.push({
        path: relativePath.replace(/\\/g, '/'),
        fullPath: fullPath,
        size: fs.statSync(fullPath).size,
        ext: path.extname(item.name)
      });
    }
  }
  
  return files;
}

// 统计文件类型
function countFileTypes(files) {
  const types = {};
  files.forEach(file => {
    const ext = file.ext || '(无扩展名)';
    types[ext] = (types[ext] || 0) + 1;
  });
  return types;
}

// 格式化文件大小
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// 主检查函数
function checkCopiedFiles() {
  console.log('='.repeat(80));
  console.log('='.repeat(80));
  if (!fs.existsSync(assetsDir)) {
    console.error('❌ Assets 目录不存在！');
    return;
  }
  
  // 获取所有文件
  const files = getAllFiles(assetsDir);
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const fileTypes = countFileTypes(files);
  console.log(`   总大小: ${formatSize(totalSize)}`);
  // 按文件类型统计
  const sortedTypes = Object.entries(fileTypes)
    .sort((a, b) => b[1] - a[1]);
  sortedTypes.forEach(([ext, count]) => {
  });
  
  // 显示关键文件
  const keyFiles = [
    'index.html',
    'index.js',
    'assets/styles/style.css',
    'assets/styles/material.css',
    'modules/songs/songTopUI.js',
    'modules/party/partyUI.js',
    'modules/common/SharedModalManager.js',
    'modules/common/BaseSongUI.js',
    'utils/SongCardFactory.js',
  ];
  
  keyFiles.forEach(filePath => {
    const file = files.find(f => f.path === filePath);
    if (file) {
      console.log(`   ✅ ${filePath} (${formatSize(file.size)})`);
    } else {
      console.log(`   ❌ ${filePath} (缺失)`);
    }
  });
  
  // 显示目录结构（前50个文件）
  const sortedFiles = files
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, 50);
  
  sortedFiles.forEach(file => {
    console.log(`   ${file.path} (${formatSize(file.size)})`);
  });
  
  if (files.length > 50) {
  }
  
  // 检查最近修改的文件
  const recentFiles = files
    .map(file => ({
      ...file,
      mtime: fs.statSync(file.fullPath).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 10);
  
  recentFiles.forEach(file => {
    const date = file.mtime.toLocaleString('zh-CN');
    console.log(`   ${file.path} (${date})`);
  });
  
  // 总结
  console.log('\n' + '='.repeat(80));
  console.log(`总大小: ${formatSize(totalSize)}`);
  console.log('='.repeat(80));
}

// 运行检查
checkCopiedFiles();


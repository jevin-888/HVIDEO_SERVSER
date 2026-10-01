#!/usr/bin/env node

/**
 * 清理多余目录，确保单一目录精准复制
 * 
 * 功能：
 * 1. 检查是否有重复目录
 * 2. 提示用户清理选项
 * 3. 验证 .capacitorignore 配置
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const capacitorIgnorePath = path.join(projectRoot, '.capacitorignore');

console.log('='.repeat(60));
console.log('='.repeat(60));
// 检查 public 目录是否存在
const publicExists = fs.existsSync(publicDir);
// 检查 .capacitorignore 配置
const capacitorIgnoreExists = fs.existsSync(capacitorIgnorePath);
if (capacitorIgnoreExists) {
  const ignoreContent = fs.readFileSync(capacitorIgnorePath, 'utf8');
  const ignoresPublic = ignoreContent.includes('public/');
}

console.log('\n' + '='.repeat(60));
console.log('='.repeat(60));

if (publicExists) {
} else {
}

console.log('\n' + '='.repeat(60));
console.log('='.repeat(60));
console.log('\nwebDir: "." (项目根目录)');
console.log('\n' + '='.repeat(60));
console.log('='.repeat(60));


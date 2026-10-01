#!/usr/bin/env node

/**
 * 清理构建缓存脚本
 * 清理 Android 构建缓存、Node.js 缓存等
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

// 需要清理的目录和文件
const cleanPaths = [
  // Android 构建缓存
  path.join(projectRoot, 'android', 'app', 'build'),
  path.join(projectRoot, 'android', 'build'),
  path.join(projectRoot, 'android', 'capacitor-cordova-android-plugins', 'build'),
  path.join(projectRoot, 'android', '.gradle'),
  path.join(projectRoot, 'android', '.idea'),
  
  // Android 临时文件
  path.join(projectRoot, 'android', 'app', '.cxx'),
  path.join(projectRoot, 'android', '.cxx'),
  
  // Node.js 缓存（可选）
  // path.join(projectRoot, 'node_modules'),
  
  // 其他缓存
  path.join(projectRoot, '.capacitor'),
];

// 需要清理的文件
const cleanFiles = [
  path.join(projectRoot, 'android', 'local.properties'),
];
let cleanedCount = 0;
let errorCount = 0;

/**
 * 删除目录
 */
function removeDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return false;
  }
  
  try {
    console.log(`  删除目录: ${path.relative(projectRoot, dirPath)}`);
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error(`  ❌ 删除目录失败: ${path.relative(projectRoot, dirPath)}`, error.message);
    return false;
  }
}

/**
 * 删除文件
 */
function removeFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  try {
    console.log(`  删除文件: ${path.relative(projectRoot, filePath)}`);
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error(`  ❌ 删除文件失败: ${path.relative(projectRoot, filePath)}`, error.message);
    return false;
  }
}

// 清理目录
for (const dirPath of cleanPaths) {
  if (removeDirectory(dirPath)) {
    cleanedCount++;
  } else {
    errorCount++;
  }
}

// 清理文件
for (const filePath of cleanFiles) {
  if (removeFile(filePath)) {
    cleanedCount++;
  } else {
    errorCount++;
  }
}

// 清理 Gradle 缓存（如果存在）
try {
  const gradleUserHome = process.env.GRADLE_USER_HOME || path.join(process.env.HOME || process.env.USERPROFILE, '.gradle');
  const gradleCache = path.join(gradleUserHome, 'caches');
  
  if (fs.existsSync(gradleCache)) {
    // 只清理模块缓存，保留 Gradle wrapper 等
    const modulesCache = path.join(gradleCache, 'modules-2');
    if (fs.existsSync(modulesCache)) {
      fs.rmSync(modulesCache, { recursive: true, force: true });
      cleanedCount++;
    }
  }
} catch (error) {
  console.error(`  ⚠️  清理 Gradle 缓存失败:`, error.message);
}

// 总结
if (errorCount > 0) {
}
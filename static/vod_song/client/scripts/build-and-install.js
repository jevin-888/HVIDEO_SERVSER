#!/usr/bin/env node

/**
 * 构建并安装 Android APK 脚本
 * 1. 卸载旧APK（如果已安装）
 * 2. 构建新APK
 * 3. 安装新APK
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const appId = 'com.huoshan.ktv';
const androidDir = path.join(projectRoot, 'android');
const apkDebugPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const apkReleasePath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

// 检查命令是否存在
function commandExists(command) {
  try {
    if (process.platform === 'win32') {
      execSync(`where ${command}`, { stdio: 'ignore' });
    } else {
      execSync(`which ${command}`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

// 检查设备是否连接
function checkDevice() {
  try {
    const result = execSync('adb devices', { encoding: 'utf-8' });
    const lines = result.split('\n').filter(line => line.trim());
    // 跳过第一行 "List of devices attached"
    const devices = lines.slice(1).filter(line => {
      const parts = line.trim().split(/\s+/);
      return parts.length >= 2 && parts[1] === 'device';
    });
    return devices.length > 0;
  } catch (error) {
    return false;
  }
}

// 检查APK是否已安装
function isAppInstalled() {
  try {
    // 使用 adb shell pm list packages 命令检查包是否已安装
    const result = execSync(`adb shell pm list packages`, { encoding: 'utf-8' });
    const packages = result.split('\n').filter(line => line.trim().startsWith('package:'));
    const packageNames = packages.map(line => line.replace('package:', '').trim());
    return packageNames.includes(appId);
  } catch {
    return false;
  }
}

// 卸载APK
function uninstallApp() {
  if (!isAppInstalled()) {
    return true;
  }
  try {
    execSync(`adb uninstall ${appId}`, { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error('   ❌ 卸载失败:', error.message);
    return false;
  }
}

// 构建APK
function buildApk(buildType = 'debug') {
  try {
    const gradleCommand = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    const buildCommand = `${gradleCommand} assemble${buildType.charAt(0).toUpperCase() + buildType.slice(1)}`;
    execSync(buildCommand, {
      cwd: androidDir,
      stdio: 'inherit'
    });
    return true;
  } catch (error) {
    console.error(`   ❌ ${buildType} APK 构建失败:`, error.message);
    return false;
  }
}

// 安装APK（使用覆盖安装，与 Android Studio 一致）
function installApk(buildType = 'debug') {
  const apkPath = buildType === 'release' ? apkReleasePath : apkDebugPath;
  
  if (!fs.existsSync(apkPath)) {
    console.error(`   ❌ APK 文件不存在: ${apkPath}`);
    return false;
  }
  try {
    // 使用 -r 参数进行覆盖安装，如果应用已安装则替换，否则安装新应用
    // 这与 Android Studio 的行为一致
    execSync(`adb install -r "${apkPath}"`, { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(`   ❌ ${buildType} APK 安装失败:`, error.message);
    return false;
  }
}

// 主函数
async function main() {
  console.log('='.repeat(60));
  console.log('='.repeat(60));
  // 解析命令行参数
  const args = process.argv.slice(2);
  let buildType = 'debug';
  if (args.includes('--release') || args.includes('-r')) {
    buildType = 'release';
  } else if (args.includes('--debug') || args.includes('-d')) {
    buildType = 'debug';
  }
  
  // 默认使用覆盖安装（与 Android Studio 一致），不先卸载
  // 如果用户想要先卸载再安装，可以使用 --uninstall 参数
  const doUninstall = args.includes('--uninstall') || args.includes('-u');
  const skipBuild = args.includes('--skip-build');
  const skipInstall = args.includes('--skip-install');
  if (skipBuild) console.log('跳过构建: 是');
  if (skipInstall) console.log('跳过安装: 是');
  // 检查 adb 命令
  if (!commandExists('adb')) {
    console.error('❌ adb 命令未找到！');
    process.exit(1);
  }
  
  // 检查设备连接
  if (!skipInstall && !checkDevice()) {
    console.error('❌ 未检测到连接的设备！');
    process.exit(1);
  }
  
  // 步骤1: 卸载旧APK（可选，默认跳过，使用覆盖安装）
  // Android Studio 使用覆盖安装，不需要先卸载
  // 如果需要先卸载再安装，可以使用 --uninstall 参数
  if (doUninstall && !skipInstall) {
    if (!uninstallApp()) {
      console.error('❌ 卸载失败，终止流程');
      process.exit(1);
    }
  } else if (!skipInstall) {
  }
  
  // 步骤2: 构建APK
  if (!skipBuild) {
    // 先复制文件到 Android assets
    try {
      execSync('npx cap copy', { cwd: projectRoot, stdio: 'inherit' });
    } catch (error) {
      console.error('   ❌ 文件复制失败:', error.message);
      process.exit(1);
    }
    
    // 同步 Capacitor
    try {
      execSync('npx cap sync', { cwd: projectRoot, stdio: 'inherit' });
    } catch (error) {
      console.error('   ❌ Capacitor 同步失败:', error.message);
      process.exit(1);
    }
    
    // 构建APK
    if (!buildApk(buildType)) {
      console.error('❌ APK 构建失败');
      process.exit(1);
    }
  }
  
  // 步骤3: 安装APK
  if (!skipInstall) {
    if (!installApk(buildType)) {
      console.error('❌ APK 安装失败');
      process.exit(1);
    }
  }
  
  // 完成
  console.log('\n' + '='.repeat(60));
  console.log('='.repeat(60));
  if (!skipInstall) {
  }
}

// 运行主函数
main().catch(error => {
  console.error('❌ 发生错误:', error);
  process.exit(1);
});


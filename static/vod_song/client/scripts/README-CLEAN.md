# 清理构建缓存说明

## 概述

本项目提供了多个清理构建缓存的脚本，用于清理 Android 构建缓存、Gradle 缓存等。

## 可用的清理脚本

### 1. Node.js 脚本（推荐）

```bash
npm run clean
```

或者

```bash
node scripts/clean-build.js
```

### 2. PowerShell 脚本（Windows）

```powershell
powershell -ExecutionPolicy Bypass -File scripts/clean-build.ps1
```

### 3. Batch 脚本（Windows）

```cmd
scripts\clean-build.bat
```

## 清理的内容

### Android 构建缓存
- `android/app/build/` - Android app 构建输出
- `android/build/` - Android 项目构建输出
- `android/capacitor-cordova-android-plugins/build/` - 插件构建输出
- `android/.gradle/` - Gradle 构建缓存（项目级别）
- `android/.idea/` - Android Studio IDE 缓存
- `android/app/.cxx/` - C++ 构建缓存
- `android/.cxx/` - C++ 构建缓存（项目级别）

### 其他缓存
- `android/local.properties` - 本地配置文件（包含 SDK 路径）
- `.capacitor/` - Capacitor 缓存
- Gradle 用户级缓存（`~/.gradle/caches/modules-2/`）

## 使用场景

### 1. 清理所有构建缓存

```bash
npm run clean
```

### 2. 清理构建缓存并清理 npm 缓存

```bash
npm run clean:all
```

### 3. 清理后重新构建

```bash
npm run clean
npm run build:android
```

## 注意事项

1. **local.properties 文件**
   - 清理 `local.properties` 后，需要重新配置 Android SDK 路径
   - 如果使用 Android Studio，它会自动重新生成此文件

2. **Gradle 缓存**
   - 如果 Gradle 缓存被锁定（正在使用），清理可能会失败
   - 这是正常的，可以关闭 Android Studio 或其他正在使用 Gradle 的进程后重试

3. **node_modules**
   - 默认情况下，不会清理 `node_modules` 目录
   - 如果需要清理，可以手动删除：`rm -rf node_modules`（Linux/Mac）或 `rmdir /s /q node_modules`（Windows）
   - 清理后需要重新安装：`npm install`

4. **构建时间**
   - 清理构建缓存后，下次构建可能需要更长时间
   - 这是因为需要重新编译和下载依赖

## 故障排除

### 问题：某些文件无法删除

**原因：** 文件可能正在被其他进程使用（如 Android Studio、Gradle Daemon）

**解决方案：**
1. 关闭 Android Studio
2. 停止 Gradle Daemon：`cd android && gradlew --stop`
3. 重新运行清理脚本

### 问题：清理后无法构建

**原因：** 可能缺少必要的配置文件

**解决方案：**
1. 检查 `android/local.properties` 是否存在
2. 如果不存在，在 Android Studio 中打开项目，它会自动生成
3. 或者手动创建并配置 SDK 路径

### 问题：Gradle 缓存清理失败

**原因：** Gradle 缓存可能正在被使用

**解决方案：**
1. 关闭所有使用 Gradle 的进程
2. 手动清理：删除 `~/.gradle/caches/` 目录（Linux/Mac）或 `%USERPROFILE%\.gradle\caches\`（Windows）
3. 或者忽略此错误，它不会影响项目构建

## 清理前后对比

### 清理前
```
android/
  ├── app/
  │   └── build/          # 大量构建文件（可能数百 MB）
  ├── build/              # 项目构建文件
  └── capacitor-cordova-android-plugins/
      └── build/          # 插件构建文件
```

### 清理后
```
android/
  ├── app/
  │   └── (build/ 目录已删除)
  ├── (build/ 目录已删除)
  └── capacitor-cordova-android-plugins/
      └── (build/ 目录已删除)
```

## 相关命令

- `npm run build` - 构建项目（复制文件到 public 目录）
- `npm run build:android` - 构建 Android 项目
- `npm run clean` - 清理构建缓存
- `npm run clean:all` - 清理构建缓存和 npm 缓存


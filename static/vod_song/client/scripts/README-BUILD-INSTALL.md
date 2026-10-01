# 构建并安装 Android APK 说明

## 概述

本脚本自动化 Android APK 的构建和安装流程：
1. 复制文件到 Android assets
2. 同步 Capacitor
3. 构建新APK
4. 覆盖安装新APK到设备（与 Android Studio 一致）

**默认行为**: 使用覆盖安装（`adb install -r`），与 Android Studio 一致，不需要先卸载旧APK。

## 使用方法

### 1. 基本使用（Debug APK）

```bash
npm run build:install
```

或者

```bash
npm run build:install:debug
```

### 2. 构建 Release APK

```bash
npm run build:install:release
```

### 3. 直接运行脚本

```bash
node scripts/build-and-install.js
```

### 4. 使用参数

```bash
# 构建 Release APK
node scripts/build-and-install.js --release

# 先卸载再安装（默认使用覆盖安装，与 Android Studio 一致）
node scripts/build-and-install.js --uninstall

# 跳过构建步骤（只安装已存在的APK）
node scripts/build-and-install.js --skip-build

# 跳过安装步骤（只构建APK）
node scripts/build-and-install.js --skip-install

# 组合参数
node scripts/build-and-install.js --release --uninstall
```

## 参数说明

### 构建类型

- `--debug` 或 `-d`: 构建 Debug APK（默认）
- `--release` 或 `-r`: 构建 Release APK

### 安装方式

- **默认**: 覆盖安装（`adb install -r`），与 Android Studio 一致
  - 如果应用已安装，直接覆盖安装
  - 如果应用未安装，安装新应用
- `--uninstall` 或 `-u`: 先卸载旧APK再安装新APK
  - 只有在需要完全清理应用数据时才使用

### 跳过步骤

- `--skip-build`: 跳过构建APK步骤（只安装已存在的APK）
- `--skip-install`: 跳过安装APK步骤（只构建APK）

## 前置条件

### 1. Android SDK

确保已安装 Android SDK 并配置了环境变量：

- `adb` 命令可用
- Android SDK platform-tools 目录已添加到 PATH

### 2. 设备连接

确保设备已连接并配置：

- 设备已通过 USB 连接到电脑
- 已启用 USB 调试
- 已授权电脑调试

### 3. 检查设备连接

```bash
adb devices
```

应该显示已连接的设备，例如：

```
List of devices attached
ABC123XYZ    device
```

## 工作流程

### 1. 检查环境

- 检查 `adb` 命令是否存在
- 检查设备是否连接（如果不需要安装，可以跳过）

### 2. 复制文件

- 运行 `npx cap copy` 复制文件到 Android assets
- 运行 `npx cap sync` 同步 Capacitor 配置

### 3. 构建APK

- 运行 Gradle 构建命令
- Debug: `gradlew assembleDebug`
- Release: `gradlew assembleRelease`

### 4. 安装APK（覆盖安装，与 Android Studio 一致）

- 检查 APK 文件是否存在
- 使用 `adb install -r` 覆盖安装 APK
- `-r` 参数表示替换已安装的应用（如果已安装）或安装新应用（如果未安装）
- **默认行为**: 不先卸载，直接覆盖安装（与 Android Studio 一致）
- **可选**: 使用 `--uninstall` 参数先卸载再安装

### 5. 卸载旧APK（可选）

- 仅在使用了 `--uninstall` 参数时执行
- 检查应用是否已安装（包名: `com.huoshan.ktv`）
- 如果已安装，卸载旧APK
- 如果未安装，跳过卸载步骤

## 安装方式说明

### 覆盖安装（默认，与 Android Studio 一致）

**命令**: `adb install -r <apk_path>`

**行为**:
- 如果应用已安装，直接覆盖安装（替换）
- 如果应用未安装，安装新应用
- 保留应用数据（除非签名不同）

**优势**:
- 更快（不需要先卸载）
- 与 Android Studio 行为一致
- 保留应用数据（如果需要）

**这是 Android Studio 的默认行为，脚本也采用相同的方式。**

### 卸载安装（可选）

**命令**: `adb uninstall <packageName>` + `adb install -r <apk_path>`

**行为**:
- 先完全卸载旧应用
- 再安装新应用
- 清除所有应用数据

**使用场景**:
- 需要完全清理应用数据
- 遇到安装冲突问题
- 调试应用数据问题

**使用方法**:
- 使用 `--uninstall` 参数：`npm run build:install -- --uninstall`

## APK 路径

### Debug APK

```
android/app/build/outputs/apk/debug/app-debug.apk
```

### Release APK

```
android/app/build/outputs/apk/release/app-release.apk
```

## 常见问题

### 1. adb 命令未找到

**错误**: `❌ adb 命令未找到！`

**解决方案**:
1. 安装 Android SDK
2. 将 Android SDK platform-tools 目录添加到 PATH
3. 重启终端或命令行

### 2. 未检测到连接的设备

**错误**: `❌ 未检测到连接的设备！`

**解决方案**:
1. 检查 USB 连接
2. 启用 USB 调试（设置 > 关于手机 > 连续点击版本号 7 次）
3. 授权电脑调试（设备上会弹出授权提示）
4. 运行 `adb devices` 检查设备状态

### 3. 覆盖安装 vs 卸载安装

**默认行为**: 覆盖安装（`adb install -r`），与 Android Studio 一致

**覆盖安装的优势**:
- 更快（不需要先卸载）
- 保留应用数据（如果需要）
- 与 Android Studio 行为一致

**卸载安装的使用场景**:
- 需要完全清理应用数据
- 遇到安装冲突问题
- 调试应用数据问题

**使用方法**:
- 默认（覆盖安装）：`npm run build:install`
- 先卸载再安装：`npm run build:install -- --uninstall`

### 4. 构建失败

**错误**: `❌ APK 构建失败`

**可能原因**:
- Gradle 配置问题
- 依赖问题
- 构建缓存问题

**解决方案**:
1. 清理构建缓存：`npm run clean`
2. 检查 Gradle 配置
3. 检查 Android SDK 版本
4. 查看构建日志

### 5. 安装失败

**错误**: `❌ APK 安装失败`

**可能原因**:
- APK 文件不存在
- 设备存储空间不足
- 权限问题

**解决方案**:
1. 检查 APK 文件是否存在
2. 检查设备存储空间
3. 检查设备权限设置
4. 手动安装：`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`

## 相关命令

### 检查设备

```bash
adb devices
```

### 检查应用是否已安装

```bash
adb shell pm list packages | findstr com.huoshan.ktv
```

### 手动卸载应用

```bash
adb uninstall com.huoshan.ktv
```

### 手动安装APK

```bash
# Debug APK
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# Release APK
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

### 查看应用信息

```bash
adb shell pm list packages -f | findstr com.huoshan.ktv
```

## 注意事项

1. **安装方式**: 默认使用覆盖安装（`adb install -r`），与 Android Studio 一致，不需要先卸载

2. **覆盖安装**: 如果应用已安装，直接覆盖安装（替换），保留应用数据（除非签名不同）

3. **卸载安装**: 如果需要完全清理应用数据，可以使用 `--uninstall` 参数先卸载再安装

4. **Release APK**: Release APK 需要签名，确保 `android/app/huoshan-release-key.keystore` 文件存在

5. **设备连接**: 如果设备未连接，可以使用 `--skip-install` 跳过安装步骤，只构建APK

6. **构建时间**: 首次构建可能需要较长时间，后续构建会使用缓存，速度会更快

7. **文件复制**: 构建前会自动复制文件到 Android assets，确保文件是最新的

8. **与 Android Studio 一致**: 脚本的默认行为与 Android Studio 完全一致，使用覆盖安装

## 完整流程示例

```bash
# 1. 清理构建缓存（可选）
npm run clean

# 2. 构建并安装 Debug APK
npm run build:install

# 3. 或者构建并安装 Release APK
npm run build:install:release

# 4. 检查安装结果
adb shell pm list packages | findstr com.huoshan.ktv
```

## 自动化流程

脚本会自动执行以下步骤：

1. ✅ 检查环境（adb、设备连接）
2. ✅ 复制文件到 Android assets
3. ✅ 同步 Capacitor 配置
4. ✅ 构建 APK（Debug 或 Release）
5. ✅ 覆盖安装 APK 到设备（与 Android Studio 一致）

**默认行为**: 使用覆盖安装（`adb install -r`），不先卸载，与 Android Studio 完全一致。

**可选步骤**: 如果使用 `--uninstall` 参数，会在安装前先卸载旧APK。

整个过程完全自动化，无需手动干预。


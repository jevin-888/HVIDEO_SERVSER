# 触摸屏端 APK 打包指南

## 概述

使用 Capacitor 将触摸屏端（`static/vod_song/client`）打包成 Android APK。

## 优势

- 性能优秀（使用系统 WebView）
- 包体积小（5-10MB）
- 成熟稳定，生产可用
- 完全兼容现有的 IP 配置系统

## 前置要求

- ✅ Node.js（已安装）
- ✅ Android Studio（已安装）
- ✅ Java JDK 8+

## 快速开始

### 1. 安装 Capacitor 依赖

```bash
npm install
```

### 2. 初始化 Capacitor

```bash
npx cap init "火山点歌" "com.hvideo.client" --web-dir="static/vod_song/client"
```

### 3. 添加 Android 平台

```bash
npx cap add android
```

### 4. 同步代码到 Android 项目

```bash
npx cap sync
```

### 5. 在 Android Studio 中打开项目

```bash
npx cap open android
```

### 6. 构建 APK

在 Android Studio 中：
1. 点击 `Build` → `Build Bundle(s) / APK(s)` → `Build APK(s)`
2. 等待构建完成（首次需要下载依赖，约 5-10 分钟）
3. APK 文件位置：`android/app/build/outputs/apk/debug/app-debug.apk`

## IP 地址配置

### 默认配置

APK 首次运行时，默认服务器 IP 为 `192.168.1.56`（与 Web 版本一致）

### 修改服务器 IP

用户可以通过以下方式修改：

1. 在触摸屏左上角连续点击 5 次
2. 输入密码：`989898`
3. 修改"客户端 IP 地址"
4. 点击"保存"，应用会自动刷新

### 配置存储

- IP 配置保存在 `localStorage.clientIp`
- 与浏览器版本完全兼容
- 重装 APP 后需要重新配置

## 配置文件说明

### capacitor.config.json

```json
{
  "appId": "com.hvideo.client",
  "appName": "火山点歌",
  "webDir": "static/vod_song/client",
  "server": {
    "androidScheme": "https",
    "cleartext": true
  },
  "android": {
    "allowMixedContent": true,
    "captureInput": true,
    "webContentsDebuggingEnabled": true
  }
}
```

关键配置：
- `cleartext: true` - 允许 HTTP 连接（局域网环境）
- `allowMixedContent: true` - 允许混合内容
- `webContentsDebuggingEnabled: true` - 启用 Chrome DevTools 调试

### capacitor-config.js

APK 专用配置文件，自动处理：
- 首次运行设置默认 IP
- 读取 localStorage 中的 IP 配置
- 标记 Capacitor 环境

## 网络权限

Capacitor 会自动在 `AndroidManifest.xml` 中添加必要权限：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

## 调试

### Chrome DevTools 调试

1. 手机通过 USB 连接电脑
2. 启用 USB 调试
3. Chrome 浏览器访问：`chrome://inspect`
4. 选择你的设备和应用

### 查看日志

```bash
# 实时查看 Android 日志
npx cap run android --livereload

# 或使用 adb
adb logcat | grep -i capacitor
```

## 更新代码

修改前端代码后，重新同步：

```bash
npx cap sync
```

然后在 Android Studio 中重新构建 APK。

## 发布版本

### 生成签名密钥

```bash
keytool -genkey -v -keystore hvideo-release.keystore -alias hvideo -keyalg RSA -keysize 2048 -validity 10000
```

### 配置签名

在 `android/app/build.gradle` 中添加：

```gradle
android {
    signingConfigs {
        release {
            storeFile file("../../hvideo-release.keystore")
            storePassword "your-password"
            keyAlias "hvideo"
            keyPassword "your-password"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

### 构建发布版

在 Android Studio 中：
1. `Build` → `Generate Signed Bundle / APK`
2. 选择 `APK`
3. 选择密钥文件
4. 选择 `release` 构建类型

## 常见问题

### 1. WebSocket 连接失败

确保：
- 服务器 IP 配置正确
- 服务器防火墙允许 8080 端口
- 手机和服务器在同一局域网

### 2. 图片/资源加载失败

检查：
- `capacitor.config.json` 中 `cleartext: true`
- `allowMixedContent: true`

### 3. 触摸事件不响应

已在 HTML 中处理：
- 禁用双击缩放
- 禁用长按菜单
- 优化触摸延迟

## 性能优化

### 已实现的优化

- GPU 加速滚动
- 图片懒加载
- Service Worker 缓存
- 资源预加载

### APK 特定优化

Capacitor 自动提供：
- 原生滚动性能
- 更快的 JavaScript 执行
- 更好的内存管理

## 文件结构

```
project/
├── capacitor.config.json          # Capacitor 配置
├── android/                       # Android 项目（自动生成）
│   └── app/
│       └── build/
│           └── outputs/
│               └── apk/
│                   └── debug/
│                       └── app-debug.apk
├── static/vod_song/client/        # Web 源码
│   ├── index.html
│   ├── capacitor-config.js        # APK 专用配置
│   └── ...
└── package.json
```

## 下一步

1. 测试 APK 在不同设备上的表现
2. 收集用户反馈
3. 根据需要调整配置
4. 考虑发布到应用商店或内部分发

## 技术支持

如遇问题，检查：
1. Chrome DevTools 控制台日志
2. Android Logcat 日志
3. 网络连接状态
4. 服务器运行状态

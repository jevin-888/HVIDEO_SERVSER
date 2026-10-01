# 构建复制说明

## 概述

本项目使用 Capacitor 将 Web 应用文件复制到 Android 应用中。本文档说明文件复制的逻辑和目标目录。

## 复制配置

### Capacitor 配置

配置文件：`capacitor.config.json`

```json
{
  "webDir": ".",
  ...
}
```

- **webDir**: 设置为 `.`（项目根目录）
- 这意味着 Capacitor 会从**项目根目录**复制文件到 Android assets 目录

## 复制目标目录

### Android Assets 目录

**目标目录**: `android/app/src/main/assets/`

**完整路径**: `D:\huoshanKTV\android\app\src\main\assets`

## 复制流程

### 1. 运行构建命令

```bash
npm run build
```

或

```bash
npx cap copy && npx cap sync
```

### 2. 复制过程

1. **cap copy**: 将 `webDir`（项目根目录）中的文件复制到 Android assets 目录
2. **cap sync**: 同步 Capacitor 插件和配置

### 3. 复制结果

- 源目录: 项目根目录（`.`）
- 目标目录: `android/app/src/main/assets/`
- 文件数: 196 个文件
- 总大小: 8.69 MB

## 复制的文件类型

### 文件类型统计

- `.js`: 141 个文件（JavaScript 文件）
- `.png`: 26 个文件（图片文件）
- `.json`: 9 个文件（配置文件）
- `.css`: 6 个文件（样式文件）
- `.ttf`: 4 个文件（字体文件）
- `.woff2`: 4 个文件（字体文件）
- `.ico`: 2 个文件（图标文件）
- `.html`: 2 个文件（HTML 文件）
- `.mjs`: 2 个文件（ES 模块文件）

## 关键文件

### 已复制的关键文件

✅ 所有必需文件都已复制：

- `index.html` - 主 HTML 文件
- `index.js` - 主 JavaScript 文件
- `assets/styles/style.css` - 主样式文件
- `assets/styles/material.css` - Material 样式文件
- `modules/songs/songTopUI.js` - 点歌页面 UI
- `modules/party/partyUI.js` - 派对页面 UI
- `modules/party/partyService.js` - 派对页面服务
- `modules/common/SharedModalManager.js` - 共享模态框管理器
- `modules/common/BaseSongUI.js` - 基础歌曲 UI
- `utils/SongCardFactory.js` - 歌曲卡片工厂

## 目录结构

### 源目录结构（项目根目录）

```
.
├── index.html
├── index.js
├── assets/
│   ├── fonts/
│   ├── images/
│   ├── styles/
│   └── webfonts/
├── modules/
│   ├── cashier/
│   ├── common/
│   ├── ordeModal/
│   ├── party/
│   └── songs/
├── navigation/
├── services/
├── utils/
└── ...
```

### 目标目录结构（Android Assets）

```
android/app/src/main/assets/
├── index.html
├── index.js
├── assets/
│   ├── fonts/
│   ├── images/
│   ├── styles/
│   └── webfonts/
├── modules/
│   ├── cashier/
│   ├── common/
│   ├── ordeModal/
│   ├── party/
│   └── songs/
├── navigation/
├── services/
├── utils/
└── ...
```

## 检查复制结果

### 1. 使用检查脚本

```bash
npm run check:build
```

检查关键文件是否存在。

### 2. 使用详细检查脚本

```bash
npm run check:copied
```

显示所有复制的文件、文件类型统计、目录结构等。

### 3. 手动检查

检查目标目录是否存在：

```bash
# Windows
dir android\app\src\main\assets

# Linux/Mac
ls -la android/app/src/main/assets
```

## 常见问题

### 1. 文件没有复制

**原因**: 可能没有运行构建命令

**解决方案**: 运行 `npm run build`

### 2. 文件复制不完整

**原因**: 可能构建过程中出错

**解决方案**: 
1. 检查构建日志
2. 清理构建缓存：`npm run clean`
3. 重新构建：`npm run build`

### 3. 文件路径错误

**原因**: 可能 `capacitor.config.json` 配置错误

**解决方案**: 检查 `webDir` 配置是否正确

## 相关命令

- `npm run build` - 构建项目（复制文件到 Android assets）
- `npm run build:android` - 构建 Android 项目
- `npm run check:build` - 检查关键文件是否存在
- `npm run check:copied` - 检查所有复制的文件
- `npm run clean` - 清理构建缓存

## 注意事项

1. **文件同步**: 修改源文件后，需要重新运行 `npm run build` 才能更新 Android assets 目录中的文件

2. **文件大小**: 注意文件大小，过大的文件可能影响应用启动速度

3. **文件路径**: 在代码中使用相对路径引用资源文件，确保路径正确

4. **文件更新**: 如果文件没有更新，可能需要清理构建缓存后重新构建

## 复制目标目录总结

**目标目录**: `android/app/src/main/assets/`

**完整路径**: `D:\huoshanKTV\android\app\src\main\assets`

**文件数**: 196 个文件

**总大小**: 8.69 MB

**状态**: ✅ 所有文件已成功复制


# HVideo 点歌服务器

HVideo 点歌服务器包含 Rust 后端、Tauri 桌面管理端和 Web 点歌页面。Windows 与 Linux 使用独立分支维护：

- `windows`：Windows 桌面管理端和绿色部署包。
- `linux`：Linux 后端和 Tauri AppImage/deb 构建链。

## 源目录分支管理

本机开发目录为 `D:\HVIDEO\Hvideo_server`，在此目录直接切换分支，无需另外克隆项目：

```powershell
git status
git switch windows
git switch linux
git fetch origin
git pull --ff-only
git push
```

切换分支前先提交当前修改。`windows` 跟踪 `origin/windows`，`linux` 跟踪 `origin/linux`。公共修改通过 `git cherry-pick <提交号>` 同步到另一分支；平台配置分别维护。本机数据库、授权、日志、依赖和构建目录不进入 Git，切换分支时会保留。不要使用 `git clean -fdx` 清理含运行数据的项目目录。

## Windows

```powershell
cargo check --offline
cargo check --manifest-path src-tauri/Cargo.toml --offline
npm run tauri:portable
```

## Linux

Linux 主机需要 Rust、Node.js、GTK/WebKitGTK 开发包、`iproute2`、`ffmpeg`、`ffprobe` 和 `yt-dlp`：

```bash
npm install
npm run linux:build
```

产物位于 `src-tauri/target/release/bundle/`。运行数据保存于 `$XDG_DATA_HOME/HVideo Admin`，未设置时使用 `~/.local/share/HVideo Admin`。

Linux 原生编译、安装与运行验证尚未完成，构建脚本仍需在 Linux 环境验证。

详细改动记录见 `docs/records/`。

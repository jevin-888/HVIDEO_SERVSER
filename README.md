# HVideo 点歌服务器

HVideo 点歌服务器包含 Rust 后端、Tauri 桌面管理端和 Web 点歌页面。Windows 与 Linux 使用独立分支维护：

- `windows`：Windows 桌面管理端和绿色部署包。
- `linux`：Linux 后端和 Tauri AppImage/deb 构建链。

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

详细改动记录见 `docs/records/`。

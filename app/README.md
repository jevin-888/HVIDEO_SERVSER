# 播放器启动升级目录

把正式播放器 APK 放在此目录第一层，无需改文件名、填写版本号或重启服务器。
服务器读取 APK 的 AndroidManifest.xml，按 `com.hsvj.engine`、`hw81/hw82` 和实际 versionCode 选择最高版本。
APK 必须带 `com.hsvj.engine.HARDWARE` 元数据（2026-09-18 起播放器构建自动加入）。旧 APK 不符合此发布协议，会被忽略并记日志。

- 先复制成 `.part` 文件，复制完成后改为 `.apk`，避免客户端遇到尚未复制完成的文件。
- hw81 和 hw82 可放在同一目录；文件名不参与版本或硬件判断。
- 只更新更高 versionCode，同版/旧版不会重复安装或降级。签名须与设备现有播放器一致。
- 默认目录是运行配置 `config.toml` 同级的 `app`（便携部署即程序同级）。可用 `HVIDEO_PLAYER_APP_DIR` 指定其他目录，建议绝对路径。
- 播放器需先安装支持本协议的新版本；旧播放器仍使用旧云端接口，不能靠放入 APK 自动切换协议。
- 播放器启动完成约 8 秒检查；网络或服务器地址未就绪时每 30 秒重试，合计最多 5 次。受 `appUpdateEnabled` 开关控制。
- 校验下载大小、SHA-256、包名、版本、硬件和签名后自动安装；具有现有 root 安装权限的设备走静默安装，否则打开系统安装界面。

检查接口 `POST /api/v1/player-updates/check`；下载接口 `GET /api/v1/player-updates/files/{sha256}`。服务器需正常授权。

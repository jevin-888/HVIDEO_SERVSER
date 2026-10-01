# 2026-09-19 收银端协议发现服务器

- 新增 `src/discover/cashier.rs`，启动 18081/UDP 专用发现接收器，以 HTTP 选定网卡单播回复当前端口；不执行终端注册或数据库操作。原播放器 18080 逻辑不变。
- 收银端移除 HTTP 子网扫描，改为实际网卡广播请求/响应与公开 HTTP 状态确认；客户端和服务器必须配套更新。
- 完整字段、重试/取消规则及网络范围见 [收银服务器发现协议](features/收银服务器发现协议.md)。
- `cargo test --lib discover:: --locked`：9 项通过，包含请求字段、请求 ID、协议隔离、无效数据及实际 UDP 收发。收银端全量 41 项测试、静态分析通过。
- `cargo build --manifest-path src-tauri/Cargo.toml --release --locked --features custom-protocol` 成功。更新包 `release/HVideo-Server-Cashier-Discovery-Update.zip` 包含新 EXE、更新说明及协议文档，EXE SHA-256 与构建结果一致；不包含配置、数据库或授权。

- 收银正式 EXE 与完整 ZIP 构建成功（24 文件哈希通过）。使用独立空 APPDATA 实测三网卡广播及本机单播，每目标 3 包，/20 掩码广播正确；未回复时显示未连接且登录禁用。
- 构建 EXE SHA-256：A13EB72AAD23368DDCEDFCF3811BB61969ACD3ADB51CA0F226A7270CEED6CF70。
- 运行中的旧服务器暂未替换，等待用户确认重启；客户电脑及部署后两端连通尚待验证。清理收银测试目录并重新打开的组合操作被自动审批拒绝（blocked by policy），未重试。

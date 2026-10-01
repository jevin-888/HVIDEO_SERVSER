# 2026-09-15：启动自动创建 freesongs

用户要求：服务器启动时检查 freesongs，不存在就自动创建。

修改 `src/lib.rs` 的公共启动入口 `start_server_impl`：日志初始化后，对运行根目录下的 `freesongs` 调用 `create_dir_all`。桌面服务器启动、后台服务重启和独立服务器共用该入口。已有目录与歌曲保持不变；创建失败记录具体路径和系统错误，不让空闲媒体目录故障阻断整个点歌服务。

当前便携版运行根目录为 EXE 所在目录，因此目标为：

`D:\HVIDEO\Hvideo_server\release\HVideo_Admin_Portable_0.2.0\freesongs`

没有修改数据库中的媒体根目录、空闲歌曲路径设置或任何 API；如果用户配置了其他空闲路径，仍按那个设置播放。新建文件夹不会自动生成视频，需要放入歌曲文件。

代码变更为幂等目录创建，无新增业务分支测试文件。构建、部署和启动日志验收结果在本记录后追加。

## 构建与现场部署

- cargo build --manifest-path src-tauri/Cargo.toml --release --locked 通过（1分44秒）。
- 用户明确要求停止当前服务器并替换新版。初次替换遇到旧 EXE 占用，重新核实守护和工作进程，停止两者后完成替换。
- 已部署并于 2026-09-15 13:00:13 重新启动；新版工作进程 PID 22492，守护 PID 16600。
- /health 返回 200；启动日志出现“空闲歌曲目录已就绪”；空闲扫描仍发现用户放入的 60000114.mkv、60000145.mp4，两文件保留。没有为测试删除或移动该目录。
- 新EXE SHA256：8C6AFB8A54ACB46322DBB52F82E8E182952D6E148E262CE164420B48203A685F。
- 旧EXE备份：D:\HVIDEO\Hvideo_server\release\backups\freesongs-startup-20260915-125925\HVideo Admin.exe。
- 没有生成测试媒体或临时测试文件。

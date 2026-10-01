# 终端开机配置

终端管理的“属性”列提供“默认”“模板”“自定义”，未设置的设备显示默认。选择模板或自定义后，服务器立即读取该在线终端的 config.json，保存成功后下次播放器启动生效；旁边保存按钮可重新抓取当前配置。选择默认无需读取终端，离线的自定义设备也可恢复默认。

默认设备始终可以选择自定义，不因已有模板或缓存的离线状态禁用下拉框。保存时使用实际网络握手确认连接；无 IP 或连接失败时明确提示，并保留原属性，不显示虚假的保存成功。

- 模板：只能由一台设备占用。已有模板时，其他设备的模板选项禁用，仍可选默认或自定义；服务器也在提交锁内拒绝其他设备设置模板（HTTP 409），不会替换现有模板。需要更换时，先把原模板改为默认或自定义，再选择新模板。首次选定模板会将其余设备恢复默认并清理旧专用配置。当前模板旁的重新保存按钮仅更新模板内容，保留之后设置的自定义设备。
- 默认：不保存独立文件，开机跟随公共模板。没有模板时继续本地配置。
- 自定义：按保存时的终端 IPv4 保存专用配置。启动请求的真实 TCP 来源 IP 优先匹配自定义配置，未匹配则使用模板。选择模板后，仍需独立设置的终端可以再选择自定义。
- 同一终端切换属性会替换其旧档案；模板终端改为默认或自定义会取消公共模板。IP 变化需要重新保存自定义配置。旧版持久化档案中的 default 模式作为 custom 读取，防止误解旧 IP 专用配置。删除终端登记不会删除已保存的开机配置。
- 当启动时配置为在线 VOD（vodMode=2），或通过服务器发现回复及 HTTP 准入自动切换为在线 VOD 后，请求并应用服务器开机配置，发生在图层初始化之前。没有接入服务器的关闭/单机模式继续使用本地配置。网络连接失败最多请求 3 次，每次 3 秒、间隔 1 秒；失败、无配置或配置损坏时保留本地配置。网络稍后恢复时可自动切换在线 VOD，但完整图层模板需下次启动加载。
- 保留本机 networkIpMode、networkStaticIp、networkGateway、networkDns、debugHotspotEnabled、onlineVodHost、onlineVodRoomId、licenseServerUrl、vodMode、enableVod，避免复制模板设备的网络、房间身份或切换本机 VOD 模式。图层、矩阵、音频等配置来自服务器；外部素材、播放列表和独立融合文件不包含在 config.json 中，不随此功能传输。

## 唯一接口契约

服务器统一响应 `{code,message,data}`，成功 code=0。

| 方法与路径 | 权限 | 请求/响应 data |
|---|---|---|
| GET /api/v1/terminals/config-profiles | 登录管理员 | 档案数组，每项 `{terminalId,sourceIp,mode,fileName,updatedAt}`，时间为 Unix 秒 |
| POST /api/v1/terminals/:id/config-profile | 登录管理员 | 请求仅 `{mode:"template"}`、`{mode:"custom"}` 或 `{mode:"default"}`；前两者返回已提交档案，默认返回 null |
| GET /api/v1/terminals/startup-config | 有效服务器授权，无需管理员登录 | 无请求参数；返回 null，或 `{mode,sourceIp,updatedAt,config}`，mode 为 template/custom；以 TCP 来源 IP 选择，忽略伪造的查询 IP/代理头 |

保存使用既有 UDP challenge-response 核对登记序列号，再访问播放器局域网端口 8081 的既有 `GET /api/v1/config.json`，响应为 `{ok:true,data:<完整系统和图层配置>,error:null}`。不新增重复导出接口。

存储目录是运行 config.toml 同级的 terminal-configs。profiles.json 是原子提交索引，快照文件带来源 IP 和唯一 ID；重复保存后清理已替换快照。索引提交失败保留旧档案。限制配置大小 4 MB，要求矩阵对象和图层对象。播放器先用真实 SystemConfig 加载器验证暂存文件，再原子替换本地 config.json；临时文件自动清理。

实现：服务器 src/api/terminal_config_handler.rs、src/services/terminal_config_service.rs；播放器 D:/CHUANGWEI/src/core/Engine.cpp、include/core/StartupConfig.h。

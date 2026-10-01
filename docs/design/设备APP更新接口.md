# 设备 APP 更新

设备管理页的「APP 更新」支持上传一个 APK，选择 1–50 台已登记在线终端，后台逐台覆盖安装。入口位于 `static/admin/index.html`，交互为 `static/admin/app-update.js`，API 方法统一位于 `static/admin/api.js`。

## 安装环境

- 服务器需具备 Android platform-tools。ADB 查找顺序：`HVIDEO_ADB_PATH` 环境变量指定的完整程序路径、服务器可执行文件旁的 `tools/adb.exe`、可执行文件旁的 `adb.exe`、系统 PATH（Linux 对应 `adb`）。Windows 部署时保留 platform-tools 自带的 DLL。
- 设备已开启网络 ADB，并授权服务器。管理页面不显示端口，使用服务器默认端口 `5555`；该端口与设备播放器 HTTP 端口不同。
- 只支持完整 `.apk`，不支持 `.aab`、`.apks` 或分包集合。上传最大 300 MiB。服务器流式写临时文件并检查 ZIP 和非空 `AndroidManifest.xml`；Android Package Manager 负责签名、版本和最终安装校验。
- 执行 `adb connect IP:port`，确认 `get-state` 为 `device`，然后执行 `adb -s IP:port install --no-streaming -r 临时文件.apk`。勾选“允许降级安装”时增加 `-d` 参数，执行 `adb -s IP:port install --no-streaming -r -d 临时文件.apk`。保留应用数据，不自动卸载。不会自动启动 APP，运行中的 APP 可能因更新退出。
- 降级比较 Android `versionCode`。`-d` 是否生效取决于应用的 debuggable 属性、设备构建和系统权限，普通正式版设备不保证支持；新旧安装包签名仍须一致。系统拒绝降级时显示明确原因和原始错误，不自动卸载重装或清空数据。

## 一对一 API

所有接口均需 `Authorization: Bearer <token>`，且 Token 的 `permissions` 包含 `admin`。响应沿用 `{code,message,data}`。

| 前端方法 | HTTP | 路径 | 输入 |
|---|---|---|---|
| `startAppUpdate(apk, terminalIds, allowDowngrade)` | POST | `/api/v1/terminals/app-updates` | multipart，字段如下 |
| `getLatestAppUpdate()` | GET | `/api/v1/terminals/app-updates/latest` | 无 |
| `getAppUpdate(taskId)` | GET | `/api/v1/terminals/app-updates/{taskId}` | 任务 ID |

POST 字段固定为：`apk`（一个 APK 文件）、`terminalIds`（JSON 字符串数组，例如 `["terminal-xxx"]`）、`adbPort`（1–65535 的整数字符串，可省略，默认 5555）、`allowDowngrade`（严格的字符串 `true` 或 `false`，可省略，默认 `false`）。拒绝未知或重复字段、重复设备 ID、离线或不存在的设备。IP 仅从设备数据库读取，不接受客户端提供任意目标 IP。

管理页面省略 `adbPort`，由服务器应用默认值，用户无需输入端口。

POST 在完整上传、验证并创建后台任务后返回 `data`：

```json
{
  "taskId": "任务 UUID",
  "fileName": "app-release.apk",
  "adbPort": 5555,
  "allowDowngrade": false,
  "status": "running",
  "createdAt": 1788800000000,
  "completedAt": null,
  "devices": [
    {
      "terminalId": "terminal-xxx",
      "name": "包间播放器",
      "terminalIp": "192.168.1.100",
      "status": "queued",
      "message": "等待安装"
    }
  ]
}
```

两个 GET 返回同一任务结构；从未创建任务时 `latest` 的 `data` 为 `null`。字段不提供其他命名别名。

`allowDowngrade` 在任务响应中为 JSON 布尔值，后台任务和操作日志保留此次安装模式。重新打开窗口查看运行中的任务时恢复该选项，执行过程中不能更改。

- 任务状态：`running`、`completed`。`completed` 仅表示所有设备处理完毕，不能直接显示“全部安装成功”。
- 设备状态：`queued` → `connecting` → `installing` → `succeeded` / `failed`。连接失败可直接进入 `failed`。
- 只有安装进程退出成功且输出独立的 `Success` 行才标为成功。连接 20 秒、状态读取 15 秒、每台安装 300 秒超时；超时明确显示结果未确认。单台失败不阻断后续设备。
- 同一服务器进程只允许一个上传/安装任务，重复请求返回 409。无管理员权限返回 403；参数或 APK 无效返回 400；设备/任务不存在返回 404。
- 页面每 1.5 秒查询状态，关闭弹窗后停止查询，后台继续安装。重新打开/刷新页面后点击 APP 更新，通过 `latest` 恢复查看。网络断开不能直接认定安装失败，应重新读取任务。
- 临时 APK 在请求拒绝、任务正常结束（含设备安装失败）或任务被取消释放时删除。设备结果写入操作日志，任务详情在内存保留最近 20 项，服务器进程退出后不再保留。服务器重启中断任务时，应核对设备实际安装结果再重试。

## 验证

`cargo test --lib app_update` 检查安装包校验、安装结果和后台任务；`node scripts/app-update-ui.test.mjs` 检查设备选择、上传协议、安装结果、失败恢复和弹窗布局。真实设备需用已授权且签名匹配的 APK 单独验收。

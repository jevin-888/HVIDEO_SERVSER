# 房间控制命令列表

所有控制均需指定房间，路径中 `:id` 为房间 ID（或由后端按客户端 IP 解析）。  
除「通用 command」外，其余为专用外设接口。

---

## 一、通用命令（POST /api/v1/rooms/:id/command）

通过 **body** 传 **action**（唯一格式），后端通过 WebSocket 下发给房间终端。协议格式统一使用后台定义。

### 1. 按 action 对象

| action 类型 | 含义 | 示例 body |
|-------------|------|-----------|
| `"Play"` | 播放 | `{ "action": "Play" }` |
| `"Pause"` | 暂停 | `{ "action": "Pause" }` |
| `"NextSong"` | 下一首 | `{ "action": "NextSong" }` |
| `"SkipSong"` | 切歌 | `{ "action": "SkipSong" }` |
| `"Replay"` | 重播当前 | `{ "action": "Replay" }` |
| `"SwitchTrack"` | 原唱/伴唱 | `{ "action": "SwitchTrack", "trackId": 0 }` |
| `"SetVolume"` | 音量 | `{ "action": "SetVolume", "volume": 80 }` |
| `"SetMic"` | 麦克风 | `{ "action": "SetMic", "enabled": true }` |
| `"SetAC"` | 空调 | `{ "action": "SetAC", "power": true, "temp": 26, "mode": "cool" }` |
| `"SetLight"` | 灯光 | `{ "action": "SetLight", "scene": "romantic" }` |
| `"SetEffect"` | 音效 | `{ "action": "SetEffect", "mode": "ktv" }` |
| `"PlayAmbiance"` | 氛围音效 | `{ "action": "PlayAmbiance", "effect": "applause" }` |
| `"ServiceCall"` | 服务呼叫 | `{ "action": "ServiceCall", "callType": "waiter" }` |
| `"Custom"` | 自定义 | `{ "action": "Custom", "command": "original" }` |
| `"PlayMaterial"` | 播放素材 | `{ "action": "PlayMaterial", "materialId": "xxx" }` |
| `"PlayStream"` | 播放流 | `{ "action": "PlayStream", "streamId": "xxx" }` |
| `"StopStream"` | 停止流 | `{ "action": "StopStream" }` |

点歌、置顶、删除、打乱、清空队列统一走 `/api/v1/rooms/:id/queue*` 和 `/api/v1/rooms/:id/clear`，不通过 `/command` 发送歌曲队列操作。

---

## 二、专用外设接口（推荐按接口调用）

| 接口 | 方法 | 含义 | 请求体示例 |
|------|------|------|-------------|
| `/api/v1/rooms/:id/peripheral/ac` | POST | 空调 | `{ "power": true, "temp": 26, "mode": "cool" }` |
| `/api/v1/rooms/:id/peripheral/light` | POST | 灯光 | `{ "scene": "romantic" }` |
| `/api/v1/rooms/:id/peripheral/effect` | POST | 音效 | `{ "mode": "ktv" }` |
| `/api/v1/rooms/:id/peripheral/ambiance` | POST | 氛围音效 | `{ "effect": "applause" }` |
| `/api/v1/rooms/:id/peripheral/call` | POST | 服务呼叫 | `{ "callType": "waiter", "callNote": "" }` |
| `/api/v1/rooms/:id/peripheral/voice` | POST | 音量/静音 | `{ "type": 4, "val": 80 }`（4=音乐音量，2=静音，3=取消静音） |
| `/api/v1/rooms/:id/peripheral/button` | POST | 按钮点击 | `{ "buttonNameAlias": "windLowButton" }` |

---

## 三、前端调用方式

- **音乐栏/播放控制**：`ApiService.musicBarControl(params)` → POST `/api/v1/rooms/:id/command`，params 统一为后台 action 格式，例如 `{ action: "Play" }`、`{ action: "Custom", command: "original" }`。
- **空调/灯光/音效/氛围/呼叫/音量/按钮**：可走对应 peripheral 接口，或统一走 `/command` 并传对应 `action` 对象。

后端会将命令以 `{ type: "command", action: ..., source: "ktv" }` 通过 WebSocket 推送给该房间终端。

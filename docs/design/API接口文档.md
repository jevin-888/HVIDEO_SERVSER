# HVideo 系统 API 接口文档

本文档列出了 HVideo 点歌系统服务器提供的所有 API 接口、请求参数及返回数据格式。

设备 APP 上传与批量安装：见 [设备 APP 更新接口](设备APP更新接口.md)，包含 `POST /api/v1/terminals/app-updates`、`GET /api/v1/terminals/app-updates/latest` 和 `GET /api/v1/terminals/app-updates/{taskId}`。

歌曲编辑中的“歌曲分类”对应 `categoryCode`；“视频格式”对应 `videoFileType`。`POST /api/v1/songdb/songs` 和 `PUT /api/v1/songdb/songs/{id}` 均支持 `videoFileType`，常用值为小写字符串 `mp4`、`mkv`、`mpg`，列表和详情使用同名字段返回。更新时省略该字段保留原格式，空字符串表示未知。此字段只记录格式，不转换视频文件，也不修改歌曲分类。

## API 概览树 (API Tree)

```text
/ (root)
├── health [GET] (健康检查)
├── ws/
│   └── :terminal_id [GET] (WebSocket 长连接)
└── api/
    └── v1/
        ├── auth/
        │   ├── login [POST] (认证登录)
        │   └── waiter/
        │       └── login [POST] (服务员登录)
        ├── system/
        │   ├── server-info [GET] (服务器网卡与IP)
        │   ├── status [GET] (系统资源占用)
        │   └── dicts [GET] (系统字典列表)
        ├── songs/
        │   ├── (root) [GET, POST] (列表/创建)
        │   └── :id [GET, PUT, DELETE] (详情/更新/删除)
        ├── artists/
        │   ├── (root) [GET, POST] (列表/创建)
        │   └── :id [GET, PUT, DELETE] (详情/更新/删除)
        ├── rooms/
        │   ├── (root) [GET, POST] (列表/创建)
        │   ├── :id/
        │   │   ├── (root) [GET, PUT, DELETE] (详情/更新/删除)
        │   │   ├── state [GET] (当前播放/外设状态)
        │   │   ├── queue [GET, POST] (队列管理/点歌)
        │   │   ├── queue/prioritize [POST] (置顶歌曲)
        │   │   ├── next [POST] (切到下一首)
        │   │   ├── clear [POST] (清空队列)
        │   │   ├── command [POST] (发送控制指令: 音量/麦克风等)
        │   │   ├── materials/play [POST] (播放素材)
        │   │   ├── streams/play [POST] (播放流媒体)
        │   │   ├── message [POST] (发送消息)
        │   │   ├── control [POST] (房间控制)
        │   │   ├── peripheral/
        │   │   │   ├── ac [POST] (空调控制)
        │   │   │   ├── light [POST] (灯光控制)
        │   │   │   ├── effect [POST] (音效模式)
        │   │   │   ├── ambiance [POST] (氛围音效)
        │   │   │   ├── call [POST] (服务呼叫)
        │   │   │   └── voice [POST] (声音控制)
        │   │   └── service/
        │   │       ├── bell [POST] (服务铃)
        │   │       ├── response [POST] (响应服务)
        │   │       └── cancel [POST] (取消服务)
        │   └── configs/
        │       ├── types/
        │       │   ├── (root) [GET, POST]
        │       │   └── :id [DELETE]
        │       └── areas/
        │           ├── (root) [GET, POST]
        │           └── :id [DELETE]
        ├── terminals/
        │   ├── (root) [GET] (终端列表)
        │   ├── register [POST] (终端注册)
        │   ├── heartbeat [POST] (心跳上报)
        │   ├── scan [POST] (触发网段扫描)
        │   ├── discover [POST] (UDP发现设备)
        │   └── :id [GET, PUT, DELETE] (管理特定终端)
        ├── cloud/
        │   ├── import [POST] (批量导入云端数据)
        │   ├── tasks [GET] (同步任务列表)
        │   └── download/
        │       └── :id [POST] (触发单个文件下载)
        ├── clients/
        │   ├── (root) [GET, POST] (API 客户端列表/创建)
        │   └── :id [PUT, DELETE] (更新权限/删除)
        ├── materials/
        │   ├── (root) [GET] (素材列表)
        │   └── categories [GET] (素材分类)
        ├── streams [GET] (流媒体列表)
        ├── products/
        │   ├── (root) [GET] (商品列表)
        │   ├── categories [GET] (商品分类)
        │   │   └── free [GET] (免费分类)
        │   ├── combos [GET] (套餐列表)
        │   │   └── :id/items [GET] (套餐明细)
        │   └── tastes [GET] (口味列表)
        ├── orders/
        │   ├── (root) [POST] (创建订单)
        │   ├── bill [GET] (账单概要)
        │   ├── qrcode [GET] (点单二维码)
        │   └── :id/detail [GET] (订单明细)
        ├── marketing/
        │   └── ads [GET] (广告列表)
        ├── pr/
        │   ├── staff [GET] (公关人员)
        │   ├── groups [GET] (公关分组)
        │   │   └── stats [GET] (分组统计)
        │   ├── records [GET] (公关记录)
        │   ├── flowers [GET] (打赏礼物)
        │   ├── service [POST] (公关服务)
        │   └── orders [POST] (公关订单)
        ├── songdb/ (大曲库 song.db 直接操作)
        │   ├── songs/
        │   │   ├── (root) [GET, POST]
        │   │   └── :id [GET, PUT, DELETE]
        │   ├── singers/
        │   │   ├── (root) [GET, POST]
        │   │   ├── :id/
        │   │   │   ├── (root) [GET, PUT, DELETE]
        │   │   │   └── songs [GET] (获取该歌手的所有歌曲)
        │   ├── dict/
        │   │   └── :group/
        │   │       ├── (root) [GET, PUT] (读取分组 / 新增或更新字典项)
        │   │       └── :code [DELETE] (删除未被引用的字典项)
        │   ├── dicts/
        │   │   ├── (root) [GET] (管理员读取全部字典)
        │   │   ├── export [GET] (导出 XLSX)
        │   │   └── import [POST] (导入 XLSX)
        │   └── stats [GET] (曲库总量统计)
        └── activities [GET] (最近操作日志)
```

---


## 1. 通用响应格式

所有 API 遵循统一的 JSON 响应格式：

```json
{
  "code": 0,         // 业务状态码，0 表示成功
  "message": "success", // 提示消息
  "data": { ... }    // 具体的业务数据
}
```

## 认证说明

除以下公开接口外，所有API都需要JWT认证：

**公开接口（无需认证）：**
- `GET /health` - 健康检查
- `POST /api/v1/auth/login` - 登录获取Token
- `POST /api/v1/auth/waiter/login` - 服务员登录
- `GET /ws/:terminal_id` - WebSocket连接

**认证方式：**
在HTTP请求头中添加：
```
Authorization: Bearer <your_jwt_token>
```

**认证失败响应：**
### 2.2 获取服务器信息
- **路径**: `GET /api/v1/system/server-info`
- **认证**: 无需
- **返回数据**: `ServerInfo`
  - `host`: 推荐的本机 IP
  - `port`: 监听端口
  - `interfaces`: `Array<{ name: string, ip: string }>` (网卡列表)

### 2.3 获取系统状态
- **路径**: `GET /api/v1/system/status`
- **认证**: 无需
- **返回数据**: `SystemStatus`
  - `cpu_usage`: CPU 占用率 (%)
  - `memory_used_mb`: 已用内存 (MB)
  - `memory_total_mb`: 总内存 (MB)
  - `memory_usage_percent`: 内存占用率 (%)
  - `disks`: `Array<{ name: string, mount_point: string, total_space_gb: number, used_space_gb: number, usage_percent: number }>`
  - `load_average`: `{ one: number, five: number, fifteen: number }`

### 2.4 获取系统字典
- **接口名**: `get_dicts`
- **路径**: `GET /api/v1/system/dicts`
- **认证**: 无需
- **返回数据**: `Array<DictEntry>（字段同 15.6：dictGroup、dictCode、dictName、sortOrder、visible）`
- **说明**: 返回 language、sex、region、classify、track、ac 六个分组，包含隐藏项；后台全部字典列表使用 15.6 的管理员接口。

### 2.5 健康检查
- **路径**: `GET /health`
- **返回**: `OK` (Text)

---

## 3. 歌曲管理 (Song Management)

### 3.1 获取歌曲列表
- **路径**: `GET /api/v1/songs`
- **查询参数**: `SongQuery`
  - `keyword`: 关键词
  - `initial`: 首字母
  - `artist_id`: 歌星 ID
  - `language`: 语言
  - `genre`: 流派
  - `is_hot`: 是否热门 (bool)
  - `page`: 页码 (默认 1)
  - `page_size`: 每页大小 (默认 20)
- **返回**: `PagedResponse<Song>`

### 3.2 创建歌曲
- **路径**: `POST /api/v1/songs`
- **请求体**: `CreateSongRequest`
  - `title`, `pinyin`, `artist_id`, `artist_name`, `language`, `genre`, `duration`, `quality`

### 3.3 获取/更新/删除单首歌曲
- **路径**: `GET/PUT/DELETE /api/v1/songs/:id`

---

## 4. 歌星管理 (Artist Management)

### 4.1 获取歌星列表
- **路径**: `GET /api/v1/artists`
- **查询参数**: `ArtistQuery` (keyword, initial, gender, region, page, page_size)
- **返回**: `PagedResponse<Artist>`

### 4.2 获取/更新/删除单个歌星
- **路径**: `GET/PUT/DELETE /api/v1/artists/:id`

---

## 5. 房间管理 (Room Management)

### 5.1 获取所有房间
- **路径**: `GET /api/v1/rooms`
- **认证**: 需要
- **返回**: `Array<RoomWithTerminalInfo>`

### 5.2 创建房间
- **路径**: `POST /api/v1/rooms`
- **认证**: 需要
- **请求体**: `CreateRoomRequest`

### 5.3 获取/更新/删除房间
- **获取**: `GET /api/v1/rooms/:id`
- **更新**: `PUT /api/v1/rooms/:id`
- **删除**: `DELETE /api/v1/rooms/:id`
- **认证**: 需要

### 5.4 房间配置 (类型/区域)
- **获取类型**: `GET /api/v1/rooms/configs/types`
- **创建类型**: `POST /api/v1/rooms/configs/types`
- **删除类型**: `DELETE /api/v1/rooms/configs/types/:id`
- **获取区域**: `GET /api/v1/rooms/configs/areas`
- **创建区域**: `POST /api/v1/rooms/configs/areas`
- **删除区域**: `DELETE /api/v1/rooms/configs/areas/:id`
- **认证**: 需要

---

## 6. 房间点歌与控制 (Room Queue & Command)

### 6.1 获取点歌队列
- **路径**: `GET /api/v1/rooms/:id/queue`
- **认证**: 无需
- **返回**: `Array<RoomQueueItem>`

### 6.2 获取已唱列表
- **路径**: `GET /api/v1/rooms/:id/queue/played`
- **认证**: 无需
- **返回**: `Array<RoomQueueItem>`（status=2 已唱 或 status=3 已跳过，按时间倒序）

### 6.3 点歌
- **路径**: `POST /api/v1/rooms/:id/queue`
- **认证**: 无需
- **请求体**: `{"song_id": "string", "is_priority": false}`

### 6.4 置顶歌曲
- **路径**: `POST /api/v1/rooms/:id/queue/prioritize`
- **认证**: 无需
- **请求体**: `{"song_id": "string"}`

### 6.5 切换下一首
- **路径**: `POST /api/v1/rooms/:id/next`
- **认证**: 无需

### 6.6 清空队列
- **路径**: `POST /api/v1/rooms/:id/clear`
- **认证**: 无需

### 6.7 获取房间实时状态
- **路径**: `GET /api/v1/rooms/:id/state`
- **认证**: 无需
- **说明**: 支持通过房间ID或终端IP自动识别房间
- **返回数据**: 包含播放状态、音量、外设状态等

### 6.8 统一控制接口（兼容旧版）
- **路径**: `POST /api/v1/rooms/:id/command`
- **认证**: 无需
- **请求体**: JSON对象，使用`action`字段标识动作类型
- **说明**: 
  - 支持所有播放控制命令的统一接口
  - 建议使用独立API接口（见第7章），此接口主要用于兼容旧版本
  - 详细命令格式参见附录

---

## 7. 播放控制 (Playback Control)

### 7.1 播放
- **路径**: `POST /api/v1/rooms/:id/play`
### 8.2 灯光控制
- **路径**: `POST /api/v1/rooms/:id/peripheral/light`
- **认证**: 无需
- **请求体**: `{"scene": "happy"}`

### 8.3 音效控制
- **路径**: `POST /api/v1/rooms/:id/peripheral/effect`
- **认证**: 无需
- **请求体**: `{"mode": "KTV"}`

### 8.4 氛围音效
- **路径**: `POST /api/v1/rooms/:id/peripheral/ambiance`
- **认证**: 无需
- **请求体**: `{"effect": "applause"}`

### 8.5 服务呼叫
- **路径**: `POST /api/v1/rooms/:id/peripheral/call`
- **认证**: 无需
- **请求体**: `{"call_type": "water"}`

### 8.6 声音控制更新后的房间状态

### 7.5 设置音量
- **路径**: `POST /api/v1/rooms/:id/volume`
- **认证**: 无需
- **请求体**: 
---

## 9. 媒体资源 (Media - Material & Stream)

### 9.1 获取素材列表
- **返回数据**: 更新后的房间状态

### 7.6 麦克风控制
- **路径**: `POST /api/v1/rooms/:id/mic`
### 9.2 获取素材分类
- **路径**: `GET /api/v1/materials/categories`
- **认证**: 无需
- **返回**: `Array<MaterialCategory>`

### 9.3 获取流媒体列表
- **路径**: `GET /api/v1/streams`
- **认证**: 无需
- **返回**: `Array<Stream>`

### 9.4 播放素材
- **路径**: `POST /api/v1/rooms/:id/materials/play`
- **认证**: 无需
- **请求体**: `{"media_id": "string", "media_type": "material"}`

### 9.5 播放流媒体": 0  // 0=伴唱, 1=原唱
  }
  ```
- **返回数据**: 更新后的房间状态

---

### 7.7 原唱/伴唱切换
- **路径**: `POST /api/v1/rooms/:id/track`
- **认证**: 无需
- **请求体**: 
  ```json
  {
    "track_id": 0  // 0=伴唱, 1=原唱
  }
  ```
- **返回数据**: 更新后的房间状态

---

## 8. 外设控制 (Peripheral Control)
```json
// 播放
{"action": "Play"}

// 暂停
{"action": "Pause"}

// 下一首
{"action": "NextSong"}

// 切歌（跳过当前歌曲）
{"action": "SkipSong"}

// 重播当前歌曲
{"action": "Replay"}

// 清空队列
{"action": "ClearQueue"}
```

**音量与麦克风控制**
```json
// 调节音量 (0-100)
{"action": "SetVolume", "volume": 50}

// 麦克风开关
{"action": "SetMic", "enabled": true}
```

**原唱/伴唱切换**
```json
// 切换音轨 (0=伴唱, 1=原唱)
{"action": "SwitchTrack", "track_id": 0}
```

**点歌（兼容火韵协议）**
```json
{"action": "AddSong", "song_id": "song_uuid"}
```

**外设控制**
```json
// 空调控制
{"action": "SetAC", "power": true, "temp": 24, "mode": "cool", "wind": "auto"}

// 灯光控制
{"action": "SetLight", "scene": "happy"}

// 音效设置
{"action": "SetEffect", "mode": "KTV"}

// 氛围音效 (喝彩、鼓掌等)
{"action": "PlayAmbiance", "effect": "applause"}

// 服务呼叫
{"action": "ServiceCall", "call_type": "water"}
```

**媒体播放**
```json
// 播放素材
{"action": "PlayMaterial", "material_id": "material_uuid"}

// 播放流媒体
{"action": "PlayStream", "stream_id": "stream_uuid"}

// 停止流媒体
{"action": "StopStream"}
```

**自定义命令（火韵兼容）**
```json
{"action": "Custom", "command": "custom_command_string"}
```

- **返回数据**: 更新后的房间状态（包含play_state、volume、mute等）
- **说明**: 
  - 命令会通过WebSocket实时转发到终端设备
  - 播放状态会自动更新到数据库
  - 状态变更会广播给所有连接的客户端

---

## 7. 外设控制 (Peripheral Control)

### 7.1 空调控制
- **路径**: `POST /api/v1/rooms/:id/peripheral/ac`
- **认证**: 无需
- **请求体**: `{"power": true, "temp": 24, "mode": "cool"}`

### 7.2 灯光控制
- **路径**: `POST /api/v1/rooms/:id/peripheral/light`
- **认证**: 无需
- **请求体**: `{"scene": "happy"}`

### 7.3 音效控制
- **路径**: `POST /api/v1/rooms/:id/peripheral/effect`
- **认证**: 无需
- **请求体**: `{"mode": "KTV"}`

### 7.4 氛围音效
- **路径**: `POST /api/v1/rooms/:id/peripheral/ambiance`
- **认证**: 无需
- **请求体**: `{"effect": "applause"}`

### 7.5 服务呼叫
- **路径**: `POST /api/v1/rooms/:id/peripheral/call`
- **认证**: 无需
- **请求体**: `{"call_type": "water"}`

### 7.6 声音控制
- **路径**: `POST /api/v1/rooms/:id/peripheral/voice`
- **认证**: 无需
- **请求体**:
  ```json
  { "volume": 50 }
  ```
  或同时设置麦克风音量：
  ```json
  { "volume": 50, "mic_volume": 40 }
  ```
- **说明**:
  - `volume` = 0 时后台自动标记为静音（`mute: true`）
  - `volume` > 0 时取消静音（`mute: false`）
  - `mic_volume` 可选，不传则保持当前麦克风音量不变
  - 静音/取消静音逻辑由前端负责：静音时记住当前音量，发送 `volume: 0`；取消静音时发送之前记住的音量值
- **返回数据**: 更新后的完整房间状态（含 `mute`、`volume`、`mic_volume` 等字段）

---

## 8. 媒体资源 (Media - Material & Stream)

### 8.1 获取素材列表
- **路径**: `GET /api/v1/materials`
- **认证**: 无需
- **返回**: `Array<Material>`

### 8.2 获取素材分类
- **路径**: `GET /api/v1/materials/categories`
- **认证**: 无需
- **返回**: `Array<MaterialCategory>`

### 8.3 获取流媒体列表
- **路径**: `GET /api/v1/streams`
- **认证**: 无需
- **返回**: `Array<Stream>`

### 8.4 播放素材
- **路径**: `POST /api/v1/rooms/:id/materials/play`
- **认证**: 无需
- **请求体**: `{"media_id": "string", "media_type": "material"}`

### 8.5 播放流媒体
- **路径**: `POST /api/v1/rooms/:id/streams/play`
- **认证**: 无需
- **请求体**: `{"media_id": "string", "media_type": "stream"}`

---

## 9. 终端管理 (Terminal Management)

### 9.1 获取终端列表
- **路径**: `GET /api/v1/terminals`
- **认证**: 需要 JWT
- **返回**: `Array<Terminal>`，每台物理设备一条，包含必填注册身份 `serial` 和 `connections` 数组；完整字段见 [终端注册协议](终端发现与准入协议.md)。

### 9.2 指定 IP 验证并注册播放器
- **路径**: `POST /api/v1/terminals/register`
- **认证**: 需要 JWT
- **请求体**: 只接受 `terminalIp` 和 `serial`，两者均必填
  ```json
  {
    "terminalIp": "192.168.1.100",
    "serial": "279F4F6D53F8FEBE"
  }
  ```
- **说明**: 服务端向该 IP 发起 UDP challenge-response 握手。核对请求中的序列号与播放器实际序列号；名称、MAC、型号和端口采用播放器响应。序列号缺失返回 400，不匹配返回 409。

### 9.3 扫描并注册播放器
- **路径**: `POST /api/v1/terminals/discover`
- **认证**: 需要 JWT
- **说明**: 通过 UDP v2 challenge-response 发现 HSVJ Player；仅接受 `device_role=player`、`app_id=com.hsvj.engine` 且 challenge 匹配的响应，随后自动注册并创建房间。
- **返回**: `Array<DiscoveredDevice>`

### 9.4 获取/更新/删除终端
- **获取**: `GET /api/v1/terminals/:id`
- **更新**: `PUT /api/v1/terminals/:id`
- **删除**: `DELETE /api/v1/terminals/:id`
- **管理端批量删除**：对当前勾选的终端逐台调用上述 DELETE 接口；删除前使用 `GET /api/v1/terminals/:id/rooms` 汇总关联房间并统一确认。成功项取消勾选，失败项保留以供重试，不新增批量路由或请求字段。单台删除同时清理关联房间、点歌队列和网络连接记录。
- **认证**: 需要 JWT

### 9.5 获取终端房间
- **路径**: `GET /api/v1/terminals/:id/rooms`
- **认证**: 需要 JWT

### 9.6 WebSocket 升级
- **路径**: `GET /ws/:terminal_id`
- **认证**: 无需
- **说明**: 建立终端与服务器的长连接。

### 9.7 播放器在线准入
- **路径**: `POST /api/v1/terminals/admission`
- **请求**: `protocolVersion`、`deviceRole`、`appId`、`macAddress`、`serial` 必填，校验支持的 `model`；新版同时上报 `network`。
- **说明**: 来源 IP 取实际 TCP 对端。以序列号注册终端，核对既有有线 MAC 绑定，有线/无线连接共用一个授权名额。
- **完整字段**: [终端注册与网络连接协议](终端发现与准入协议.md)。

> 已删除 `/api/v1/terminals/scan` 和 `/api/v1/terminals/heartbeat`。TCP 端口不能证明播放器身份，播放器在线状态统一由经过身份字段校验的 UDP v2 Beacon 更新。
---

## 10. 房务服务 (Room Service)

### 10.1 服务铃呼叫
- **路径**: `POST /api/v1/rooms/:id/service/bell`
- **认证**: 无需

### 10.2 响应服务
- **路径**: `POST /api/v1/rooms/:id/service/response`
- **认证**: 无需

### 10.3 取消服务
- **路径**: `POST /api/v1/rooms/:id/service/cancel`
- **认证**: 无需

### 10.4 发送消息
- **路径**: `POST /api/v1/rooms/:id/message`
- **认证**: 无需

### 10.5 房间控制
- **路径**: `POST /api/v1/rooms/:id/control`
- **认证**: 无需

---

## 11. 商品与收银 (Products & Cashier)

### 11.1 获取商品列表
- **路径**: `GET /api/v1/products`
- **认证**: 无需

### 11.2 获取商品分类
- **路径**: `GET /api/v1/products/categories`
- **认证**: 无需

### 11.3 获取免费分类
- **路径**: `GET /api/v1/products/categories/free`
- **认证**: 无需

### 11.4 获取套餐列表
- **路径**: `GET /api/v1/products/combos`
- **认证**: 无需

### 11.5 获取套餐明细
- **路径**: `GET /api/v1/products/combos/:id/items`
- **认证**: 无需

### 11.6 获取口味列表
- **路径**: `GET /api/v1/products/tastes`
- **认证**: 无需

### 11.7 创建订单
- **路径**: `POST /api/v1/orders`
- **认证**: 无需

### 11.8 获取账单概要
- **路径**: `GET /api/v1/orders/bill`
- **认证**: 无需

### 11.9 获取订单明细
- **路径**: `GET /api/v1/orders/:id/detail`
- **认证**: 无需

### 11.10 获取点单二维码
- **路径**: `GET /api/v1/orders/qrcode`
- **认证**: 无需

---

## 12. 认证与营销 (Auth & Marketing)

### 12.1 服务员登录
- **路径**: `POST /api/v1/auth/waiter/login`
- **认证**: 无需

### 12.2 获取广告列表
- **路径**: `GET /api/v1/marketing/ads`
- **认证**: 无需

---

## 13. 公关服务 (PR Service)

### 13.1 获取公关人员列表
- **路径**: `GET /api/v1/pr/staff`
- **认证**: 无需

### 13.2 获取公关分组
- **路径**: `GET /api/v1/pr/groups`
- **认证**: 无需

### 13.3 获取分组统计
- **路径**: `GET /api/v1/pr/groups/stats`
- **认证**: 无需

### 13.4 获取公关记录
- **路径**: `GET /api/v1/pr/records`
- **认证**: 无需

### 13.5 获取打赏礼物列表
- **路径**: `GET /api/v1/pr/flowers`
- **认证**: 无需

### 13.6 公关服务操作
- **路径**: `POST /api/v1/pr/service`
- **认证**: 无需

### 13.7 创建公关订单
- **路径**: `POST /api/v1/pr/orders`
- **认证**: 无需

---

## 14. 云端同步 (Cloud Sync)

云端同步 HTTP 字段统一使用 `camelCase`，不提供 snake_case 别名。下载任务状态：`0` 待处理、`1` 进行中、`2` 已完成、`3` 失败。

### 14.1 云端状态
- **路径**: `GET /api/v1/cloud/status`
- **认证**: 需要
- **返回字段**: `configured`, `reachable`, `apiBaseUrl`, `downloadDir`, `apiKeyConfigured`, `importableSongCount`（旧通用下载兼容字段，固定 0）, `message`, `packages`, `updateError`, `updating`, `authorization`。`authorization={enabled,valid,expiresAt,message}`，到期时间为 Unix 秒或 null，云端更新有效期独立于服务器永久授权。
- **packages**: 数组，字段 `id`, `name`, `versionCode`, `songCount`, `videoCount`, `totalSize`, `installed`。展示云端已发布包，歌曲资料数与视频数分开统计。`updateError` 为 null 或读取包错误原因；可连接不等于更新目录可用。
- 页面登录进入程序立即检查，之后每 30 秒刷新；同一请求未完成不重叠，退出登录后不轮询。自动检查不触发下载。

### 14.2 批量导入
- **路径**: `POST /api/v1/cloud/import`
- **认证**: 需要
- **请求体**: `{"songIds": ["id1", "id2"]}`
- **约束**: 旧版单曲导入已停用，admin + 云端更新授权校验后返回 400 并引导使用 `/api/v1/cloud/updates`。保留路由只用于明确拒绝旧调用，不能绕过包校验、磁盘保护与 song.db 入库。

云端任务页面展示全部状态并保留分页，不提供状态筛选和手动刷新按钮。进入时立即获取，空闲每 10 秒、待处理或进行中每 1.5 秒静默刷新；错误自动重试，离页或注销暂停。接口和分页字段不变。

### 14.2.1 云端配置

| 操作 | HTTP 路径 | 前端方法 | 权限 |
|---|---|---|---|
| 读取配置 | `GET /api/v1/cloud/config` | `getCloudConfig()` | JWT，permissions 包含 admin |
| 保存配置 | `PUT /api/v1/cloud/config` | `saveCloudConfig(config)` | 同上 |

请求字段只接受 `{downloadDir, updateMode}`，其他字段一律拒绝。响应 data 为 `{downloadDir, updateMode}`。`updateMode` 必填且仅接受 `manual`（手动）或 `auto`（自动）；旧 TOML 未设置 `update_mode` 时默认手动。状态接口同时返回 `updateMode`。连接地址及密钥在服务器配置中内置，不在管理页面编辑。写入保留现有地址和密钥，原子保存至当前 config.toml；更新执行中禁止修改目录和模式（409）。

云端根地址探测 `/health` 仍然独立显示连接状态；获取目录、基础包、版本检查、manifest 和 `/vod-updates/` 文件下载均由云端验签。点歌服务器从已绑定本机且有效的 server.lic 读取签名原文，以 `X-HVideo-Server-License` 头发送；前端不能上传自选凭据绕过本机授权。云端更新范围在签名 payload 内为可选 `cloudUpdate: {enabled: true, expiresAt: Unix秒}`，不勾选时省略；旧 v1/v2 签名继续有效但不具有云端更新权限。云端用固定公钥、服务器时间校验授权及独立云端期限，失效返回 403。云端管理员保留 JWT 下载预览权限。已下载视频不因云端到期而删除或停止点播。

### 14.2.2 已发布包更新

| 操作 | HTTP 路径 | 前端方法 | 权限 |
|---|---|---|---|
| 开始更新所有遗漏发布包 | `POST /api/v1/cloud/updates`（无请求体） | `startCloudUpdates()` | JWT，permissions 包含 admin |
更新和重试都要求 admin 与有效云端更新授权。更新接口返回 SyncTask 数组，按版本顺序执行，`targetType=vodPackage`。运行中返回 409；已安装返回空数组。同版本新文件按清单指纹重新检测。下载文件先验证大小、SHA256，再通过原生 XLSX 导入器写 song.db，增量登记播放路径。
视频直接存为 `downloadDir/文件名`，不再套更新包 ID/指纹目录；XLSX 与下载中间文件只放任务临时目录，结束自动清理。旧嵌套目录中校验一致的视频可复用并迁移；有正在点播队列引用的旧文件保留。同名不同内容的视频报错，不覆盖。仅登记本包视频，曲库、搜索、可点播索引与实际文件路径全部核验通过后显示完成。旧版已完成但仍为嵌套目录，或文件/入库索引缺失的包会重新列为待更新，点击同一更新按钮修复。

每包开始前按全部文件总大小（包含临时副本）检查磁盘，完成后至少剩余 10GiB（页面显示 10GB）。首选目录不可写或容量不足时，按可用空间降序选择可写本地磁盘，使用其根目录下 HVideoCloudUpdates，实际目录写入配置及任务 localPath。下载和复制每次写入前继续检查空间与授权到期；空间不足清理本包临时文件后自动重选一次，所有磁盘不足则明确失败，不强行写入。已完成包按任务保存的原目录核验，不因自动换盘误判未安装。容量保护覆盖本工具的文件写入，其他程序并发写盘仍可能占用保留空间。

标题云朵绿色表示已连接，红色表示未连接；文字清晰展示独立云端更新到期日期。删除旧连接状态、地址、密钥与检查时间配置块，紧凑显示更新目录与下载更新方式，统计改为一排数字；自动模式隐藏手动下载按钮，手动模式显示下载操作，选择后保存生效。继续启动自动检查和每 30 秒刷新。未授权时只在顶部显示授权提示，不在包列表重复显示。

自动下载在服务器后台运行，不依赖页面打开或管理员登录：启动时检查，设置及授权每 30 秒读取，每次自动更新尝试间隔至少 5 分钟（失败也遵循此间隔）。手动模式不自动下载；切换自动后，最迟在下一次满足间隔的检查启动。自动与手动使用同一个更新锁、签名授权、磁盘保护和下载入库流程，已完整安装的包跳过。服务停止或重启时旧调度器同时取消，避免重复调度。

桌面管理端所有目录选择统一调用 Tauri `select_directories` 原生命令，弹出 Windows 系统文件夹窗口。云端下载、媒体根目录支持选择结果；媒体根目录和歌曲扫描支持多选，多个路径用分号保存；空闲歌曲和歌星图片选择单个目录。取消选择不改变原值。浏览器访问时不弹自制目录窗口，会提示在服务器电脑的 HVideo Admin 桌面程序中选择，仍可直接填写服务器路径。

### 14.3 获取任务列表
- **路径**: `GET /api/v1/cloud/tasks`
- **认证**: 需要
- **查询参数**: `taskType`, `status`, `page`, `pageSize`
- **返回字段**: `items`, `total`, `page`, `pageSize`, `pending`, `running`, `completed`, `failed`
- **任务字段**: `id`, `taskType`, `targetType`, `targetId`, `cloudUrl`, `localPath`, `fileSize`, `downloadedSize`, `status`, `retryCount`, `errorMessage`, `createdAt`, `updatedAt`

### 14.4 触发或重试下载
- **路径**: `POST /api/v1/cloud/download/:id`
- **认证**: 需要
- **仅允许状态**: 待处理或失败；进行中、已完成任务返回 409，防止重复下载。
- **返回字段**: `taskId`, `status`
- 更新包重试要求 admin + 有效云端更新授权，并按当前发布目录重新调度所有遗漏包，避免越过先前失败的版本。旧单曲任务返回 400，不再启动兼容下载。

---

## 15. 歌曲库 (Song Database - song.db)

这些接口直接操作外部大曲库 `song.db`。

### 15.1 歌曲搜索
- **路径**: `GET /api/v1/songdb/songs`
- **认证**: 需要
- **查询参数**: `keyword`、`searchMode`、`songNoPrefix`、`languageCode`、`initial`、`primarySingerNo`、`categoryCode`、`availableOnly`、`page`、`pageSize`。字段使用上述 camelCase 名称。
- `songNoPrefix`：歌曲编号 `songNo` 的字面前缀，去除参数首尾空白，区分大小写；`%` 和 `_` 不作为通配符。省略或空白表示不限制编号。
- `songNoPrefix` 与 `keyword` / `searchMode`、语言、分类、歌星等条件取交集；编号前缀不会隐含语言分类。`keyword` 匹配歌曲编号前缀，或按 `searchMode=fullName`（默认，歌名前缀）、`searchMode=initial`（首字母前缀）匹配文本；这些前缀均将 `%`、`_` 和反斜杠作为字面字符。
- `categoryCode=1`（新歌）：原分类为 1 的歌曲，加上最近 30 天云端更新包下载入库的视频歌曲，按 `addedTime` 降序、`songNo` 升序分页。云端登记不修改歌曲原分类；只导入资料、没有本地视频的歌曲不会因此进入默认可点播新歌列表。同一更新包重试保留原入库日期。PAD 新歌列表每次进入均请求接口，不使用旧的首屏缓存。其他分类与普通搜索继续按 `clickTime` 降序、`songNo` 升序。
- `availableOnly` 默认 `true`，沿用本地可用歌曲范围；`false` 查询整个歌曲库。`page` 默认 `1`，`pageSize` 默认 `20`、最大 `100`。列表、搜索、`total` 与分页使用同一组筛选条件。
- **印尼歌曲**：列表请求 `GET /api/v1/songdb/songs?songNoPrefix=YN&page=1&pageSize=20`；搜索请求 `GET /api/v1/songdb/songs?songNoPrefix=YN&keyword=Lagu&searchMode=fullName&page=1&pageSize=20`。两者均不附加印尼语 `languageCode`。
- **成功响应**：固定为 `{ "code": 0, "message": "success", "data": { "items": [...], "total": 123, "page": 1, "pageSize": 20 } }`，`items` 为歌曲对象列表，`total` 为筛选后的歌曲总数。

### 15.2 获取/添加/更新/删除歌曲
`scoreEnabled` 由服务器根据实际本地视频的加密标记维护，1 表示评分“是”，0 表示“否”。路径扫描、云端视频入库和手工修改文件路径时同步更新；仅修改视频格式文字或导入 XLSX 的 `score_enabled` 不能启用评分。兼容 HVIDEO 和旧加密 MP4，按容器加密视频轨识别，不按后缀猜测；无文件、无法读取或非加密视频均为 0。首次升级会修正旧曲库评分字段，外接视频磁盘未连接时需连接后重新对照。
- **获取**: `GET /api/v1/songdb/songs/:id`
- **添加**: `POST /api/v1/songdb/songs`
- **更新**: `PUT /api/v1/songdb/songs/:id`
- **删除**: `DELETE /api/v1/songdb/songs/:id`
- **认证**: 需要

### 15.3 歌星搜索
- **路径**: `GET /api/v1/songdb/singers`
- **认证**: 需要
- **查询参数**: `SingerSearchQuery` (keyword, region, sex, initial, page, page_size)

### 15.4 获取/添加/更新/删除歌星
- **获取**: `GET /api/v1/songdb/singers/:id`
- **添加**: `POST /api/v1/songdb/singers`
- **更新**: `PUT /api/v1/songdb/singers/:id`
- **删除**: `DELETE /api/v1/songdb/singers/:id`
- **认证**: 需要

### 15.5 获取歌星的歌曲列表
- **路径**: `GET /api/v1/songdb/singers/:id/songs`
- **认证**: 需要

### 15.6 字典读取、维护与 XLSX 导入导出

后台入口：**字典维护**。数据独立存储于 `song.db` 的 `dicts` 表，唯一键为 `(dictGroup, dictCode)`。每个接口对应一个前端 `ApiService` 方法，无替代路径或字段别名。

| 操作 | HTTP 路径 | 前端方法 | 认证 |
| --- | --- | --- | --- |
| 读取一个分组 | `GET /api/v1/songdb/dict/:group` | `getSongDbDict(group)` | 公开，保持终端读取协议 |
| 读取全部分组 | `GET /api/v1/songdb/dicts` | `getSongDbDicts()` | JWT，`permissions` 含 `admin` |
| 新增或更新一项 | `PUT /api/v1/songdb/dict/:group` | `upsertSongDbDict(group, data)` | 同上 |
| 删除一项 | `DELETE /api/v1/songdb/dict/:group/:code` | `deleteSongDbDict(group, code)` | 同上 |
| 导出 XLSX | `GET /api/v1/songdb/dicts/export` | `exportSongDbDicts(dictGroup)` | 同上 |
| 导入 XLSX | `POST /api/v1/songdb/dicts/import` | `importSongDbDicts(file)` | 同上 |

**读取结果**：成功返回 `{ "code": 0, "message": "success", "data": [DictEntry] }`。包含隐藏项；单组按 `sortOrder, id` 排序，全部列表按 `dictGroup, sortOrder, id` 排序。无条目时为 `[]`。

```json
{
  "dictGroup": "classify",
  "dictCode": "001",
  "dictName": "流行",
  "sortOrder": 10,
  "visible": 1
}
```

JSON 与 XLSX 均只包含上述五个业务字段。内部数据库主键 `id` 保留，不再公开或导出；外部溯源字段已通过 `song_db_003_dictionary_fields` 迁移移除。常用分组为 `classify`（歌曲分类，对应歌曲 `categoryCode`）、`language`（语种）、`track`（音轨/声道）、`region`（歌手地区）、`sex`（歌手类型）、`light`、`soundEffect` 及公播配置分组。`category`、`genre`、`gender` 不是这些分组的别名。新增分组可独立维护，但要由对应业务显式接入后才会用于歌曲筛选。

**新增或更新**：路径 `:group` 决定分组，请求体仅接受以下字段。以分组和编码合并，原记录的 `id` 不变。编辑界面的分组和编码只读。

```json
{
  "dictCode": "001",
  "dictName": "华语流行",
  "sortOrder": 10,
  "visible": 1
}
```

| 字段 | 规范 |
| --- | --- |
| 路径 `group` / XLSX `dictGroup` | 1–64 位，以英文字母开头，仅字母、数字、下划线；区分大小写 |
| `dictCode` | 必填字符串，去除首尾空白后 1–128 个字符，禁止控制字符；编码按文本保存，保留前导零 |
| `dictName` | 必填字符串，去除首尾空白后 1–256 个字符，禁止控制字符 |
| `sortOrder` | 0–2147483647 的整数；JSON 省略或 `null` 时保留原值，新增默认 0 |
| `visible` | 整数 0（隐藏）或 1（显示）；JSON 省略或 `null` 时保留原值。新增戏曲相关分类及“其他”默认 0，其他项默认 1；显式填写时采用指定值 |

成功返回 `{ "code": 0, "message": "success", "data": DictEntry }`。修改 `classify`、`language`、`region`、`sex` 名称时，在同一事务内同步 `songs.categoryName/languageName`、`singers.regionName/sexName`。不改变歌曲或歌星所属编码。

**删除**：`:code` 必须作为 URL 路径段编码；成功返回 `{ "code": 0, "message": "success", "data": null }`。不存在返回 404。分类、语种在 `songs/songSearch/songSingers` 中被引用，地区、类型在 `singers` 中被引用，音轨在 `songs.track` 中被引用，或分类/灯光被 `publicSongClassify/publicSongLight` 引用时返回 409；可改为隐藏或先调整引用。

**导出**：唯一可选查询参数为 `dictGroup`。省略时导出全部分组，传入时导出该分组全部条目，包含隐藏项，不受页面关键词或显示状态筛选影响。成功响应为 XLSX 二进制，`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，`Content-Disposition: attachment` 并提供中文文件名；错误仍为 JSON。工作表名固定为 `字典数据`，列为：

```text
dictGroup, dictCode, dictName, sortOrder, visible
```

分组、编码、名称以文本单元格导出，排序和显示状态使用整数单元格，带冻结表头和筛选器。旧数据中 `sortOrder/visible` 为 `null` 时，导出使用 0/1 默认值。

**导入**：`multipart/form-data`，必须且只能上传一个名为 `file` 的文件字段，扩展名 `.xlsx`，文件非空且不超过 5 MiB。最多 10,000 条非空数据行、256 个 ZIP 文件成员，解压总量不超过 32 MiB。单工作表文件使用该表；多工作表文件必须包含 `字典数据`，只读取该表，忽略分类映射、维护说明、原始字典等其他页。

第一行必须是上述五个英文字段名，全部必填、列顺序不限，不接受额外字段或重复表头。旧表需先删除 `id`、`sourceDictId` 两列；JSON 写入同样不接受这两个字段及 `dictId`。`sortOrder/visible` 必须填写整数值，公式单元格不接受，任意单元格最长 256 个字符（其他字段还需满足各自更短的上限）。空行忽略；错误返回具体行号。

全表校验后，以 `(dictGroup, dictCode)` 在一个事务内新增或更新。重复键、非法字段或写入失败时整批不写入；文件外的条目保留。导入字典不会应用“旧分类映射”或批量调整歌曲分类。成功响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "totalCount": 142,
    "insertedCount": 24,
    "updatedCount": 38,
    "unchangedCount": 80
  }
}
```

三个分类计数之和等于 `totalCount`。字典维护期间若已有歌曲或歌星导入任务处于 `pending/running`，新增、更新、删除和导入均返回 409，读取和导出仍可使用。请求参数或文件错误返回 400；缺少/过期 JWT 返回 401，非管理员返回 403，数据库写入失败返回 500 并回滚。错误格式为 `{ "code": HTTP状态码, "message": "错误说明" }`。

### 15.7 统计信息
- **路径**: `GET /api/v1/songdb/stats`
- **认证**: 需要
- **返回**: `{ total_songs, total_singers, total_languages }`

---

## 16. 活动日志 (Activity)

### 16.1 获取最近活动
- **路径**: `GET /api/v1/activities`
- **认证**: 需要
- **查询参数**: `limit` (默认 20)
- **返回**: `Array<ActivityItem>`

---

## 17. API 客户端管理 (API Client Management)

用于管理能够调用受保护接口的客户端凭据。

### 17.1 获取所有客户端
- **路径**: `GET /api/v1/clients`
- **认证**: 需要
- **返回**: `Array<ApiClient>`

### 17.2 创建客户端
- **路径**: `POST /api/v1/clients`
- **认证**: 需要
- **请求体**: `CreateApiClientRequest`
- **返回**: `ApiClientCreatedResponse` (仅此时返回 `client_secret`)

### 17.3 更新/删除客户端
- **更新**: `PUT /api/v1/clients/:id`
- **删除**: `DELETE /api/v1/clients/:id`
- **认证**: 需要

---

## 附录：API 规范检查清单

### 已修复的问题

1. ✅ **终端注册协议收敛** - `POST /api/v1/terminals/register` 仅接受必填的 `terminalIp`、`serial`，并在服务端完成播放器握手验证
2. ✅ **API文档章节编号混乱** - 已重新整理章节编号，从1-17连续编号
3. ✅ **缺失的接口文档** - 已补充以下接口文档：
   - 房间置顶歌曲 (`POST /api/v1/rooms/:id/queue/prioritize`)
   - 声音控制 (`POST /api/v1/rooms/:id/peripheral/voice`)
   - 房务服务相关接口（服务铃、消息、控制）
   - 商品与收银完整接口
   - 服务员登录和营销广告
   - 公关服务完整接口
   - 歌曲库CRUD完整操作

### 命名规范一致性

- ✅ 终端注册请求字段与实现一对一，统一使用 `terminalIp`、`serial`
- ✅ 房间IP字段统一使用 `room_ip`
- ✅ 所有字段使用 snake_case 命名

### 认证要求

- 公开接口（无需认证）：
  - 健康检查、WebSocket
  - 房间点歌和控制相关接口
  - 媒体资源、商品、订单、公关服务
  - 系统字典、服务员登录、广告

- 受保护接口（需要JWT认证）：
  - 歌曲/歌星管理
  - 房间管理（创建/更新/删除）
  - 终端管理（包括注册和主动发现）
  - 云端同步
  - 歌曲库管理
  - API客户端管理
  - 活动日志

### 路由注册完整性

所有handler函数均已在 `src/api/mod.rs` 中正确注册路由。

### 中控配置名称修改（2026-09-17）

| 操作 | 方法与路径 | 请求体 |
| --- | --- | --- |
| 修改灯光、音效、空调预设名称 | PUT `/api/v1/admin/peripheral-presets/:id` | `{ "name": "新名称" }` |
| 修改服务名称 | PUT `/api/v1/admin/service-types/:id` | `{ "name": "新名称" }` |

两项操作均复用现有管理接口，`:id` 按 URL 路径编码。只传名称时保留原有 ID、控制参数、歌曲分类、排序、服务图标及启用状态；返回现有 `ApiResponse` 数据结构。


### 桌面管理端语言偏好（2026-09-24）

本功能只增加 Tauri IPC 命令，不增加 HTTP API；原点歌、云端、授权接口与请求字段保持不变。

| 前端调用 | Rust 命令 | 参数 | 成功结果 |
| --- | --- | --- | --- |
| `invoke('get_admin_language')` | `admin_language::get_admin_language` | 无 | `zh` / `id` / `vi` / `th` / `en` |
| `invoke('set_admin_language', {language})` | `admin_language::set_admin_language` | `language`，上述五个代码之一 | `null` |

无效语言拒绝写入，读取不存在或损坏的偏好返回 `zh`。保存于 Tauri 应用配置目录 `admin-language.txt`，避免桌面随机端口造成重启后丢失语言。浏览器保存键为 `hvideo_admin_language`。前端串行保存，启动读取不覆盖用户刚选择的语言。原生对话框的系统按钮文字遵循 Windows 系统语言。


### 服务器云端授权（2026-09-24）

原 GET `/api/v1/license/status` 与 POST `/api/v1/license/import` 增加状态字段 source（cloud/cloud_cache/local）、cloudConnected（可空 bool）、cloudCheckedAt（可空 Unix 秒）、cloudMessage。授权内容及终端准入字段不变。唯一云端查询为 POST `/api/server-license/resolve`，请求 machineCode/nonce，响应经 Ed25519 双层签名校验；详见 `docs/records/20260924_服务器云端授权.md` 的一对一接口表。


### 云端服务器 ID 自动登记（2026-09-24）
服务器启动及每 60 秒调用 `POST /api/server-license/resolve` 的 `machineCode` 字段即自动上报 ID。云端先幂等登记，再返回最新签名授权或签名 null；未授权上报不产生权限。云端后台通过 `GET /api/admin/server-registrations` 查询 `{machineCode,firstSeen,lastSeen,online}`，与授权历史合并显示待授权服务器。管理员发布后客户端下次轮询直接生效，无需文件导入。

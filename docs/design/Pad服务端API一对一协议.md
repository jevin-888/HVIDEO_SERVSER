# Pad 服务端 API 一对一协议

本文档只描述 `Fultter_pad` 与 `Hvideo_server` 之间的公开网络协议。项目未发布前不保留旧协议兼容分支；字段、路径、事件名必须一对一。

## 通用约定

- HTTP 根路径：`http://{serverIp}:9898/api/v1`
- 房间标识：统一使用 `roomId`，值为房间/终端绑定的 IP。
- 房间类 API：房间标识只放在路径 `/rooms/{roomId}/...`。
- 非路径房间参数：统一使用 camelCase `roomId`。
- WebSocket：只使用 `ws://{serverIp}:9898/ws?roomId={roomId}`。
- HTTP 响应外壳：`{ "code": 0, "message": "success", "data": ... }`。

## 点歌默认页

服务器“字典维护 → 点歌默认页”统一配置所有连接该服务器的 PAD。

- 唯一读取接口：`GET /api/v1/songdb/dict/songEntryPage`，终端公开读取；响应 `data` 为仅含一项的标准字典数组。
- 唯一保存接口：`PUT /api/v1/songdb/dict/songEntryPage`，要求管理员登录。沿用字典维护接口，不添加配置别名或其他路由。
- 字典分组固定为 `songEntryPage`；`dictCode` 与 `dictName` 一一对应：`song` / `歌名`、`singer` / `歌星`、`indonesian` / `印尼歌曲`。`visible` 固定为 `1`，`sortOrder` 固定为 `0`。
- 保存时在同一事务内替换该分组原选项，始终只有一个默认页；不能删除或隐藏。XLSX 导入遵循相同校验，同一批中此分组只能有一项。
- 初次建库或旧库升级时缺省为 `song`，已有配置保留。PAD 每次点击首页“点歌”时刷新配置，并清空上次搜索词与歌星、语种、分类筛选后进入该页；手动切换页签不会修改服务器默认值。
- 短暂读取失败时 PAD 沿用本次运行中最后成功读取的值，尚未读到时使用 `song`。配置更改在下次点击“点歌”时生效，无需重启 PAD。

```http
PUT /api/v1/songdb/dict/songEntryPage
Content-Type: application/json
Authorization: Bearer <管理员令牌>

{"dictCode":"indonesian","dictName":"印尼歌曲","visible":1,"sortOrder":0}
```

## 歌曲列表与印尼歌曲搜索

- 唯一列表和搜索接口：`GET /api/v1/songdb/songs`。
- 编号前缀字段统一为 `songNoPrefix`，按 `songNo` 的字面前缀匹配，区分大小写；参数首尾空白会去除，省略或空白表示不限制编号，`%`、`_` 不作为通配符。
- PAD 选择“印尼歌曲”时传 `songNoPrefix=YN`，不传印尼语 `languageCode`，因此其他语言分类下的 `YN` 编号歌曲也会显示。
- 选中后的首次加载、翻页、刷新、关键词搜索和搜索建议均保留 `songNoPrefix=YN`。`keyword`、`searchMode`（`fullName` / `initial`）与编号前缀取交集；切换其他入口时清除前缀。
- `availableOnly` 沿用现有语义，默认 `true`；`page`、`pageSize` 与其他筛选条件照常使用。服务端先应用全部条件，再统计总数和分页。
- YN 列表、关键词搜索和联想均按曲库 `clickTime`（点播率）降序、`songNo` 升序排序后分页，PAD 保留返回顺序；同点播率的歌曲跨页顺序固定。点播率沿用曲库导入值，不混用本店播放次数。
- 成功响应固定为 `{ "code": 0, "message": "success", "data": { "items": [...], "total": 123, "page": 1, "pageSize": 20 } }`。

## 点歌媒体文件

- 点歌可用性和媒体读取共用歌曲库 `local_available_songs.absolutePath`；已扫描歌曲位于 `media_root` 之外时，仍可通过服务端下发的 `playingNow.songPath` 播放。
- 对照请求 `POST /api/v1/songdb/scan/start` 固定字段为 `directory`（字符串，分号分隔多个硬盘/目录）、`deleteDuplicates`（布尔，默认 false）、`incremental`（布尔，默认 false）。`GET /api/v1/songdb/scan/result/{task_id}` 的任务数据同样返回 `incremental`，仅此一个增量字段，不使用别名。启动响应仍为 `data.taskId`。
- 默认全量对照（`incremental=false`）：所有可扫描目录对照成功后，在同一事务中替换歌曲路径索引。未选目录的旧对照结果随成功对照一起移除。
- 增量对照（`incremental=true`）：在同一事务中仅新增/更新本次成功匹配编号的路径、格式与可用状态，保留其他歌曲在 songs、songFiles、songSearch、songSingers、local_available_songs 中的记录；空扫描或零匹配不清空旧索引，不清理失效旧路径。此功能仍扫描所选目录全部候选文件，不是基于时间戳的文件监视。两种模式均从本次目录计算相对路径，不读取管理库的 `media_root`。
- 对照写入评分按最终选中文件后缀判断：`.hvideo`（不区分大小写）写入 `scoreEnabled=1`，其他格式写入 `0`，不打开视频读取内容。云端视频登记复用此写入逻辑。写入进度使用既有 `currentDirectory` 与 `percentage` 字段显示已处理/总数及提交阶段，不增加 API 字段。
- 对照递归扫描遇到 `PermissionDenied` 的子目录或目录项时记录服务端警告并跳过，继续扫描同级和后续目录；其他读取错误仍返回失败，不用不完整结果替换索引。指定的根目录本身拒绝访问时跳过该根目录，其他根目录继续；所有根目录均不可访问时任务失败。
- 同编号文件的取舍：两种模式均对本次扫描候选按 `.hvideo`（加密）→ `.mkv` → `.mp4` → 其他受支持格式排序，后缀不区分大小写，同级按完整路径排序；原保存路径不覆盖此优先级。未扫描的旧文件不参与比较或删除，因此增量扫描同编号新文件时也可能替换旧路径。重叠目录重复扫描到的同一路径不算待删除副本。格式与路径按最终选中文件同步；仅勾选删除重复且数据库事务提交成功后才删除本次候选中的其余副本。
- 媒体接口 `GET /media/{path}` 对解码后的 Windows 绝对视频路径进行精确索引匹配，只提供该已扫描文件；不会开放同目录其他未扫描文件。`media_root` 继续用于空闲媒体、相对路径和目录浏览。
- 播放器原样使用 `songPath`，正常读取返回 `200`，字节范围请求返回 `206`。路径只解码一次，不允许目录穿越；索引中不存在且不在媒体根目录内的文件返回 `404`。
- 入队成功或收到房态推送只表示点播已受理；联调成功还必须验证媒体读取成功、播放器打开对应文件且播放进度持续增加。

## 房间状态与推送

### 空闲媒体配置更新

`PUT /api/v1/system/settings/idle_song_path` 或 `PUT /api/v1/system/settings/media_root` 保存成功后，服务端清除空闲媒体索引缓存，并向所有在线客户端发送现有资源更新通知：

```json
{"type":"roomStateChanged","path":"/api/v1/idle-media/scan","timestamp":1788760000000}
```

- `path` 固定为 `/api/v1/idle-media/scan`，这是列表刷新通知，不带 `data`，不代表播放或切歌命令。
- 客户端立即通过 `GET /api/v1/idle-media/scan` 获取已保存目录的完整列表并替换缓存；并发收到新通知时，当前请求结束后必须再拉取一次。
- 服务端随后向没有 active 点播歌曲的房间推送完整 `roomStateChanged.data`，携带新空闲媒体地址并保留播放/暂停状态；正在点播的房间仅更新空闲列表。
- 每次成功 `join_room` 后，服务端向该连接补发列表刷新通知和当前完整房态，补齐离线期间的配置变更。
- 保存校验失败及修改无关设置不发送通知；重新保存相同目录仍刷新索引，用于同步目录内文件变化。

服务端状态权威事件：

```json
{
  "type": "roomStateChanged",
  "roomId": "172.27.112.152",
  "data": {
    "roomId": "172.27.112.152",
    "roomName": "A01",
    "status": 1,
    "currentSongId": "10001",
    "currentSongTitle": "Song",
    "playState": 1,
    "volume": 50,
    "musicVolume": 50,
    "micVolume": 50,
    "micStatus": 1,
    "mute": false,
    "playingNow": {
      "queueItemId": "queue-row-uuid",
      "songId": "10001",
      "songName": "Song",
      "songPath": "/media/song.mp4"
    },
    "ac": {},
    "light": {},
    "effect": {}
  }
}
```

`playState` 表示播放动作状态：`1` 播放中，`2` 暂停，`0` 停止。空闲媒体也可以播放或暂停，不能用 `playState` 判断是否在播放点播歌曲。Pad 按钮显示下一步动作。

- `playingNow` 是当前播放身份的唯一来源。点播时必须携带 `queueItemId`；空闲时 `songId` 固定为 `IDLE`，不携带 `queueItemId`，`songName` 为“空闲播放”（未配置媒体时为“暂无空闲歌曲”）。
- 顶层 `currentSongId`、`currentSongTitle` 是同一份 `playingNow.songId`、`playingNow.songName` 的摘要，禁止从过期房间记录拼入上一首歌曲。PAD 不读取摘要作为播放状态的回退来源，不按标题包含“空闲”判断状态。
- 搜索、派对、已选页面共用同一个房态和歌曲状态映射。只有与 `playingNow.songId` 匹配的点播歌曲显示“当前”；队首位置、入队成功和历史队列均不能代表正在播放。
- HTTP 首次同步、断线恢复和 `roomStateChanged` 使用同一状态处理逻辑。空闲状态立即清除旧点播显示和本地已选队列，随后以完整队列接口校准；已发起的旧 HTTP 请求不得覆盖更新的房态推送。
### 播放器完成当前正式歌曲

播放器自然播放完成正式歌曲时，只允许调用：

```http
POST /api/v1/rooms/{roomId}/skip
Content-Type: application/json

{"queueItemId":"queue-row-uuid"}
```

- `queueItemId` 必须取自同一条 `roomStateChanged.data.playingNow.queueItemId`，并绑定到实际已打开的媒体。
- 服务端只完成仍为 active（`status = 1`）且 ID 完全匹配的队列记录，然后在同一事务中激活下一首并更新房态。
- 延迟、重复或旧播放器 EOF 返回 `data.advanced = false`，不得推进当前新歌，也不得广播伪状态。
- 成功完成返回 `data.advanced = true`。空闲歌曲不包含 `queueItemId`，播放器不得调用该接口。
- 用户手动切歌使用 `POST /rooms/{roomId}/next`；播放器 EOF 与手动切歌不得混用。


## roomName 与设备名称关联

- 房间状态事件和 `GET /rooms/{roomId}/state` 中只有 `data.roomName` 表示房间显示名称。
- `roomId` 只用于路由和房间绑定，不得作为设备名、蓝牙名、产品名或 hostname。
- 服务端修改房间名称后，必须通过现有 `roomStateChanged` 事件发送新的 `data.roomName`；不增加第二个重命名事件。
- Engine 只读取 `roomName`，不接受 `name`、IP、terminalId 或 UUID 作为兼容别名。
- 空名称、控制字符或超过 63 UTF-8 字节的名称不会应用到设备。
- 中文 `roomName` 原样用于设备名和蓝牙名；网络 hostname 由 Engine 确定性转换为合法 ASCII。


## PAD 点单开关

- `GET /pad-ordering/status`
- 无请求参数、无需登录。
- 响应 `data` 固定为 `{ "enabled": false }` 或 `{ "enabled": true }`。
- `enabled` 为 `false` 时，PAD 必须隐藏或禁用商品点单入口；请求失败时也按未启用处理。
- 收银管理端通过 `PUT /admin/pad-ordering/status` 修改，body 固定为 `{ "enabled": true }` 或 `{ "enabled": false }`。

## Pad 使用的 HTTP 接口

- `GET /rooms/{roomId}/state`
- `GET /rooms/{roomId}/queue`
- `GET /rooms/{roomId}/queue/played`
- `POST /rooms/{roomId}/queue` body: `{ "songNo": "10001", "isPriority": false }`
- `POST /rooms/{roomId}/queue/prioritize` body: `{ "songNo": "10001" }`
- `DELETE /rooms/{roomId}/queue/{songNo}`
- `POST /rooms/{roomId}/next`
- `POST /rooms/{roomId}/queue/shuffle`
- `POST /rooms/{roomId}/clear`
- `POST /rooms/{roomId}/play`
- `POST /rooms/{roomId}/pause`
- `POST /rooms/{roomId}/replay`
- `POST /rooms/{roomId}/track` body: `{ "trackId": 1 }`
- `POST /rooms/{roomId}/command` body: `{ "action": "Mute" }` 或 `{ "action": "Unmute" }`
- `POST /rooms/{roomId}/peripheral/voice` body: `{ "volume": 50, "micVolume": 50 }`
- `POST /rooms/{roomId}/peripheral/light` body: `{ "scene": "auto" }`
- `POST /rooms/{roomId}/peripheral/ac` body: `{ "power": true, "temp": 26, "mode": "auto", "wind": "low" }`
- `POST /rooms/{roomId}/peripheral/effect` body: `{ "mode": "standard" }`
- `POST /rooms/{roomId}/peripheral/call` body: `{ "callType": "water", "callNote": "" }`
- `GET /materials`
- `GET /materials/categories`
- `POST /rooms/{roomId}/materials/play` body: `{ "mediaId": "m1", "mediaType": "material" }`
- `GET /peripheral/presets?type=light`
- `GET /youtube/search?q={keyword}`
- `GET /youtube/hot`
- `GET /youtube/parse?videoId={videoId}`（只解析，不加入队列）
- `POST /rooms/{roomId}/youtube/queue` body: `{ "videoId": "abcdefghijk", "title": "Song", "channel": "Singer", "isPriority": false }`
- `GET /youtube/stream?videoId={videoId}`（支持 Range，供终端读取媒体）
- `GET /orders/items?roomId={roomId}`
- `POST /orders` body: `{ "roomId": "172.27.112.152", "items": [{ "productId": "p01", "quantity": 1 }] }`

## YouTube 搜索、点歌与同步

- `search` 与 `hot` 的 `data` 都是视频数组，字段固定为 `id`、`title`、`thumbnail`、`duration`、`channel`。搜索最多 15 条；热门最多 12 条有效单曲伴奏，数量以实际结果为准。
- 搜索统一通过服务端复用的 HTTP 客户端访问 YouTube；热门和搜索共享五分钟缓存，相同查询的并发请求合并。只有媒体解析使用 yt-dlp，Windows 子进程必须无窗口启动，超时后结束进程。
- `queue` 持久化歌曲和稳定媒体路径、完成队列状态同步后立即返回 `RoomQueueItem`，与 `GET /rooms/{roomId}/queue` 中的单项结构一致。客户端使用 `songNo`，不得用 `songId` 作为兼容别名；YouTube 编号固定为 `youtube:{videoId}`。`songName`、`singerNames` 使用服务端返回值；`position` 为队列顺序，`status` 为 `0` 等待、`1` 正在播放、`2` 已播放、`3` 已跳过；入队确认仅允许 `0` 或 `1`。
- PAD 点击立即显示“正在加入播放列表”，正常成功时提示至少保留两秒。确认成功后立即更新唯一共享队列和已选数量，不等待提示结束；随后拉取完整队列校准。
- `roomStateChanged` 外层及 `data.roomId` 必须都是绑定终端 IP，禁止回退到内部 UUID。收到 `playListChanged`、当前歌曲变化，以及 WebSocket 连接恢复时立即获取队列。
- 空队列响应必须将所有页面的已选数量归零；网络或格式错误必须保留最近确认的队列。禁止页面独立维护已加入集合、用历史数量替换零，或在完整队列同步后自行补回歌曲。
- 搜索结果仅包含展示信息，不包含已解析的媒体地址。`videoId` 必须是 11 位 YouTube 视频 ID；`parse`、`queue`、`stream` 不接收视频网页 URL 作为替代参数。
- `queue` 不等待媒体解析或下载。服务端以 `youtube:{videoId}` 保存歌曲编号，以 `/api/v1/youtube/stream?videoId={videoId}` 保存媒体路径；后台准备已点播媒体。
- 媒体地址按视频 ID 合并解析，最多缓存 128 项、最长一小时，并在上游地址到期前五分钟失效。上游返回 403 时只刷新一次，首次连接中断允许一次重试。播放与缓存共用断点续传实现，最多恢复八次，校验响应区间，拒绝把断流文件当成完整缓存。
- 已点播的完整 MP4 保存在运行目录 `data/cache/youtube`，单文件上限 128 MiB，完整文件总预算 512 MiB，按文件修改时间清理超过七天或超出预算的旧文件；最多两路后台下载，每路最多三分钟。在途文件不计入完整文件预算，失败不发布为可播放缓存，超过一小时的残留临时文件在缓存维护时清理。
- 完整文件跨重启复用，支持 Range/HEAD；首次未缓存的歌曲仍需要上游解析及首包时间，搜索成功和入队成功均不承诺上游媒体一定可播。
- 终端通过服务端 `youtube/stream` 读取含视频及音频的 MP4。队列已接收和媒体已实际播放是两种不同事实，播放验收必须检查终端媒体进度。

## 禁止兼容字段

Pad 与服务端之间不得再使用以下公开协议字段或事件：

- `room_id`
- `room_code`
- `purchase_goods`
- `goods_id`
- `point_num`
- `video_id`
- `media_id`
- `media_type`
- `call_type`
- `call_note`
- `preset_type`
- `sort_order`
- `room_update`
- `getMusBarState`
- `getMusBarStateResponse`
- `RoomStatusChanged`
- `UnMute`

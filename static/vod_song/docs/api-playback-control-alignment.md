# 播放控制接口协议对齐说明

## 接口路径

| 功能 | 前端方法 | HTTP | 路径 | 请求体 |
|------|----------|------|------|--------|
| 点歌 | `selectSong` / `requestSong` | POST | `/api/v1/rooms/:id/queue` | `{ "songNo": "xxx" }` |
| 优先点歌 | `selectSong` / `requestSong` | POST | `/api/v1/rooms/:id/queue` | `{ "songNo": "xxx", "isPriority": true }` |
| 获取已选 | `getPlayList` | GET | `/api/v1/rooms/:id/queue` | 无 |
| 获取已唱 | `getPlayedList` | GET | `/api/v1/rooms/:id/queue/played` | 无 |
| 置顶 | `upWord` | POST | `/api/v1/rooms/:id/queue/prioritize` | `{ "songNo": "xxx" }` |
| 删除 | `delete` | DELETE | `/api/v1/rooms/:id/queue/:songNo` | 无 |
| 切歌 | `playNext` | POST | `/api/v1/rooms/:id/next` | 无 |
| 打乱 | `shufflePlayList` | POST | `/api/v1/rooms/:id/queue/shuffle` | 无 |
| 清空 | `clearPlayList` | POST | `/api/v1/rooms/:id/clear` | 无 |

房间 ID 由 `ApiService.roomId` 填充到路径 `:id`。这些接口与 `D:\Hvideo\Fultter_pad` 的 `RoomServiceProvider` 保持一致，不再通过字段映射或 REST 额外参数兼容历史协议。

## 响应与同步

- 已选列表使用 `GET /rooms/:id/queue` 的返回值作为权威数据。
- 已唱列表使用 `GET /rooms/:id/queue/played`。
- 播放列表响应通过 `normalizePlayList` 归一为前端使用的 `songNo`、`songName`、`singerName` 等字段。
- WebSocket 的 `playlistUpdate` / `getPlayList` 事件只作为变更通知，收到后主动拉取 HTTP 队列。

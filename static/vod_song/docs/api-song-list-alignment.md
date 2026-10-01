# 歌曲列表接口对齐说明

## 接口路径

- 歌曲列表：`GET /api/v1/songdb/songs`
- 歌手列表：`GET /api/v1/songdb/singers`
- 预热：`GET /api/v1/songdb/warmup`

这些接口与 `D:\Hvideo\Fultter_pad` 使用的协议一致，前端直接发送后台字段，不再做旧字段映射。

## 歌曲列表 Query 参数

| 参数 | 说明 |
|------|------|
| `page` | 页码，从 1 开始 |
| `pageSize` | 每页条数 |
| `keyword` | 搜索关键词 |
| `searchMode` | 搜索模式 |
| `initial` | 首字母/数字索引 |
| `languageCode` | 语种编码 |
| `primarySingerNo` | 主歌手编号 |
| `categoryCode` | 分类编码 |
| `isHot` | 热门歌曲标记 |

## 歌手列表 Query 参数

| 参数 | 说明 |
|------|------|
| `page` | 页码，从 1 开始 |
| `pageSize` | 每页条数 |
| `keyword` | 搜索关键词 |
| `initial` | 首字母索引 |
| `regionCode` | 地区编码 |
| `sexCode` | 性别编码 |

## 响应体

前端按标准响应解析：

| 响应结构 | 说明 |
|----------|------|
| `{ code, message, data: [] }` | 简化数组 |
| `{ code, message, data: { data: [], total } }` | 分页结构 |
| `{ code, message, data: { records: [], total } }` | 记录列表结构 |

歌曲对象使用 `songNo`、`songName`、`singerNames`、`primarySingerNo`、`languageCode`、`categoryCode` 等后台字段。

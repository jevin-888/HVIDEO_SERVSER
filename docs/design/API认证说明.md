# HVideo API 统一认证说明

## 认证策略

系统采用分层认证策略：
- **终端/客户端接口**：无需认证，供KTV点歌客户端、触摸屏、手机端直接访问
- **管理端接口**：需要JWT Token认证，仅供管理后台使用

## 终端公开接口（无需认证）

以下接口无需认证，供KTV终端、点歌客户端、手机端直接访问：

### 基础接口
1. `GET /health` - 健康检查
2. `POST /api/v1/auth/login` - 管理员登录获取Token
3. `POST /api/v1/auth/waiter/login` - 服务员登录
4. `GET /ws/:terminal_id` - WebSocket连接
5. `GET /ws` - WebSocket默认连接
6. `GET /ws/scan/:task_id` - 扫描进度WebSocket

### 系统信息
- `GET /api/v1/system/dicts` - 获取系统字典

### 歌曲/歌星查询
- `GET /api/v1/songs` - 歌曲列表
- `GET /api/v1/songs/:id` - 歌曲详情
- `GET /api/v1/artists` - 歌星列表
- `GET /api/v1/artists/:id` - 歌星详情
- `GET /api/v1/artists/:id/image` - 歌星图片

### 房间查询
- `GET /api/v1/rooms/by-terminal` - 按终端查询房间
- `GET /api/v1/rooms/:id/state` - 房间状态
- `GET /api/v1/rooms/:id/config` - 房间配置
- `POST /api/v1/rooms/:id/config` - 设置房间配置
- `GET /api/v1/rooms/:id/settings` - 房间设置

### 点歌队列管理
- `GET /api/v1/rooms/:id/queue` - 获取队列
- `POST /api/v1/rooms/:id/queue` - 点歌
- `DELETE /api/v1/rooms/:id/queue/:song_id` - 删除歌曲
- `POST /api/v1/rooms/:id/queue/prioritize` - 置顶歌曲
- `POST /api/v1/rooms/:id/queue/shuffle` - 打乱队列
- `POST /api/v1/rooms/:id/next` - 下一首
- `POST /api/v1/rooms/:id/clear` - 清空队列

### 播放控制
- `POST /api/v1/rooms/:id/command` - 发送控制指令
- `POST /api/v1/rooms/:id/play` - 播放
- `POST /api/v1/rooms/:id/pause` - 暂停
- `POST /api/v1/rooms/:id/replay` - 重播
- `POST /api/v1/rooms/:id/skip` - 播放器完成当前正式歌曲；JSON body 固定为 `{ "queueItemId": "..." }`；旧/重复 ID 返回 `advanced=false`
- `POST /api/v1/rooms/:id/volume` - 设置音量
- `POST /api/v1/rooms/:id/mic` - 麦克风控制
- `POST /api/v1/rooms/:id/track` - 原唱/伴唱切换

### 外设控制
- `POST /api/v1/rooms/:id/peripheral/ac` - 空调控制
- `POST /api/v1/rooms/:id/peripheral/light` - 灯光控制
- `POST /api/v1/rooms/:id/peripheral/sample` - 中控示例
- `POST /api/v1/rooms/:id/peripheral/effect` - 音效控制
- `POST /api/v1/rooms/:id/peripheral/ambiance` - 氛围音效
- `POST /api/v1/rooms/:id/peripheral/call` - 服务呼叫
- `POST /api/v1/rooms/:id/peripheral/voice` - 声音控制
- `POST /api/v1/rooms/:id/peripheral/button` - 按钮控制

### 房务服务
- `POST /api/v1/rooms/:id/service/bell` - 服务铃
- `POST /api/v1/rooms/:id/service/response` - 响应服务
- `POST /api/v1/rooms/:id/service/cancel` - 取消服务
- `POST /api/v1/rooms/:id/message` - 发送消息
- `POST /api/v1/rooms/:id/control` - 房间控制

### 媒体资源
- `GET /api/v1/materials` - 素材列表
- `GET /api/v1/materials/categories` - 素材分类
- `GET /api/v1/streams` - 流媒体列表
- `POST /api/v1/rooms/:id/materials/play` - 播放素材
- `POST /api/v1/rooms/:id/streams/play` - 播放流媒体
- `POST /api/v1/rooms/:id/streams/stop` - 停止流媒体

### 导航配置
- `GET /api/v1/navigation/smartl/status` - 智能控制状态
- `GET /api/v1/navigation/smartl` - 智能控制配置
- `GET /api/v1/navigation/bottom/current` - 当前底部导航
- `GET /api/v1/navigation/bottom` - 底部导航配置
- `GET /api/v1/display/layout` - 显示布局
- `GET /api/v1/display/status` - 显示状态

### 商品与订单
- `GET /api/v1/products` - 商品列表
- `GET /api/v1/products/categories` - 商品分类
- `GET /api/v1/products/categories/free` - 免费分类
- `GET /api/v1/products/combos` - 套餐列表
- `GET /api/v1/products/combos/:id/items` - 套餐明细
- `GET /api/v1/products/tastes` - 口味列表
- `POST /api/v1/orders` - 创建订单
- `GET /api/v1/orders/bill` - 账单概要
- `GET /api/v1/orders/:id/detail` - 订单详情
- `GET /api/v1/orders/qrcode` - 点单二维码

### 营销与公关
- `GET /api/v1/marketing/ads` - 广告列表
- `GET /api/v1/pr/staff` - 公关人员
- `GET /api/v1/pr/groups` - 公关分组
- `GET /api/v1/pr/groups/stats` - 分组统计
- `GET /api/v1/pr/records` - 公关记录
- `GET /api/v1/pr/flowers` - 打赏礼物
- `POST /api/v1/pr/service` - 公关服务
- `POST /api/v1/pr/orders` - 公关订单

### 歌曲库查询
- `GET /api/v1/songdb/songs` - 歌曲搜索
- `GET /api/v1/songdb/songs/:id` - 歌曲详情
- `GET /api/v1/songdb/singers` - 歌星搜索
- `GET /api/v1/songdb/singers/:id` - 歌星详情
- `GET /api/v1/songdb/singers/:id/songs` - 歌星的歌曲
- `POST /api/v1/songdb/singers/:id/image` - 上传歌星图片
- `GET /api/v1/songdb/dict/:group` - 字典信息
- `GET /api/v1/songdb/stats` - 统计信息

### 服务类型
- `GET /api/v1/service-types` - 服务类型列表

## 管理端接口（需要认证）

以下接口需要JWT Token认证，仅供管理后台使用：

### 系统管理
- `GET /api/v1/system/status` - 系统状态
- `GET /api/v1/system/server-info` - 服务器信息

### 歌曲/歌星管理
- `POST /api/v1/songs` - 创建歌曲
- `PUT /api/v1/songs/:id` - 更新歌曲
- `DELETE /api/v1/songs/:id` - 删除歌曲
- `POST /api/v1/artists` - 创建歌星
- `PUT /api/v1/artists/:id` - 更新歌星
- `DELETE /api/v1/artists/:id` - 删除歌星

### 房间管理
- `GET /api/v1/rooms` - 房间列表
- `POST /api/v1/rooms` - 创建房间
- `GET /api/v1/rooms/:id` - 房间详情
- `PUT /api/v1/rooms/:id` - 更新房间
- `DELETE /api/v1/rooms/:id` - 删除房间
- `GET /api/v1/rooms/configs/types` - 房间类型
- `POST /api/v1/rooms/configs/types` - 创建类型
- `DELETE /api/v1/rooms/configs/types/:id` - 删除类型
- `GET /api/v1/rooms/configs/areas` - 房间区域
- `POST /api/v1/rooms/configs/areas` - 创建区域
- `DELETE /api/v1/rooms/configs/areas/:id` - 删除区域

### 导航管理
- `PUT /api/v1/navigation/bottom/:id` - 更新底部导航
- `POST /api/v1/display/layout` - 设置显示布局
- `PUT /api/v1/display/status` - 更新显示状态

### 终端管理
- `GET /api/v1/terminals` - 终端列表
- `POST /api/v1/terminals/register` - 指定 IP 验证并注册 HSVJ 播放器
- `POST /api/v1/terminals/discover` - challenge-response 扫描并注册 HSVJ 播放器
- `GET /api/v1/terminals/:id` - 终端详情
- `PUT /api/v1/terminals/:id` - 更新终端
- `DELETE /api/v1/terminals/:id` - 删除终端
- `GET /api/v1/terminals/:id/rooms` - 终端房间

### 云端同步
- `GET /api/v1/cloud/status` - 自动读取连接和更新包状态
- `GET/PUT /api/v1/cloud/config` - 管理员读取/保存云端配置
- `POST /api/v1/cloud/updates` - 管理员执行已发布包更新
- `POST /api/v1/cloud/import` - 批量导入
- `GET /api/v1/cloud/tasks` - 任务列表
- `POST /api/v1/cloud/download/:id` - 触发下载
- `vodPackage` 更新包任务重试要求管理员权限

### API客户端管理
- `GET /api/v1/clients` - 客户端列表
- `POST /api/v1/clients` - 创建客户端
- `PUT /api/v1/clients/:id` - 更新客户端
- `DELETE /api/v1/clients/:id` - 删除客户端

### 歌曲库管理
- `POST /api/v1/songdb/songs` - 创建歌曲
- `PUT /api/v1/songdb/songs/:id` - 更新歌曲
- `DELETE /api/v1/songdb/songs/:id` - 删除歌曲
- `POST /api/v1/songdb/singers` - 创建歌星
- `PUT /api/v1/songdb/singers/:id` - 更新歌星
- `DELETE /api/v1/songdb/singers/:id` - 删除歌星

### 字典维护（JWT 的 permissions 必须包含 admin）

- `GET /api/v1/songdb/dicts` - 全部分组及隐藏项
- `PUT /api/v1/songdb/dict/:group` - 新增或更新字典项
- `DELETE /api/v1/songdb/dict/:group/:code` - 删除未被引用的字典项
- `GET /api/v1/songdb/dicts/export` - 导出全部或指定分组 XLSX
- `POST /api/v1/songdb/dicts/import` - 上传一个 file 字段，按分组和编码合并 XLSX

终端使用的 `GET /api/v1/songdb/dict/:group` 和 `GET /api/v1/system/dicts` 保持公开。维护接口非管理员返回 403；字段和文件格式见 [API接口文档 15.6](API接口文档.md#156-字典读取维护与-xlsx-导入导出)。

### 歌曲路径扫描
- `GET /api/v1/songdb/scan/fs` - 文件系统列表
- `POST /api/v1/songdb/scan/start` - 开始扫描
- `GET /api/v1/songdb/scan/progress/:task_id` - 扫描进度
- `GET /api/v1/songdb/scan/result/:task_id` - 扫描结果
- `POST /api/v1/songdb/scan/cancel/:task_id` - 取消扫描

### 活动日志
- `GET /api/v1/activities` - 活动列表

### 中控配置
- `GET /api/v1/admin/peripherals` - 外设状态列表
- `POST /api/v1/admin/peripherals/batch/light` - 批量设置灯光
- `POST /api/v1/admin/peripherals/batch/ac` - 批量设置空调
- `GET /api/v1/admin/peripherals/:room_id` - 房间外设状态
- `PUT /api/v1/admin/peripherals/:room_id/light` - 设置房间灯光
- `PUT /api/v1/admin/peripherals/:room_id/ac` - 设置房间空调
- `PUT /api/v1/admin/peripherals/:room_id/effect` - 设置房间音效
- `GET /api/v1/admin/peripheral-presets` - 预设列表
- `POST /api/v1/admin/peripheral-presets` - 创建预设
- `PUT /api/v1/admin/peripheral-presets/:id` - 更新预设
- `DELETE /api/v1/admin/peripheral-presets/:id` - 删除预设

### 服务铃管理
- `GET /api/v1/admin/service-calls` - 服务呼叫列表
- `PUT /api/v1/admin/service-calls/:id/complete` - 完成服务

### 服务类型管理
- `GET /api/v1/admin/service-types` - 服务类型列表
- `POST /api/v1/admin/service-types` - 创建服务类型
- `PUT /api/v1/admin/service-types/:id` - 更新服务类型
- `DELETE /api/v1/admin/service-types/:id` - 删除服务类型

## 认证方式

在HTTP请求头中添加Authorization字段：

```
Authorization: Bearer <your_jwt_token>
```

## 获取Token

### 管理员登录
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "client_key": "your_client_key",
  "client_secret": "your_client_secret"
}
```

### 服务员登录
```http
POST /api/v1/auth/waiter/login
Content-Type: application/json

{
  "username": "waiter_username",
  "password": "waiter_password"
}
```

### 响应示例
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expire_at": "2024-01-01T12:00:00Z"
  }
}
```

## 认证失败响应

### 缺少Token
```json
{
  "code": 401,
  "message": "缺少认证Token"
}
```

### Token无效或过期
```json
{
  "code": 401,
  "message": "Token无效或已过期"
}
```

## 使用示例

### 终端/客户端接口（无需认证）

```bash
# 直接调用，无需Token
curl -X GET http://localhost:8080/api/v1/songs

# 点歌
curl -X POST http://localhost:8080/api/v1/rooms/room-001/queue \
  -H "Content-Type: application/json" \
  -d '{"song_id":"song-123"}'

# 播放控制
curl -X POST http://localhost:8080/api/v1/rooms/room-001/play

# 设置音量
curl -X POST http://localhost:8080/api/v1/rooms/room-001/volume \
  -H "Content-Type: application/json" \
  -d '{"volume":50}'
```

### 管理端接口（需要认证）

```bash
# 1. 先登录获取Token
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"client_key":"admin","client_secret":"secret"}'

# 2. 使用Token调用管理API
curl -X GET http://localhost:8080/api/v1/rooms \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# 3. 创建房间
curl -X POST http://localhost:8080/api/v1/rooms \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"name":"VIP-001","room_type":"vip"}'
```

## 注意事项

1. **KTV终端/客户端**：所有业务接口无需认证，可直接调用
2. **管理后台**：需要先登录获取Token，然后在请求头中携带Token
3. Token有过期时间，过期后需要重新登录获取新Token
4. Token应妥善保管，不要泄露给未授权用户
5. 建议在生产环境使用HTTPS协议传输Token
6. WebSocket连接建立后不需要在每个消息中携带Token
7. 终端注册和心跳接口保持公开，便于设备自动接入

## 前端实现建议

### KTV客户端（mobile/client）
- 无需实现登录功能
- 无需存储和管理Token
- 直接调用所有业务API即可

### 管理后台
- 需要实现登录页面
- 登录成功后存储Token到localStorage
- 在所有管理API请求中携带Token
- 实现Token过期自动刷新或重新登录

# HSVJ 播放器 UDP 发现协议（v2）

## 目标

终端列表只允许加入已安装 HSVJ 播放器、并通过播放器身份协议验证的设备。普通 Windows 主机、HVideo Server 实例或仅开放某个 TCP 端口的设备均不能注册为终端。

## 唯一管理 API

### 主动发现

```http
POST /api/v1/terminals/discover
Authorization: Bearer <JWT>
```

服务端向局域网广播播放器发现查询，验证响应后自动注册终端并创建对应房间。

### 指定 IP 添加

```http
POST /api/v1/terminals/register
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "terminalIp": "192.168.1.100",
  "serial": "PLAYER-SERIAL"
}
```

服务端会向该 IP 单播 challenge-response 查询，并核对填写的序列号与播放器返回值。序列号必填；名称、MAC、型号和业务端口采用播放器返回值。

已删除的旧接口：

- `/api/v1/terminals/scan`：不得再用 TCP 开放端口猜测终端身份。
- `/api/v1/terminals/heartbeat`：不得用公开 HTTP 请求伪造在线心跳。

## UDP 协议

默认端口为 `18080/UDP`，协议版本固定为 `2.0`。

### 查询包（HVideo Server → HSVJ Player）

查询必须严格包含以下四个字段：

```json
{
  "type": "discover",
  "query": "hvideo_player",
  "protocol_version": "2.0",
  "challenge": "8df6339c-9cd9-46ec-a975-80d66ca6130a"
}
```

约束：

- `challenge` 由发起方为每次扫描随机生成。
- `challenge` 不能为空，最大长度 128 字节。
- 播放器只响应字段和值都符合本协议的查询。

### 主动查询响应（HSVJ Player → HVideo Server）

```json
{
  "type": "hvideo",
  "protocol": "discover",
  "protocol_version": "2.0",
  "device_role": "player",
  "app_id": "com.hsvj.engine",
  "challenge": "8df6339c-9cd9-46ec-a975-80d66ca6130a",
  "version": "1.0",
  "ip": "192.168.1.100",
  "device_name": "HSVJ-Player",
  "mac": "00:11:22:33:44:55",
  "serial": "PLAYER-SERIAL",
  "model": "H6_POR",
  "network": {"networkType":"ethernet","interfaceName":"eth0","macAddress":"00:11:22:33:44:55"},
  "ports": {
    "http": 8080,
    "mobile": 8081,
    "vod": 9898,
    "ws": 9898,
    "tcp": 9000,
    "udp": 8000,
    "sync": 4322
  }
}
```

服务端只有在以下条件全部满足时才接受响应：

1. `type` 精确等于 `hvideo`。
2. `protocol` 精确等于 `discover`。
3. `protocol_version` 精确等于 `2.0`。
4. `device_role` 精确等于 `player`。
5. `app_id` 精确等于 `com.hsvj.engine`。
6. `challenge` 与本次查询完全一致。
7. `ports.http` 大于 `0`。
8. UDP 数据包源 IP 与指定 IP 验证目标一致；注册时以数据包源 IP 为准，不信任响应 JSON 中自报的 `ip`。

9. 必须提供有效 `serial`、设备有线 MAC 和支持的 H6 型号。新版上报明确 `network`，旧版 v2 省略时保留为未分类连接。

### 播放器 Beacon（HSVJ Player → HVideo Server）

播放器周期 Beacon 使用与响应相同的身份字段，但不包含 `challenge`。服务端只把同时具有 `protocol_version=2.0`、`device_role=player`、`app_id=com.hsvj.engine` 的 Beacon 作为已安装播放器的在线心跳并注册/更新终端。

HVideo Server 不再广播设备 Beacon，也不响应播放器发现查询，因此多个服务端实例不会互相注册成终端。

## 工作流程

```text
管理端点击扫描
  → POST /api/v1/terminals/discover（JWT）
  → 服务端生成随机 challenge 并广播严格查询
  → HSVJ Player 校验查询并原样回传 challenge
  → 服务端校验来源 IP、播放器身份和 challenge
  → 统一调用 register_verified_player
  → 注册/更新终端并自动创建房间
```

定时扫描使用同一套发现协议，不再执行子网 TCP 端口扫描。

## 兼容性

v2 服务端不会接受旧版 v1 Beacon 或旧查询响应。已部署播放器必须升级到包含 v2 发现协议的版本，否则不会被新服务端发现或更新在线心跳。

## 测试要点

1. 启动服务端后，普通 Windows/HVideo Server 主机不应出现在终端列表。
2. 发送缺少 `device_role`、`app_id` 或 `protocol_version` 的旧 Beacon，不应注册。
3. 发送 challenge 不匹配的响应，不应注册。
4. 安装新版 HSVJ Player 的设备应能通过“扫描终端”和指定 IP 添加。
5. 即使响应 JSON 伪造 `ip`，服务端也应采用 UDP 数据包的真实来源 IP。
序列号、网络字段、主连接选择、迁移和错误码的完整定义见 [终端注册与网络连接协议](../design/终端发现与准入协议.md)。同一序列号的有线/无线连接共用一个终端、房间和授权名额。

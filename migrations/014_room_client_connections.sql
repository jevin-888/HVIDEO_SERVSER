-- 记录房间当前已连接客户端（用于精准推送审计与房间清理）
CREATE TABLE IF NOT EXISTS room_client_connections (
    connection_id    TEXT PRIMARY KEY,
    roomId          TEXT NOT NULL DEFAULT '',
    roomName        TEXT NOT NULL DEFAULT '',
    roomIp          TEXT NOT NULL DEFAULT '',
    terminalId      TEXT NOT NULL DEFAULT '',
    terminalName    TEXT NOT NULL DEFAULT '',
    clientType      TEXT NOT NULL DEFAULT 'unknown',
    clientIp        TEXT NOT NULL DEFAULT '',
    connectedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_room_client_connections_room_id
    ON room_client_connections(roomId);

CREATE INDEX IF NOT EXISTS idx_room_client_connections_room_ip
    ON room_client_connections(roomIp);

CREATE INDEX IF NOT EXISTS idx_room_client_connections_client_type
    ON room_client_connections(clientType);

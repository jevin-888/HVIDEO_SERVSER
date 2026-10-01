-- 将房间客户端连接表升级为“状态记录”模型（安全增量版）
PRAGMA foreign_keys=off;

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

ALTER TABLE room_client_connections ADD COLUMN currentConnectionId TEXT NOT NULL DEFAULT '';
ALTER TABLE room_client_connections ADD COLUMN status INTEGER NOT NULL DEFAULT 1;
ALTER TABLE room_client_connections ADD COLUMN disconnectedAt TEXT NOT NULL DEFAULT '';

UPDATE room_client_connections
SET currentConnectionId = COALESCE(currentConnectionId, ''),
    status = COALESCE(status, 1),
    disconnectedAt = COALESCE(disconnectedAt, '')
WHERE 1 = 1;

CREATE INDEX IF NOT EXISTS idx_room_client_connections_room_id
    ON room_client_connections(roomId);

CREATE INDEX IF NOT EXISTS idx_room_client_connections_room_ip
    ON room_client_connections(roomIp);

CREATE INDEX IF NOT EXISTS idx_room_client_connections_client_type
    ON room_client_connections(clientType);

CREATE INDEX IF NOT EXISTS idx_room_client_connections_status
    ON room_client_connections(status);

PRAGMA foreign_keys=on;

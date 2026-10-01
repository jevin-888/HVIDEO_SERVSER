CREATE TABLE IF NOT EXISTS room_client_http_sources (
    source_id     TEXT PRIMARY KEY,
    roomId       TEXT NOT NULL DEFAULT '',
    roomIp       TEXT NOT NULL DEFAULT '',
    clientIp     TEXT NOT NULL DEFAULT '',
    clientType   TEXT NOT NULL DEFAULT 'unknown',
    createdAt    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_room_client_http_sources_room_id
    ON room_client_http_sources(roomId);

CREATE INDEX IF NOT EXISTS idx_room_client_http_sources_room_ip
    ON room_client_http_sources(roomIp);

CREATE INDEX IF NOT EXISTS idx_room_client_http_sources_client_ip
    ON room_client_http_sources(clientIp);

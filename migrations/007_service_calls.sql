-- 服务铃呼叫记录表
-- callType: 'call'=呼叫 | 'cup'=杯子 | 'clean'=清洁 | 'bill'=买单 | 'ice'=冰块
-- status:    0=待处理  | 1=已完成

CREATE TABLE IF NOT EXISTS service_calls (
    id           TEXT PRIMARY KEY,
    roomId      TEXT NOT NULL,
    roomName    TEXT NOT NULL DEFAULT '',
    callType    TEXT NOT NULL DEFAULT 'call',
    status       INTEGER NOT NULL DEFAULT 0,
    createdAt   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_service_calls_room   ON service_calls(roomId);
CREATE INDEX IF NOT EXISTS idx_service_calls_status ON service_calls(status);

-- Per-room PAD/mobile shared UI state (display mode, scene lock, and future slots).
CREATE TABLE IF NOT EXISTS room_sync_states (
    roomId     TEXT PRIMARY KEY,
    syncState  TEXT NOT NULL DEFAULT '[null,null,null,null,null,null,null,null,null]',
    updatedAt  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (roomId) REFERENCES rooms(id) ON DELETE CASCADE
);

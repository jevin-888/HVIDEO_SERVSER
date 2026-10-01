-- 系统配置表（key-value）
CREATE TABLE IF NOT EXISTS system_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 默认媒体根目录（空表示未配置）
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('media_root', '');

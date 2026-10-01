-- 服务铃类型配置表（后台可配置的服务项目）
CREATE TABLE IF NOT EXISTS service_types (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT 'fa-concierge-bell',
    sortOrder INTEGER NOT NULL DEFAULT 0,
    enabled    INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 默认服务类型
INSERT OR IGNORE INTO service_types (id, name, icon, sortOrder) VALUES
    ('svc-call',  '呼叫', 'fa-bell',                 1),
    ('svc-cup',   '杯子', 'fa-glass-cheers',          2),
    ('svc-clean', '清洁', 'fa-broom',                 3),
    ('svc-bill',  '买单', 'fa-file-invoice-dollar',   4),
    ('svc-ice',   '冰块', 'fa-snowflake',             5);

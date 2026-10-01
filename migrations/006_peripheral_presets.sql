-- 外设品类预设表
-- presetType: 'light' | 'effect' | 'ac'
-- settings JSON 格式:
--   light:  {"ctrlType": 2, "code": "8"}  或  {"ctrlType": 3, "code": "1"}
--   effect: {"mode": "ktv"}
--   ac:     {"power": true, "temp": 26, "mode": "cool"}

CREATE TABLE IF NOT EXISTS peripheral_presets (
    id          TEXT PRIMARY KEY,
    presetType TEXT NOT NULL,
    name        TEXT NOT NULL,
    settings    TEXT NOT NULL DEFAULT '{}',
    sortOrder  INTEGER NOT NULL DEFAULT 0,
    createdAt  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_peripheral_presets_type ON peripheral_presets(presetType);

-- 默认灯光品类
INSERT OR IGNORE INTO peripheral_presets (id, presetType, name, settings, sortOrder) VALUES
    ('preset-light-auto',     'light', '自动', '{"ctrlType":3,"code":"1"}',  1),
    ('preset-light-soft',     'light', '柔和', '{"ctrlType":2,"code":"1"}',  2),
    ('preset-light-bright',   'light', '明亮', '{"ctrlType":2,"code":"2"}',  3),
    ('preset-light-romantic', 'light', '浪漫', '{"ctrlType":2,"code":"8"}',  4),
    ('preset-light-all-on',   'light', '全开', '{"ctrlType":2,"code":"98"}', 5),
    ('preset-light-all-off',  'light', '全关', '{"ctrlType":2,"code":"99"}', 6);

-- 默认音效品类
INSERT OR IGNORE INTO peripheral_presets (id, presetType, name, settings, sortOrder) VALUES
    ('preset-effect-standard', 'effect', '标准',  '{"mode":"standard"}', 1),
    ('preset-effect-ktv',      'effect', 'KTV',   '{"mode":"ktv"}',      2),
    ('preset-effect-pop',      'effect', '流行',  '{"mode":"pop"}',      3),
    ('preset-effect-rock',     'effect', '摇滚',  '{"mode":"rock"}',     4),
    ('preset-effect-concert',  'effect', '音乐会','{"mode":"concert"}',  5);

-- 默认空调品类
INSERT OR IGNORE INTO peripheral_presets (id, presetType, name, settings, sortOrder) VALUES
    ('preset-ac-cool-26', 'ac', '制冷 26℃', '{"power":true,"temp":26,"mode":"cool"}',  1),
    ('preset-ac-heat-26', 'ac', '制热 26℃', '{"power":true,"temp":26,"mode":"heat"}',  2),
    ('preset-ac-auto',    'ac', '自动模式',  '{"power":true,"temp":26,"mode":"auto"}',  3),
    ('preset-ac-off',     'ac', '关闭空调',  '{"power":false,"temp":26,"mode":"auto"}', 4);

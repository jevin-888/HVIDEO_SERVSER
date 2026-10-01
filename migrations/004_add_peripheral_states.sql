-- 为 rooms 表添加外设状态字段
-- 使用 JSON 格式存储外设状态，便于扩展

-- 空调状态 JSON 格式: {"power": true, "temp": 26, "mode": "cool"}
ALTER TABLE rooms ADD COLUMN acState TEXT NOT NULL DEFAULT '{"power":false,"temp":26,"mode":"auto"}';

-- 灯光状态 JSON 格式: {"scene": "auto"}
ALTER TABLE rooms ADD COLUMN lightState TEXT NOT NULL DEFAULT '{"scene":"auto"}';

-- 音效状态 JSON 格式: {"mode": "standard"}
ALTER TABLE rooms ADD COLUMN effectState TEXT NOT NULL DEFAULT '{"mode":"standard"}';

-- 静音状态
ALTER TABLE rooms ADD COLUMN muteStatus INTEGER NOT NULL DEFAULT 0;

-- 播放状态 (0:停止 1:播放中 2:暂停)
ALTER TABLE rooms ADD COLUMN playState INTEGER NOT NULL DEFAULT 0;

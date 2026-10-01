-- 添加麦克风音量字段
-- 将原有的 volume 字段改名为 musicVolume，新增 micVolume 字段

-- 1. 添加新的 micVolume 字段（默认值50）
ALTER TABLE rooms ADD COLUMN micVolume INTEGER NOT NULL DEFAULT 50;

-- 2. 添加新的 musicVolume 字段，并将原有 volume 的值复制过去
ALTER TABLE rooms ADD COLUMN musicVolume INTEGER;

-- 3. 将原有 volume 的值复制到 musicVolume
UPDATE rooms SET musicVolume = volume WHERE musicVolume IS NULL;

-- 4. 设置 musicVolume 为 NOT NULL（SQLite 不支持直接修改列约束，需要重建表）
-- 注意：为了保持向后兼容，我们保留 volume 字段作为 musicVolume 的别名
-- 这样旧的 API 调用仍然可以工作

-- 确保 musicVolume 有默认值
UPDATE rooms SET musicVolume = 50 WHERE musicVolume IS NULL;

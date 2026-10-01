-- 创建房间类型表
CREATE TABLE IF NOT EXISTS room_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

-- 创建房间区域表
CREATE TABLE IF NOT EXISTS room_areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

-- 为 rooms 表添加 typeId 和 areaId 字段
ALTER TABLE rooms ADD COLUMN typeId INTEGER DEFAULT NULL REFERENCES room_types(id);
ALTER TABLE rooms ADD COLUMN areaId INTEGER DEFAULT NULL REFERENCES room_areas(id);

-- 迁移旧数据：将现有的 room_type 值迁移到 room_types 表和 typeId 字段
-- 假设 room_type 是整数，我们为其创建默认名称 "Type X"
INSERT OR IGNORE INTO room_types (id, name)
SELECT DISTINCT room_type, 'Type ' || room_type
FROM rooms
WHERE room_type IS NOT NULL AND room_type > 0;

-- 更新 typeId
UPDATE rooms SET typeId = room_type WHERE room_type IS NOT NULL AND room_type > 0;

-- 清理历史兼容阶段遗留的默认房型 "Type 0"
-- room_type=0 仅表示未设置，不应作为真实房型出现在 room_types 表中

UPDATE rooms
SET typeId = NULL
WHERE typeId IS NOT NULL AND typeId <= 0;

DELETE FROM room_types
WHERE id <= 0 OR TRIM(name) = '' OR name = 'Type 0';

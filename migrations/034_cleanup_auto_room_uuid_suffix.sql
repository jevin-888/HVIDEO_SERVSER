-- 清理旧版自动房间名中的播放器随机 UUID 短后缀。
-- 只处理仍严格等于“房间-终端名”的自动名称，避免覆盖后台人工修改的名称。
UPDATE rooms
SET name = '房间-' || substr(
    (SELECT terminals.name FROM terminals WHERE terminals.id = rooms.terminalId),
    1,
    length((SELECT terminals.name FROM terminals WHERE terminals.id = rooms.terminalId)) - 9
)
WHERE EXISTS (
    SELECT 1
    FROM terminals
    WHERE terminals.id = rooms.terminalId
      AND rooms.name = '房间-' || terminals.name
      AND length(terminals.name) > 9
      AND substr(terminals.name, -9, 1) = '-'
      AND length(substr(terminals.name, -8)) = 8
      AND lower(substr(terminals.name, -8)) NOT GLOB '*[^0-9a-f]*'
);

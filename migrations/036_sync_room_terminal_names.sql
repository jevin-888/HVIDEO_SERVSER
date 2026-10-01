-- Backfill management names saved by older room editors.
-- Only unambiguous bindings with custom room names are eligible.
WITH bound_names AS (
    SELECT t.id,
           t.name AS terminal_name,
           r.name AS room_name,
           CASE WHEN trim(t.name) = '' THEN '房间'
                ELSE '房间-' || trim(t.name) END AS automatic_name,
           CASE WHEN length(trim(t.name)) > 9
                     AND substr(trim(t.name), -9, 1) = '-'
                     AND substr(trim(t.name), -8) NOT GLOB '*[^0-9A-Fa-f]*'
                THEN '房间-' || substr(trim(t.name), 1, length(trim(t.name)) - 9)
           END AS legacy_automatic_name
    FROM terminals t
    JOIN rooms r ON r.terminalId = t.id
    WHERE (SELECT count(*) FROM rooms linked WHERE linked.terminalId = t.id) = 1
), custom_names AS (
    SELECT id, room_name
    FROM bound_names
    WHERE trim(room_name) != ''
      AND room_name != terminal_name
      AND room_name != automatic_name
      AND room_name != COALESCE(legacy_automatic_name, automatic_name)
      AND NOT (
          length(room_name) = length(automatic_name) + 9
          AND substr(room_name, 1, length(automatic_name) + 1) = automatic_name || '-'
          AND substr(room_name, -8) NOT GLOB '*[^0-9A-Fa-f]*'
      )
)
UPDATE terminals
SET name = (SELECT room_name FROM custom_names WHERE id = terminals.id),
    updatedAt = datetime('now','localtime')
WHERE id IN (SELECT id FROM custom_names);

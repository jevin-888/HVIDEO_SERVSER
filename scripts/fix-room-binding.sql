-- Room Binding Fix Script
-- This script helps fix common room binding issues
-- 
-- Usage:
--   sqlite3 data/hvideo.db < scripts/fix-room-binding.sql
--
-- Or interactively:
--   sqlite3 data/hvideo.db
--   .read scripts/fix-room-binding.sql

-- ============================================================
-- Step 1: Check current status
-- ============================================================

.print "==================================================================="
.print "Room Binding Status Report"
.print "==================================================================="
.print ""

.print "All Terminals:"
.print "-------------------------------------------------------------------"
SELECT 
    t.name AS 'Terminal Name',
    t.terminalIp AS 'IP Address',
    CASE t.onlineStatus
        WHEN 1 THEN 'Online'
        ELSE 'Offline'
    END AS 'Status',
    CASE 
        WHEN EXISTS (SELECT 1 FROM rooms WHERE terminalId = t.id) THEN 'Yes'
        ELSE 'No'
    END AS 'Has Room'
FROM terminals t
ORDER BY t.terminalIp;

.print ""
.print "All Rooms:"
.print "-------------------------------------------------------------------"
SELECT 
    r.name AS 'Room Name',
    CASE r.status 
        WHEN 0 THEN 'Idle'
        WHEN 1 THEN 'In Use'
        WHEN 2 THEN 'Maintenance'
        ELSE 'Unknown'
    END AS 'Status',
    t.terminalIp AS 'Terminal IP',
    t.name AS 'Terminal Name'
FROM rooms r
LEFT JOIN terminals t ON r.terminalId = t.id
ORDER BY r.name;

.print ""
.print "Terminals without rooms:"
.print "-------------------------------------------------------------------"
SELECT 
    t.name AS 'Terminal Name',
    t.terminalIp AS 'IP Address'
FROM terminals t
WHERE NOT EXISTS (
    SELECT 1 FROM rooms r WHERE r.terminalId = t.id
);

.print ""
.print "==================================================================="
.print "Fix Options"
.print "==================================================================="
.print ""
.print "To create rooms for terminals without rooms, run:"
.print ""
.print "  -- For a specific terminal IP (replace with actual IP):"
.print "  INSERT INTO rooms (id, name, terminalId, status)"
.print "  SELECT "
.print "      lower(hex(randomblob(16))),"
.print "      'Room-' || t.name,"
.print "      t.id,"
.print "      1"
.print "  FROM terminals t"
.print "  WHERE t.terminalIp = '192.168.1.100'"
.print "  AND NOT EXISTS (SELECT 1 FROM rooms WHERE terminalId = t.id);"
.print ""
.print "  -- For all terminals without rooms:"
.print "  INSERT INTO rooms (id, name, terminalId, status)"
.print "  SELECT "
.print "      lower(hex(randomblob(16))),"
.print "      'Room-' || t.name,"
.print "      t.id,"
.print "      1"
.print "  FROM terminals t"
.print "  WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE terminalId = t.id);"
.print ""
.print "To set all rooms to 'In Use' status:"
.print ""
.print "  UPDATE rooms SET status = 1 WHERE status = 0;"
.print ""
.print "To register a new terminal (replace with actual IP and name):"
.print ""
.print "  INSERT INTO terminals (id, name, terminalIp, onlineStatus)"
.print "  VALUES (lower(hex(randomblob(16))), 'Terminal-A01', '192.168.1.100', 1);"
.print ""
.print "==================================================================="

-- ============================================================
-- Uncomment the following sections to apply automatic fixes
-- ============================================================

-- -- Auto-fix 1: Create rooms for all terminals without rooms
-- INSERT INTO rooms (id, name, terminalId, status)
-- SELECT 
--     lower(hex(randomblob(16))),
--     'Room-' || t.name,
--     t.id,
--     1
-- FROM terminals t
-- WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE terminalId = t.id);

-- -- Auto-fix 2: Set all idle rooms to 'In Use' status
-- UPDATE rooms SET status = 1 WHERE status = 0;

-- -- Auto-fix 3: Set all terminals to online
-- UPDATE terminals SET onlineStatus = 1;

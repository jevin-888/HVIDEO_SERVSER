-- Serial identifies a physical player. Do not silently merge historical devices.
ALTER TABLE terminals ADD COLUMN serial TEXT NOT NULL DEFAULT '' COLLATE NOCASE;

WITH candidates AS (
    SELECT id, upper(trim(json_extract(
        CASE WHEN json_valid(hardwareInfo) THEN hardwareInfo ELSE '{}' END,
        '$.serial'))) AS value
    FROM terminals
    WHERE json_type(CASE WHEN json_valid(hardwareInfo) THEN hardwareInfo ELSE '{}' END, '$.serial') = 'text'
), usable AS (
    SELECT id, value FROM candidates
    WHERE length(value) BETWEEN 4 AND 128
      AND value NOT GLOB '*[^A-Z0-9._-]*'
      AND value NOT IN ('UNKNOWN', 'NULL', 'NONE', 'DEFAULT', 'SERIAL', '0123456789ABCDEF')
      AND value GLOB '*[A-Z0-9]*'
      AND replace(replace(replace(replace(value, '0', ''), '-', ''), '_', ''), '.', '') <> ''
      AND replace(replace(replace(replace(value, 'F', ''), '-', ''), '_', ''), '.', '') <> ''
)
UPDATE terminals SET serial = (SELECT value FROM usable WHERE usable.id = terminals.id)
WHERE id IN (
    SELECT u.id FROM usable u
    WHERE (SELECT count(*) FROM usable other WHERE other.value = u.value) = 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_terminals_serial ON terminals(serial COLLATE NOCASE) WHERE serial <> '';

CREATE TABLE IF NOT EXISTS terminal_connections (
    terminalId TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    networkType TEXT NOT NULL CHECK (networkType IN ('ethernet', 'wifi', 'unknown')),
    interfaceName TEXT NOT NULL DEFAULT '',
    ipAddress TEXT NOT NULL,
    macAddress TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 8080,
    onlineStatus INTEGER NOT NULL DEFAULT 0 CHECK (onlineStatus IN (0, 1)),
    lastHeartbeat TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (terminalId, networkType)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_connections_active_ip ON terminal_connections(ipAddress) WHERE onlineStatus = 1;
CREATE INDEX IF NOT EXISTS idx_terminal_connections_ip ON terminal_connections(ipAddress);
CREATE INDEX IF NOT EXISTS idx_terminal_connections_mac ON terminal_connections(macAddress COLLATE NOCASE);

-- Existing reports do not say which interface was used. Never guess from MAC/IP.
INSERT OR IGNORE INTO terminal_connections
    (terminalId, networkType, interfaceName, ipAddress, macAddress, port, onlineStatus, lastHeartbeat)
SELECT id, 'unknown', '', terminalIp, macAddress, port, onlineStatus, lastHeartbeat
FROM terminals WHERE terminalIp GLOB '[0-9]*.[0-9]*.[0-9]*.[0-9]*';

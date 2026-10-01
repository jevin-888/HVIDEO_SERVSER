-- A released primary address is empty. Historical IPv4 addresses remain in
-- terminal_connections. Nonempty primary addresses still have exactly one owner.
DROP INDEX IF EXISTS idx_terminals_ip;
CREATE UNIQUE INDEX idx_terminals_ip ON terminals(terminalIp) WHERE terminalIp <> '';

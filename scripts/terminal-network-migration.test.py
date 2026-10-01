"""Validate migration of existing identities without merging rooms/devices."""
from pathlib import Path
import json
import sqlite3

db = sqlite3.connect(':memory:')
db.executescript('''
CREATE TABLE terminals (
    id TEXT PRIMARY KEY, terminalIp TEXT UNIQUE, macAddress TEXT, hardwareInfo TEXT,
    port INTEGER DEFAULT 8080, onlineStatus INTEGER DEFAULT 0, lastHeartbeat TEXT DEFAULT ''
);
CREATE TABLE rooms (id TEXT PRIMARY KEY, terminalId TEXT, name TEXT);
''')
for number, serial in enumerate(['279f4f6d53f8febe', 'duplicate-123', 'DUPLICATE-123', '00000000', 'FFFFFFFF', None]):
    identity = f'terminal-{number}'
    hardware = json.dumps({'serial': serial}) if serial is not None else '{invalid json'
    db.execute('INSERT INTO terminals (id,terminalIp,macAddress,hardwareInfo) VALUES (?,?,?,?)',
               (identity, f'192.0.2.{10 + number}', f'02:00:00:00:00:{10 + number:02x}', hardware))
    db.execute('INSERT INTO rooms VALUES (?,?,?)', (f'room-{number}', identity, f'Room {number}'))
before_rooms = db.execute('SELECT * FROM rooms ORDER BY id').fetchall()
db.executescript((Path(__file__).resolve().parents[1] / 'migrations/035_terminal_network_connections.sql').read_text(encoding='utf-8'))
serials = dict(db.execute('SELECT id,serial FROM terminals'))
assert serials['terminal-0'] == '279F4F6D53F8FEBE'
assert all(serials[f'terminal-{i}'] == '' for i in range(1, 6))
assert db.execute('SELECT COUNT(*) FROM terminals').fetchone()[0] == 6
assert db.execute('SELECT * FROM rooms ORDER BY id').fetchall() == before_rooms
assert db.execute("SELECT COUNT(*) FROM terminal_connections WHERE networkType='unknown'").fetchone()[0] == 6
try:
    db.execute("UPDATE terminals SET serial='279f4f6d53f8febe' WHERE id='terminal-1'")
    raise AssertionError('Serial uniqueness must ignore casing')
except sqlite3.IntegrityError:
    pass
print('PASS: serial backfill, duplicate/placeholder preservation, case-insensitive uniqueness, unchanged rooms and unknown legacy networks')

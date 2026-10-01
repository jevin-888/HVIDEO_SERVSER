#!/usr/bin/env node

/**
 * Room Binding Diagnostic Script
 * 
 * This script helps diagnose room binding issues by checking:
 * 1. Terminal registration status
 * 2. Room binding status
 * 3. Room status configuration
 * 
 * Usage:
 *   node scripts/diagnose-room-binding.js <terminalIp>
 * 
 * Example:
 *   node scripts/diagnose-room-binding.js 192.168.1.100
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Parse command line arguments
const terminalIp = process.argv[2];

if (!terminalIp) {
    console.error('Error: Terminal IP address is required');
    console.error('Usage: node scripts/diagnose-room-binding.js <terminalIp>');
    console.error('Example: node scripts/diagnose-room-binding.js 192.168.1.100');
    process.exit(1);
}

// Validate IP format
const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
if (!ipRegex.test(terminalIp)) {
    console.error(`Error: Invalid IP address format: ${terminalIp}`);
    process.exit(1);
}

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'hvideo.db');

console.log('='.repeat(60));
console.log('Room Binding Diagnostic Tool');
console.log('='.repeat(60));
console.log(`Terminal IP: ${terminalIp}`);
console.log(`Database: ${dbPath}`);
console.log('='.repeat(60));
console.log('');

// Open database
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Error: Failed to open database:', err.message);
        process.exit(1);
    }
});

// Check 1: Terminal registration
console.log('Step 1: Checking terminal registration...');
db.get(
    'SELECT * FROM terminals WHERE terminalIp = ?',
    [terminalIp],
    (err, terminal) => {
        if (err) {
            console.error('  ❌ Database query error:', err.message);
            db.close();
            process.exit(1);
        }

        if (!terminal) {
            console.log('  ❌ Terminal NOT registered');
            console.log('');
            console.log('DIAGNOSIS: Terminal not found in database');
            console.log('');
            console.log('SOLUTION:');
            console.log('  Register the terminal using the following SQL:');
            console.log('');
            console.log(`  INSERT INTO terminals (id, name, terminalIp, onlineStatus)`);
            console.log(`  VALUES (lower(hex(randomblob(16))), 'Terminal-${terminalIp}', '${terminalIp}', 1);`);
            console.log('');
            db.close();
            return;
        }

        console.log('  ✅ Terminal registered');
        console.log(`     ID: ${terminal.id}`);
        console.log(`     Name: ${terminal.name}`);
        console.log(`     Online: ${terminal.onlineStatus === 1 ? 'Yes' : 'No'}`);
        console.log('');

        // Check 2: Room binding
        console.log('Step 2: Checking room binding...');
        db.get(
            `SELECT r.*, t.terminalIp
             FROM rooms r
             JOIN terminals t ON r.terminalId = t.id
             WHERE t.terminalIp = ?`,
            [terminalIp],
            (err, room) => {
                if (err) {
                    console.error('  ❌ Database query error:', err.message);
                    db.close();
                    process.exit(1);
                }

                if (!room) {
                    console.log('  ❌ Room NOT bound to terminal');
                    console.log('');
                    console.log('DIAGNOSIS: Terminal registered but no room bound');
                    console.log('');
                    console.log('SOLUTION:');
                    console.log('  Create and bind a room using the following SQL:');
                    console.log('');
                    console.log(`  INSERT INTO rooms (id, name, terminalId, status)`);
                    console.log(`  VALUES (lower(hex(randomblob(16))), 'Room-${terminal.name}', '${terminal.id}', 1);`);
                    console.log('');
                    db.close();
                    return;
                }

                console.log('  ✅ Room bound to terminal');
                console.log(`     Room ID: ${room.id}`);
                console.log(`     Room Name: ${room.name}`);
                console.log('');

                // Check 3: Room status
                console.log('Step 3: Checking room status...');
                const statusMap = {
                    0: 'Idle (Not in use)',
                    1: 'In use',
                    2: 'Maintenance'
                };
                const statusText = statusMap[room.status] || 'Unknown';
                const statusOk = room.status === 1 || room.status === 2;

                if (statusOk) {
                    console.log(`  ✅ Room status: ${room.status} (${statusText})`);
                } else {
                    console.log(`  ⚠️  Room status: ${room.status} (${statusText})`);
                }
                console.log(`     Volume: ${room.volume}`);
                console.log(`     Mic Status: ${room.micStatus === 1 ? 'On' : 'Off'}`);
                console.log(`     Current Song: ${room.currentSongId || 'None'}`);
                console.log('');

                // Final diagnosis
                console.log('='.repeat(60));
                console.log('FINAL DIAGNOSIS');
                console.log('='.repeat(60));

                if (statusOk) {
                    console.log('✅ All checks passed! Room is properly configured.');
                    console.log('');
                    console.log('If frontend still shows error, check:');
                    console.log('  1. Network connectivity between client and server');
                    console.log('  2. Client IP matches terminalIp in database');
                    console.log('  3. Backend server is running and accessible');
                    console.log('  4. WebSocket connection is established');
                } else {
                    console.log('⚠️  Room is configured but not in use (status=0)');
                    console.log('');
                    console.log('SOLUTION:');
                    console.log('  Set room status to "In use" (1) using the following SQL:');
                    console.log('');
                    console.log(`  UPDATE rooms SET status = 1 WHERE id = '${room.id}';`);
                    console.log('');
                    console.log('Or contact reception to open the room.');
                }

                console.log('');
                db.close();
            }
        );
    }
);

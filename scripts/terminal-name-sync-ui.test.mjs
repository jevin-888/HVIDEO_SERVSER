import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const clientSource = read('static/vod_song/shared/websocket/websocket-client.js');
const clientClass = clientSource.slice(clientSource.indexOf('class WebSocketClient {'), clientSource.indexOf('\nlet wsClient;'));
const admin = read('static/admin/admin.js');
const start = admin.indexOf("    ws.on('terminals_updated',");
assert.ok(start > 0);
const listener = admin.slice(start, admin.indexOf('    // 监听播放器操作结果', start));
const context = vm.createContext({ console, logService: null, playControlLogger: null });
vm.runInContext(`
    ${clientClass}
    const ws = Object.create(WebSocketClient.prototype);
    ws.listeners = new Map();
    ws.globalState = {};
    let currentSection = 'terminals';
    const calls = { terminals: 0, rooms: 0, dashboard: 0, unknown: 0 };
    function loadTerminals() { calls.terminals++; }
    function loadRooms() { calls.rooms++; }
    function updateStatistics() { calls.dashboard++; }
    ws.on('unknown', () => calls.unknown++);
    ${listener}
    globalThis.deliver = (section, type = 'terminals_updated') => {
        currentSection = section;
        ws._handleMessage({ data: JSON.stringify({ type }) });
        return JSON.stringify(calls);
    };
`, context);

const deliver = (section, type) => JSON.parse(context.deliver(section, type));
assert.deepEqual(deliver('terminals'), { terminals: 1, rooms: 0, dashboard: 0, unknown: 0 });
assert.deepEqual(deliver('rooms'), { terminals: 1, rooms: 1, dashboard: 0, unknown: 0 });
assert.deepEqual(deliver('dashboard'), { terminals: 1, rooms: 1, dashboard: 1, unknown: 0 });
assert.deepEqual(deliver('songs'), { terminals: 1, rooms: 1, dashboard: 1, unknown: 0 });
assert.deepEqual(deliver('terminals', 'unrecognized'), { terminals: 1, rooms: 1, dashboard: 1, unknown: 1 });
console.log('PASS: server terminal event reaches the active terminal, room or dashboard view exactly once; unrelated views and messages do not refresh.');

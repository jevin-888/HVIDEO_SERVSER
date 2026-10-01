import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const admin = readFileSync(new URL('static/admin/admin.js', root), 'utf8');
const api = readFileSync(new URL('static/admin/api.js', root), 'utf8');
function codeBetween(start, end) {
    const first = admin.indexOf(start);
    const last = admin.indexOf(end, first);
    assert(first >= 0 && last > first, `missing production code: ${start}`);
    return admin.slice(first, last);
}
const handlers = [
    codeBetween('function closeSyslogConnection()', 'const expandedTerminalConnections'),
    codeBetween('async function loadSettingsServerInfo()', 'function openMediaDirectoryPicker('),
    codeBetween('function getTauriInvoke()', '// 刷新系统资源状态'),
].join('\n');
const fixture = `<!doctype html><meta charset="utf-8">
    <select id="settings-network-interface">
        <option>192.168.1.11</option><option>192.168.2.11</option>
    </select>
    <input id="settings-media-root"><input id="settings-idle-song-path">
    <button id="settings-save-btn">保存设置</button>
    <div id="tauri-test-block"><div id="tauri-test-msg"></div>
        <button id="tauri-btn-restart">重启服务器</button>
    </div>
    <div id="syslog-container"></div>
    <button id="syslog-pause-btn"></button><button id="syslog-clear-btn"></button>`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function runCase(options, exercise) {
    const page = await browser.newPage();
    const writes = [];
    const restarts = [];
    const errors = [];
    let networkSaved = false;
    let readyLoads = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('testRestart', async logs => {
        restarts.push({ logs, writes: structuredClone(writes) });
        assert(networkSaved, 'restart must follow the completed network save');
        if (options.restartError) throw new Error('模拟重启失败');
        return { message: '服务器已重启', serverUrl: 'http://network-restart.test/ready' };
    });
    await page.route('http://network-restart.test/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === '/admin/') return route.fulfill({ contentType: 'text/html', body: fixture });
        if (path === '/ready') {
            readyLoads += 1;
            return route.fulfill({ contentType: 'text/html', body: '<p>重新连接完成</p>' });
        }
        const ok = data => route.fulfill({ json: { code: 0, message: 'success', data } });
        if (path === '/api/v1/system/server-info') return ok({
            host: '192.168.1.11', port: options.port ?? 9898,
            interfaces: [{ ip: '192.168.1.11' }, { ip: '192.168.2.11' }],
        });
        if (request.method() === 'PUT') {
            writes.push({ path, body: request.postDataJSON() });
            if (path === '/api/v1/system/server-network') {
                if (options.saveError) {
                    return route.fulfill({ status: 400, json: { message: '模拟网络配置保存失败' } });
                }
                networkSaved = true;
                return ok({ ...request.postDataJSON(), restartRequired: options.restartRequired !== false });
            }
            assert(!networkSaved, 'finish other settings before changing the desktop proxy target');
            return ok(request.postDataJSON());
        }
        if (path === '/api/v1/system/settings/media_root') return ok({ value: 'E:/' });
        if (path === '/api/v1/system/settings/idle_song_path') return ok({ value: 'E:\\idle' });
        throw new Error(`Unexpected request: ${request.method()} ${path}`);
    });
    try {
        await page.goto('http://network-restart.test/admin/');
        await page.addScriptTag({ content: api });
        await page.addScriptTag({ content: `
            let settingsServerOperationPending = false;
            let settingsServerPort = null;
            let currentSection = 'settings';
            let syslogEventSource = null;
            let syslogPaused = false;
            let syslogAutoScroll = true;
            let syslogShowHeartbeat = true;
            let syslogFilterKeyword = '';
            let syslogFilterLevel = 'INFO';
            window.messages = [];
            window.confirmCalls = 0;
            window.confirmResult = true;
            window.logConnections = { opened: 0, closed: 0 };
            window.EventSource = class {
                constructor() { logConnections.opened += 1; }
                close() { logConnections.closed += 1; }
            };
            window.showLoading = () => {};
            window.escapeHtml = value => String(value);
            window.hideLoading = () => {};
            window.showToast = message => messages.push(message);
            window.showConfirm = async () => { confirmCalls += 1; return confirmResult; };
            window.__TAURI_INVOKE__ = async command => {
                if (command === 'restart_server') {
                    setupSyslogs();
                    return testRestart({ ...logConnections, active: Boolean(syslogEventSource) });
                }
                throw new Error('Unexpected desktop command: ' + command);
            };
            ${handlers}
            loadSettingsServerInfo();
            setupSystemSettings();
            initTauriTest();
        ` });
        await page.waitForFunction(() => document.getElementById('settings-idle-song-path').value === 'E:\\idle');
        await page.waitForFunction(() => settingsServerPort !== null);
        await exercise({ page, writes, restarts, readyLoads: () => readyLoads });
        assert.deepEqual(errors, []);
    } finally {
        await page.close();
    }
}

try {
    await runCase({ port: 9999 }, async ({ page, writes, restarts, readyLoads }) => {
        await page.selectOption('#settings-network-interface', { label: '192.168.2.11' });
        await page.fill('#settings-media-root', 'F:/unsaved');
        await page.fill('#settings-idle-song-path', 'F:/unsaved-idle');
        await page.evaluate(() => {
            currentSection = 'syslogs';
            setupSyslogs();
            document.getElementById('tauri-btn-restart').dispatchEvent(new Event('click'));
            document.getElementById('tauri-btn-restart').dispatchEvent(new Event('click'));
            document.getElementById('settings-save-btn').onclick();
        });
        await page.waitForURL('http://network-restart.test/ready');
        assert.deepEqual(writes, [{
            path: '/api/v1/system/server-network', body: { host: '192.168.2.11', port: 9999 },
        }], 'direct restart saves only the selected server address and port');
        assert.equal(restarts.length, 1, 'repeated restart/save clicks must not queue another restart');
        assert.deepEqual(restarts[0].logs, { opened: 1, closed: 1, active: false });
        assert.equal(readyLoads(), 1);
    });
    console.log('PASS: change interface -> restart saves network only, closes logs, reconnects once');

    await runCase({}, async ({ page, writes, restarts, readyLoads }) => {
        await page.selectOption('#settings-network-interface', { label: '192.168.2.11' });
        await page.fill('#settings-media-root', 'F:/media');
        await page.fill('#settings-idle-song-path', 'F:/idle');
        await page.evaluate(() => {
            document.getElementById('settings-save-btn').onclick();
            document.getElementById('settings-save-btn').onclick();
            document.getElementById('tauri-btn-restart').dispatchEvent(new Event('click'));
        });
        await page.waitForURL('http://network-restart.test/ready');
        assert.deepEqual(writes, [
            { path: '/api/v1/system/settings/media_root', body: { value: 'F:/media' } },
            { path: '/api/v1/system/settings/idle_song_path', body: { value: 'F:\\idle' } },
            { path: '/api/v1/system/server-network', body: { host: '192.168.2.11', port: 9898 } },
        ]);
        assert.equal(restarts.length, 1);
        assert.equal(readyLoads(), 1);
    });
    console.log('PASS: save settings finishes other writes before changing network, then restarts once');

    await runCase({ restartRequired: false }, async ({ page, writes, restarts }) => {
        await page.click('#settings-save-btn');
        await page.waitForFunction(() => messages.includes('Settings saved'));
        assert.equal(writes.length, 3);
        assert.equal(restarts.length, 0, 'unchanged network does not cause an automatic restart');
        assert.equal(await page.locator('#settings-save-btn').isEnabled(), true);
    });
    console.log('PASS: unchanged network saves without an automatic restart');

    for (const invalidField of ['host', 'port']) {
        await runCase({}, async ({ page, writes, restarts }) => {
            await page.evaluate(field => {
                if (field === 'host') document.getElementById('settings-network-interface').value = '';
                else settingsServerPort = null;
            }, invalidField);
            await page.click('#tauri-btn-restart');
            await page.waitForFunction(() => document.getElementById('tauri-test-msg').textContent.includes('重启失败'));
            assert.equal(writes.length, 0);
            assert.equal(restarts.length, 0);
            assert.equal(await page.locator('#tauri-btn-restart').isEnabled(), true);
        });
    }
    await runCase({}, async ({ page, writes, restarts }) => {
        await page.evaluate(() => { confirmResult = false; });
        await page.click('#tauri-btn-restart');
        assert.equal(writes.length, 0);
        assert.equal(restarts.length, 0);
        assert.equal(await page.locator('#tauri-btn-restart').isEnabled(), true);
    });
    console.log('PASS: invalid address/port and cancelled restart produce no writes or restart');

    await runCase({ saveError: true }, async ({ page, writes, restarts }) => {
        await page.click('#tauri-btn-restart');
        await page.waitForFunction(() => document.getElementById('tauri-test-msg').textContent.includes('模拟网络配置保存失败'));
        assert.equal(writes.length, 1);
        assert.equal(restarts.length, 0, 'failed config save must not restart with the old settings');
        assert.equal(await page.locator('#tauri-btn-restart').isEnabled(), true);
    });
    await runCase({ restartError: true }, async ({ page, restarts }) => {
        await page.evaluate(() => { currentSection = 'syslogs'; setupSyslogs(); });
        await page.click('#tauri-btn-restart');
        await page.waitForFunction(() => document.getElementById('tauri-test-msg').textContent.includes('模拟重启失败'));
        assert.equal(restarts.length, 1);
        assert.deepEqual(await page.evaluate(() => logConnections), { opened: 2, closed: 1 });
        assert.equal(await page.locator('#tauri-btn-restart').isEnabled(), true);
    });
    console.log('PASS: save failure prevents restart; restart failure restores controls and log connection');
} finally {
    await browser.close();
}

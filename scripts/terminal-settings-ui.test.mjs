import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('static/admin/index.html', root), 'utf8');
const js = readFileSync(new URL('static/admin/admin.js', root), 'utf8');
const dialog = html.slice(html.indexOf('    <dialog id="terminal-settings-dialog"'), html.indexOf('    <script src="../vod_song/shared/websocket'));
const settings = js.slice(js.indexOf('async function openTerminalSettings('), js.indexOf('const terminalSearchInput ='));
const server = createServer((request, response) => {
    response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    response.end(`<button id="open">设置</button>${dialog}`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const serverUrl = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const live = process.env.TERMINAL_SETTINGS_LIVE === '1';
    const legacy = process.env.TERMINAL_SETTINGS_LEGACY === '1';
    if (live) page.on('console', message => {
        if (message.type() === 'error') console.error(message.text().slice(0, 400));
    });
    if (live) page.on('requestfailed', request => console.error(request.url().split('?')[0], request.failure()?.errorText));
    if (!live) await page.route('http://192.168.2.101/**', route => route.fulfill({
        contentType: 'text/html; charset=utf-8', body: '<p>终端配置</p>',
    }));
    await page.goto(serverUrl);
    await page.addScriptTag({content: `window.messages=[]; window.getTauriInvoke=()=>null; window.showToast=(message)=>messages.push(message); ${settings}
        document.getElementById('open').onclick=()=>openTerminalSettings('192.168.2.101');`});
    if (legacy) await page.evaluate(() => {
        window.getTauriInvoke = () => async () => {throw 'Command open_terminal_settings not found';};
    });
    await page.click('#open');
    assert.equal(await page.locator('#terminal-settings-dialog').evaluate(el => el.open), true);
    assert.equal(page.url(), serverUrl);
    assert.equal(page.context().pages().length, 1);
    const frame = page.frameLocator('#terminal-settings-frame');
    if (live) {
        const terminalFrame = await page.locator('#terminal-settings-frame').elementHandle().then(el => el.contentFrame());
        assert.ok(terminalFrame);
        await terminalFrame.waitForURL('http://192.168.2.101/index.html', {timeout: 30000, waitUntil: 'domcontentloaded'});
        assert.equal(await terminalFrame.evaluate(() => Boolean(localStorage.getItem('hvideo_auth_token'))), true);
        console.log('PASS: real terminal automatically logged in inside settings panel');
    } else {
        await frame.getByText('终端配置').waitFor();
    }
    await page.getByRole('button', {name:'关闭设置'}).click();
    assert.equal(await page.locator('#terminal-settings-dialog').evaluate(el => el.open), false);
    await page.waitForFunction(() => document.querySelector('#terminal-settings-frame').getAttribute('src') === 'about:blank');
    await page.click('#open');
    await page.locator('#terminal-settings-dialog button').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#terminal-settings-dialog').evaluate(el => el.open), false);
    await page.evaluate(() => {
        window.calls=[];
        window.getTauriInvoke=()=>async (...args)=>calls.push(args);
        return openTerminalSettings('192.168.2.101');
    });
    assert.deepEqual(await page.evaluate(() => calls), [['open_terminal_settings', { terminalIp:'192.168.2.101' }]]);
    assert.equal(await page.locator('#terminal-settings-dialog').evaluate(el => el.open), false);
    await page.evaluate(() => openTerminalSettings('999.168.2.101'));
    assert.equal(await page.evaluate(() => calls.length), 1);
    await page.evaluate(() => {
        window.getTauriInvoke=()=>async ()=>{throw new Error('native failure');};
        return openTerminalSettings('192.168.2.101');
    });
    assert.match(await page.evaluate(() => messages.at(-1)), /native failure/);
    assert.equal(page.url(), serverUrl);
    console.log(`PASS: ${legacy ? 'legacy desktop fallback' : 'browser'} open/close/reopen/Escape, desktop command, invalid IP, native error`);
} finally {
    await browser.close();
    server.close();
}

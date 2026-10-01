import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../static/admin/index.html');
const panel = html.slice(html.indexOf('<div id="scan-panel"'), html.indexOf('<div id="song-filters"'));
const admin = read('../static/admin/admin.js');
const scan = admin.slice(admin.indexOf('// ==================== 歌曲对照功能'), admin.indexOf('// ==================== 歌曲总库 Excel 导入'));
const writes = [];
let rejectStart = false;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://incremental-scan.test/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: panel });
        if (path === '/api/v1/songdb/scan/fs') return route.fulfill({ json: {
            code: 0, data: { entries: [{ name: 'D:', path: 'D:/' }, { name: 'E:', path: 'E:/' }] }
        } });
        if (path === '/api/v1/songdb/scan/start') {
            assert.equal(request.method(), 'POST');
            writes.push(request.postDataJSON());
            return route.fulfill(rejectStart
                ? { status: 500, json: { code: 500, message: '测试启动失败' } }
                : { json: { code: 0, data: { taskId: 'test-task' } } });
        }
        throw new Error(`Unexpected request ${path}`);
    });
    await page.goto('http://incremental-scan.test/');
    await page.addScriptTag({ content: read('../static/libs/tailwindcss.js') });
    await page.addScriptTag({ content: `
        window.showToast = () => {};
        window.escapeHtml = value => String(value);
        window.WebSocket = class {
            constructor() { window.testSocket = this; }
            close() {}
        };
    ` });
    await page.addScriptTag({ content: read('../static/admin/api.js') });
    await page.addScriptTag({ content: scan });
    await page.evaluate(() => toggleScanPanel());
    assert.equal(await page.locator('#scan-mode').inputValue(), 'full');
    assert.equal(await page.locator('#scan-drive-panel').isVisible(), true);
    assert.equal(await page.locator('#scan-directory-panel').isVisible(), false);
    assert.equal(await page.locator('#scan-config-panel p').count(), 0);
    await page.locator('.drive-btn').first().check();
    await page.locator('.drive-btn').nth(1).check();
    assert.equal(await page.locator('#scan-directories').inputValue(), 'D:/;E:/');
    await page.locator('.drive-btn').nth(1).uncheck();
    await page.evaluate(() => {toggleScanPanel();toggleScanPanel();});
    await page.waitForFunction(()=>!document.getElementById('scan-drive-status').textContent);
    assert.equal(await page.locator('.drive-btn').first().isChecked(), true);
    assert.equal(await page.locator('.drive-btn').nth(1).isChecked(), false);
    await page.locator('.drive-btn').nth(1).check();
    assert.equal(await page.locator('#scan-delete-duplicates').isChecked(), false);

    const out = new URL('../outputs/scan-modes-20260924/', import.meta.url);
    mkdirSync(out, {recursive: true});
    await page.addStyleTag({content:'body { background: #171b26; color: white; padding: 24px; }'});
    await page.setViewportSize({width:1440,height:900});
    for (const incremental of [false, true]) {
        if (incremental) {
            await page.evaluate(() => resetScan());
            await page.selectOption('#scan-mode', 'incremental');
            assert.equal(await page.locator('#scan-directories').inputValue(), '');
            await page.click('#scan-start-btn');
            assert.equal(writes.length, 1, 'empty folder must not submit old disks');
            await page.locator('#scan-directories').fill('D:/MV;E:/新歌');
        }
        assert.equal(await page.locator('#scan-drive-panel').isVisible(), !incremental);
        assert.equal(await page.locator('#scan-directory-panel').isVisible(), incremental);
        const modeBox = await page.locator('#scan-mode').boundingBox();
        const sourceBox = await page.locator(incremental ? '#scan-directories' : '#scan-drive-list').boundingBox();
        assert(Math.abs((modeBox.y + modeBox.height / 2) - (sourceBox.y + sourceBox.height / 2)) < 2, 'mode and source selection share one row');
        await page.locator('#scan-panel').screenshot({path:new URL(incremental ? 'incremental.png' : 'full.png',out).pathname.replace(/^\/(\w:)/,'$1')});
        await page.locator('#scan-delete-duplicates').setChecked(incremental);
        await page.click('#scan-start-btn');
        await page.waitForFunction(() => window.testSocket);
        assert.deepEqual(writes.at(-1), { directory: incremental ? 'D:/MV;E:/新歌' : 'D:/;E:/', deleteDuplicates: incremental, incremental });
        for (const control of ['#scan-mode', '#scan-delete-duplicates', '.drive-btn', '#scan-directories', '#scan-directories-browse']) {
            assert.equal(await page.locator(control).first().isDisabled(), true);
        }
        await page.evaluate(() => {
            testSocket.onmessage({ data: JSON.stringify({ type: 'completed', data: {
                totalFilesScanned: 0, matchedCount: 0, matchedRecords: [], unmatchedFiles: [],
                unrecognizedFiles: [], duplicateFiles: [], errors: []
            } }) });
            window.testSocket = null;
        });
        assert.equal(await page.locator('#scan-mode').isEnabled(), true);
        assert.equal(await page.locator('#scan-mode').inputValue(), incremental ? 'incremental' : 'full');
        assert.equal(await page.locator('#scan-result-panel').isVisible(), true);
    }
    rejectStart = true;
    await page.click('#scan-start-btn');
    await page.waitForFunction(() => !document.getElementById('scan-mode').disabled);
    assert.equal(await page.locator('#scan-delete-duplicates').isEnabled(), true);
    assert.deepEqual(writes.at(-1), { directory: 'D:/MV;E:/新歌', deleteDuplicates: true, incremental: true });
    await page.evaluate(() => resetScan());
    assert.equal(await page.locator('#scan-drive-list input:checked').count(),0);
    await page.locator('#scan-directories').fill('E:/新歌');
    await page.selectOption('#scan-mode', 'full');
    await page.waitForFunction(()=>!document.getElementById('scan-drive-status').textContent);
    const before = writes.length;
    await page.click('#scan-start-btn');
    assert.equal(writes.length, before, 'full mode must not submit old folders');
    assert.equal(await page.locator('#scan-directories').inputValue(), '');
    assert.equal(await page.locator('#scan-drive-panel').isVisible(), true);
    assert.equal(await page.locator('#scan-directory-panel').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS: mode-specific controls, multiple drives, folder requests, clearing stale selections, empty validation, reopen/reset, full/incremental API payloads, control locking, completion and failure recovery');
} finally {
    await browser.close();
}

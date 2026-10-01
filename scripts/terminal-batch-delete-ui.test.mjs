import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../static/admin/admin.js');
const html = read('../static/admin/index.html');
const section = html.slice(html.indexOf('<section id="terminals-section"'), html.indexOf('</section>', html.indexOf('<section id="terminals-section"')) + 10);
const listCode = source.slice(source.indexOf('const expandedTerminalConnections ='), source.indexOf('// 打开终端调试/配置页面'));
const deleteCode = source.slice(source.indexOf('async function deleteTerminal('), source.indexOf('const PERMANENT_LICENSE_SECONDS'));
const confirmCode = source.slice(source.indexOf('function showConfirm('), source.indexOf('function showPrompt('));
const roomNameCode = source.slice(source.indexOf('function getRoomDisplayName('), source.indexOf('function createRoomCard('));
const apiSource = read('../static/admin/api.js');
const apiDelete = apiSource.slice(apiSource.indexOf('    async deleteTerminal('), apiSource.indexOf('    async scanNetwork('));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
    const page = await browser.newPage();
    const styles = html.slice(html.indexOf('<style>'), html.indexOf('</style>') + 8);
    await page.setContent(`${styles}${section}<div id="confirm-container"></div>`);
    await page.addScriptTag({ content: `
        window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
        window.showLoading = window.hideLoading = () => {};
        window.messages = []; window.requests = []; window.roomRefreshes = 0;
        window.showToast = (...args) => messages.push(args);
        window.loadRooms = async () => { roomRefreshes++; };
        window.openTerminalSettings = () => {};
        window.failIds = []; window.failLookup = false;
        window.fixture = [
            {id:'one', serial:'SN-001', name:'包厢 <img src=x>', onlineStatus:1},
            {id:'two', serial:'SN-002', name:'包厢二'},
            {id:'three/encoded', serial:'SN-003', name:'包厢三'}
        ];
        window.apiService = {
            getTerminals: async () => ({data:structuredClone(fixture)}),
            getTerminalConfigProfiles: async () => ({data:[]}),
            request: async (path, options = {}) => {
                requests.push([path, options.method || 'GET']);
                if (options.method === 'DELETE') {
                    const id = decodeURIComponent(path.slice('/terminals/'.length));
                    if (failIds.includes(id)) throw new Error('设备删除失败');
                    fixture = fixture.filter(item => item.id !== id);
                    return {data:null};
                }
                if (failLookup) throw new Error('房间读取失败');
                return {data:[{name:'关联房间'}]};
            },
            ${apiDelete}
        };
        ${confirmCode}
        ${roomNameCode}
        ${listCode}
        ${deleteCode}
        document.getElementById('terminal-search').addEventListener('input', () => loadTerminals(false));
    ` });
    const batch = page.locator('#delete-selected-terminals');
    const all = page.locator('#select-all-terminals');
    const selected = () => page.evaluate(() => [...selectedTerminalIds]);
    const settled = () => page.waitForFunction(() => !terminalDeletionPending);
    await page.evaluate(() => loadTerminals());
    assert.equal(await batch.isDisabled(), true);
    await page.locator('[data-terminal-id="one"] .terminal-select').check();
    assert.equal(await all.evaluate(el => el.indeterminate), true);
    await all.check();
    assert.equal((await selected()).length, 3);
    await all.uncheck();
    assert.deepEqual(await selected(), []);
    await all.check();
    await page.fill('#terminal-search', 'SN-002');
    assert.deepEqual(await selected(), ['two'], 'search drops hidden selections');
    await page.fill('#terminal-search', '');
    await page.evaluate(() => loadTerminals());
    assert.deepEqual(await selected(), ['two'], 'refresh preserves visible selection');
    await all.check();
    await batch.click();
    assert.match(await page.locator('.admin-confirm-message').innerText(), /3 台终端/);
    assert.match(await page.locator('.admin-confirm-message').innerText(), /3 个房间及其点歌队列/);
    assert.equal(await page.locator('#confirm-container img').count(), 0, 'confirmation escapes names');
    assert.equal(await all.isDisabled(), true);
    assert.equal(await batch.isDisabled(), true);
    await page.evaluate(() => deleteTerminals(fixture));
    assert.equal(await page.locator('.admin-confirm-box').count(), 1, 'no duplicate confirmation');
    await page.locator('.admin-confirm-cancel').click();
    await settled();
    assert.equal(await page.evaluate(() => requests.filter(([, method]) => method === 'DELETE').length), 0);
    assert.equal((await selected()).length, 3);

    await page.evaluate(() => { failLookup = true; });
    await batch.click();
    await settled();
    assert.equal(await page.locator('.admin-confirm-box').count(), 0);
    assert.equal(await page.evaluate(() => requests.filter(([, method]) => method === 'DELETE').length), 0);
    await page.evaluate(() => { failLookup = false; failIds = ['two']; });
    await batch.click();
    await page.locator('.admin-confirm-ok').click();
    await settled();
    assert.deepEqual(await selected(), ['two'], 'only failures remain selected');
    assert.deepEqual(await page.evaluate(() => fixture.map(item => item.id)), ['two']);
    assert.match(await page.evaluate(() => messages.at(-1)[0]), /已删除 2 台，1 台失败/);
    assert.equal(await page.evaluate(() => roomRefreshes), 1);
    assert.deepEqual(await page.evaluate(() => requests.filter(([, method]) => method === 'DELETE')), [
        ['/terminals/one', 'DELETE'], ['/terminals/two', 'DELETE'], ['/terminals/three%2Fencoded', 'DELETE']
    ]);
    await page.evaluate(() => { failIds = []; });
    await batch.click();
    await page.locator('.admin-confirm-ok').click();
    await settled();
    assert.deepEqual(await selected(), []);
    assert.equal(await batch.isDisabled(), true);
    assert.equal(await all.isDisabled(), true);
    assert.match(await page.locator('#terminals-table').innerText(), /暂无符合条件/);
    assert.match(await page.evaluate(() => messages.at(-1)[0]), /已删除 1 台终端/);

    await page.evaluate(() => { fixture = [{id:'single', name:'单台'}]; return loadTerminals(); });
    await page.locator('.terminal-delete').click();
    await page.locator('.admin-confirm-ok').click();
    await settled();
    assert.equal(await page.evaluate(() => fixture.length), 0, 'single delete shares verified flow');
    await page.evaluate(() => {
        fixture = Array.from({length:100}, (_, index) => ({id:String(index), name:'长设备名称'.repeat(30)}));
        return loadTerminals();
    });
    await all.check();
    await batch.click();
    const bounds = await page.locator('.admin-confirm-ok').boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize().height, 'large batches keep confirmation buttons on screen');
    await page.locator('.admin-confirm-cancel').click();
    await settled();
    console.log('PASS: selection, filtered select-all, refresh, cancel, escaping, duplicate guard, lookup failure, partial deletion, retry, encoded API paths and single deletion');
} finally {
    await browser.close();
}

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const source = read('static/admin/admin.js');
const helpers = source.slice(source.indexOf('const configModal ='), source.indexOf('// 编辑房间', source.indexOf('const configModal =')));
const escape = source.slice(source.indexOf('function escapeHtml('), source.indexOf('function showToast('));
const html = read('static/admin/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
mkdirSync(new URL('scratch/room-config-qa/', root), { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('http://room-config.test/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        try {
            const file = `static${pathname}`;
            await route.fulfill({ body: readFileSync(new URL(file, root)) });
        } catch { await route.fulfill({ status: 404, body: '' }); }
    });
    await page.goto('http://room-config.test/');
    await page.addScriptTag({ content: read('static/libs/tailwindcss.js') });
    await page.addScriptTag({ content: `
        let roomTypes = [], roomAreas = [];
        const database = { type: [{id:1,name:'豪华VIP'}], area: [] };
        let nextId = 2, writes = 0, failWrite = false, releaseRead;
        const result = data => ({code:0,data:structuredClone(data)});
        const create = kind => async name => {
            writes++;
            await new Promise(resolve => setTimeout(resolve, 60));
            if(failWrite) throw new Error('测试保存失败');
            const item = {id:nextId++,name}; database[kind].push(item); return result(item);
        };
        const remove = kind => async id => {database[kind] = database[kind].filter(x=>x.id!==id); return result(null);};
        const apiService = {
            getRoomTypes:async()=>result(database.type), getRoomAreas:async()=>result(database.area),
            createRoomType:create('type'), createRoomArea:create('area'),
            deleteRoomType:remove('type'), deleteRoomArea:remove('area')
        };
        const showConfirm = async()=>true;
        const loadRooms = ()=>{};
        ${escape}
        ${source.slice(source.indexOf('function renderRoomTabs()'), source.indexOf('function switchType('))}
        function switchType(){} function switchArea(){}
        ${helpers}
    ` });
    await page.evaluate(() => openRoomConfigModal());
    await page.waitForFunction(() => document.getElementById('room-types-count').textContent === '1');
    for (const name of ['标准包间', '商务包间', '家庭包间', '音乐主题包间', '大型聚会包间', '<b>超长类型名称用于验证换行不会遮挡删除按钮</b>']) {
        await page.getByLabel('新类型名称', {exact:true}).fill(name);
        await page.getByLabel('添加类型', {exact:true}).click();
        await page.waitForFunction(() => !roomConfigBusy);
    }
    assert.equal(await page.locator('#room-types-list .config-item').count(), 7);
    assert.equal(await page.locator('#room-types-list b').count(), 0);
    assert.equal(await page.locator('#room-type-tabs button').count(), 8);
    for (const name of ['一楼', '二楼', '三楼']) {
        await page.getByLabel('新区域名称', {exact:true}).fill(name);
        await page.getByLabel('新区域名称', {exact:true}).press('Enter');
        await page.waitForFunction(() => !roomConfigBusy);
    }
    assert.equal(await page.locator('#room-areas-list .config-item').count(), 3);
    await page.evaluate(async () => {
        newTypeInput.value = '防重复';
        const before = writes;
        await Promise.all([addRoomConfig('type'), addRoomConfig('type')]);
        if(writes !== before+1) throw new Error('duplicate submission');
        const get = apiService.getRoomTypes;
        const stale = result(database.type);
        apiService.getRoomTypes = () => new Promise(resolve => {releaseRead = ()=>resolve(stale);});
        const refresh = refreshRoomConfigLists();
        newTypeInput.value = '慢请求后的新增'; await addRoomConfig('type');
        releaseRead(); await refresh;
        apiService.getRoomTypes = get;
        if(!roomTypes.some(x=>x.name==='慢请求后的新增')) throw new Error('stale read overwrote new item');
        failWrite = true; newAreaInput.value = '保留失败输入'; await addRoomConfig('area');
        if(newAreaInput.value !== '保留失败输入') throw new Error('input lost on failure');
        failWrite = false;
    });
    assert.match(await page.locator('#room-config-status').innerText(), /测试保存失败/);
    await page.locator('#room-areas-list .config-delete').first().click();
    await page.waitForFunction(() => !roomConfigBusy && roomAreas.length === 2);
    await page.getByLabel('关闭房间配置').click();
    await page.evaluate(() => openRoomConfigModal());
    await page.waitForFunction(() => document.getElementById('room-config-status').textContent === '');
    assert.equal(await page.locator('#room-types-list .config-item').count(), 9);
    await page.screenshot({ path: new URL('scratch/room-config-qa/desktop.png', root).pathname.replace(/^\/(\w:)/, '$1') });
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({ path: new URL('scratch/room-config-qa/mobile.png', root).pathname.replace(/^\/(\w:)/, '$1') });
    assert.ok(await page.locator('.room-config-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
    assert.ok(await page.locator('.config-entry').first().evaluate(el=>el.scrollWidth<=el.clientWidth));
    console.log('PASS: multiple adds, counts, tabs, Enter, delete, reopen, escaping, duplicate submit, stale reads, failed writes, responsive bounds');
} finally { await browser.close(); }

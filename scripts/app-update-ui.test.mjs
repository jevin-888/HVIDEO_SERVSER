import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const source = read('static/admin/index.html');
const section = source.slice(source.indexOf('<section id="terminals-section"'), source.indexOf('<!-- 房间管理 (POS'))
    .replace('section-content hidden', 'section-content');
const devices = [
    { id: 't1', name: '大厅播放器', terminalIp: '192.0.2.10', onlineStatus: 1, softwareVer: '1.0.0' },
    { id: 't2', name: '<b>包间播放器</b>', terminalIp: '192.0.2.11', onlineStatus: 1, softwareVer: '1.1.0' },
    { id: 't3', name: '离线播放器', terminalIp: '192.0.2.12', onlineStatus: 0 },
];
let task = null, posts = 0, polls = 0, failPoll = false;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
mkdirSync(new URL('scratch/app-update-qa/', root), { recursive: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://app-update.test/**', async route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        const ok = data => route.fulfill({ json: { code: 0, message: 'success', data } });
        if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<html lang="zh-CN"><meta charset="utf-8"><body class="bg-gray-900 p-4">${section}</body></html>` });
        assert.equal(request.headers().authorization, 'Bearer test-token');
        if (pathname === '/api/v1/terminals') return ok(devices);
        if (pathname.endsWith('/latest')) return ok(task);
        if (request.method() === 'POST') {
            posts++;
            const body = request.postDataBuffer().toString();
            assert.match(request.headers()['content-type'], /^multipart\/form-data; boundary=/);
            assert.match(body, /name="terminalIds"\r\n\r\n\["t1","t2"\]/);
            assert.doesNotMatch(body, /name="adbPort"/);
            assert.match(body, new RegExp('name="allowDowngrade"\\r\\n\\r\\n' + (posts > 1 ? 'true' : 'false')));
            assert.match(body, /name="apk"; filename="update.apk"/);
            assert.doesNotMatch(body, /"t3"/);
            task = { taskId: 'job-1', fileName: 'update.apk', adbPort: 5555, allowDowngrade: posts > 1, status: 'running', createdAt: Date.now(), completedAt: null,
                devices: devices.slice(0, 2).map(d => ({terminalId:d.id, name:d.name, terminalIp:d.terminalIp,status:'queued',message:'等待安装'})) };
            return ok(task);
        }
        if (pathname.endsWith('/job-1')) {
            polls++;
            if (failPoll) return route.fulfill({status:503,json:{message:'测试连接中断'}});
            task.status = 'completed'; task.completedAt = Date.now();
            task.devices[0].status = 'succeeded'; task.devices[0].message = '安装成功';
            task.devices[1].status = 'failed'; task.devices[1].message = 'INSTALL_FAILED_UPDATE_INCOMPATIBLE';
            return ok(task);
        }
        return route.fulfill({status:404,body:''});
    });
    await page.goto('http://app-update.test/');
    await page.evaluate(() => localStorage.setItem('admin_token', 'test-token'));
    await page.addScriptTag({content:read('static/libs/tailwindcss.js')});
    await page.addScriptTag({content:read('static/admin/api.js')});
    await page.addScriptTag({content:read('static/admin/app-update.js')});
    await page.locator('#update-terminal-app').click();
    await page.waitForFunction(() => document.querySelectorAll('#app-update-devices input').length === 3);
    assert.equal(await page.locator('#app-update-devices b').count(), 0);
    assert.equal(await page.locator('#app-update-devices input[value=t3]').isDisabled(), true);
    assert.equal(await page.locator('#app-update-allow-downgrade').isChecked(), false);
    assert.equal(await page.locator('#app-update-port').count(), 0);
    await page.locator('#app-update-select-all').check();
    assert.equal(await page.locator('#app-update-selected').innerText(), '已选 2 台');
    await page.locator('#app-update-file').setInputFiles({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('not apk')});
    await page.locator('#app-update-start').click();
    assert.equal(posts, 0);
    await page.locator('#app-update-file').setInputFiles({name:'update.apk',mimeType:'application/vnd.android.package-archive',buffer:Buffer.from('test upload')});
    await page.screenshot({path:new URL('scratch/app-update-qa/selection.png',root).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
    failPoll = true;
    await page.locator('#app-update-start').click();
    await page.waitForFunction(() => !document.getElementById('app-update-retry').classList.contains('hidden'));
    assert.equal(posts, 1);
    assert.equal(await page.locator('#app-update-start').isDisabled(), true);
    failPoll = false;
    await page.locator('#app-update-retry').click();
    await page.waitForFunction(() => document.getElementById('app-update-message').textContent.includes('任务已结束'));
    assert.match(await page.locator('#app-update-message').innerText(), /成功 1 \/ 失败 1/);
    assert.match(await page.locator('#app-update-results').innerText(), /INSTALL_FAILED_UPDATE_INCOMPATIBLE/);
    assert.equal(await page.locator('#app-update-results b').count(), 0);
    await page.screenshot({path:new URL('scratch/app-update-qa/results.png',root).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
    await page.locator('#app-update-close').click();
    await page.locator('#update-terminal-app').click();
    await page.waitForFunction(() => document.getElementById('app-update-message').textContent.includes('任务已结束'));
    assert.equal(posts, 1);
    await page.locator('#app-update-select-all').check();
    await page.locator('#app-update-file').setInputFiles({name:'update.apk',mimeType:'application/vnd.android.package-archive',buffer:Buffer.from('old version')});
    await page.locator('#app-update-allow-downgrade').check();
    await page.locator('#app-update-start').click();
    await page.waitForFunction(() => document.getElementById('app-update-fields').disabled);
    await page.locator('#app-update-close').click();
    await page.evaluate(() => {document.getElementById('app-update-allow-downgrade').checked = false;});
    await page.locator('#update-terminal-app').click();
    await page.waitForFunction(() => document.getElementById('app-update-allow-downgrade').checked);
    await page.waitForFunction(() => document.getElementById('app-update-message').textContent.includes('任务已结束'));
    assert.equal(posts, 2);
    assert.match(await page.locator('#app-update-message').innerText(), /允许降级/);
    await page.setViewportSize({width:900,height:600});
    await page.screenshot({path:new URL('scratch/app-update-qa/compact.png',root).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
    const bounds = await page.locator('[role=dialog]').boundingBox();
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 900 && bounds.y + bounds.height <= 600);
    assert.deepEqual(errors, []);
    console.log('APP update UI passed: normal/downgrade multipart contract, mode restored on reopen, selection, offline exclusion, poll recovery, mixed results and 900x600 layout.');
} finally { await browser.close(); }

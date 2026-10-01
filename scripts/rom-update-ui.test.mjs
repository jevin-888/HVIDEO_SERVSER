import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
let published = false, writes = 0, fail = false;
const id = 'a'.repeat(64);
mkdirSync(new URL('docs/records/20260920-rom-update/', root), { recursive: true });
try {
    for (const width of [1280, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        await page.route('http://rom-update.test/**', async route => {
            const request = route.request(), path = new URL(request.url()).pathname;
            const ok = data => route.fulfill({ json: { code: 0, message: 'success', data } });
            if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<html lang="zh-CN"><meta charset="utf-8"><body style="background:#111827"><button id="update-terminal-rom">ROM 更新</button></body></html>' });
            if (path.startsWith('/assets/')) return route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'font/woff2', body: readFileSync(new URL('static' + path, root)) });
            assert.equal(request.headers().authorization, 'Bearer test-token');
            if (request.method() === 'PUT') {
                assert.equal(path, `/api/v1/rom-updates/releases/${id}/publication`);
                if (fail) return route.fulfill({ status: 400, json: { message: 'ROM image SHA256 mismatch' } });
                published = request.postDataJSON().published; writes++; return ok({ published });
            }
            assert.equal(path, '/api/v1/rom-updates/releases');
            return ok({ releases: [{ release_id: id, version_code: 32, hardware: 'hw81', image_size: 913113674, published, error: '' }],
                results: [{ device_id: 'c03daeea68fe1cc2', version_code: 32, phase: 'failed', message: '<img src=x onerror=alert(1)>' }] });
        });
        await page.goto('http://rom-update.test/');
        await page.evaluate(() => localStorage.setItem('admin_token', 'test-token'));
        await page.addScriptTag({ content: read('static/libs/tailwindcss.js') });
        await page.addStyleTag({ url: 'http://rom-update.test/assets/css/all-client.min.css' });
        await page.addScriptTag({ content: read('static/admin/api.js') });
        await page.addScriptTag({ content: read('static/admin/rom-update.js') });
        await page.locator('#update-terminal-rom').click();
        await page.waitForSelector('#rom-releases button');
        assert.equal(await page.locator('#rom-results img').count(), 0);
        fail = true;
        await page.locator('#rom-releases button').click();
        await page.waitForFunction(() => document.querySelector('#rom-message').textContent.includes('SHA256'));
        assert.equal(published, false);
        fail = false;
        await page.locator('#rom-releases button').click();
        await page.waitForFunction(() => document.querySelector('#rom-releases button').textContent === '撤回');
        assert.equal(published, true);
        await page.screenshot({ path: new URL(`docs/records/20260920-rom-update/admin-${width}.png`, root).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.locator('#rom-releases button').click();
        await page.waitForFunction(() => document.querySelector('#rom-releases button').textContent === '发布');
        assert.equal(published, false);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#rom-update-modal').isVisible(), false);
        assert.deepEqual(errors, []);
        await page.close();
    }
    assert.equal(writes, 4);
    console.log('ROM admin desktop/mobile: publish, withdraw, checksum rejection, XSS and layout passed');
} finally { await browser.close(); }

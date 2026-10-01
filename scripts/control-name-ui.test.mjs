import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const admin = read('../static/admin/admin.js');
const prompt = admin.slice(admin.indexOf('function showPrompt('), admin.indexOf('function showSection('));
const items = ['light', 'effect', 'ac', 'service'].map(type => ({
    id: `${type}-one`, presetType: type, name: `${type}原名称`,
    settings: { code: '98', song_category: '流行', mode: 'rock', temp: 25 },
    sortOrder: 7, enabled: 0, icon: 'fa-bell'
}));
const original = structuredClone(items);
const writes = [];
let failWrite = false;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://control-name.test/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body:
            '<div id="confirm-container"></div>' +
            ['light', 'effect', 'ac'].map(type => `<div id="preset-list-${type}"></div>`).join('') +
            '<div id="service-type-list"></div>' });
        if (request.method() === 'PUT') {
            const payload = request.postDataJSON();
            writes.push({ path: url.pathname, payload });
            if (failWrite) return route.fulfill({ status: 500, json: { message: '测试保存失败' } });
            const item = items.find(item => item.id === decodeURIComponent(url.pathname.split('/').at(-1)));
            assert.ok(item, 'request targets the original ID');
            Object.assign(item, payload);
            return route.fulfill({ json: { code: 0, data: item } });
        }
        const type = url.pathname.endsWith('/service-types') ? 'service' : url.searchParams.get('type');
        return route.fulfill({ json: { code: 0, data: items.filter(item => item.presetType === type) } });
    });
    await page.goto('http://control-name.test/');
    await page.addScriptTag({ content: `
        window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
        window.messages = [];
        window.showToast = (...args) => messages.push(args);
        ${prompt}
    ` });
    await page.addScriptTag({ content: read('../static/admin/api.js') });
    await page.addScriptTag({ content: read('../static/assets/js/peripheral-management.js') });
    await page.evaluate(async () => {
        await Promise.all(['light', 'effect', 'ac'].map(loadPresetList));
        await loadServiceTypeList();
    });
    const nameButton = type => page.locator(`[data-control-type="${type}"]`);
    const settled = () => page.waitForFunction(() => !_controlRenameBusy);
    for (const type of ['light', 'effect', 'ac', 'service']) {
        await nameButton(type).click();
        assert.equal(await page.locator('.admin-prompt-input').inputValue(), `${type}原名称`);
        await page.locator('.admin-prompt-input').fill(`  ${type}新名称  `);
        await page.locator('.admin-prompt-input').press('Enter');
        await settled();
        assert.equal(await nameButton(type).innerText(), `${type}新名称`);
        assert.deepEqual(writes.at(-1), {
            path: `/api/v1/admin/${type === 'service' ? 'service-types' : 'peripheral-presets'}/${type}-one`,
            payload: { name: `${type}新名称` }
        });
        const index = items.findIndex(item => item.presetType === type);
        assert.deepEqual(items[index], { ...original[index], name: `${type}新名称` });
    }
    for (const action of ['cancel', 'escape', 'blank', 'unchanged']) {
        await nameButton('light').click();
        if (action === 'cancel') await page.locator('.admin-confirm-cancel').click();
        if (action === 'escape') await page.locator('.admin-prompt-input').press('Escape');
        if (action === 'blank') {
            await page.locator('.admin-prompt-input').fill('   ');
            await page.locator('.admin-confirm-ok').click();
        }
        if (action === 'unchanged') await page.locator('.admin-confirm-ok').click();
        await settled();
        assert.equal(writes.length, 4, `${action} does not write`);
    }
    failWrite = true;
    await nameButton('service').click();
    await page.locator('.admin-prompt-input').fill('失败名称');
    await page.locator('.admin-confirm-ok').click();
    await settled();
    assert.equal(await nameButton('service').innerText(), 'service新名称');
    assert.match(await page.evaluate(() => messages.at(-1)[0]), /测试保存失败/);
    failWrite = false;
    const escapedName = `名称 ' " <b>文本</b> &`;
    await nameButton('service').click();
    await page.evaluate(() => renameControlName(document.querySelector('[data-control-type="service"]')));
    assert.equal(await page.locator('.admin-prompt-input').count(), 1, 'duplicate clicks only open one prompt');
    await page.locator('.admin-prompt-input').fill(escapedName);
    await page.locator('.admin-confirm-ok').click();
    await settled();
    await page.evaluate(() => loadServiceTypeList());
    assert.equal(await nameButton('service').innerText(), escapedName);
    assert.equal(await nameButton('service').locator('b').count(), 0);
    await nameButton('service').click();
    assert.equal(await page.locator('.admin-prompt-input').inputValue(), escapedName);
    await page.locator('.admin-confirm-cancel').click();
    await settled();
    assert.equal(items[3].enabled, 0, 'renaming a disabled service keeps it disabled');
    assert.deepEqual(errors, []);
    console.log('PASS: all four name buttons, exact PUT paths/name-only bodies, parameters preserved, cancel/Escape/blank/unchanged, failure/retry, duplicate prompt, refresh and HTML escaping.');
} finally {
    await browser.close();
}

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const html = read('static/admin/index.html').replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,
    (tag, src) => /(?:tailwindcss|api|admin|i18n-catalog|i18n-admin|i18n)\.js(?:\?|$)/.test(src) ? tag : '');
const song = {
    songId: 1, songNo: '60000114', songName: '后来', primarySingerNo: '2031',
    primarySingerName: '刘若英', singerNames: '刘若英', languageCode: '1',
    categoryCode: '1', track: 3, videoFileType: 'hvideo',
    scoreEnabled: 1, relativePath: 'MV', fileName: '60000114.hvideo',
    absolutePath: 'D:/MV/60000114.hvideo'
};
const writes = [];
const singerRequests = [];
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('admin_token', 'test-token'));
    await page.route('http://song-edit.test/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const ok = data => route.fulfill({ json: { code: 0, message: 'success', data } });
        if (url.pathname === '/admin/') return route.fulfill({ contentType: 'text/html', body: html });
        if (!url.pathname.startsWith('/api/')) {
            try { return route.fulfill({ contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: read(`static${url.pathname}`) }); }
            catch { return route.fulfill({ status: 404, body: '' }); }
        }
        if (url.pathname === '/api/v1/songdb/songs/1') {
            if (request.method() === 'PUT') writes.push(request.postDataJSON());
            return ok(song);
        }
        if (url.pathname === '/api/v1/songdb/singers') {
            singerRequests.push(url.searchParams.get('keyword') || '');
            const keyword = (url.searchParams.get('keyword') || '').toLowerCase();
            const items = keyword && !'刘若英'.includes(keyword) && !'2031'.includes(keyword)
                ? [{ singerId: 2, singerNo: '2088', singerName: '王菲' }]
                : [{ singerId: 1, singerNo: '2031', singerName: '刘若英' }];
            return ok({ items, total: items.length, page: 1, pageSize: 30 });
        }
        if (url.pathname.startsWith('/api/v1/songdb/dict/')) return ok([{ dictCode: '1', dictName: '测试', visible: 1, sortOrder: 1 }]);
        if (url.pathname === '/api/v1/songdb/songs') return ok({ items: [song], total: 1, page: 1, pageSize: 10 });
        if (url.pathname.endsWith('/active')) return ok(null);
        if (/\/settings\b|\/config\b|\/status\b/.test(url.pathname)) return ok({});
        return ok([]);
    });
    await page.goto('http://song-edit.test/admin/');
    await page.waitForFunction(() => typeof window.openEditSongModal === 'function');
    await page.evaluate(() => document.getElementById('admin-page').classList.remove('hidden'));
    await page.evaluate(() => openEditSongModal(1));
    await page.locator('#song-artist-search').fill('王');
    await page.waitForTimeout(350);
    await page.locator('#song-artist').selectOption('2088');
    await page.locator('#song-score-enabled').selectOption('1');
    await page.locator('#song-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => document.getElementById('song-modal').classList.contains('hidden'));
    assert(singerRequests.some(keyword => keyword === '王'), '歌手编辑框应按关键词请求歌手接口');
    assert.equal(writes.length, 1, '一次保存只能产生一个更新请求');
    assert.equal(writes[0].primarySingerNo, '2088');
    assert.equal(writes[0].scoreEnabled, 1);
    assert.deepEqual(errors, []);
    console.log('PASS: song edit singer remote search and score field');
} finally {
    await browser.close();
}

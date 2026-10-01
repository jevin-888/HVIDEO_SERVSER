import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const html = read('static/admin/index.html').toString().replace(
    /<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,
    (tag, src) => /(?:tailwindcss|api|admin)\.js(?:\?|$)/.test(src) ? tag : ''
);
const cases = [
    { relativePath: 'D:/MV/60000114.mkv', fileName: '60000114.mkv', expected: 'D:/MV/60000114.mkv' },
    { relativePath: 'V10/8.0_3_10T/', fileName: '60000114.mp4', expected: 'V10/8.0_3_10T/60000114.mp4' },
    { relativePath: 'D:\\MV\\60000114.MKV', fileName: '60000114.MKV', expected: 'D:/MV/60000114.MKV' },
    { relativePath: '/media/MV/60000114.mkv', fileName: '', expected: '/media/MV/60000114.mkv' },
    { relativePath: '', fileName: '60000114.mkv', expected: '60000114.mkv' },
    { relativePath: 'D:/MV/歌曲 #100%.mkv', fileName: '歌曲 #100%.mkv', expected: 'D:/MV/歌曲 #100%.mkv' },
];
let song;
const writes = [];
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('admin_token', 'test-token'));
    await page.route('http://song-path.test/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const ok = data => route.fulfill({ json: { code: 0, message: 'success', data } });
        if (path === '/admin/') return route.fulfill({ contentType: 'text/html', body: html });
        if (!path.startsWith('/api/')) {
            try {
                return route.fulfill({
                    contentType: path.endsWith('.js') ? 'text/javascript' : 'text/css',
                    body: read(`static${path}`)
                });
            } catch { return route.fulfill({ status: 404, body: '' }); }
        }
        if (path === '/api/v1/songdb/songs/1') {
            if (request.method() === 'PUT') {
                const payload = request.postDataJSON();
                writes.push(payload);
                song = { ...song, ...payload };
            }
            return ok(song);
        }
        if (path.startsWith('/api/v1/songdb/dict/')) {
            const group = path.split('/').at(-1);
            return ok([{ dictGroup: group, dictCode: '1', dictName: '测试', visible: 1, sortOrder: 1 }]);
        }
        if (path === '/api/v1/songdb/songs') return ok({ items: song ? [song] : [], total: song ? 1 : 0, page: 1, pageSize: 10 });
        if (path === '/api/v1/songdb/singers') return ok({ items: [{ singerId: 1, singerNo: '2031', singerName: 'Liu Ruo Ying' }], total: 1 });
        if (path === '/api/v1/license/status') return ok({ valid: true, status: 'valid', machineCode: 'TEST' });
        if (path === '/api/v1/system/server-info') return ok({ host: '127.0.0.1', port: 9898, interfaces: [] });
        if (path === '/api/v1/system/status') return ok({ disks: [] });
        if (path.endsWith('/active')) return ok(null);
        if (/\/settings\b|\/config\b/.test(path)) return ok({});
        return ok([]);
    });
    await page.goto('http://song-path.test/admin/');
    await page.waitForFunction(() => !document.getElementById('admin-page').classList.contains('hidden'));
    for (const [index, fixture] of cases.entries()) {
        song = {
            songId: 1, songNo: '60000114', songName: '后来(MTV)',
            singerNames: 'Liu Ruo Ying', primarySingerNo: '2031',
            languageCode: '1', categoryCode: '1', track: 1,
            videoFileType: 'mkv', ...fixture
        };
        await page.evaluate(() => openEditSongModal(1));
        assert.equal(await page.locator('#song-path').inputValue(), fixture.expected);
        if (index === 0) {
            mkdirSync(new URL('scratch/local-song-audit-20260911/', root), { recursive: true });
            await page.screenshot({ path: new URL('scratch/local-song-audit-20260911/song-path-fixed.png', root).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
        }
        await page.locator('#song-form').evaluate(form => form.requestSubmit());
        await page.waitForFunction(() => document.getElementById('song-modal').classList.contains('hidden'));
        assert.equal(writes.length, index + 1, 'one save produces exactly one PUT');
        const payload = writes.at(-1);
        assert.equal(payload.relativePath + payload.fileName, fixture.expected, 'save must preserve one complete path');
        assert(!('songPath' in payload), 'do not add a parallel path API field');
        await page.evaluate(() => openEditSongModal(1));
        assert.equal(await page.locator('#song-path').inputValue(), fixture.expected, 'reopening saved data must not append the file name again');
        await page.locator('#cancel-song-modal').click();
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: ${cases.length} path cases through real edit -> PUT -> reopen handlers`);
} finally {
    await browser.close();
}

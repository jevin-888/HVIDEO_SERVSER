// Read-only verification: select paths in the real page, never start a scan.
import {chromium} from 'playwright';
import {readFileSync, mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {base, token} = JSON.parse(readFileSync(0, 'utf8'));
const browser = await chromium.launch({channel:'msedge', headless:true, args:['--no-proxy-server']});
try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(token => localStorage.setItem('admin_token',token),token);
    await page.goto(base+'/static/admin/index.html');
    await page.locator('#admin-page:not(.hidden)').waitFor();
    await page.locator('.nav-item[data-section="songs"]').click();
    await page.evaluate(() => toggleScanPanel());
    await page.locator('#scan-drive-list input').first().waitFor();
    const roots = await page.locator('#scan-drive-list input').evaluateAll(nodes => nodes.map(node => node.value));
    assert(roots.length > 0);
    await page.locator('#scan-drive-list input').first().check();
    assert.equal(await page.locator('#scan-directories').inputValue(),roots[0]);
    if (roots.length > 1) {
        await page.locator('#scan-drive-list input').nth(1).check();
        assert.equal(await page.locator('#scan-directories').inputValue(),roots.slice(0,2).join(';'));
    }
    assert.equal(await page.locator('#scan-drive-panel').isVisible(),true);
    assert.equal(await page.locator('#scan-directory-panel').isVisible(),false);
    await page.selectOption('#scan-mode','incremental');
    assert.equal(await page.locator('#scan-drive-panel').isVisible(),false);
    assert.equal(await page.locator('#scan-directory-panel').isVisible(),true);
    assert.equal(await page.locator('#scan-directories').inputValue(),'');
    assert.equal(await page.locator('#scan-directories-browse').isEnabled(),true);
    await page.locator('#songs-table tr').first().waitFor();
    await page.waitForFunction(() => document.getElementById('loading-overlay')?.classList.contains('hidden') ?? true);
    const dir = new URL('../outputs/scan-drives-20260924/',import.meta.url);
    mkdirSync(dir,{recursive:true});
    await page.screenshot({path:new URL('live.png',dir).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS live server drive API, actual drive selection, native picker entry; no scan started. Drives:',roots.join(', '));
} finally {await browser.close();}

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root));
const source = read('static/admin/index.html').toString();
// Exercise the real admin navigation, event handlers and page CSS. Unrelated optional plugins are omitted.
const html = source.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g, (tag, src) =>
    /(?:tailwindcss|\/api|\/admin|\/dictionary|room-service-mgmt|^api|^admin|^dictionary)\.js(?:\?|$)/.test(src) ? tag : '');
const rows = [
    ['classify','001','流行',0,1], ['classify','002','摇滚',1,0],
    ['classify','003','民谣',2,1], ['classify','004','电子',3,1],
    ['classify','005','爵士',4,1], ['language','zh','国语',0,1],
    ['language','en','英语',1,1], ['track','3','伴唱左／原唱右',3,1],
    ['sex','0','组合',0,1], ['region','cn','中国',0,1],
    ['mood','xss','<img src=x onerror="window.dictionaryXss=true">',1,1],
].map(([dictGroup,dictCode,dictName,sortOrder,visible]) =>
    ({dictGroup,dictCode,dictName,sortOrder,visible}));
const calls = { list:0, puts:[], deletes:[], exports:[], imports:0, groups:[] };
let failLoad = false, failImport = false, failExport = false, writeGate = null;
const browser = await chromium.launch({headless:true,channel:'msedge'});
mkdirSync(new URL('scratch/dictionary-qa/',root),{recursive:true});
try {
    const page = await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
    const errors = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('admin_token','test-token'));
    await page.route('http://dictionary.test/**', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        const ok = data => route.fulfill({json:{code:0,message:'success',data}});
        const error = (status,message) => route.fulfill({status,json:{code:status,message}});
        if (path === '/admin/') return route.fulfill({contentType:'text/html',body:html});
        if (!path.startsWith('/api/')) {
            try {
                const contentType = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream';
                return route.fulfill({contentType,body:read(`static${path}`)});
            } catch { return route.fulfill({status:404,body:''}); }
        }
        assert.equal(request.headers().authorization,'Bearer test-token');
        if (path === '/api/v1/songdb/dicts') {
            calls.list++;
            return failLoad ? error(503,'字典服务暂时不可用') : ok(rows);
        }
        if (path === '/api/v1/songdb/dicts/export') {
            calls.exports.push(url.search);
            if (failExport) return error(401,'登录已过期，请重新登录');
            return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:Buffer.from('PK-test-download')});
        }
        if (path === '/api/v1/songdb/dicts/import') {
            calls.imports++;
            assert.match(request.headers()['content-type'],/^multipart\/form-data; boundary=/);
            const body = request.postDataBuffer().toString();
            assert.match(body,/name="file"; filename="dictionary.xlsx"/);
            assert.doesNotMatch(body,/name="dictGroup"|name="mode"/);
            if (failImport) return error(400,'第9行的分组和编码重复：classify/001');
            rows.push({dictGroup:'scene',dictCode:'001',dictName:'聚会',sortOrder:0,visible:1});
            return ok({totalCount:3,insertedCount:1,updatedCount:1,unchangedCount:1});
        }
        if (path.startsWith('/api/v1/songdb/dict/')) {
            const [group,code] = path.slice('/api/v1/songdb/dict/'.length).split('/').map(decodeURIComponent);
            if (request.method() === 'GET') { calls.groups.push(group); return ok(rows.filter(row => row.dictGroup === group)); }
            if (request.method() === 'PUT') {
                const data = request.postDataJSON();
                assert.deepEqual(Object.keys(data).sort(),['dictCode','dictName','sortOrder','visible']);
                calls.puts.push({group,...data});
                if (writeGate) await writeGate;
                let row = rows.find(row => row.dictGroup === group && row.dictCode === data.dictCode);
                if (!row) { row = {dictGroup:group}; rows.push(row); }
                Object.assign(row,data);
                return ok(row);
            }
            if (request.method() === 'DELETE') {
                calls.deletes.push([group,code]);
                if (code === '001') return error(409,'该字典项已被歌曲或歌星引用，请先调整关联数据；暂时不显示可改为隐藏');
                rows.splice(rows.findIndex(row=>row.dictGroup === group && row.dictCode === code),1);
                return ok(null);
            }
        }
        if (path === '/api/v1/license/status') return ok({valid:true,status:'valid',machineCode:'TEST',message:'测试授权'});
        if (path === '/api/v1/system/server-info') return ok({host:'127.0.0.1',port:9898,interfaces:[{name:'test',ip:'127.0.0.1'}]});
        if (path.endsWith('/active')) return ok(null);
        if (path === '/api/v1/songdb/songs' || path === '/api/v1/songdb/singers') return ok({items:[],total:0,page:1,pageSize:10});
        if (path === '/api/v1/system/status') return ok({cpu_usage:0,memory_used_mb:0,memory_total_mb:1024,memory_usage_percent:0,disks:[]});
        if (path === '/api/v1/songdb/stats') return ok({total_songs:0,total_singers:0,total_languages:2});
        if (/\/settings\b|\/config\b/.test(path)) return ok({});
        return ok([]);
    });
    await page.goto('http://dictionary.test/admin/');
    await page.waitForFunction(() => !document.getElementById('admin-page').classList.contains('hidden'));
    // Initialization is complete once all dictionary-backed edit selectors have loaded.
    await page.waitForFunction(() => document.querySelectorAll('#song-classify option').length > 1);
    await page.locator('.nav-item[data-section=dicts]').click();
    await page.waitForFunction(() => document.getElementById('dict-count').textContent.includes('11 / 11'));
    assert.equal(await page.locator('#page-title').innerText(),'字典维护');
    assert.equal(await page.locator('#dict-table img').count(),0);
    assert.equal(await page.evaluate(()=>window.dictionaryXss),undefined);
    assert(!calls.groups.includes('category'),'song classification requests the canonical classify group');
    assert.equal(await page.evaluate(()=>getDictName('sex',0)),'组合');
    assert.equal(await page.evaluate(()=>formatDictDisplay('classify','001','过期分类')),'流行');
    await page.locator('#dict-group-filter').selectOption('classify');
    await page.locator('#dict-visible-filter').selectOption('0');
    assert.equal(await page.locator('#dict-table tr[data-dict-code]').count(),1);
    await page.locator('#dict-search').fill('摇滚');
    const groupDownload = page.waitForEvent('download');
    await page.locator('#dict-export-group').click();
    assert.equal((await groupDownload).suggestedFilename(),'歌曲字典_classify.xlsx');
    assert.equal(calls.exports[0],'?dictGroup=classify');
    const allDownload = page.waitForEvent('download');
    await page.locator('#dict-export-all').click();
    assert.equal((await allDownload).suggestedFilename(),'歌曲字典.xlsx');
    assert.equal(calls.exports[1],'');

    await page.locator('#dict-search').fill('');
    await page.locator('#dict-visible-filter').selectOption('');
    await page.getByRole('button',{name:'编辑 classify/001',exact:true}).click();
    assert.equal(await page.locator('#dict-edit-group').getAttribute('readonly'),'');
    assert.equal(await page.locator('#dict-edit-code').getAttribute('readonly'),'');
    assert.equal(await page.locator('#dict-edit-code').inputValue(),'001');
    assert.equal(await page.locator('#dict-edit-source').count(),0);
    await page.locator('#dict-edit-name').fill('华语流行 & 经典');
    await page.locator('#dict-edit-visible').selectOption('0');
    let releaseWrite;
    writeGate = new Promise(resolve=>{releaseWrite=resolve;});
    await page.locator('#dict-save').click();
    await page.waitForFunction(()=>document.getElementById('dict-editor-fields').disabled);
    await page.locator('#dict-editor-form').evaluate(form=>form.dispatchEvent(new Event('submit',{cancelable:true})));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#dict-editor').isVisible(),true,'in-flight writes cannot be closed or submitted twice');
    releaseWrite(); writeGate=null;
    await page.waitForFunction(()=>!document.getElementById('dict-editor').open);
    await page.waitForFunction(()=>document.querySelector('#song-classify option[value="001"]').textContent.includes('华语流行'));
    assert.equal(calls.puts.length,1);
    assert.equal(await page.evaluate(()=>formatDictDisplay('classify','001','旧名')),'华语流行 &amp; 经典');

    await page.locator('#dict-add').click();
    await page.locator('#dict-edit-code').fill('001');
    await page.locator('#dict-edit-name').fill('重复');
    await page.locator('#dict-save').click();
    assert.match(await page.locator('#dict-editor-message').innerText(),/已存在/);
    assert.equal(calls.puts.length,1);
    await page.locator('#dict-edit-code').fill('010/甲');
    await page.locator('#dict-edit-name').fill('测试新增');
    await page.locator('#dict-save').click();
    await page.waitForFunction(()=>!document.getElementById('dict-editor').open);
    await page.waitForFunction(()=>!document.getElementById('dict-add').disabled);
    assert.equal(calls.puts.at(-1).group,'classify');
    assert.equal(calls.puts.at(-1).dictCode,'010/甲');
    await page.getByRole('button',{name:'删除 classify/010/甲',exact:true}).click();
    await page.locator('.admin-confirm-cancel').click();
    assert.equal(calls.deletes.length,0);
    await page.getByRole('button',{name:'删除 classify/010/甲',exact:true}).click();
    await page.locator('.admin-confirm-ok').click();
    await page.waitForFunction(()=>document.getElementById('dict-message').textContent.includes('已删除'));
    assert.deepEqual(calls.deletes,[['classify','010/甲']]);
    await page.getByRole('button',{name:'删除 classify/001',exact:true}).click();
    await page.locator('.admin-confirm-ok').click();
    await page.waitForFunction(()=>document.getElementById('dict-message').textContent.includes('已被歌曲'));
    assert.equal(await page.getByRole('button',{name:'编辑 classify/001',exact:true}).count(),1);

    await page.locator('#dict-open-import').click();
    await page.locator('#dict-import-file').setInputFiles({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('bad')});
    await page.locator('#dict-import-submit').click();
    assert.equal(calls.imports,0);
    await page.locator('#dict-import-file').setInputFiles({name:'dictionary.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('PK-test-upload')});
    failImport=true;
    await page.locator('#dict-import-submit').click();
    await page.waitForFunction(()=>document.getElementById('dict-import-message').textContent.includes('第9行'));
    assert.equal(await page.locator('#dict-import-submit').isDisabled(),false);
    failImport=false;
    await page.locator('#dict-import-submit').click();
    await page.waitForFunction(()=>document.getElementById('dict-import-message').textContent.includes('导入完成'));
    assert.match(await page.locator('#dict-import-message').innerText(),/共 3 条，新增 1，更新 1，未变化 1/);
    await page.waitForFunction(()=>!document.getElementById('dict-import-submit').disabled);
    await page.waitForFunction(()=>!document.querySelector('.admin-toast'));
    await page.screenshot({path:fileURLToPath(new URL('scratch/dictionary-qa/import-result.png',root))});
    await page.locator('[data-dict-close="dict-import-dialog"]').last().click();
    failLoad=true;
    await page.locator('#dict-refresh').click();
    await page.waitForFunction(()=>document.getElementById('dict-message').textContent.includes('可点击“刷新”重试'));
    assert.equal(await page.locator('#dict-table tr[data-dict-code]').count(),0);
    failLoad=false;
    await page.locator('#dict-refresh').click();
    await page.waitForFunction(()=>document.getElementById('dict-summary').textContent.includes('12 条'));

    // The former track popup now links directly to the dedicated page with the group selected.
    await page.locator('.nav-item[data-section=songs]').click();
    await page.locator('button[onclick="window.dictionaryPage.open(\'track\')"]').click();
    await page.waitForFunction(()=>document.getElementById('dict-group-filter').value==='track');
    assert.equal(await page.locator('#dict-table tr[data-dict-code]').count(),1);
    await page.locator('#dict-group-filter').selectOption('');
    await page.screenshot({path:fileURLToPath(new URL('scratch/dictionary-qa/page.png',root))});
    await page.setViewportSize({width:900,height:600});
    await page.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().right<=1);
    await page.locator('#dict-add').click();
    await page.screenshot({path:fileURLToPath(new URL('scratch/dictionary-qa/compact-editor.png',root))});
    const box = await page.locator('#dict-editor').boundingBox();
    assert(box.x>=0 && box.y>=0 && box.x+box.width<=900 && box.y+box.height<=600);
    await page.locator('[data-dict-close="dict-editor"]').last().click();
    await page.screenshot({path:fileURLToPath(new URL('scratch/dictionary-qa/compact-page.png',root))});
    const panel = await page.locator('.dict-panel').boundingBox();
    assert(panel.x>=0 && panel.x+panel.width<=900 && panel.y+panel.height<=600);

    failExport=true;
    await page.locator('#dict-export-all').click();
    await page.waitForFunction(()=>!document.getElementById('login-page').classList.contains('hidden'));
    assert.equal(await page.evaluate(()=>localStorage.getItem('admin_token')),null);
    assert.equal(await page.locator('#admin-page').isVisible(),false);
    // An expired background request must not leave a native dialog blocking the login form.
    await page.evaluate(()=>{
        apiService.setToken('test-token');
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('admin-page').classList.remove('hidden');
    });
    await page.locator('#dict-add').click();
    await page.evaluate(()=>apiService.exportSongDbDicts().catch(()=>{}));
    assert.equal(await page.locator('#login-page').isVisible(),true);
    assert.equal(await page.locator('#dict-editor').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: dictionary navigation, canonical cached names, filters, CRUD by group/code, five-field contract, reference errors, single-submit, import retry/results, authenticated XLSX downloads, expired login and 900x600 layout.');
} finally { await browser.close(); }

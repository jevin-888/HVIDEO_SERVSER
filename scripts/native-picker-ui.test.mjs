import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const js = read('static/admin/admin.js');
const html = read('static/admin/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const shared = js.slice(js.indexOf('async function selectNativeDirectories('), js.indexOf('async function loadSyncTasks('));
const idle = js.slice(js.indexOf('function normalizeMediaRootPath('), js.indexOf('function setupCloudEventListeners('));
const invoke = js.slice(js.indexOf('function getTauriInvoke('), js.indexOf('function initTauriTest('));
assert.doesNotMatch(html, /media-directory-modal|singer-image-match-roots|available-disks-container/);
assert.doesNotMatch(js, /loadDrives|loadImageRoots|listFs\(|getCloudDirectories\(/);
const browser = await chromium.launch({headless:true,channel:'msedge'});
try {
    const page = await browser.newPage();
    await page.setContent(html);
    await page.addScriptTag({content:`
        window.calls=[]; window.messages=[]; window.selection=null;
        window.showToast=(message)=>messages.push(message);
        window.__TAURI__={tauri:{invoke:async(command,args)=>{
            calls.push({command,args});
            if(window.gate) await window.gate;
            if(window.failure) throw new Error(failure);
            return window.selection;
        }}};
        ${invoke}
        ${shared}
        ${idle}
        document.getElementById('choose-cloud-directory-btn').onclick=chooseCloudDirectory;
        document.getElementById('settings-media-root-browse').onclick=()=>chooseDirectoryForInput('settings-media-root','mediaRoots');
    `});
    const cases = [
        ['cloud-download-dir','choose-cloud-directory-btn','cloudDownload',['D:/视频 保存']],
        ['settings-media-root','settings-media-root-browse','mediaRoots',['D:/MV','E:/歌曲']],
        ['scan-directories','scan-directories-browse','songScan',['D:/MV','F:/MV']],
        ['singer-image-match-directory','singer-image-directory-browse','singerImages',['E:/歌星 图片']],
    ];
    for(const [input,button,purpose,paths] of cases) {
        await page.evaluate(({input,button,paths})=>{
            document.getElementById(input).value='C:/旧目录'; selection=paths;
            document.getElementById(button).click();
        },{input,button,paths});
        await page.waitForFunction(()=>!window.nativeDirectoryPickerOpen);
        assert.equal(await page.locator('#'+input).inputValue(),paths.join(';'));
        const call=await page.evaluate(()=>calls.at(-1));
        assert.deepEqual(call,{command:'select_directories',args:{purpose,initialPath:'C:/旧目录'}});
        await page.evaluate(({button})=>{selection=null;document.getElementById(button).click();},{button});
        await page.waitForFunction(()=>!window.nativeDirectoryPickerOpen);
        assert.equal(await page.locator('#'+input).inputValue(),paths.join(';'));
    }
    await page.evaluate(async()=>{
        window.idleSaved=[]; document.getElementById('settings-media-root').value='D:/MV';
        selection=['D:/MV/空闲歌曲']; await openMediaDirectoryPicker('D:/MV',p=>idleSaved.push(p));
    });
    assert.deepEqual(await page.evaluate(()=>idleSaved),['D:/MV/空闲歌曲']);
    assert.equal(await page.evaluate(()=>calls.at(-1).args.purpose),'idleSongs');
    await page.evaluate(async()=>{
        selection=null; await openMediaDirectoryPicker('D:/MV',p=>idleSaved.push(p));
        selection=['D:/Other']; await openMediaDirectoryPicker('D:/MV',p=>idleSaved.push(p));
    });
    assert.equal(await page.evaluate(()=>idleSaved.length),1);
    assert.match(await page.evaluate(()=>messages.at(-1)),/媒体根目录/);
    const before=await page.evaluate(()=>calls.length);
    await page.evaluate(()=>{
        window.gate=new Promise(resolve=>window.release=resolve);
        chooseCloudDirectory(); chooseCloudDirectory();
    });
    assert.equal(await page.evaluate(()=>calls.length),before+1);
    await page.evaluate(async()=>{selection=null;release();await gate;gate=null;});
    await page.waitForFunction(()=>!window.nativeDirectoryPickerOpen);
    await page.evaluate(async()=>{failure='原生窗口错误';await chooseCloudDirectory();failure=null;});
    assert.equal(await page.evaluate(()=>nativeDirectoryPickerOpen),false);
    assert.equal(await page.evaluate(()=>messages.at(-1)),'原生窗口错误');
    await page.evaluate(async()=>{__TAURI__=undefined;await chooseCloudDirectory();});
    assert.match(await page.evaluate(()=>messages.at(-1)),/HVideo Admin/);
    // Upload controls already use the operating system picker and retain their filters.
    assert.equal(await page.locator('#song-import-file').getAttribute('type'),'file');
    assert.equal(await page.locator('#singer-import-file').getAttribute('type'),'file');
    console.log('PASS five directory purposes, native command contract, multi-selection, Unicode, cancellation, idle root boundary, duplicate-click lock, error recovery, browser limitation, native upload controls');
} finally { await browser.close(); }

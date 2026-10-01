import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const source = read('static/admin/admin.js');
const helpers = source.slice(source.indexOf('async function loadCloudConfig()'), source.indexOf('async function loadSyncTasks('));
const listeners = source.slice(source.indexOf('    const cloudDirectory ='), source.indexOf('    const syncTaskPrevBtn ='));
const html = read('static/admin/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
mkdirSync(new URL('outputs/cloud-updates-20260924/', root), { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    await page.setContent(html);
    await page.addScriptTag({ content: read('static/libs/tailwindcss.js') });
    await page.addScriptTag({ content: `
        window.savedRequests = []; window.statusCalls = 0; window.updateCalls = 0;
        window.failSave = false; window.failStatus = false; window.updating = false; window.entitled = true; window.testDir = 'D:/MV/cloud';
        window.testMode = 'manual'; window.directoryCalls = []; window.testLoggedIn = true;
        window.__TAURI__ = { tauri: { invoke: async (command, args) => { directoryCalls.push({command,args}); if (command !== 'select_directories') throw new Error('unexpected command'); return args.purpose === 'cloudDownload' ? ['D:/MV/cloud'] : ['D:/selected']; } } };
        window.getTauriInvoke = () => window.__TAURI__.tauri.invoke;
        Object.defineProperty(window, 'localStorage', {value:{getItem:()=>testLoggedIn ? 'test-token' : null}});
        window.apiService = {
            getCloudConfig: async () => ({data:{downloadDir:testDir,updateMode:testMode}}),
            saveCloudConfig: async data => { if (failSave) throw new Error('磁盘不可写'); savedRequests.push(data); testMode=data.updateMode; testDir=data.downloadDir; return {data}; },
            getCloudStatus: async () => {
                statusCalls++; if (window.statusGate) await statusGate; if (failStatus) throw new Error('连接超时');
                return {data:{configured:true,reachable:true,downloadDir:testDir,updateMode:testMode,message:'服务器正常',updating,authorization:{enabled:true,valid:entitled,expiresAt:1893455999,message:entitled?'有效':'云端更新授权已到期，请续期'},
                    packages:entitled?[{id:'test',name:'20260923',versionCode:20260923,songCount:57311,videoCount:1,totalSize:125885734,installed:false}]:[]}};
            },
            startCloudUpdates: async () => { updateCalls++; updating=true; return {data:[{id:'task1'}]}; }
        };
        window.showToast = () => {}; window.loadSyncTasks = async () => {};
        window.setInterval = (callback,delay) => { window.pollCallback=callback; window.pollDelay=delay; window.intervalCount=(window.intervalCount||0)+1; return 1; };
        ${helpers}
        ${listeners}
    ` });
    await page.evaluate(() => {
        const section = document.getElementById('cloud-section');
        document.body.replaceChildren(section);
        section.classList.remove('hidden'); document.body.style.background = '#111827';
        startCloudStatusPolling(); startCloudStatusPolling();
    });
    await page.waitForFunction(() => statusCalls === 1);
    assert.equal(await page.evaluate(() => intervalCount), 1);
    assert.equal(await page.evaluate(() => pollDelay), 30000);
    await page.evaluate(async () => { pollCallback(); await window.cloudStatusInFlight; });
    assert.equal(await page.evaluate(() => statusCalls), 2);
    await page.evaluate(() => { testLoggedIn=false; pollCallback(); });
    assert.equal(await page.evaluate(() => statusCalls), 2);
    await page.evaluate(() => {
        testLoggedIn=true; window.statusGate=new Promise(resolve=>window.releaseStatus=resolve);
        pollCallback(); pollCallback();
    });
    assert.equal(await page.evaluate(() => statusCalls), 3);
    await page.evaluate(async () => { releaseStatus(); await window.cloudStatusInFlight; window.statusGate=null; });
    for (const id of ['check-cloud-status-btn','import-songs','batch-import-btn','task-status-filter','refresh-tasks-btn']) assert.equal(await page.locator('#'+id).count(), 0);
    assert.equal(await page.locator('#cloud-status-icon').getAttribute('aria-label'), '云端已连接');
    assert.match(await page.locator('#cloud-authorization').textContent(), /云端更新到期日期/);
    assert.match(await page.locator('#cloud-packages').textContent(), /57,311.*视频 1/);
    assert.equal(await page.locator('#apply-cloud-updates-btn').isDisabled(), false);
    for (const id of ['cloud-api-base-url','cloud-api-key','cloud-clear-api-key','cloud-config-panel','cloud-status-title','cloud-status-time','cloud-status-message']) assert.equal(await page.locator('#'+id).count(),0);
    const titleBox = await page.locator('#cloud-section h3').first().boundingBox();
    const iconBox = await page.locator('#cloud-status-icon').boundingBox();
    assert.ok(Math.abs(titleBox.y-iconBox.y)<10 && iconBox.x>titleBox.x);
    await page.locator('#choose-cloud-directory-btn').click();
    await page.waitForFunction(() => document.getElementById('cloud-download-dir').value === 'D:/MV/cloud');
    assert.equal(await page.evaluate(() => directoryCalls.at(-1).command), 'select_directories');
    assert.equal(await page.evaluate(() => directoryCalls.at(-1).args.purpose), 'cloudDownload');
    await page.locator('#save-cloud-config-btn').click();
    await page.waitForFunction(() => savedRequests.length === 1);
    assert.equal(await page.evaluate(() => Object.hasOwn(savedRequests[0], 'apiKey')), false);
    assert.match(await page.locator('#cloud-config-message').textContent(), /保存并生效/);
    assert.deepEqual(await page.evaluate(() => Object.keys(savedRequests[0])), ['downloadDir','updateMode']);
    assert.equal(await page.evaluate(() => savedRequests[0].updateMode), 'manual');
    await page.locator('#cloud-update-mode').selectOption('auto');
    await page.evaluate(() => loadCloudStatus());
    assert.equal(await page.locator('#cloud-update-mode').inputValue(), 'auto');
    assert.match(await page.locator('#cloud-update-mode-hint').textContent(), /保存设置后生效.*自动模式/);
    assert.equal(await page.locator('#apply-cloud-updates-btn').isVisible(), false);
    await page.locator('#save-cloud-config-btn').click();
    await page.waitForFunction(() => savedRequests.length === 2);
    assert.equal(await page.evaluate(() => savedRequests[1].updateMode), 'auto');
    await page.evaluate(() => loadCloudConfig());
    assert.equal(await page.locator('#cloud-update-mode').inputValue(), 'auto');
    assert.match(await page.locator('#cloud-update-mode-hint').textContent(), /每 5 分钟/);
    assert.equal(await page.locator('#apply-cloud-updates-btn').isVisible(), false);
    assert.equal(await page.evaluate(() => updateCalls), 0);
    await page.locator('#cloud-update-mode').selectOption('manual');
    await page.locator('#save-cloud-config-btn').click();
    await page.waitForFunction(() => savedRequests.length === 3);
    assert.equal(await page.evaluate(() => savedRequests[2].updateMode), 'manual');
    assert.equal(await page.locator('#apply-cloud-updates-btn').isVisible(), true);
    await page.locator('#cloud-download-dir').fill('F:/手工选择');
    await page.evaluate(async () => { testDir='E:/HVideoCloudUpdates'; await loadCloudStatus(); });
    assert.equal(await page.locator('#cloud-download-dir').inputValue(),'F:/手工选择');
    await page.evaluate(async () => { delete document.getElementById('cloud-download-dir').dataset.dirty; await loadCloudStatus(); });
    assert.equal(await page.locator('#cloud-download-dir').inputValue(),'E:/HVideoCloudUpdates');
    await page.evaluate(async () => { entitled=false; await loadCloudStatus(); });
    assert.equal(await page.locator('#apply-cloud-updates-btn').isDisabled(),true);
    assert.match(await page.locator('#cloud-authorization').textContent(),/已到期/);
    assert.equal(await page.locator('#cloud-packages').textContent(), '');
    assert.equal(await page.locator('#cloud-status-icon').getAttribute('aria-label'),'云端已连接');
    await page.evaluate(async () => { entitled=true; await loadCloudStatus(); });
    await page.evaluate(() => { failSave = true; });
    await page.locator('#save-cloud-config-btn').click();
    await page.waitForFunction(() => document.getElementById('cloud-config-message').textContent.includes('磁盘不可写'));
    assert.equal(await page.locator('#save-cloud-config-btn').isDisabled(), false);
    await page.evaluate(async () => { failStatus = true; await loadCloudStatus(); });
    assert.equal(await page.locator('#cloud-status-icon').getAttribute('aria-label'),'云端未连接');
    assert.equal(await page.locator('#cloud-status-icon').evaluate(el=>el.style.color),'rgb(239, 68, 68)');
    assert.equal(await page.locator('#apply-cloud-updates-btn').isDisabled(), true);
    await page.evaluate(async () => { failStatus = false; await loadCloudStatus(); });
    await page.locator('#apply-cloud-updates-btn').click();
    await page.waitForFunction(() => updateCalls === 1 && document.getElementById('apply-cloud-updates-btn').textContent.includes('正在更新'));
    assert.equal(await page.locator('#apply-cloud-updates-btn').isDisabled(), true);
    assert.equal(await page.locator('#choose-cloud-directory-btn').isDisabled(),true);
    assert.equal(await page.locator('#cloud-update-mode').isDisabled(),true);
    await page.evaluate(() => { document.getElementById('cloud-config-message').textContent=''; });
    await page.screenshot({ path: new URL('outputs/cloud-updates-20260924/cloud-updates.png', root).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
    assert.equal(await page.evaluate(() => directoryCalls.filter(item => item.command === 'select_directories').length), 1);
    // Exercise the actual task polling function through idle, active, failed and overlapping requests.
    await page.addScriptTag({ content: `
        var syncTaskPage=1, syncTaskPageSize=20, syncTaskRefreshTimer=null, syncTaskLoading=false;
        window.taskQueries=[]; window.taskRunning=0; window.taskFailure=false;
        window.taskTimers=new Map(); window.taskTimerId=0;
        window.setTimeout=(callback,delay)=>{ const id=++taskTimerId; taskTimers.set(id,{callback,delay}); return id; };
        window.clearTimeout=id=>taskTimers.delete(id);
        window.showLoading=()=>{}; window.hideLoading=()=>{};
        window.escapeHtml=value=>String(value);
        window.apiService.getSyncTasks=async query=>{
            taskQueries.push(query); if(window.taskGate) await taskGate;
            if(taskFailure) throw new Error('temporary task failure');
            return {data:{items:window.testTasks||[],total:40,page:query.page,pageSize:20,pending:0,running:taskRunning,completed:2,failed:0}};
        };
        window.runTaskPoll=async()=>{const [id,timer]=[...taskTimers][0];taskTimers.delete(id);await timer.callback();};
        ${source.slice(source.indexOf('async function loadSyncTasks('), source.indexOf('async function loadRecentActivities('))}
    ` });
    await page.evaluate(() => loadSyncTasks(true));
    assert.deepEqual(await page.evaluate(()=>taskQueries[0]),{page:1,pageSize:20});
    assert.equal(await page.evaluate(()=>[...taskTimers.values()][0].delay),10000);
    await page.evaluate(async()=>{taskRunning=1;await runTaskPoll();});
    assert.equal(await page.evaluate(()=>[...taskTimers.values()][0].delay),1500);
    await page.evaluate(async()=>{taskRunning=0;await runTaskPoll();});
    assert.equal(await page.evaluate(()=>[...taskTimers.values()][0].delay),10000);
    await page.evaluate(async()=>{taskFailure=true;await runTaskPoll();});
    assert.equal(await page.evaluate(()=>taskTimers.size),1);
    await page.evaluate(async()=>{taskFailure=false;await runTaskPoll();});
    await page.evaluate(()=>{window.taskGate=new Promise(resolve=>window.releaseTasks=resolve);window.taskLoad=loadSyncTasks(true);syncTaskPage=2;loadSyncTasks(true);});
    const duringRequest=await page.evaluate(()=>taskQueries.length);
    await page.evaluate(async()=>{releaseTasks();await taskLoad;window.taskGate=null;});
    assert.equal(await page.evaluate(()=>taskQueries.length),duringRequest);
    assert.equal(await page.evaluate(()=>syncTaskPage),2);
    assert.equal(await page.evaluate(()=>[...taskTimers.values()][0].delay),0);
    await page.evaluate(()=>runTaskPoll());
    assert.equal(await page.evaluate(()=>taskQueries.at(-1).page),2);
    await page.evaluate(async()=>{window.testTasks=[{id:'resume-test',taskType:'download',targetType:'vodPackage',targetId:'test',status:1,fileSize:100,downloadedSize:60,errorMessage:'网络中断，已保留进度，5 秒后自动续传（第 1 次）：test.mp4'}];await loadSyncTasks(true);});
    assert.match(await page.locator('#tasks-table').innerText(),/等待自动续传/);
    assert.match(await page.locator('#tasks-table').innerText(),/60%/);
    assert.equal(await page.locator('#tasks-table .trigger-download-btn').count(),0);
    await page.evaluate(async()=>{testTasks[0].errorMessage='正在断点续传：test.mp4';await loadSyncTasks(true);});
    assert.match(await page.locator('#tasks-table').innerText(),/断点续传中/);
    await page.evaluate(async()=>{document.getElementById('cloud-section').classList.add('hidden');await runTaskPoll();});
    assert.equal(await page.evaluate(()=>taskTimers.size),0);
    await page.evaluate(async()=>{document.getElementById('cloud-section').classList.remove('hidden');await loadSyncTasks(true);testLoggedIn=false;await runTaskPoll();});
    assert.equal(await page.evaluate(()=>taskTimers.size),0);
    console.log('PASS task polling: idle 10s, active 1.5s, error retry, request deduplication, pagination race, pause off-page/logout; filter and refresh removed');
    console.log('PASS cloud UI: one startup timer / 30 seconds, title cloud icon, expiry, hidden connection settings, native directory invoke, directory/mode API, persisted auto/manual, no duplicate authorization, auto-switch display, expired grant, failed connection recovery, update action');
} finally { await browser.close(); }

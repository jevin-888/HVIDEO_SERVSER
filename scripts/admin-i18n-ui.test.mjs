import {chromium} from 'playwright';
import {readFileSync, mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url), read=p=>readFileSync(new URL(p,root),'utf8');
const html=read('static/admin/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const browser=await chromium.launch({headless:true,channel:'msedge'});
let persisted='zh', writes=[];
async function setup(page,native=false){
 await page.route('http://admin.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
 await page.exposeFunction('testNativeLanguage',async(command,args)=>{if(command==='get_admin_language')return persisted;if(command==='set_admin_language'){persisted=args.language;writes.push(args.language);return;}throw Error(command);});
 if(native)await page.addInitScript(()=>{window.__TAURI__={tauri:{invoke:(command,args)=>testNativeLanguage(command,args)}};});
 await page.goto('http://admin.test/');
 await page.evaluate(()=>{window.apiService={};});
 await page.addScriptTag({content:read('static/libs/tailwindcss.js')});
 await page.addStyleTag({content:read('static/admin/responsive.css')});
 for(const f of ['i18n-catalog.js','i18n-admin.js','i18n.js','app-update.js','rom-update.js'])await page.addScriptTag({content:read('static/admin/'+f)});
}
try{
 const context=await browser.newContext();const page=await context.newPage();await setup(page);
 const chineseNames=await page.locator('.nav-item span').allTextContents();
 await page.evaluate(()=>{
  document.getElementById('cloud-download-dir').value='D:/歌曲/云端更新';
  document.getElementById('songs-table').innerHTML='<tr><td>123</td><td>CL</td><td>云端更新</td><td>系统概览</td><td>国语</td><td>流行</td><td>MP4</td><td>2</td><td>是</td></tr>';
  const button=document.getElementById('save-cloud-config-btn');window.savedClicks=0;button.addEventListener('click',e=>{e.preventDefault();savedClicks++;});
 });
 for(const [code,title] of [['en','Overview'],['id','Ringkasan'],['vi','Tổng quan'],['th','ภาพรวม'],['zh','系统概览']]){
  await page.locator('[data-admin-language]').first().selectOption(code);
  await page.waitForFunction(code=>AdminI18n.language===code,code);
  assert.equal(await page.locator('.nav-item[data-section="dashboard"] span').textContent(),title);
  assert.equal(await page.locator('[data-admin-language]').last().inputValue(),code);
  assert.equal(await page.locator('#cloud-download-dir').inputValue(),'D:/歌曲/云端更新');
  assert.equal(await page.locator('#songs-table td').nth(2).textContent(),'云端更新');
  assert.equal(await page.locator('#songs-table td').nth(3).textContent(),'系统概览');
 }
 assert.deepEqual(await page.locator('.nav-item span').allTextContents(),chineseNames);
 await page.locator('[data-admin-language]').first().selectOption('en');
 await page.evaluate(()=>{document.getElementById('cloud-authorization').textContent='云端更新到期日期：2027-09-24';document.getElementById('sync-task-page-summary').textContent='第 2 / 3 页，共 50 条';});
 await page.waitForFunction(()=>document.getElementById('sync-task-page-summary').textContent==='Page 2 / 3, 50 items');
 assert.equal(await page.locator('#cloud-authorization').textContent(),'Cloud updates expire: 2027-09-24');
 assert.equal(await page.locator('#app-update-start').textContent(),'Install');
 assert.equal(await page.locator('#app-update-file-info').textContent(),'No package selected');
 assert.equal(await page.locator('#rom-title').textContent(),'ROM updates');
 assert.match(await page.evaluate(()=>AdminI18n.t('发布 ROM v34？匹配设备下次启动将自动升级，系统数据将重建，/huoshan 保留。')),/^Publish ROM v34/);
 await page.evaluate(()=>{document.getElementById('login-page').classList.add('hidden');document.getElementById('admin-page').classList.remove('hidden');document.querySelectorAll('.section-content').forEach(n=>n.classList.add('hidden'));document.getElementById('cloud-section').classList.remove('hidden');});
 await page.locator('#save-cloud-config-btn').click();assert.equal(await page.evaluate(()=>savedClicks),1);
 // Ensure only presentation changes: option values and HTML form inputs are untouched.
 assert.deepEqual(await page.locator('#cloud-update-mode option').evaluateAll(nodes=>nodes.map(n=>n.value)),['manual','auto']);
 const missing=await page.evaluate(()=>{
  const ignore='script,style,code,pre,[translate="no"],[data-i18n-ignore],#songs-table,#syslog-container';
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const result=new Set();
  while(walker.nextNode()){const node=walker.currentNode;if(node.parentElement.closest(ignore))continue;const source=AdminI18n.sourceText(node.parentElement).trim().replace(/\s+/g,' ');if(node.parentElement.childNodes.length===1&&/[\u4e00-\u9fff]/.test(node.nodeValue)&&AdminI18n.t(source)===source)result.add(source);}
  return [...result];
 });
 assert.deepEqual(missing,[],'Untranslated static UI text');
 mkdirSync(new URL('outputs/admin-i18n-20260924/',root),{recursive:true});
 await page.screenshot({path:new URL('outputs/admin-i18n-20260924/cloud-en.png',root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
 const second=await context.newPage();await setup(second);assert.equal(await second.evaluate(()=>AdminI18n.language),'en');
 await context.close();
 const nativeContext=await browser.newContext();const desktop=await nativeContext.newPage();await setup(desktop,true);
 await desktop.evaluate(()=>AdminI18n.setLanguage('vi'));assert.equal(persisted,'vi');
 await desktop.evaluate(()=>localStorage.clear());await desktop.close();
 const restarted=await nativeContext.newPage();await setup(restarted,true);await restarted.waitForFunction(()=>AdminI18n.language==='vi');
 assert.equal(await restarted.locator('[data-admin-language]').first().inputValue(),'vi');
 await restarted.evaluate(async()=>{await Promise.all([AdminI18n.setLanguage('th'),AdminI18n.setLanguage('en')]);});assert.equal(persisted,'en');
 assert.equal(writes.at(-1),'en');
 await nativeContext.close();
 console.log('PASS five languages, static coverage, dynamic updates, Chinese roundtrip, preserved names/paths/form values/events, browser persistence, native restart persistence and ordered saves');
}finally{await browser.close();}


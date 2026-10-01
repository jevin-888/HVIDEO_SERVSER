import {chromium} from 'playwright';
import {readFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const input=JSON.parse(readFileSync(0,'utf8'));
const root=new URL('../',import.meta.url);
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 const requests=[]; page.on('requestfailed',req=>requests.push([new URL(req.url()).pathname,req.failure()?.errorText])); page.on('response',res=>{const u=new URL(res.url());if(u.pathname.startsWith('/api/'))requests.push([u.pathname,res.status()]);});
 const failures=[];page.on('pageerror',e=>failures.push(e.message));
 await page.goto(input.base+'/static/admin/index.html');
 await page.locator('#login-page:not(.hidden)').waitFor();
 await page.locator('[data-admin-language]').first().selectOption('vi');
 assert.equal(await page.evaluate(()=>AdminI18n.language),'vi');
 await page.addInitScript(token=>localStorage.setItem('admin_token',token),input.token);
 await page.reload();
 try { await page.locator('#admin-page:not(.hidden)').waitFor({timeout:10000}); } catch(error) { console.log('Page errors:',failures);console.log('License UI:',await page.locator('#license-status-message').allTextContents());console.log('Requests:',requests);console.log('Token present:',await page.evaluate(()=>!!localStorage.getItem('admin_token')));throw error; }
 await page.locator('.nav-item[data-section="cloud"]').click();
 await page.waitForTimeout(600);
 const originalMode=await page.locator('#cloud-update-mode').inputValue();
 for(const code of ['en','id','vi','th','zh']) {
  await page.locator('[data-admin-language]').last().selectOption(code);
  assert.equal(await page.locator('#page-title').textContent(),await page.evaluate(()=>AdminI18n.t('云端更新')));
  assert.equal(await page.locator('#cloud-update-mode').inputValue(),originalMode);
  for(const width of [1280,900]){
   await page.setViewportSize({width,height:800});await page.waitForTimeout(400);
   const bounds=await page.locator('[data-admin-language]').last().boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'page overflow '+code+' '+width);
  }
  if(code==='en'){
   mkdirSync(new URL('outputs/admin-i18n-20260924/',root),{recursive:true});
   await page.screenshot({path:new URL('outputs/admin-i18n-20260924/cloud-live-en.png',root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  }
 }
 if(input.verifyServerLicense){
  const status=await page.evaluate(async()=> (await apiService.getLicenseStatus()).data);
  assert.equal(status.cloudConnected,true);assert.equal(status.valid,true);assert(['cloud','cloud_cache','local'].includes(status.source));
  await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(400);
  await page.locator('.nav-item[data-section="settings"]').click();
  await page.waitForFunction(()=>document.getElementById('admin-license-source').textContent.length>0);
  assert.match(await page.locator('#admin-license-source').textContent(),/云端/);
  mkdirSync(new URL('outputs/cloud-server-license-20260924/',root),{recursive:true});
  await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(400);
  await page.screenshot({path:new URL('outputs/cloud-server-license-20260924/license-live.png',root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
 }
 assert.deepEqual(failures,[]);
 console.log('PASS live login/admin five languages, cloud title, download mode preserved, 900/1280px layout, no page errors');
}finally{await browser.close();}

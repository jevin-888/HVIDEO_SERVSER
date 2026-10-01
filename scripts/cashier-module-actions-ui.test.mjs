import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const writes = [], errors = [], settings = new Map();
let categories = [{ id: 'cat', name: '酒水' }], locations = [{ id: 'loc', name: '吧台' }];
let products = [], transactions = [], printers = [];
let failMutation = false;
const room = { id: 'room', name: 'VIP888', typeId: 1, areaId: 1, status: 0 };
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(() => {
        window.messages = [];
        window.chrome.webview = { postMessage: m => window.messages.push(m) };
        window.WebSocket = class { static OPEN = 1; static CONNECTING = 0; readyState = 1; close() {} };
    });
    await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.hostname !== 'cashier.test') return route.abort();
        if (url.pathname.startsWith('/static/')) {
            try { return route.fulfill({ contentType: url.pathname.endsWith('.html') ? 'text/html' : 'application/javascript', body: readFileSync(new URL(url.pathname.slice(1), root)) }); }
            catch { return route.fulfill({ status: 404, body: '' }); }
        }
        const path = url.pathname.replace('/api/v1', ''), method = req.method(), body = req.postDataJSON();
        if (method !== 'GET') writes.push({ path, method, body });
        if (method !== 'GET' && failMutation) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 503, message: '测试：服务器暂不可用' }) });
        let data = [];
        if (path === '/rooms') data = [room];
        else if (path === '/rooms/configs/types') data = [{ id: 1, name: '标准' }];
        else if (path === '/rooms/configs/areas') data = [{ id: 1, name: '一楼' }];
        else if (path === '/admin/warehouse/categories') { if (method === 'POST') categories.push({ id: 'new-cat', ...body }); data = categories; }
        else if (path.startsWith('/admin/warehouse/categories/')) categories = categories.filter(c => c.id !== path.split('/').pop());
        else if (path === '/admin/warehouse/locations') { if (method === 'POST') locations.push({ id: 'new-loc', ...body }); data = locations; }
        else if (path.startsWith('/admin/warehouse/locations/')) locations = locations.filter(c => c.id !== path.split('/').pop());
        else if (path === '/admin/warehouse/products') { products.push({ id: 'p1', ...body, stock: body.initial_stock, enabled: 1 }); data = products.at(-1); }
        else if (path === '/admin/warehouse/inventory' || path === '/products') data = products;
        else if (path === '/admin/warehouse/products/p1/in' || path === '/admin/warehouse/products/p1/out') {
            const incoming = path.endsWith('/in');
            products[0].stock += body.quantity * (incoming ? 1 : -1);
            transactions.push({ id: String(transactions.length), productName: products[0].name, ...body, transactionType: incoming ? 'in' : 'out' });
            data = products[0];
        } else if (path === '/admin/warehouse/transactions') data = transactions.filter(t => t.transactionType === url.searchParams.get('transactionType'));
        else if (path === '/admin/warehouse/products/p1' && method === 'DELETE') products = [];
        else if (path === '/admin/billing-settings') data = [...settings].map(([key, value]) => ({ key, value }));
        else if (path.startsWith('/admin/billing-settings/')) { const key = path.split('/').pop(); settings.set(key, body.value); data = { key, value: body.value }; }
        else if (path === '/admin/pad-ordering/status') data = { enabled: body?.enabled || false };
        else if (path === '/admin/printers') { if (method === 'POST') printers.push({ id: 'printer', ...body }); data = printers; }
        else if (path === '/admin/printers/printer') { if (method === 'DELETE') printers = []; else printers[0] = { ...printers[0], ...body }; data = printers[0]; }
        else if (path === '/admin/finance/report') data = { room_income: 60, beverage_income: 10, total_income: 70, records: [{ sessionId: 'bill', roomId: 'room', roomName: 'VIP888', roomAmount: 60, beverageAmount: 10, paidAmount: 65, payableAmount: 65, paymentMethod: 'cash', shiftName: '白班' }] };
        else if (path === '/admin/finance/sessions/bill/details') data = { roomName: 'VIP888', session: { id: 'bill', roomAmount: 60, beverageAmount: 10, discountAmount: 5, payableAmount: 65, paidAmount: 65 }, items: [{ productName: '可乐', quantity: 1, price: 10, amount: 10 }] };
        else if (path === '/admin/shifts/report') data = { total_income: 70 };
        else if (!['/admin/members', '/admin/reservations', '/products/categories', '/admin/service-calls', '/admin/service-types', '/admin/employees', '/admin/employee-roles'].includes(path)) errors.push(`Unexpected API: ${method} ${path}`);
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://cashier.test/static/cashier/index.html?desktop=1');
    await page.waitForFunction(() => window.messages.some(m => m.type === 'ready'));
    await page.evaluate(() => hvideoDesktopConnect({ token: 'test', employee: { id: 'e', roleId: 'admin', name: '测试' }, module: null }));
    const click = handler => page.locator(`[onclick="${handler}"]`).click();
    const confirm = () => page.locator('#cashier-dialog-confirm').click();
    const module = async name => { await page.evaluate(name => hvideoDesktopShowModule(name), name); await page.locator(`#page-${name}`).waitFor({ state: 'visible' }); };

    // Every static inline entry must name an actual implementation.
    const missing = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => /^on/.test(a.name)).flatMap(a => [...a.value.matchAll(/(?<![\w.])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))).filter(name => !['if', 'Number', 'String'].includes(name) && typeof window[name] !== 'function'));
    assert.deepEqual([...new Set(missing)], []);

    await module('warehouse');
    await page.locator('#warehouse-new-product-category option[value="cat"]').waitFor({ state: 'attached' });
    for (const [kind, label, handler] of [['category', '测试类别', 'Category'], ['location', '测试库房', 'Location']]) {
        await page.locator(`#warehouse-${kind}-name`).fill(label);
        await click(`createWarehouse${handler}()`);
        await page.locator(`#warehouse-${kind}-list`).getByText(label, { exact: true }).waitFor();
        await click(`toggleWarehouse${handler}Edit()`);
        await click(`deleteWarehouse${handler}('new-${kind === 'category' ? 'cat' : 'loc'}')`);
        await confirm();
        await page.locator(`#warehouse-${kind}-list`).getByText(label, { exact: true }).waitFor({ state: 'hidden' });
        await click(`toggleWarehouse${handler}Edit()`);
    }
    await page.locator('#warehouse-new-product-name').fill('测试可乐');
    await page.locator('#warehouse-new-product-category').selectOption('cat');
    await page.locator('#warehouse-new-product-price').fill('10');
    await page.locator('#warehouse-new-product-stock').fill('5');
    failMutation = true;
    await click('createWarehouseProduct()');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('测试：服务器暂不可用'));
    assert.equal(products.length, 0);
    assert.equal(await page.locator('#warehouse-new-product-name').inputValue(), '测试可乐');
    failMutation = false;
    await click('createWarehouseProduct()');
    await page.locator('#warehouse-inventory-table').getByText('测试可乐').waitFor();
    assert.equal(products[0].stock, 5);
    await click("switchWarehouseTab('inbound-form')");
    await page.locator('#warehouse-inbound-product').selectOption('p1');
    await page.locator('#warehouse-inbound-quantity').fill('3');
    await page.locator('#warehouse-inbound-form button:not([type])').click();
    await page.waitForFunction(() => document.getElementById('warehouse-inbound-quantity').value === '');
    assert.equal(products[0].stock, 8);
    await click("switchWarehouseTab('inventory')");
    await page.locator('[onclick="openWarehouseOutbound(\'p1\')"]').click();
    await page.locator('#warehouse-outbound-quantity').fill('2');
    await page.locator('#warehouse-outbound-location').selectOption('loc');
    await click('submitWarehouseOutbound()');
    await page.locator('#warehouse-outbound-panel').waitFor({ state: 'hidden' });
    assert.equal(products[0].stock, 6);
    await click("switchWarehouseTab('inbound')");
    await page.locator('#warehouse-inbound-records').getByText('测试可乐').waitFor();
    await click("switchWarehouseTab('outbound')");
    await page.locator('#warehouse-outbound-records').getByText('测试可乐').waitFor();

    await module('base-settings');
    await page.waitForFunction(() => document.getElementById('setting-printer-list').textContent.includes('暂无'));
    await page.locator('#setting-store-name').fill('测试门店');
    await click('saveStoreInfoSetting()');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('门店信息已保存'));
    assert.equal(settings.get('store_info').name, '测试门店');
    for (const [handler, path] of [['saveBusinessHoursSetting()', '/billing-settings/business_hours'], ['saveTrialSingingSetting()', '/billing-settings/trial_singing'], ['savePadOrderingStatus()', '/pad-ordering/status']]) {
        await Promise.all([page.waitForResponse(r => r.request().method() !== 'GET' && r.url().includes(path)), click(handler)]);
    }
    await page.locator('#setting-printer-name').fill('测试打印机');
    await page.locator('#setting-printer-address').fill('default');
    await click('savePrinterConfig()');
    await page.locator('#setting-printer-list').getByText('测试打印机').waitFor();
    printers[0].enabled = 0;
    await page.evaluate(() => loadPrinterConfigs());
    await page.locator('#setting-printer-list button').filter({ hasText: '修改' }).click();
    await page.locator('#setting-printer-name').fill('已修改打印机');
    await click('savePrinterConfig()');
    await page.locator('#setting-printer-list').getByText('已修改打印机').waitFor();
    assert.equal(printers[0].enabled, 0, 'editing a disabled printer must preserve its disabled state');
    await page.locator('#setting-printer-list button').filter({ hasText: '删除' }).click(); await confirm();
    await page.waitForFunction(() => document.getElementById('setting-printer-list').textContent.includes('暂无'));
    await page.locator('#setting-holiday-date-input').fill('2026-10-01');
    await click('addHolidayDate()'); await click('saveHolidayDatesSetting()');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('节假日已保存'));
    assert.deepEqual(settings.get('holiday_dates'), ['2026-10-01']);
    for (const [tab, key, add] of [['rates', 'room_type_rates', 'addRoomTypeRateRow()'], ['buyout', 'buyout_periods', 'addBuyoutPeriodRow()'], ['activity', 'activity_rules', 'addActivityRuleRow()'], ['packages', 'package_configs', 'addPackageConfig()'], ['gifts', 'room_type_gifts', 'addRoomTypeGiftRow()']]) {
        await click(`showBillingSettingTab('${tab}')`); await click(add);
        await Promise.all([page.waitForResponse(r => r.url().includes(`/billing-settings/${key}`)), click(`saveJsonBillingSetting('${key}')`)]);
        assert.ok(settings.has(key), key);
    }
    // Click page-owned controls; do not use selectOption/fill to bypass their UI.
    await click("showBillingSettingTab('rates')");
    await click('addRoomTypeRateRow()');
    const rate = page.locator('#setting-room-type-rates-rows tr').last();
    await rate.locator('select').click();
    assert.equal(await page.locator('.cashier-control-overlay').count(), 0, 'select must not open a modal');
    const anchor = await rate.locator('select').boundingBox();
    const dropdown = await page.locator('.cashier-select-dropdown').boundingBox();
    assert.ok(Math.abs(dropdown.x - anchor.x) < 2 && Math.abs(dropdown.y - anchor.y - anchor.height - 4) < 2, 'dropdown opens below its field');
    await page.locator('.cashier-select-dropdown').getByRole('option', { name: '标准', exact: true }).click();
    await rate.locator('select').click();
    await page.locator('#billing-setting-tab-rates').click();
    assert.equal(await page.locator('.cashier-select-dropdown').count(), 0, 'outside click closes dropdown');
    assert.equal(await rate.locator('select').inputValue(), '1');
    await rate.locator('button[onclick="openWeekdaysPicker(this)"]').click();
    await page.locator('.weekday-option[value="1"]').check();
    await page.locator('.weekday-option[value="5"]').check();
    assert.equal(await page.locator('#weekday-all').isChecked(), false);
    await confirm();
    assert.equal(await rate.locator('[data-field="weekdays"]').inputValue(), '1,5');
    await rate.locator('[data-field="start_time"]').click();
    await page.locator('[data-hour="9"]').click();
    await page.locator('[data-minute="30"]').click();
    await page.locator('.cashier-control-panel').getByRole('button', { name: '确定', exact: true }).click();
    assert.equal(await rate.locator('[data-field="start_time"]').inputValue(), '09:30');
    await rate.locator('[data-field="normal_price"]').fill('88');
    await Promise.all([page.waitForResponse(r => r.url().includes('/billing-settings/room_type_rates') && r.request().method() === 'PUT'), click("saveJsonBillingSetting('room_type_rates')")]);
    assert.deepEqual(settings.get('room_type_rates').at(-1).weekdays, [1,5]);
    assert.equal(settings.get('room_type_rates').at(-1).start_time, '09:30');
    assert.equal(settings.get('room_type_rates').at(-1).room_type_id, 1);
    await click('loadBillingBaseSettings()');
    await page.waitForFunction(() => document.querySelector('#setting-room-type-rates-rows [data-field="start_time"]')?.value === '09:30');
    for (const language of ['id','vi','th','en']) {
        await page.evaluate(language => hvideoSetLanguage(language), language);
        for (const tab of ['basic','rates','buyout','activity','packages','gifts']) {
            await click(`showBillingSettingTab('${tab}')`);
            const untranslated = await page.locator('#page-base-settings').evaluate(root => {
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), missing=[];
                while(walker.nextNode()) {
                    const node=walker.currentNode, el=node.parentElement;
                    if(el.tagName === 'OPTION' || el.tagName === 'TEXTAREA' || !el.checkVisibility()) continue;
                    const text=node.textContent.trim();
                    if(/[\u3400-\u9fff]/.test(text)) missing.push(text);
                }
                return [...new Set(missing)];
            });
            assert.deepEqual(untranslated, [], language + ':' + tab);
        }
        await click("showBillingSettingTab('rates')");
        const selectedRate = page.locator('#setting-room-type-rates-rows tr').last();
        await selectedRate.locator('select').focus();
        await page.keyboard.press('Enter');
        await page.locator('.cashier-select-dropdown').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        assert.equal(await selectedRate.locator('select').inputValue(), '1');
        await selectedRate.locator('button[onclick="openWeekdaysPicker(this)"]').click();
        assert.doesNotMatch(await page.locator('#cashier-dialog').innerText(), /[\u3400-\u9fff]/);
        await page.locator('#weekday-all').check();
        assert.equal(await page.locator('.weekday-option:checked').count(), 0);
        await page.locator('#cashier-dialog-cancel').click();
        assert.equal(await selectedRate.locator('[data-field="weekdays"]').inputValue(), '1,5');
        await click("showBillingSettingTab('basic')");
        await page.locator('#setting-holiday-date-input').click();
        assert.doesNotMatch(await page.locator('.cashier-date-picker').innerText(), /[\u3400-\u9fff]/);
        await page.locator('.cashier-date-picker [data-cancel]').click();
    }
    await page.evaluate(() => hvideoSetLanguage('zh'));
    await click("showBillingSettingTab('basic')");
    await page.locator('#setting-holiday-date-input').click();
    await page.locator('[data-days] button').first().click();
    await page.locator('.cashier-date-picker [data-confirm]').click();
    assert.match(await page.locator('#setting-holiday-date-input').inputValue(), /^\d{4}-\d{2}-\d{2}$/);
    await module('finance');
    await page.locator('#finance-records').getByText('VIP888').waitFor();
    await click("showFinanceDetails('bill')");
    await page.locator('#cashier-dialog-message').getByText('可乐', { exact: true }).waitFor();
    assert.match(await page.locator('#cashier-dialog-message').innerText(), /5\.00/);
    await confirm();
    await page.evaluate(() => hvideoDesktopCashierAction({ id: 55, action: 'desk' }));
    await page.locator('#page-checkout-desk').waitFor({ state: 'visible' });
    await click('submitShiftReport()'); await confirm();
    await page.waitForFunction(() => window.messages.some(m => m.type === 'sessionExpired'));
    assert.equal(writes.find(w => w.path === '/admin/shifts/report').body.employee_id, 'e');
    assert.equal(writes.find(w => w.path === '/admin/shifts/report').body.shiftName, '白班');
    assert.deepEqual(errors, []);
    assert.ok(writes.some(w => w.path.endsWith('/in') && w.body.quantity === 3));
    assert.ok(writes.some(w => w.path.endsWith('/out') && w.body.targetLocationId === 'loc'));
    console.log('PASS: handler inventory, warehouse create/in/out/records, settings saves, printer edit/delete, holidays, billing configuration tabs, finance details. Isolated API only.');
} finally { await browser.close(); }

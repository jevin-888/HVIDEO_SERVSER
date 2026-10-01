import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Run original cashier handlers against isolated in-memory API responses.
const root = new URL('../', import.meta.url);
const room = { id: 'room-2', name: 'VIP888', status: 0, typeId: 1, areaId: 1 };
const targetRoom = { ...room, id: 'room-1', name: '不可误选', status: 0 };
const writes = [], errors = [];
let bill = null;
let failRooms = false;
let failBill = false;
let wrongBillRoom = false;
let billGate = null;
let billStarted = null;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
        window.messages = [];
        window.chrome.webview = { postMessage: value => window.messages.push(value) };
        window.WebSocket = class { static OPEN = 1; static CONNECTING = 0; readyState = 1; close() {} };
    });
    await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.hostname !== 'cashier.test') return route.abort();
        if (url.pathname.startsWith('/static/')) {
            try { return route.fulfill({ contentType: url.pathname.endsWith('.html') ? 'text/html' : 'application/javascript', body: readFileSync(new URL(url.pathname.slice(1), root)) }); }
            catch { return route.fulfill({ status: 404, body: '' }); }
        }
        const path = url.pathname.replace('/api/v1', '');
        const body = request.postDataJSON();
        if (request.method() !== 'GET') writes.push({ path, body });
        assert.equal(request.headers().authorization, 'Bearer test-token');
        let data = [];
        if (path === '/rooms') {
            if (failRooms) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 503, message: '服务器暂时不可用' }) });
            data = [targetRoom, room];
        } else if (path === '/rooms/configs/types') data = [{ id: 1, name: '标准' }];
        else if (path === '/rooms/configs/areas') data = [{ id: 1, name: '一楼' }];
        else if (path === '/billing/price-preview') data = { hourly_price: 60, billingMode: 'minute' };
        else if (path === '/admin/members') data = [{ id: 'm1', card_no: 'VIP001', name: '测试会员', balance: 100, level: '普通会员' }];
        else if (path === '/billing/sessions/open') {
            assert.equal(body.roomId, room.id);
            room.status = 1;
            bill = { id: 'bill-test', roomId: room.id, status: 'active', startTime: new Date().toISOString(), roomAmount: 60, beverageAmount: 0, payableAmount: 60, billingMode: body.billingMode, shiftName: body.shiftName, order_items: [] };
            data = bill;
        } else if (path === '/billing/room-bill') {
            assert.equal(url.searchParams.get('roomId'), bill?.roomId || room.id);
            if (failBill) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 503, message: '测试：账单服务暂时不可用' }) });
            if (billGate) {
                const gate = billGate;
                billStarted?.resolve();
                await gate.promise;
            }
            if (!bill || bill.status === 'paid') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 404, message: '没有活动计费会话' }) });
            data = wrongBillRoom ? { ...bill, roomId: targetRoom.id } : bill;
        } else if (path === '/billing/sessions/bill-test/transfer') {
            assert.deepEqual(body, { targetRoomId: targetRoom.id });
            room.status = 0; targetRoom.status = 1; bill.roomId = targetRoom.id;
            data = bill;
        } else if (path === '/products') data = [{ id: 'water', name: '矿泉水', price: 10, status: 1, stock: 20 }];
        else if (path === '/orders') {
            assert.equal(body.roomId, room.id);
            bill.order_items = [{ productName: '矿泉水', productId: 'water', quantity: 1, price: 10, amount: 10 }];
            bill.beverageAmount = 10; bill.payableAmount = 70;
            data = { id: 'order-test' };
        } else if (path === '/billing/sessions/bill-test/pay') {
            room.status = 0; bill.status = 'paid'; data = bill;
        } else if (path === '/admin/finance/report') data = { records: [], total_income: 70, room_income: 60, beverage_income: 10 };
        else if (!['/admin/members', '/admin/reservations', '/products/categories', '/admin/billing-settings', '/admin/service-calls', '/admin/service-types'].includes(path)) {
            errors.push(`Unexpected API: ${path}`);
        }
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://cashier.test/static/cashier/index.html?desktop=1');
    await page.waitForFunction(() => window.messages.some(m => m.type === 'ready'));
    const connect = permissions => page.evaluate(permissions => hvideoDesktopConnect({ token: 'test-token', employee: { id: 'employee-test', name: '测试收银', roleId: 'cashier', extraPermissions: permissions }, shiftName: '夜班', module: null }), permissions);
    await connect(['cashier']);
    let sequence = 0;
    async function action(action, roomId = room.id, outcome = 'cashierActionReady') {
        const id = ++sequence;
        assert.equal(await page.evaluate(request => hvideoDesktopCashierAction(request), { id, action, roomId }), true);
        await page.waitForFunction(({ id, outcome }) => window.messages.some(m => m.id === id && m.type === outcome), { id, outcome });
        return id;
    }
    async function returned(id) { await page.waitForFunction(id => window.messages.some(m => m.id === id && m.type === 'cashierReturn'), id); }

    let id = await action('open');
    await page.locator('#open-customer-name').focus();
    await page.keyboard.press('Escape');
    await returned(id);
    assert.equal(writes.length, 0, 'Escape must return without opening a room');
    id = await action('open');
    assert.equal(await page.locator('#open-room-name').innerText(), 'VIP888');
    assert.equal(await page.locator('#open-room-type').innerText(), '标准');
    assert.equal(writes.length, 0, 'opening the form must not open a room');
    await page.locator('#open-billing-mode').click();
    await page.keyboard.press('F5');
    assert.equal(writes.length, 0, 'F5 must not submit through an open dropdown');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#page-open-room').isVisible(), true, 'first Escape closes the dropdown only');
    await page.locator('#open-timer-hours').selectOption('1');
    await page.locator('#open-timer-minutes').selectOption('30');
    await page.locator('#open-timer-reminder').selectOption('1');
    await page.locator('#open-customer-phone').fill('13800138000');
    await page.keyboard.press('F5');
    await page.keyboard.press('F5');
    await returned(id);
    assert.equal(writes.filter(w => w.path === '/billing/sessions/open').length, 1, 'repeated F5 must not open twice');
    assert.equal(writes[0].path, '/billing/sessions/open');
    assert.equal(writes[0].body.employee_id, 'employee-test');
    assert.equal(writes[0].body.shiftName, '夜班');
    assert.equal(writes[0].body.timerMinutes, 90);
    assert.equal(writes[0].body.timerReminderEnabled, true);

    id = await action('order');
    assert.equal(await page.locator('#order-room-title').innerText(), 'VIP888');
    await page.locator('#order-product-grid').getByText('矿泉水', { exact: true }).click();
    await page.locator('button[onclick="submitOrderPage()"]').click();
    await returned(id);
    assert.deepEqual(writes.find(w => w.path === '/orders').body, { roomId: room.id, items: [{ productId: 'water', quantity: 1 }], packages: [] });

    id = await action('print');
    const receipt = page.frameLocator('#desktop-bill-preview iframe');
    await receipt.getByText('VIP888', { exact: true }).waitFor();
    assert.match(await receipt.locator('body').innerText(), /矿泉水/);
    assert.match(await receipt.locator('body').innerText(), /70\.00/);
    await page.locator('#desktop-bill-preview iframe').evaluate(frame => { frame.contentWindow.print = () => { window.printInvoked = true; }; });
    await page.locator('#desktop-bill-preview button').first().click();
    assert.equal(await page.evaluate(() => window.printInvoked), true);
    assert.equal(context.pages().length, 1, 'printing must not depend on popups');
    await page.locator('#desktop-bill-preview button').last().click();
    await returned(id);

    failBill = true;
    id = await action('checkout');
    assert.equal(await page.locator('#checkout-submit').isDisabled(), true);
    assert.equal(await page.locator('#checkout-bill-status').innerText(), '测试：账单服务暂时不可用');
    await page.evaluate(() => submitCheckoutPage());
    assert.equal(writes.filter(w => w.path.endsWith('/pay')).length, 0);
    failBill = false;
    wrongBillRoom = true;
    await page.locator('#checkout-bill-retry').click();
    await page.waitForFunction(() => document.getElementById('checkout-bill-status').textContent.includes('房间不匹配'));
    assert.equal(await page.locator('#checkout-submit').isDisabled(), true);
    wrongBillRoom = false;
    await page.locator('#checkout-bill-retry').click();
    await page.waitForFunction(() => !document.getElementById('checkout-submit').disabled);

    // Leaving while a retry is in flight invalidates the late response.
    billGate = Promise.withResolvers(); billStarted = Promise.withResolvers();
    await page.evaluate(() => { window.reloadFinished = false; void reloadCheckoutBill().then(() => { window.reloadFinished = true; }); });
    await billStarted.promise;
    assert.equal(await page.locator('#checkout-submit').isDisabled(), true);
    await page.evaluate(() => backToCashierRooms());
    billGate.resolve(); billGate = null;
    await page.waitForFunction(() => window.reloadFinished);
    assert.equal(await page.evaluate(() => checkoutBill), null);

    id = await action('checkout');
    assert.equal(await page.locator('#checkout-payable').innerText(), '¥70.00');
    // A delayed room refresh can clear the legacy shared ID after checkout
    // rendered successfully. Payment must use the bill displayed on this page.
    await page.evaluate(() => { window.currentBillingSessionId = null; });
    await page.locator('.checkout-key').filter({ hasText: /^1$/ }).click();
    await page.locator('button[onclick="submitCheckoutPage()"]').click();
    assert.equal(await page.locator('#cashier-dialog').isVisible(), false, 'short cash tender must not submit');
    await page.locator('.checkout-key').filter({ hasText: /^0$/ }).click();
    await page.locator('.checkout-key').filter({ hasText: /^0$/ }).click();
    assert.equal(await page.locator('#checkout-received').inputValue(), '100');
    assert.equal(await page.locator('#checkout-change').innerText(), '¥30.00');
    await page.locator('[data-payment-method="member"]').click();
    await page.locator('#checkout-member').selectOption('m1');
    await page.locator('[data-payment-method="cash"]').click();
    await page.locator('button[onclick="submitCheckoutPage()"]').click();
    await page.locator('#cashier-dialog-cancel').click({ timeout: 5000 });
    assert.equal(writes.filter(w => w.path.endsWith('/pay')).length, 0);
    await page.locator('button[onclick="submitCheckoutPage()"]').click();
    await page.evaluate(() => { window.currentBillingSessionId = 'wrong-session'; });
    await page.locator('#cashier-dialog-confirm').click();
    await returned(id);
    const payment = writes.find(w => w.path.endsWith('/pay'));
    assert.equal(payment.body.paymentMethod, 'cash');
    assert.equal(payment.body.employee_id, 'employee-test');
    assert.equal(payment.body.shiftName, '夜班');
    assert.equal(payment.body.member_id, null, 'switching back to cash must not deduct member balance');
    assert.equal(room.status, 0);

    id = await action('open');
    await page.locator('#page-open-room button[onclick="submitOpenRoomPage()"]').click();
    await returned(id);
    id = await action('checkout');
    await page.locator('[data-payment-method="member"]').click();
    await page.locator('#checkout-member').selectOption('m1');
    await page.locator('button[onclick="submitCheckoutPage()"]').click();
    await page.locator('#cashier-dialog-confirm').click();
    await returned(id);
    assert.equal(writes.filter(w => w.path.endsWith('/pay')).at(-1).body.member_id, 'm1');

    id = await action('open');
    await page.locator('#page-open-room button[onclick="submitOpenRoomPage()"]').click();
    await returned(id);
    await action('room');
    await page.getByRole('button', { name: '房间操作', exact: true }).click();
    await page.locator('#cashier-room-context-actions').getByText('转房/换房', { exact: true }).click();
    await page.locator('#cashier-dialog-input').fill('1');
    await page.locator('#cashier-dialog-confirm').click();
    await page.waitForFunction(() => document.getElementById('cashier-room-id').value === 'room-1' && cashierRoomsCache.find(r => r.id === 'room-1').status === 1);
    assert.equal(bill.roomId, targetRoom.id);
    assert.equal(writes.filter(w => w.path.endsWith('/transfer')).length, 1);

    await action('desk', null);
    assert.equal(await page.locator('#page-checkout-desk').isVisible(), true);
    await action('open', 'missing-room', 'cashierActionError');
    failRooms = true;
    await action('order', room.id, 'cashierActionError');
    failRooms = false;
    await action('order', targetRoom.id);
    await connect(['member']);
    assert.equal(await page.evaluate(() => hvideoDesktopCashierAction({ id: 999, action: 'open', roomId: 'room-2' })), false);
    assert.deepEqual(errors, []);
    console.log('PASS: open room, timed billing, order submission, receipt and print invocation, payment cancel/confirm, checkout desk, selected room, permissions and request failures. No live business data changed.');
} finally { await browser.close(); }

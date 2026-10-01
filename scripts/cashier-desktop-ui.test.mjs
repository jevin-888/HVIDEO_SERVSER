import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const members = [], reservations = [], requests = [];
const employees = [];
const employeeRoles = [['admin', '管理员'], ['cashier', '收银员'], ['marketer', '营销'],
    ['warehouse', '库管'], ['finance', '财务'], ['consultant', '咨客'], ['production', '出品'], ['waiter', '服务员']]
    .map(([id, name]) => ({ id, name }));
let nextEmployeeNo = 1001;
const room = { id: 'room-1', name: 'VIP888', status: 0, typeId: 1, areaId: 1 };
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
        window.messages = [];
        window.chrome.webview = { postMessage: message => window.messages.push(message) };
        // No real socket traffic or business data is used by this test.
        window.WebSocket = class {
            static OPEN = 1; static CONNECTING = 0;
            readyState = 1;
            close() {}
        };
    });
    await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.hostname !== 'cashier.test') return route.abort();
        if (url.pathname.startsWith('/static/')) {
            try {
                const body = readFileSync(new URL(url.pathname.slice(1), root));
                return route.fulfill({ contentType: url.pathname.endsWith('.html') ? 'text/html' : 'application/javascript', body });
            } catch { return route.fulfill({ status: 404, body: '' }); }
        }
        requests.push({ path: url.pathname, method: request.method(), body: request.postDataJSON(), headers: request.headers() });
        let data = [];
        if (url.pathname === '/api/v1/admin/members') {
            if (request.method() === 'POST') members.push({ ...request.postDataJSON(), version: 1 });
            data = members;
        } else if (url.pathname === '/api/v1/admin/reservations') {
            if (request.method() === 'POST') reservations.push({ ...request.postDataJSON(), version: 1 });
            data = reservations;
        } else if (/\/admin\/members\/[^/]+(?:\/balance)?$/.test(url.pathname)) {
            const id = url.pathname.split('/')[5], index = members.findIndex(m => m.id === id);
            assert.ok(index >= 0);
            const payload = request.postDataJSON();
            if (url.pathname.endsWith('/balance')) {
                assert.equal(request.method(), 'POST');
                assert.ok(payload.request_id);
                members[index].balance += payload.balance_delta;
                members[index].points += payload.points_delta;
                members[index].version++;
            } else if (request.method() === 'PUT') {
                assert.equal(payload.version, members[index].version);
                members[index] = { ...payload, version: payload.version + 1 };
            } else if (request.method() === 'DELETE') {
                assert.equal(members[index].balance, 0, 'server rejects deletion with nonzero balance');
                members.splice(index, 1);
            }
            data = members[index];
        } else if (/\/admin\/reservations\/[^/]+$/.test(url.pathname)) {
            const id = url.pathname.split('/').pop(), index = reservations.findIndex(r => r.id === id);
            assert.ok(index >= 0);
            if (request.method() === 'PUT') {
                const payload = request.postDataJSON();
                assert.equal(payload.version, reservations[index].version);
                reservations[index] = { ...payload, version: payload.version + 1 };
            } else if (request.method() === 'DELETE') reservations[index].status = 'cancelled';
            data = reservations[index];
        } else if (url.pathname === '/api/v1/rooms') data = [room];
        else if (url.pathname.endsWith('/configs/types')) data = [{ id: 1, name: '标准' }];
        else if (url.pathname.endsWith('/configs/areas')) data = [{ id: 1, name: '一楼' }];
        else if (url.pathname.endsWith('/employee-roles')) data = employeeRoles;
        else if (url.pathname.endsWith('/employees/next-number')) data = { employeeNo: String(nextEmployeeNo) };
        else if (url.pathname.endsWith('/employees')) {
            if (request.method() === 'POST') {
                assert.equal(request.postDataJSON().employeeNo, '');
                data = { ...request.postDataJSON(), id: `e${nextEmployeeNo}`, employeeNo: String(nextEmployeeNo++), enabled: 1, extraPermissions: JSON.stringify(request.postDataJSON().modulePermissions) };
                assert.match(data.password, /^[A-Za-z0-9]{4,8}$/);
                employees.push(data);
            } else data = employees;
        }
        else if (/\/employees\/[^/]+$/.test(url.pathname)) {
            const id = decodeURIComponent(url.pathname.split('/').pop());
            const index = employees.findIndex(employee => employee.id === id);
            assert.ok(index >= 0);
            if (request.method() === 'PUT') {
                const payload = request.postDataJSON();
                employees[index] = { ...employees[index], ...payload, extraPermissions: JSON.stringify(payload.modulePermissions) };
                data = employees[index];
            } else if (request.method() === 'DELETE') {
                assert.notEqual(employees[index].roleId, 'admin');
                employees.splice(index, 1); data = { deleted: true };
            }
        }
        else if (url.pathname.endsWith('/finance/report')) data = { records: [], total_income: 123, room_income: 100, beverage_income: 23 };
        else if (url.pathname.endsWith('/pad-ordering/status')) data = { enabled: false };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://cashier.test/static/cashier/index.html?desktop=1');
    await page.waitForFunction(() => window.messages.some(message => message.type === 'ready'));
    assert.equal(await page.locator('#cashier-login').isVisible(), false);
    await page.waitForFunction(() => window.messages.filter(message => message.type === 'ready').length >= 2);
    assert.equal(await page.evaluate(() => hvideoDesktopConnect({ token: 'test-token', employee: { id: 'e1', name: '测试', employeeNo: 'tester', roleId: 'admin' }, language: 'en', module: null })), true);
    await page.waitForFunction(() => document.querySelector('[data-page="cashier"]').textContent.includes('Front desk'));
    for (const [code, label] of [['id', 'Kasir depan'], ['vi', 'Thu ngân'], ['th', 'แคชเชียร์หน้าร้าน'], ['en', 'Front desk']]) {
        await page.evaluate(code => hvideoSetLanguage(code), code);
        await page.waitForFunction(label => document.querySelector('[data-page="cashier"]').textContent.includes(label), label);
    }
    await page.evaluate(() => hvideoSetLanguage('zh'));
    assert.equal(await page.locator('.cashier-page:not(.hidden)').count(), 0);
    assert.equal(requests.length, 0, 'background preload must not request business data');
    await page.evaluate(() => hvideoDesktopShowModule('member'));
    await page.waitForFunction(() => document.getElementById('member-table').textContent.includes('暂无会员'));
    const beforeRepeat = requests.length;
    await page.evaluate(() => hvideoDesktopShowModule('member'));
    assert.equal(requests.length, beforeRepeat, 'same module should not load twice');
    assert.equal(await page.locator('#cashier-app > aside').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('admin_token')), null);
    await page.locator('#member-birthday').click();
    assert.equal(await page.locator('.cashier-date-picker').isVisible(), true);
    assert.equal(await page.locator('.cashier-date-open').count(), await page.locator('input[data-cashier-date-bound]').count());
    const birthdayLayout = await page.locator('#member-birthday').evaluate(input => {
        const field = input.closest('.cashier-date-field').getBoundingClientRect();
        const button = input.closest('.cashier-date-field').querySelector('.cashier-date-open').getBoundingClientRect();
        return { fieldRight: field.right, buttonRight: button.right, buttonTop: button.top, fieldTop: field.top, fieldBottom: field.bottom };
    });
    assert.ok(Math.abs((birthdayLayout.fieldRight - 7) - birthdayLayout.buttonRight) < 2, 'calendar button is aligned to the input right edge');
    assert.ok(birthdayLayout.buttonTop > birthdayLayout.fieldTop && birthdayLayout.buttonTop < birthdayLayout.fieldBottom, 'calendar button is vertically centered');
    await page.locator('.cashier-date-grid button').first().click();
    await page.locator('.cashier-date-actions button').filter({ hasText: '确定' }).click();
    assert.match(await page.locator('#member-birthday').inputValue(), /^\d{4}-\d{2}-\d{2}$/);
    await page.locator('#member-card-no').fill('VIP001');
    await page.locator('#member-name').fill('测试会员');
    await page.locator('#member-phone').fill('13800138000');
    await page.locator('#member-form button').filter({ hasText: '保存会员' }).click();
    await page.waitForFunction(() => document.getElementById('member-table').textContent.includes('测试会员'));
    assert.equal(members.length, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('cashier_members')), null);
    await page.locator('#member-table').getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#member-name').fill('修改会员');
    await page.locator('#member-form button').filter({ hasText: '保存会员' }).click();
    await page.waitForFunction(() => document.getElementById('member-table').textContent.includes('修改会员'));
    for (const [label, amount, balance] of [['充值', '100', 100], ['扣费', '30', 70], ['扣费', '70', 0]]) {
        await page.locator('#member-table').getByRole('button', { name: label, exact: true }).click();
        await page.locator('#cashier-dialog-input').fill(amount);
        await page.locator('#cashier-dialog-confirm').click();
        await page.waitForFunction(balance => membersCache[0].balance === balance, balance);
        assert.equal(members[0].balance, balance);
    }
    await page.locator('#member-table').getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('#cashier-dialog-confirm').click();
    await page.locator('#member-table').getByText('暂无会员').waitFor();
    assert.equal(members.length, 0);
    for (const module of ['reservation', 'warehouse', 'finance', 'base-settings', 'system', 'member']) {
        await page.evaluate(module => hvideoDesktopShowModule(module), module);
        await page.waitForFunction(module => !document.getElementById(`page-${module}`).classList.contains('hidden'), module);
    }
    await page.evaluate(() => hvideoDesktopShowModule('system'));
    await page.waitForFunction(() => document.getElementById('employee-no').value === '1001');
    assert.deepEqual(await page.locator('#employee-role label span').allTextContents(), employeeRoles.slice(0, 7).map(role => role.name));
    assert.equal(await page.locator('#employee-no').getAttribute('readonly'), '');
    assert.equal(await page.locator('input[name="employee-role"]:checked').inputValue(), 'cashier');
    for (const role of employeeRoles.slice(0, 7)) {
        await page.locator('#employee-role label').filter({ hasText: role.name }).click();
        assert.equal(await page.locator('input[name="employee-role"]:checked').inputValue(), role.id);
        assert.equal(await page.locator('input[name="employee-role"]:checked').count(), 1);
    }
    await page.evaluate(() => loadEmployees());
    assert.equal(await page.locator('input[name="employee-role"]:checked').inputValue(), 'production');
    // Another cashier saves while this form still displays the previous preview.
    nextEmployeeNo = 2040;
    await page.locator('#employee-name').fill('测试营销');
    await page.locator('#employee-role label').filter({ hasText: '营销' }).click();
    for (const value of ['0123', '12345678', 'abcd', 'AbCdEfGh', '12ab', 'Ab12Cd34']) {
        await page.locator('#employee-password').fill(value);
        assert.equal(await page.locator('#employee-password').evaluate(input => input.checkValidity()), true, value);
    }
    for (const value of ['123', '123456789', '12@b', 'ab c', '中文密码']) {
        await page.locator('#employee-password').evaluate((input, value) => input.value = value, value);
        assert.equal(await page.locator('#employee-password').evaluate(input => input.checkValidity()), false, value);
    }
    await page.locator('#employee-password').fill('12@b');
    await page.locator('#employee-form button[type="submit"]').click();
    assert.equal(employees.length, 0, 'invalid password must not submit');
    await page.locator('#employee-password').fill('0123');
    for (const input of await page.locator('input[name="employee-module"]').all()) await input.uncheck();
    await page.locator('input[name="employee-module"][value="member"]').check();
    await page.locator('#employee-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('employee-no').value === '2041');
    assert.equal(employees[0].employeeNo, '2040');
    assert.equal(employees[0].roleId, 'marketer');
    assert.equal(await page.locator('#employee-name').inputValue(), '');
    assert.equal(await page.locator('#employee-password').inputValue(), '');
    assert.equal(await page.locator('input[name="employee-role"]:checked').inputValue(), 'cashier');
    await page.waitForFunction(() => document.getElementById('employee-table').textContent.includes('2040'));
    assert.deepEqual(employees[0].modulePermissions, ['member']);
    await page.locator('[data-employee-action="edit"]').click();
    assert.equal(await page.locator('#employee-no').inputValue(), '2040');
    assert.equal(await page.locator('#employee-password').inputValue(), '');
    assert.equal(await page.locator('#employee-password').getAttribute('required'), null);
    assert.deepEqual(await page.locator('input[name="employee-module"]:checked').evaluateAll(inputs => inputs.map(input => input.value)), ['member']);
    await page.locator('#employee-name').fill('修改营销');
    await page.locator('#employee-password').fill('Ab12Cd34');
    await page.locator('input[name="employee-module"][value="member"]').uncheck();
    await page.locator('input[name="employee-module"][value="reservation"]').check();
    await page.locator('#employee-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('employee-form-title').textContent === '新增人员');
    assert.equal(employees.length, 1);
    assert.equal(employees[0].employeeNo, '2040');
    assert.equal(employees[0].name, '修改营销');
    assert.equal(employees[0].password, 'Ab12Cd34');
    assert.deepEqual(JSON.parse(employees[0].extraPermissions), ['reservation']);
    employees.push({ id: 'admin-protected', employeeNo: '1000', name: '管理员', roleId: 'admin', enabled: 1 });
    await page.evaluate(() => renderEmployees());
    assert.equal(await page.locator('[data-employee-action="delete"][data-employee-id="admin-protected"]').count(), 0);
    await page.locator('[data-employee-action="delete"]').click();
    // Use the application's confirmation dialog instead of bypassing deletion UI.
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await page.waitForFunction(() => !document.getElementById('employee-table').textContent.includes('2040'));
    assert.equal(employees.length, 1);
    const row = await page.locator('.employee-identity-row input').evaluateAll(inputs => inputs.map(input => input.getBoundingClientRect().top));
    assert.equal(row.length, 3);
    assert.ok(Math.max(...row) - Math.min(...row) < 2, 'account, name and password inputs share a row');
    assert.equal(await page.getByText('从 1001 起，按已有最大数字工号递增；最终工号以保存结果为准。').count(), 0);
    nextEmployeeNo = 3000;
    await page.evaluate(() => resetEmployeeForm());
    assert.equal(await page.locator('#employee-no').inputValue(), '3000');
    await page.evaluate(() => hvideoDesktopShowModule('reservation'));
    await page.waitForFunction(() => document.querySelector('#reservation-room-id option[value="room-1"]'));
    await page.locator('#reservation-room-id').selectOption('room-1');
    await page.locator('#reservation-time').fill('2026-09-20T18:00');
    const reservationField = page.locator('.cashier-date-field').filter({ has: page.locator('#reservation-time') });
    await reservationField.locator('.cashier-date-open').click();
    assert.equal(await page.getByRole('dialog', { name: '选择日期' }).isVisible(), true);
    await page.locator('[data-days]').getByRole('button', { name: '21', exact: true }).click();
    await page.locator('[data-time]').fill('19:30');
    await page.locator('[data-confirm]').click();
    assert.equal(await page.locator('#reservation-time').inputValue(), '2026-09-21T19:30');
    const reservationAlignment = await reservationField.evaluate(field => {
        const input = field.querySelector('input').getBoundingClientRect();
        const button = field.querySelector('button').getBoundingClientRect();
        return { rightGap: input.right - button.right, centerGap: (input.top + input.bottom - button.top - button.bottom) / 2 };
    });
    assert.ok(Math.abs(reservationAlignment.rightGap - 7) < 2);
    assert.ok(Math.abs(reservationAlignment.centerGap) < 2, 'reservation calendar button is centered on its input');
    await page.locator('#reservation-customer-name').fill('测试预定');
    await page.locator('#reservation-phone').fill('13800138000');
    await page.locator('#reservation-form button[type="submit"], #reservation-form button:not([type])').click();
    await page.waitForFunction(() => document.getElementById('reservation-table').textContent.includes('测试预定'));
    assert.equal(reservations.length, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('cashier_reservations')), null);
    await page.locator('#reservation-table').getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#reservation-customer-name').fill('修改预定');
    await page.locator('#reservation-form button[type="submit"], #reservation-form button:not([type])').click();
    await page.locator('#reservation-table').getByText('修改预定', { exact: true }).waitFor();
    assert.equal(reservations[0].version, 2);
    await page.locator('#reservation-table').getByRole('button', { name: '取消', exact: true }).click();
    await page.locator('#cashier-dialog-confirm').click();
    await page.locator('#reservation-table').getByText('已取消', { exact: true }).waitFor();
    assert.equal(reservations[0].status, 'cancelled');
    assert.equal(await page.evaluate(() => hvideoDesktopShowModule('invalid-module')), false);
    const restrictedEmployee = { id: 'limited', employeeNo: '1002', name: '受限人员', roleId: 'cashier', extraPermissions: '["member"]' };
    await page.evaluate(employee => hvideoDesktopConnect({ token: 'test-token', employee, module: 'member' }), restrictedEmployee);
    const requestCount = requests.length;
    assert.equal(await page.evaluate(() => hvideoDesktopShowModule('system')), false);
    assert.equal(await page.evaluate(() => showPage('finance')), false);
    assert.equal(requests.length, requestCount, 'forbidden module must not issue API calls');
    assert.equal(await page.locator('#page-system').isVisible(), false);
    assert.equal(await page.locator('#page-member').isVisible(), true);
    await page.evaluate(() => { currentEmployee.extraPermissions = '[]'; applyEmployeeModulePermissions(); });
    assert.equal(await page.locator('.cashier-page:not(.hidden)').count(), 0);
    await page.evaluate(() => clearCashierLogin());
    assert.equal(await page.evaluate(() => apiService.token), null);
    assert.equal(await page.evaluate(() => window.messages.some(message => message.type === 'sessionExpired')), true);
    for (const path of ['/admin/members', '/admin/reservations', '/admin/warehouse/inventory', '/admin/finance/report', '/admin/billing-settings', '/admin/employees']) {
        assert.ok(requests.some(request => request.path === `/api/v1${path}`), path);
    }
    assert.ok(requests.every(request => request.headers.authorization === 'Bearer test-token'));
    assert.deepEqual(errors, []);
    console.log('PASS: six embedded modules, server customers, all seven roles selected by mouse clicks, selection retained on refresh, server-allocated employee numbers, and session expiry.');
} finally { await browser.close(); }

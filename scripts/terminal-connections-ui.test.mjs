import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../static/admin/admin.js', import.meta.url), 'utf8');
const listCode = source.slice(source.indexOf('const expandedTerminalConnections ='), source.indexOf('// 打开终端调试/配置页面'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.setContent('<input id="terminal-search"><table><tbody id="terminals-table"></tbody></table>');
    await page.addScriptTag({content: `
        window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
        window.showLoading = window.hideLoading = () => {};
        window.errors = []; window.actions = [];
        window.showToast = message => errors.push(message);
        window.openTerminalSettings = ip => actions.push(['settings', ip]);
        window.deleteTerminal = (id, name) => actions.push(['delete', id, name]);
        window.fixture = [
            {id:'terminal-one',serial:'SN-A001',name:"Player's <img src=x onerror=alert(1)>",terminalIp:'192.0.2.10',macAddress:'D6:AB:AA:8A:53:7F',onlineStatus:1,hardwareInfo:'{"model":"H6_POR"}',connections:[
                {networkType:'ethernet',interfaceName:'eth0',ipAddress:'192.0.2.10',macAddress:'D6:AB:AA:8A:53:7F',onlineStatus:1,lastHeartbeat:'2026-09-10 18:00:00'},
                {networkType:'wifi',interfaceName:'wlan0',ipAddress:'192.0.2.11',macAddress:'84:93:EC:D5:73:A5',onlineStatus:1,lastHeartbeat:'2026-09-10 18:00:01'}
            ]},
            {id:'terminal-legacy',serial:'SN-B002',name:'Legacy player',terminalIp:'192.0.2.20',onlineStatus:1,connections:[
                {networkType:'unknown',interfaceName:'',ipAddress:'192.0.2.20',macAddress:'02:00:00:00:00:20',onlineStatus:1}
            ]}
        ];
        window.profiles = []; window.captures = []; window.captureError = false;
        window.apiService = {
            getTerminals: async () => ({data:structuredClone(fixture)}),
            getTerminalConfigProfiles: async () => ({data:structuredClone(profiles)}),
            captureTerminalConfig: async (id, mode) => {
                captures.push([id, mode]);
                if (captureError) throw new Error('终端读取失败');
                const selectingTemplate = mode === 'template' && !profiles.some(p => p.terminalId === id && p.mode === 'template');
                profiles = profiles.filter(p => p.terminalId !== id && !selectingTemplate);
                if (mode !== 'default') profiles.push({terminalId:id, mode, sourceIp:fixture.find(t => t.id === id).terminalIp, updatedAt:1});
            }
        };
        ${listCode}
    `});
    await page.evaluate(() => loadTerminals());
    assert.equal(await page.locator('#terminals-table > tr[data-terminal-id]').count(), 2);
    assert.equal(await page.locator('#terminals-table img').count(), 0, 'device names render as text');
    const toggle = page.locator('[data-terminal-id="terminal-one"] .terminal-connections-toggle');
    const detail = page.locator('#terminal-connections-terminal-one');
    assert.equal(await detail.isVisible(), false);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await detail.locator('tbody tr').count(), 2);
    assert.match(await detail.locator('[data-network-type="wifi"]').innerText(), /192\.0\.2\.11/);
    assert.match(await detail.locator('[data-network-type="ethernet"]').innerText(), /当前使用/);

    await page.evaluate(() => {
        fixture[0].terminalIp = '192.0.2.11';
        fixture[0].connections[0].onlineStatus = 0;
        return loadTerminals();
    });
    assert.equal(await detail.isVisible(), true, 'expanded state survives status refresh');
    assert.match(await detail.locator('[data-network-type="ethernet"]').innerText(), /离线/);
    assert.match(await detail.locator('[data-network-type="wifi"]').innerText(), /当前使用/);
    assert.match(await page.locator('[data-terminal-id="terminal-one"]').innerText(), /在线/);

    for (const keyword of ['sn-a001', '192.0.2.10', '84:93:EC:D5:73:A5']) {
        await page.fill('#terminal-search', keyword);
        await page.evaluate(() => loadTerminals(false));
        assert.equal(await page.locator('#terminals-table > tr[data-terminal-id]').count(), 1);
        assert.equal(await detail.isVisible(), true);
    }
    await page.fill('#terminal-search', 'SN-B002');
    await page.evaluate(() => loadTerminals(false));
    await page.locator('[data-terminal-id="terminal-legacy"] .terminal-connections-toggle').click();
    const legacy = page.locator('#terminal-connections-terminal-legacy');
    assert.match(await legacy.innerText(), /未识别的连接/);
    assert.match(await legacy.locator('[data-network-type="ethernet"]').innerText(), /未上报/);
    assert.match(await legacy.locator('[data-network-type="wifi"]').innerText(), /未上报/);

    await page.fill('#terminal-search', '');
    await page.evaluate(() => loadTerminals(false));
    await page.locator('[data-terminal-id="terminal-one"] .terminal-settings').click();
    await page.locator('[data-terminal-id="terminal-one"] .terminal-delete').click();
    assert.deepEqual(await page.evaluate(() => actions), [
        ['settings', '192.0.2.11'], ['delete', 'terminal-one', "Player's <img src=x onerror=alert(1)>"]
    ]);
    await toggle.click();
    assert.equal(await detail.isVisible(), false);
    const mode = page.locator('[data-terminal-id="terminal-one"] .terminal-config-mode');
    const save = page.locator('[data-terminal-id="terminal-one"] .terminal-config-save');
    assert.equal(await mode.inputValue(), 'default');
    assert.equal(await save.isDisabled(), true);
    await mode.selectOption('template');
    await page.waitForFunction(() => profiles.length === 1 && !terminalConfigSaving);
    assert.equal(await mode.inputValue(), 'template');
    assert.equal(await save.isDisabled(), false);
    await save.click();
    await page.waitForFunction(() => captures.length === 2 && !terminalConfigSaving);
    await page.evaluate(() => { captureError = true; });
    await mode.selectOption('custom');
    await page.waitForFunction(() => captures.length === 3 && !terminalConfigSaving);
    assert.equal(await mode.inputValue(), 'template', 'failed capture retains saved mode');
    await page.evaluate(() => { captureError = false; });
    await mode.selectOption('custom');
    await page.waitForFunction(() => captures.length === 4 && !terminalConfigSaving);
    assert.equal(await mode.inputValue(), 'custom');
    await page.evaluate(() => { fixture[0].onlineStatus = 0; return loadTerminals(); });
    assert.equal(await mode.isDisabled(), false, 'offline custom terminal may return to default');
    assert.equal(await save.isDisabled(), false, 'stale offline state must not prevent a live capture retry');
    assert.deepEqual(await page.evaluate(() => captures), [
        ['terminal-one', 'template'], ['terminal-one', 'template'],
        ['terminal-one', 'custom'], ['terminal-one', 'custom']
    ]);
    await mode.selectOption('default');
    await page.waitForFunction(() => captures.length === 5 && !terminalConfigSaving);
    assert.equal(await mode.inputValue(), 'default');
    assert.equal(await mode.isDisabled(), false, 'default mode remains editable even when status is offline');
    assert.equal(await mode.locator('option[value="custom"]').isDisabled(), false);
    await mode.selectOption('custom');
    await page.waitForFunction(() => captures.length === 6 && !terminalConfigSaving);
    const otherMode = page.locator('[data-terminal-id="terminal-legacy"] .terminal-config-mode');
    await otherMode.selectOption('template');
    await page.waitForFunction(() => captures.length === 7 && !terminalConfigSaving);
    assert.equal(await otherMode.inputValue(), 'template');
    assert.equal(await mode.inputValue(), 'default', 'choosing a template resets other terminals');
    assert.equal(await mode.locator('option[value="template"]').isDisabled(), true);
    assert.equal(await mode.locator('option[value="custom"]').isDisabled(), false);
    await otherMode.selectOption('default');
    await page.waitForFunction(() => captures.length === 8 && !terminalConfigSaving);
    assert.equal(await mode.locator('option[value="template"]').isDisabled(), false, 'releasing template unlocks other devices');
    await mode.selectOption('template');
    await page.waitForFunction(() => captures.length === 9 && !terminalConfigSaving);
    assert.equal(await otherMode.inputValue(), 'default');
    assert.equal(await mode.inputValue(), 'template');
    assert.equal(await otherMode.isDisabled(), false, 'a template does not lock other default terminals');
    assert.equal(await otherMode.locator('option[value="template"]').isDisabled(), true);
    assert.equal(await mode.locator('option[value="template"]').isDisabled(), false, 'current owner may keep or save its template');
    await otherMode.selectOption('custom');
    await page.waitForFunction(() => captures.length === 10 && !terminalConfigSaving);
    assert.equal(await otherMode.inputValue(), 'custom');
    assert.equal(await otherMode.locator('option[value="template"]').isDisabled(), true);
    assert.equal(await mode.inputValue(), 'template', 'custom capture preserves the sole template');
    assert.equal(await page.evaluate(() => profiles.filter(p => p.mode === 'template').length), 1);
    await page.evaluate(() => { errors = []; });
    await page.evaluate(() => {fixture = []; return loadTerminals();});
    assert.match(await page.locator('#terminals-table').innerText(), /暂无符合条件的终端/);
    assert.deepEqual(await page.evaluate(() => errors), []);
    console.log('PASS: one terminal row, two expandable networks, failover refresh, search, legacy data and safe actions');
} finally {
    await browser.close();
}

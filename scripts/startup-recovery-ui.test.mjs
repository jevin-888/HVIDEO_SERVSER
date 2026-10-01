import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../static/admin/bootstrap.html', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const nic = { name: 'Ethernet', ip: '192.168.1.145', mac: null };
const options = { configuredHost: nic.ip, configuredPort: 9898, configuredAvailable: true, interfaces: [nic] };

async function scenario(initial, run) {
    const page = await browser.newPage();
    const model = { status: { running: false, last_error: 'HTTP/TCP 9898 端口已被占用' }, options, ...initial };
    const calls = [];
    await page.exposeFunction('invokeTest', async (command, args) => {
        calls.push({ command, args });
        if (command === 'get_server_status') return model.status;
        if (command === 'get_server_network_options') {
            if (model.optionsError) throw new Error(model.optionsError);
            return model.options;
        }
        if (command === 'restart_server' || command === 'select_server_network') {
            if (model.restartError) throw new Error(model.restartError);
            return { message: '服务器已重启', serverUrl: 'http://startup.test/ready' };
        }
        if (command === 'open_logs_dir') return;
        throw new Error(`Unexpected command ${command}`);
    });
    await page.addInitScript(() => { window.__TAURI_INVOKE__ = window.invokeTest; });
    await page.route('http://startup.test/**', route => route.fulfill({ contentType: 'text/html', body: route.request().url().endsWith('/ready') ? 'ready' : html }));
    try {
        await page.goto('http://startup.test/');
        await run(page, model, calls);
    } finally { await page.close(); }
}

try {
    await scenario({}, async (page, model, calls) => {
        await page.waitForFunction(() => document.querySelector('#network-interface').value === '192.168.1.145');
        assert.match(await page.locator('#startup-error').innerText(), /端口已被占用/);
        assert.doesNotMatch(await page.locator('#startup-message').innerText(), /当前网卡.*启动/);
        await page.click('#open-logs');
        assert(calls.some(call => call.command === 'open_logs_dir'));
        await page.click('#retry-startup');
        await page.waitForURL('http://startup.test/ready');
        assert.equal(calls.filter(call => call.command === 'restart_server').length, 1);
        assert(!calls.some(call => call.command === 'select_server_network'));
    });
    console.log('PASS: port conflict keeps actual error and usable NIC; retry and logs use existing commands');

    await scenario({ status: { running: false, last_error: 'jwt.secret configuration error' } }, async page => {
        await page.waitForFunction(() => !document.querySelector('#network-interface').disabled && document.querySelector('#network-interface').value);
        assert.match(await page.locator('#startup-error').innerText(), /jwt.secret/);
        assert.match(await page.locator('#network-status').innerText(), /已识别当前网卡/);
    });
    console.log('PASS: configuration failure does not masquerade as missing network hardware');

    await scenario({ options: { ...options, configuredAvailable: false, interfaces: [] } }, async (page, model, calls) => {
        await page.waitForFunction(() => document.querySelector('#network-interface').disabled);
        model.options = { ...options, configuredAvailable: false };
        await page.click('#refresh-network');
        await page.waitForFunction(() => !document.querySelector('#network-interface').disabled);
        await page.selectOption('#network-interface', nic.ip);
        await page.waitForURL('http://startup.test/ready');
        assert.deepEqual(calls.find(call => call.command === 'select_server_network').args, { host: nic.ip, port: 9898 });
    });
    console.log('PASS: reconnect/refresh reenables NIC selector and sends exact host/port contract');

    await scenario({ restartError: '收银发现/UDP 18081 端口已被占用' }, async (page, model) => {
        await page.waitForFunction(() => document.querySelector('#network-interface').value);
        model.status.last_error = model.restartError;
        await page.click('#retry-startup');
        await page.waitForFunction(() => !document.querySelector('#retry-startup').disabled);
        assert.match(await page.locator('#startup-error').innerText(), /18081/);
        assert.equal(await page.locator('#refresh-network').isEnabled(), true);
        assert.equal(await page.locator('#network-interface').isEnabled(), true);
        delete model.restartError;
        await page.click('#retry-startup');
        await page.waitForURL('http://startup.test/ready');
    });
    console.log('PASS: failed retry restores controls and a second retry succeeds without reload');

    await scenario({ status: { running: false, last_error: null } }, async (page, model) => {
        await page.waitForTimeout(1200);
        model.status = { running: true, last_error: null, server_url: 'http://startup.test/ready' };
        await page.waitForURL('http://startup.test/ready');
    });
    console.log('PASS: readiness polling continues through initialization and redirects after recovery');

    await scenario({ optionsError: 'config.toml syntax error' }, async (page, model) => {
        await page.waitForFunction(() => document.querySelector('#network-status').textContent.includes('syntax error'));
        assert.match(await page.locator('#startup-error').innerText(), /端口已被占用/);
        delete model.optionsError;
        await page.click('#refresh-network');
        await page.waitForFunction(() => document.querySelector('#network-interface').value === '192.168.1.145');
    });
    console.log('PASS: network-config read errors preserve the original startup error and allow refresh');
} finally { await browser.close(); }

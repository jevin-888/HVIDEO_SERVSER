// 修复终端数据
const sqlite3 = require('better-sqlite3');
const db = new sqlite3('data/hvideo.db');

// 标准JSON格式的硬件信息
const hwInfo = {
    "device_name": "localhost",
    "ip": "192.168.1.205",
    "mac": "7e:c8:70:fe:4c:55",
    "model": "rk3568_r",
    "serial": "858021a25ff45ee3",
    "ports": {
        "http": 8080,
        "mobile": 8081,
        "tcp": 9000,
        "udp": 8000,
        "vod": 8089,
        "ws": 8090
    },
    "protocol": "discover",
    "type": "hvideo",
    "version": "1.0"
};

const hwInfoStr = JSON.stringify(hwInfo);

console.log('更新终端数据...');
console.log('Hardware Info:', hwInfoStr);

const stmt = db.prepare(`
    UPDATE terminals 
    SET hardwareInfo = ?,
        onlineStatus = 1,
        last_heartbeat = datetime('now','localtime')
    WHERE terminalIp = ?
`);

const result = stmt.run(hwInfoStr, '192.168.1.205');
console.log('更新结果:', result.changes, '行受影响');

// 验证更新
const terminal = db.prepare('SELECT * FROM terminals WHERE terminalIp = ?').get('192.168.1.205');
console.log('\n更新后的数据:');
console.log('名称:', terminal.name);
console.log('IP:', terminal.terminalIp);
console.log('MAC:', terminal.macAddress);
console.log('在线状态:', terminal.onlineStatus);
console.log('最后心跳:', terminal.last_heartbeat);
console.log('硬件信息:', terminal.hardwareInfo);

// 解析验证
try {
    const parsed = JSON.parse(terminal.hardwareInfo);
    console.log('\nJSON解析成功:');
    console.log('序列号:', parsed.serial);
    console.log('型号:', parsed.model);
} catch (e) {
    console.error('JSON解析失败:', e.message);
}

db.close();

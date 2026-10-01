/**
 * Start the backend before Tauri dev and wait for [server] host/port from config.toml.
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.toml');
const MAX_WAIT_MS = 60000;
const POLL_MS = 500;

function readServerAddress() {
  const content = require('fs').readFileSync(CONFIG_PATH, 'utf8');
  const serverSection = content.match(/\[server\]([\s\S]*?)(?=\n\s*\[[^\]]+\]|$)/);
  if (!serverSection) {
    throw new Error('config.toml is missing the [server] section');
  }
  const host = serverSection[1].match(/^\s*host\s*=\s*"([^"]+)"/m)?.[1]?.trim();
  const portText = serverSection[1].match(/^\s*port\s*=\s*(\d+)/m)?.[1];
  const port = Number(portText);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('config.toml [server] must define a valid host and port');
  }
  return { host, port, url: `http://${host}:${port}/` };
}

const server = readServerAddress();
const SERVER_URL = server.url;

function waitForUrl() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + MAX_WAIT_MS;
    function tryOnce() {
      const req = http.get(SERVER_URL, { timeout: 3000 }, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error('超时：后端未在限定时间内响应'));
          return;
        }
        setTimeout(tryOnce, POLL_MS);
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error('超时：无法连接到 ' + SERVER_URL));
          return;
        }
        setTimeout(tryOnce, POLL_MS);
      });
    }
    tryOnce();
  });
}

const child = spawn('cargo', ['run'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  detached: true,
});
child.unref();

console.log('正在启动后端 (cargo run)，等待', URL, '...');
waitForUrl()
  .then(() => {
    console.log('后端已就绪，Tauri 将打开窗口。');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

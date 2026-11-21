// Cloudflare Tunnel: đưa phần mềm chạy trên máy này ra Internet qua tên miền của bạn (https://kho.tencongty.vn)
// mà không cần mở cổng modem. Phần mềm tự tải cloudflared (công cụ chính thức của Cloudflare) và chạy nó
// như một tiến trình con; token đường hầm lấy từ trang Cloudflare Zero Trust.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const state = { running: false, connected: false, downloading: false, error: '', started_at: null, log: [] };
let child = null;
let wanted = null; // { token, dataDir } khi đang bật
let retryTimer = null;
let retries = 0;

const addLog = (line) => {
  const s = String(line).replace(/\s+$/, '');
  if (!s) return;
  state.log.push(`[${new Date().toLocaleTimeString('vi-VN')}] ${s}`);
  if (state.log.length > 60) state.log.shift();
};

function binPath(dataDir) {
  return path.join(dataDir, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}
function downloadUrl() {
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
  if (process.platform === 'win32') return base + (process.arch === 'arm64' ? 'cloudflared-windows-arm64.exe' : 'cloudflared-windows-amd64.exe');
  if (process.platform === 'linux') return base + (process.arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64');
  return null;
}
// Lệnh chạy cloudflared (KHO_CLOUDFLARED_CMD dùng cho kiểm thử: JSON ["node", "fake.js"])
function command(dataDir) {
  if (process.env.KHO_CLOUDFLARED_CMD) return JSON.parse(process.env.KHO_CLOUDFLARED_CMD);
  return [binPath(dataDir)];
}

async function ensureBinary(dataDir) {
  if (process.env.KHO_CLOUDFLARED_CMD) return;
  const file = binPath(dataDir);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000000) return;
  const url = downloadUrl();
  if (!url) throw new Error('Hệ điều hành này chưa được hỗ trợ tự tải cloudflared');
  state.downloading = true;
  addLog('Đang tải cloudflared từ ' + url);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'KhoETC' }, signal: AbortSignal.timeout(300000) });
    if (!r.ok) throw new Error(`tải cloudflared lỗi ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1000000) throw new Error('file cloudflared tải về không hợp lệ');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.part', buf);
    fs.chmodSync(file + '.part', 0o755);
    fs.renameSync(file + '.part', file);
    addLog(`Đã tải cloudflared (${(buf.length / 1048576).toFixed(1)} MB)`);
  } finally {
    state.downloading = false;
  }
}

function launch() {
  if (!wanted || child) return;
  const [cmd, ...pre] = command(wanted.dataDir);
  state.error = '';
  state.connected = false;
  addLog('Khởi động đường hầm...');
  try {
    // token truyền qua biến môi trường TUNNEL_TOKEN (không hiện trong danh sách tiến trình)
    child = spawn(cmd, [...pre, 'tunnel', '--no-autoupdate', 'run'], {
      env: { ...process.env, TUNNEL_TOKEN: wanted.token }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    state.error = 'Không chạy được cloudflared: ' + e.message;
    addLog(state.error);
    return scheduleRetry();
  }
  state.running = true;
  state.started_at = new Date().toISOString();
  const onData = (b) => {
    for (const line of String(b).split(/\r?\n/)) {
      if (!line.trim()) continue;
      addLog(line.replace(/^\S+Z\s+/, ''));
      if (/Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(line)) { state.connected = true; state.error = ''; retries = 0; }
      if (/Unauthorized|invalid token|token is invalid|Provided Tunnel token is not valid/i.test(line)) state.error = 'Token đường hầm không hợp lệ: hãy chép lại token trên trang Cloudflare';
      else if (/Could not lookup|no such host|failed to dial|dial tcp|i\/o timeout|network is unreachable/i.test(line) && !state.connected) state.error = 'Không kết nối được tới máy chủ Cloudflare: kiểm tra kết nối Internet của máy này. Phần mềm sẽ tự thử lại.';
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => {
    state.error = 'Không chạy được cloudflared: ' + e.message; addLog(state.error);
    child = null; state.running = false; state.connected = false;
    if (wanted) scheduleRetry();
  });
  child.on('exit', (code) => {
    child = null;
    state.running = false;
    state.connected = false;
    addLog(`Đường hầm dừng (mã ${code})`);
    if (code && !state.error) state.error = 'Đường hầm bị dừng, phần mềm đang tự thử lại. Xem nhật ký đường hầm bên dưới để biết chi tiết.';
    if (wanted) scheduleRetry();
  });
}
function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = Math.min(60000, 3000 * 2 ** Math.min(retries++, 5));
  retryTimer = setTimeout(launch, delay);
}

// Bật đường hầm (tải cloudflared nếu cần)
async function start(dataDir, token) {
  wanted = { dataDir, token };
  retries = 0;
  clearTimeout(retryTimer);
  if (child) { const c = child; child = null; c.removeAllListeners('exit'); c.kill(); state.running = false; }
  try { await ensureBinary(dataDir); }
  catch (e) { state.error = 'Không tải được cloudflared: ' + e.message; addLog(state.error); return scheduleRetry(); }
  launch();
}
function stop() {
  wanted = null;
  clearTimeout(retryTimer);
  if (child) { addLog('Tắt đường hầm'); child.kill(); }
  state.running = false;
  state.connected = false;
  state.error = '';
}
process.on('exit', () => { if (child) try { child.kill(); } catch { /* bỏ qua */ } });

module.exports = { start, stop, state };

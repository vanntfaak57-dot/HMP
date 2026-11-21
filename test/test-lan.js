// Kiểm thử dùng chung trong mạng nội bộ: bật/tắt từ màn hình Cài đặt, truy cập qua IP mạng nội bộ,
// dữ liệu nhập từ "máy khác" thì máy chủ thấy và ngược lại.
//   node test/test-lan.js  |  APP_BIN=<file chạy> node test/test-lan.js
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), 'kho-lan-'));
const PORT = 3984;
const step = (s) => console.log('✔', s);
const lanIp = Object.values(os.networkInterfaces()).flat().find((a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal && !a.address.startsWith('169.254.'))?.address;

let proc = null;
function start() {
  const env = { ...process.env, DATA_DIR: path.join(tmp, 'data'), KHO_CONFIG: path.join(tmp, 'kho-config.json'), KHO_RESTART_MODE: 'exit', NO_BROWSER: '1' };
  delete env.PORT; delete env.HOST;
  proc = process.env.APP_BIN ? spawn(process.env.APP_BIN, [], { env, stdio: 'pipe' }) : spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'launcher.js')], { env, stdio: 'pipe' });
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = async () => {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return res(); } catch { /* chưa sẵn sàng */ }
      if (Date.now() - t0 > 20000) return rej(new Error('Không khởi động được'));
      setTimeout(tick, 300);
    };
    tick();
  });
}
const exited = () => new Promise((res) => { if (proc.exitCode !== null) return res(); proc.on('exit', res); });
function client(base) {
  let cookie = '';
  const api = async (url, opts = {}) => {
    const o = { method: 'GET', headers: { cookie }, ...opts };
    if (o.body) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.body); }
    const r = await fetch(base + url, o);
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
    if (r.status !== 200) throw new Error(`${url}: ${r.status} ${JSON.stringify(d)}`);
    return d;
  };
  return { api, login: (u, p) => api('/api/login', { method: 'POST', body: { username: u, password: p } }) };
}

(async () => {
  try {
    if (!lanIp) { console.log('Máy không có mạng nội bộ (IPv4), bỏ qua kiểm thử.'); return; }
    fs.writeFileSync(path.join(tmp, 'kho-config.json'), JSON.stringify({ port: PORT, host: '127.0.0.1' }));
    await start();
    const local = client(`http://127.0.0.1:${PORT}`);
    await local.login('admin', 'admin@123');
    await local.api('/api/me/password', { method: 'POST', body: { old_password: 'admin@123', new_password: 'MatKhau2026' } });
    let n = await local.api('/api/network');
    assert.equal(n.lan_enabled, false); assert.equal(n.can_change, true);
    let blocked = false;
    try { await fetch(`http://${lanIp}:${PORT}/healthz`, { signal: AbortSignal.timeout(3000) }); } catch { blocked = true; }
    assert.ok(blocked, 'chế độ chỉ máy này: máy khác không được truy cập');
    step(`Mặc định chỉ máy này dùng: truy cập qua ${lanIp} bị từ chối`);

    await local.api('/api/network', { method: 'PUT', body: { lan: true, port: PORT } });
    await exited();
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'kho-config.json'), 'utf8')).host, '0.0.0.0');
    await start();
    const server = client(`http://127.0.0.1:${PORT}`);
    await server.login('admin', 'MatKhau2026');
    n = await server.api('/api/network');
    assert.equal(n.lan_enabled, true);
    const link = n.addresses.find((a) => a.ip === lanIp);
    assert.ok(link && link.url === `http://${lanIp}:${PORT}` && link.qr.includes('<svg'));
    step(`Bật dùng chung: phần mềm tự khởi động lại, hiện đường link ${link.url} kèm mã QR`);

    // "máy khác" truy cập qua IP mạng nội bộ, đăng nhập cùng tài khoản
    const other = client(link.url);
    assert.match(await (await fetch(link.url + '/')).text(), /<title>/);
    await other.login('admin', 'MatKhau2026');
    await other.api('/api/items', { method: 'POST', body: { code: 'LAN01', name: 'Nhập từ máy khác', unit: 'Cái' } });
    assert.ok((await server.api('/api/items')).some((i) => i.code === 'LAN01'));
    await server.api('/api/items', { method: 'POST', body: { code: 'LAN02', name: 'Nhập từ máy chủ', unit: 'Cái' } });
    assert.ok((await other.api('/api/items')).some((i) => i.code === 'LAN02'));
    const audit = await server.api('/api/audit');
    assert.ok(audit.rows.some((a) => a.action === 'LOGIN_OK' && a.ip.includes(lanIp)), 'nhật ký ghi IP của máy khác');
    step('Máy khác mở đường link, đăng nhập cùng tài khoản; dữ liệu nhập ở máy nào thì máy kia thấy ngay; nhật ký ghi IP máy khác');

    await server.api('/api/network', { method: 'PUT', body: { lan: false } });
    await exited(); await start();
    blocked = false;
    try { await fetch(`${link.url}/healthz`, { signal: AbortSignal.timeout(3000) }); } catch { blocked = true; }
    assert.ok(blocked);
    const back = client(`http://127.0.0.1:${PORT}`);
    await back.login('admin', 'MatKhau2026');
    assert.equal((await back.api('/api/items')).length, 2);
    step('Tắt dùng chung: máy khác không vào được nữa, dữ liệu giữ nguyên');
    console.log('\nTẤT CẢ KIỂM THỬ MẠNG NỘI BỘ ĐỀU ĐẠT');
  } catch (e) {
    console.error('✘', e); process.exitCode = 1;
  } finally {
    if (proc && proc.exitCode === null) { proc.kill(); await exited(); }
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* bỏ qua */ }
  }
})();

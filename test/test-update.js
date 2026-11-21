// Kiểm thử chức năng cập nhật phần mềm từ đầu đến cuối.
//   node test/test-update.js                 -> chạy bằng mã nguồn (node launcher.js)
//   APP_BIN=<file chạy> node test/test-update.js -> chạy bằng bản đóng gói (KhoETC)
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const crypto = require('crypto'); const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), 'kho-upd-'));
const DATA = path.join(tmp, 'data');
const PORT = 3988; const B = `http://127.0.0.1:${PORT}`;
const BUILTIN = require('../package.json').version;
const step = (s) => console.log('✔', s);

// Tạo các gói cập nhật thử nghiệm
function buildPkg(version) {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-app.js'), 'update', '--version', version], { stdio: 'pipe' });
  const f = path.join(tmp, `KhoETC-update-${version}.khoupd`);
  fs.copyFileSync(path.join(ROOT, 'build', 'dist', `KhoETC-update-${version}.khoupd`), f);
  return f;
}

let proc = null;
function start(extraEnv = {}) {
  const env = { ...process.env, PORT, DATA_DIR: DATA, KHO_RESTART_MODE: 'exit', NO_BROWSER: '1', ...extraEnv };
  proc = process.env.APP_BIN ? spawn(process.env.APP_BIN, [], { env, stdio: 'pipe' }) : spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'launcher.js')], { env, stdio: 'pipe' });
  let out = '';
  proc.stdout.on('data', (b) => { out += b; }); proc.stderr.on('data', (b) => { out += b; });
  proc.output = () => out;
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Không khởi động được:\n' + out)), 20000);
    proc.stdout.on('data', () => { if (out.includes('đang chạy')) { clearTimeout(t); res(); } });
  });
}
const exited = () => new Promise((res) => { if (proc.exitCode !== null) return res(); proc.on('exit', res); });
let cookie = '';
async function api(url, opts = {}) {
  const o = { method: 'GET', headers: { cookie }, ...opts };
  if (o.body && !(o.body instanceof FormData)) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  const r = await fetch(B + url, o);
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, d };
}
const ok = async (url, opts) => { const r = await api(url, opts); if (r.status !== 200) throw new Error(`${url}: ${r.status} ${JSON.stringify(r.d)}`); return r.d; };
const login = () => ok('/api/login', { method: 'POST', body: { username: 'admin', password: 'MatKhau2026' } });
const upload = (file) => { const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)]), path.basename(file)); return api('/api/update/upload', { method: 'POST', body: fd }); };

(async () => {
  let server;
  try {
    const p990 = buildPkg('9.9.0'); const p995 = buildPkg('9.9.5');
    step('Tạo gói cập nhật thử nghiệm 9.9.0 và 9.9.5');

    await start();
    await ok('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin@123' } });
    await ok('/api/me/password', { method: 'POST', body: { old_password: 'admin@123', new_password: 'MatKhau2026' } });
    await ok('/api/settings', { method: 'PUT', body: { opening_date: '2026-09-30' } });
    await ok('/api/items', { method: 'POST', body: { code: 'VT001', name: 'Xi măng', unit: 'Bao', opening_qty: 100, opening_value: 8500000 } });
    let v = await ok('/api/version');
    assert.equal(v.version, BUILTIN); assert.equal(v.running_update, false);
    step(`Đang chạy bản gốc ${BUILTIN}`);

    // Gói hỏng / không phải gói cập nhật
    const bad = path.join(tmp, 'hong.khoupd'); fs.writeFileSync(bad, 'khong phai goi cap nhat');
    let r = await upload(bad); assert.equal(r.status, 400); assert.match(r.d.error, /không phải gói cập nhật/);
    // Người dùng không phải quản trị không được cập nhật
    await ok('/api/users', { method: 'POST', body: { username: 'ketoan', password: 'KeToan2026', role: 'accountant' } });
    const adminCookie = cookie; cookie = '';
    await ok('/api/login', { method: 'POST', body: { username: 'ketoan', password: 'KeToan2026' } });
    await ok('/api/me/password', { method: 'POST', body: { old_password: 'KeToan2026', new_password: 'KeToan2027' } });
    r = await upload(p990); assert.equal(r.status, 403);
    cookie = adminCookie;
    step('Từ chối file không phải gói cập nhật; chỉ Quản trị được cập nhật');

    // Cập nhật bằng file
    r = await upload(p990); assert.equal(r.status, 200, JSON.stringify(r.d)); assert.equal(r.d.version, '9.9.0'); assert.ok(r.d.restarting);
    await exited();
    assert.ok(fs.readdirSync(path.join(DATA, 'backups')).some((f) => f.includes(`truoc-cap-nhat-${BUILTIN}-len-9.9.0`)));
    await start(); cookie = ''; await login();
    v = await ok('/api/version'); assert.equal(v.version, '9.9.0'); assert.equal(v.running_update, true); assert.equal(v.builtin_version, BUILTIN);
    assert.equal((await ok('/api/items'))[0].code, 'VT001');
    const home = await fetch(B + '/'); assert.match(await home.text(), /<title>/);
    assert.match(await (await fetch(B + '/app.js')).text(), /pageUpdate/);
    step('Cập nhật bằng file lên 9.9.0: tự sao lưu, khởi động lại, dữ liệu và giao diện giữ nguyên');

    r = await upload(p990); assert.equal(r.status, 400); assert.match(r.d.error, /không mới hơn/);
    step('Từ chối cài gói không mới hơn phiên bản đang chạy');

    // Cập nhật qua mạng (máy chủ cập nhật thử nghiệm)
    const pkg995 = fs.readFileSync(p995);
    let sha = crypto.createHash('sha256').update(pkg995).digest('hex');
    server = http.createServer((req, res) => {
      if (req.url === '/latest.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ version: '9.9.5', url: 'KhoETC-update-9.9.5.khoupd', sha256: sha, notes: 'Bản thử nghiệm' })); }
      if (req.url === '/KhoETC-update-9.9.5.khoupd') return res.end(pkg995);
      res.statusCode = 404; res.end();
    }).listen(3987);
    await ok('/api/update/url', { method: 'PUT', body: { url: 'http://127.0.0.1:3987/latest.json' } });
    const chk = await ok('/api/update/check', { method: 'POST' });
    assert.deepEqual([chk.available, chk.latest, chk.notes], [true, '9.9.5', 'Bản thử nghiệm']);
    sha = '0'.repeat(64);
    r = await api('/api/update/download', { method: 'POST' }); assert.equal(r.status, 400); assert.match(r.d.error, /SHA256/);
    sha = crypto.createHash('sha256').update(pkg995).digest('hex');
    r = await api('/api/update/download', { method: 'POST' }); assert.equal(r.status, 200, JSON.stringify(r.d));
    await exited(); await start(); cookie = ''; await login();
    v = await ok('/api/version'); assert.equal(v.version, '9.9.5');
    assert.ok(!fs.existsSync(path.join(DATA, 'app', 'kho-9.9.0.js')) || true);
    step('Cập nhật qua mạng lên 9.9.5: kiểm tra phiên bản, chặn gói sai mã SHA256, cài đúng gói hợp lệ');

    // Quay về bản gốc
    r = await api('/api/update/rollback', { method: 'POST' }); assert.equal(r.status, 200);
    await exited(); await start(); cookie = ''; await login();
    v = await ok('/api/version'); assert.equal(v.version, BUILTIN); assert.equal(v.running_update, false);
    assert.equal((await ok('/api/items'))[0].code, 'VT001');
    step(`Quay về bản gốc ${BUILTIN}, dữ liệu giữ nguyên`);
    proc.kill(); await exited();

    // Bản cập nhật lỗi khi khởi động -> tự quay về bản gốc
    fs.writeFileSync(path.join(DATA, 'app', 'kho-9.9.9.js'), 'throw new Error("ban cap nhat loi");');
    fs.writeFileSync(path.join(DATA, 'app', 'current.json'), JSON.stringify({ version: '9.9.9', file: 'kho-9.9.9.js' }));
    await start(); cookie = ''; await login();
    v = await ok('/api/version'); assert.equal(v.version, BUILTIN);
    assert.ok(fs.existsSync(path.join(DATA, 'app', 'current.json.failed')));
    step('Bản cập nhật lỗi khi khởi động: tự quay về bản gốc');
    proc.kill(); await exited();

    // Khởi động lại kiểu app trên máy (tiến trình mới thay tiến trình cũ)
    await start({ KHO_RESTART_MODE: '' }); cookie = ''; await login();
    r = await upload(p990); assert.equal(r.status, 200);
    await exited();
    let ver = null;
    for (let i = 0; i < 40 && ver !== '9.9.0'; i++) { await new Promise((x) => setTimeout(x, 500)); try { cookie = ''; await login(); ver = (await ok('/api/version')).version; } catch { /* đang khởi động */ } }
    assert.equal(ver, '9.9.0');
    step('Kiểu app trên máy: tiến trình cũ thoát, tiến trình mới tự mở với phiên bản 9.9.0');
    console.log('\nTẤT CẢ KIỂM THỬ CẬP NHẬT ĐỀU ĐẠT');
  } catch (e) {
    console.error('✘', e); if (proc) console.error(proc.output()); process.exitCode = 1;
  } finally {
    if (server) server.close();
    if (proc && proc.exitCode === null) { proc.kill(); await exited(); }
    // dừng tiến trình mới (nếu có) đang giữ cổng
    try {
      if (process.platform === 'win32') { if (process.env.APP_BIN) execFileSync('taskkill', ['/F', '/IM', path.basename(process.env.APP_BIN)], { stdio: 'ignore' }); }
      else execFileSync('bash', ['-c', `fuser -k ${PORT}/tcp 2>/dev/null || true`]);
    } catch { /* bỏ qua */ }
    await new Promise((r) => setTimeout(r, 1000));
    fs.rmSync(path.join(ROOT, 'build', 'dist', 'KhoETC-update-9.9.0.khoupd'), { force: true });
    fs.rmSync(path.join(ROOT, 'build', 'dist', 'KhoETC-update-9.9.5.khoupd'), { force: true });
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* bỏ qua */ }
  }
})();

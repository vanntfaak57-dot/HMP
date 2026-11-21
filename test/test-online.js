// Kiểm thử bản 1.3.0: truy cập qua Cloudflare (proxy), đường hầm Cloudflare Tunnel, khôi phục dữ liệu
//   node test/test-online.js  |  APP_BIN=<file chạy> node test/test-online.js
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), 'kho-onl-'));
const PORT = 3982; const B = `http://127.0.0.1:${PORT}`;
const CF_OUT = path.join(tmp, 'cf.json');
const step = (s) => console.log('✔', s);

let proc = null;
function start() {
  const env = { ...process.env, PORT, DATA_DIR: path.join(tmp, 'data'), KHO_CONFIG: path.join(tmp, 'cfg.json'), KHO_RESTART_MODE: 'exit', NO_BROWSER: '1',
    KHO_CLOUDFLARED_CMD: JSON.stringify([process.execPath, path.join(__dirname, 'fixtures', 'fake-cloudflared.js')]), FAKE_CF_OUT: CF_OUT };
  delete env.HOST; delete env.TRUST_PROXY; delete env.COOKIE_SECURE;
  proc = process.env.APP_BIN ? spawn(process.env.APP_BIN, [], { env, stdio: 'pipe' }) : spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'launcher.js')], { env, stdio: 'pipe' });
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = async () => {
      try { if ((await fetch(B + '/healthz')).ok) return res(); } catch { /* chưa sẵn sàng */ }
      if (Date.now() - t0 > 20000) return rej(new Error('Không khởi động được'));
      setTimeout(tick, 300);
    };
    tick();
  });
}
const exited = () => new Promise((res) => { if (proc.exitCode !== null) return res(); proc.on('exit', res); });
let cookie = '';
async function raw(url, opts = {}) {
  const o = { method: 'GET', ...opts, headers: { cookie, ...(opts.headers || {}) } };
  if (o.body && !(o.body instanceof FormData)) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  const r = await fetch(B + url, o);
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, d, headers: r.headers };
}
const ok = async (url, opts) => { const r = await raw(url, opts); if (r.status !== 200) throw new Error(`${url}: ${r.status} ${JSON.stringify(r.d)}`); return r.d; };
const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('quá thời gian chờ'); await new Promise((r) => setTimeout(r, 300)); } };

(async () => {
  try {
    await start();
    // 1. Truy cập qua Cloudflare: cloudflared trên máy này gửi kèm header CF-Connecting-IP / X-Forwarded-Proto
    const CF = { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https' };
    let r = await raw('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin@123' }, headers: CF });
    assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /; Secure/); assert.ok(r.headers.get('strict-transport-security'));
    await ok('/api/me/password', { method: 'POST', body: { old_password: 'admin@123', new_password: 'MatKhau2026' }, headers: CF });
    cookie = '';
    r = await raw('/api/login', { method: 'POST', body: { username: 'admin', password: 'MatKhau2026' } });
    assert.doesNotMatch(r.headers.get('set-cookie'), /Secure/); // truy cập trực tiếp trên máy / mạng nội bộ (http)
    const au = await ok('/api/audit');
    assert.ok(au.rows.some((a) => a.action === 'LOGIN_OK' && a.ip === '203.0.113.9'), 'ghi IP thật của người dùng qua Cloudflare');
    step('Qua Cloudflare: cookie bảo mật (Secure) + HSTS, nhật ký ghi IP thật 203.0.113.9; truy cập http trên máy vẫn bình thường');

    // 2. Đường hầm Cloudflare Tunnel
    let t = await ok('/api/tunnel');
    assert.deepEqual([t.available, t.enabled, t.has_token, t.local_service], [true, false, false, `http://localhost:${PORT}`]);
    assert.equal((await raw('/api/tunnel', { method: 'PUT', body: { enabled: true } })).status, 400); // chưa có token
    assert.equal((await raw('/api/tunnel', { method: 'PUT', body: { token: 'abc', enabled: true } })).status, 400);
    const TOKEN = 'eyJhIjoiMTIzIiwidCI6IjQ1NiIsInMiOiJhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkifQ';
    t = await ok('/api/tunnel', { method: 'PUT', body: { token: `cloudflared.exe service install ${TOKEN}`, url: 'kho.tencongty.vn/', enabled: true } });
    assert.equal(t.url, 'https://kho.tencongty.vn'); assert.ok(!JSON.stringify(t).includes(TOKEN), 'không trả token ra ngoài');
    t = await waitFor(async () => { const x = await ok('/api/tunnel'); return x.connected && x; });
    assert.equal(JSON.parse(fs.readFileSync(CF_OUT, 'utf8')).token, TOKEN);
    assert.deepEqual(JSON.parse(fs.readFileSync(CF_OUT, 'utf8')).args, ['tunnel', '--no-autoupdate', 'run']);
    step('Đường hầm: nhận lệnh cài Cloudflare và tách đúng token, chạy cloudflared bằng token (không lộ token), báo Đã kết nối');

    // tự chạy lại đường hầm khi mở lại phần mềm
    proc.kill(); await exited(); fs.rmSync(CF_OUT, { force: true });
    await start(); cookie = ''; await ok('/api/login', { method: 'POST', body: { username: 'admin', password: 'MatKhau2026' } });
    await waitFor(async () => (await ok('/api/tunnel')).connected);
    step('Mở lại phần mềm: đường hầm tự kết nối lại');
    t = await ok('/api/tunnel', { method: 'PUT', body: { enabled: false } });
    assert.equal(t.enabled, false); await waitFor(async () => !(await ok('/api/tunnel')).running);
    step('Tắt đường hầm: dừng cloudflared');
    await ok('/api/tunnel', { method: 'PUT', body: { token: 'eyJsai', enabled: true } });
    t = await waitFor(async () => { const x = await ok('/api/tunnel'); return x.error && x; });
    assert.match(t.error, /Token đường hầm không hợp lệ/);
    step('Token sai: báo rõ "Token đường hầm không hợp lệ"');

    // 3. Khôi phục dữ liệu
    await ok('/api/tunnel', { method: 'PUT', body: { enabled: false } }).catch(() => {});
    await ok('/api/settings', { method: 'PUT', body: { opening_date: '2026-09-30' } });
    await ok('/api/items', { method: 'POST', body: { code: 'A1', name: 'Có trong bản sao lưu', unit: 'Cái' } });
    const bk = await fetch(B + '/api/backup', { headers: { cookie } });
    const bkBuf = Buffer.from(await bk.arrayBuffer());
    await ok('/api/items', { method: 'POST', body: { code: 'B2', name: 'Nhập sau khi sao lưu', unit: 'Cái' } });
    const up = (buf, name, confirm = 'KHOI PHUC') => { const fd = new FormData(); fd.append('confirm', confirm); fd.append('file', new Blob([buf]), name); return raw('/api/restore', { method: 'POST', body: fd }); };
    r = await up(Buffer.from('khong phai csdl'), 'x.db'); assert.equal(r.status, 400);
    r = await up(bkBuf, 'kho.db', 'sai'); assert.equal(r.status, 400);
    r = await up(bkBuf, 'kho-sao-luu.db'); assert.equal(r.status, 200, JSON.stringify(r.d)); assert.equal(r.d.items, 1);
    await exited(); await start();
    cookie = ''; await ok('/api/login', { method: 'POST', body: { username: 'admin', password: 'MatKhau2026' } });
    assert.deepEqual((await ok('/api/items')).map((i) => i.code), ['A1']);
    assert.ok(fs.readdirSync(path.join(tmp, 'data', 'backups')).some((f) => /^truoc-khoi-phuc-\d+\.db$/.test(f)));
    assert.ok((await ok('/api/audit')).rows.some((a) => a.action === 'RESTORE'));
    step('Khôi phục: chặn file không phải bản sao lưu / thiếu xác nhận; khôi phục đúng dữ liệu; tự cất dữ liệu cũ vào backups; ghi nhật ký');
    console.log('\nTẤT CẢ KIỂM THỬ ONLINE ĐỀU ĐẠT');
  } catch (e) {
    console.error('✘', e); process.exitCode = 1;
  } finally {
    if (proc && proc.exitCode === null) { proc.kill(); await exited(); }
    await new Promise((r) => setTimeout(r, 500));
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* bỏ qua */ }
  }
})();

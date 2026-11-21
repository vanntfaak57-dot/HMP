// Kiểm thử bảo mật và các báo cáo bản 1.4.0
//   node test/test-security.js  |  APP_BIN=<file chạy> node test/test-security.js
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), 'kho-sec-'));
const PORT = 3979; const B = `http://127.0.0.1:${PORT}`;
const step = (s) => console.log('✔', s);

let proc = null;
function start() {
  const env = { ...process.env, PORT, DATA_DIR: path.join(tmp, 'data'), KHO_CONFIG: path.join(tmp, 'cfg.json'), NO_BROWSER: '1' };
  delete env.HOST; delete env.TRUST_PROXY;
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
function client() {
  let cookie = '';
  const raw = async (url, opts = {}) => {
    const o = { method: 'GET', ...opts, headers: { cookie, ...(opts.headers || {}) } };
    if (o.body && !(o.body instanceof FormData)) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.body); }
    const r = await fetch(B + url, o);
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
    return { status: r.status, d, headers: r.headers };
  };
  const ok = async (url, opts) => { const r = await raw(url, opts); if (r.status !== 200) throw new Error(`${url}: ${r.status} ${JSON.stringify(r.d)}`); return r.d; };
  return { raw, ok };
}

(async () => {
  try {
    await start();
    const adm = client();
    // Header bảo mật
    const home = await fetch(B + '/');
    assert.match(home.headers.get('content-security-policy') || '', /script-src 'self'/);
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    step('Header bảo mật: CSP chặn script lạ, chống nhúng trang (clickjacking), không lộ thông tin máy chủ');

    await adm.ok('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin@123' } });
    // Mật khẩu yếu
    for (const [pw, re] of [['admin@123', /khác mật khẩu hiện tại|phổ biến/], ['matkhau123', /phổ biến/], ['Admin2026xx', /tên đăng nhập/], ['abcdefgh', /chữ và số/]]) {
      const r = await adm.raw('/api/me/password', { method: 'POST', body: { old_password: 'admin@123', new_password: pw } });
      assert.equal(r.status, 400, pw); assert.match(r.d.error, re, pw);
    }
    await adm.ok('/api/me/password', { method: 'POST', body: { old_password: 'admin@123', new_password: 'Kho#2026an' } });
    step('Mật khẩu: chặn mật khẩu phổ biến, chứa tên đăng nhập, trùng mật khẩu cũ, thiếu chữ/số');

    // Yêu cầu giả mạo từ trang web khác (CSRF)
    let r = await adm.raw('/api/users', { method: 'POST', headers: { origin: 'https://trang-lua-dao.com' }, body: { username: 'hacker', password: 'Hk#2026zz', role: 'admin' } });
    assert.equal(r.status, 403);
    assert.ok(!(await adm.ok('/api/users')).some((u) => u.username === 'hacker'));
    step('Chặn yêu cầu ghi dữ liệu gửi từ trang web khác (CSRF)');

    // Dữ liệu mẫu
    await adm.ok('/api/settings', { method: 'PUT', body: { opening_date: '2026-09-30' } });
    const A = await adm.ok('/api/items', { method: 'POST', body: { code: 'VT1', name: 'Xi măng', unit: 'Bao', opening_qty: 100, opening_value: 8000000, vat_rate: '8' } });
    const C = await adm.ok('/api/items', { method: 'POST', body: { code: 'VT2', name: 'Thép', unit: 'Kg', opening_qty: 500, opening_value: 7500000 } });
    const K1 = await adm.ok('/api/partners', { method: 'POST', body: { kind: 'KH', code: 'KH1', name: 'Công ty Minh Phát' } });
    const K2 = await adm.ok('/api/partners', { method: 'POST', body: { kind: 'KH', code: 'KH2', name: 'Nhà Xanh' } });
    const x1 = await adm.ok('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-10-05', partner_id: K1.id, lines: [{ item_id: A.id, qty: 10, unit_price: 100000 }, { item_id: C.id, qty: 50, unit_price: 18000 }] } });
    await adm.ok('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-10-20', partner_id: K2.id, lines: [{ item_id: A.id, qty: 5, unit_price: 110000 }] } });
    await adm.ok('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-11-03', partner_id: K1.id, lines: [{ item_id: A.id, qty: 2, unit_price: 105000 }] } });

    // Báo cáo bán hàng theo mặt hàng
    let s = await adm.ok('/api/reports/sales?from=2026-10-01&to=2026-10-31');
    assert.deepEqual(s.rows.map((x) => [x.code, x.qty, x.amount, x.voucher_count, x.customer_count]), [['VT1', 15, 1550000, 2, 2], ['VT2', 50, 900000, 1, 1]]);
    assert.equal(s.rows[0].cost, 15 * 80000); assert.equal(s.rows[0].profit, 1550000 - 1200000); assert.equal(s.rows[0].lines.length, 2);
    s = await adm.ok(`/api/reports/sales?from=2026-10-01&to=2026-11-30&item_ids=${A.id}&partner=p${K1.id}`);
    assert.deepEqual(s.rows.map((x) => [x.code, x.qty]), [['VT1', 12]]); assert.equal(s.total.amount, 1210000);
    step('Báo cáo bán hàng theo nhiều mặt hàng: số lượng, doanh thu, giá vốn, lãi gộp, chi tiết; lọc theo mặt hàng + khách hàng + khoảng ngày');

    // Sổ chi tiết nhiều mặt hàng
    const lg = await adm.ok(`/api/reports/ledger?item_ids=${A.id},${C.id}&from=2026-10&to=2026-11`);
    assert.deepEqual(lg.ledgers.map((l) => [l.item.code, l.out_qty, l.close_qty]), [['VT1', 17, 83], ['VT2', 50, 450]]);
    step('Sổ chi tiết vật tư cho nhiều mặt hàng cùng lúc');

    // Nhật ký theo chứng từ
    await adm.ok(`/api/vouchers/${x1.id}`);
    await adm.ok(`/api/vouchers/${x1.id}/post`, { method: 'POST', body: { post: false } });
    let va = await adm.ok(`/api/vouchers/${x1.id}/audit`);
    assert.deepEqual([...new Set(va.map((a) => a.action))].sort(), ['VOUCHER_CREATE', 'VOUCHER_UNPOST', 'VOUCHER_VIEW'].sort());
    await adm.ok(`/api/vouchers/${x1.id}/post`, { method: 'POST', body: { post: true } });
    step('Nhật ký từng chứng từ: ai tạo, xem, bỏ ghi, ghi sổ, lúc nào, từ IP nào');

    // Thủ kho: chỉ xem, tra cứu
    await adm.ok('/api/users', { method: 'POST', body: { username: 'tk1', password: 'Wh#2026kho', role: 'storekeeper' } });
    const tk = client();
    await tk.ok('/api/login', { method: 'POST', body: { username: 'tk1', password: 'Wh#2026kho' } });
    await tk.ok('/api/me/password', { method: 'POST', body: { old_password: 'Wh#2026kho', new_password: 'Wh#2027kho' } });
    const writes = [
      ['POST', '/api/items', { code: 'Z', name: 'Z' }], ['PUT', `/api/items/${A.id}`, { code: 'VT1', name: 'x' }], ['DELETE', `/api/items/${A.id}`],
      ['POST', '/api/items/bulk-delete', { ids: [A.id] }], ['POST', '/api/partners', { kind: 'KH', code: 'Z', name: 'Z' }],
      ['PUT', `/api/partners/${K1.id}`, { code: 'KH1', name: 'x' }], ['POST', '/api/partners/bulk-delete', { ids: [K1.id] }],
      ['POST', '/api/vouchers', { type: 'N', date: '2026-11-10', lines: [{ item_id: A.id, qty: 1, unit_price: 1 }] }],
      ['PUT', `/api/vouchers/${x1.id}`, { date: '2026-10-05', lines: [] }], ['DELETE', `/api/vouchers/${x1.id}`],
      ['POST', `/api/vouchers/${x1.id}/post`, { post: false }], ['POST', '/api/vouchers/bulk-post', { ids: [x1.id], post: false }],
      ['POST', '/api/vouchers/bulk-delete', { ids: [x1.id] }], ['POST', '/api/costing/run', { month: '2026-10' }],
      ['PUT', '/api/settings', { company_name: 'x' }], ['POST', '/api/users', { username: 'x2', password: 'Ab#2026xyz', role: 'admin' }],
      ['POST', '/api/periods/2026-10/lock', { locked: true }], ['PUT', '/api/network', { lan: true }], ['PUT', '/api/tunnel', { enabled: false }],
      ['POST', '/api/shutdown', {}], ['POST', '/api/update/rollback', {}], ['GET', '/api/backup'], ['GET', '/api/audit'], ['GET', '/api/users'],
    ];
    for (const [m, url, body] of writes) {
      const rr = await tk.raw(url, { method: m, body });
      assert.equal(rr.status, 403, `${m} ${url} phải bị chặn với Thủ kho (nhận ${rr.status})`);
    }
    assert.equal((await adm.ok('/api/items')).length, 2);
    assert.equal((await tk.ok('/api/items')).length, 2); // vẫn tra cứu được
    const tkv = await tk.ok(`/api/vouchers/${x1.id}/audit`);
    assert.ok(tkv.length && !tkv.some((a) => /tổng \d/.test(a.detail)), 'Thủ kho không thấy giá trị trong nhật ký');
    const tks = await tk.ok('/api/reports/sales?from=2026-10-01&to=2026-10-31');
    assert.equal(tks.rows[0].qty, 15); assert.equal(tks.rows[0].amount, undefined);
    step(`Thủ kho: bị chặn cả ${writes.length} chức năng nhập liệu / sửa / quản trị; vẫn tra cứu được số lượng, không thấy giá trị`);

    // Dò mật khẩu: khóa tài khoản sau 5 lần sai, khóa IP sau 20 lần sai
    const atk = client();
    for (let i = 0; i < 5; i++) await atk.raw('/api/login', { method: 'POST', body: { username: 'tk1', password: 'sai' + i } });
    r = await atk.raw('/api/login', { method: 'POST', body: { username: 'tk1', password: 'Wh#2027kho' } });
    assert.equal(r.status, 429);
    const msgs = new Set();
    for (const u of ['khongtontai', 'admin']) { const x = await atk.raw('/api/login', { method: 'POST', body: { username: u, password: 'sai' } }); msgs.add(x.d.error); }
    assert.equal(msgs.size, 1, 'thông báo giống nhau: không dò được tên đăng nhập có tồn tại');
    for (let i = 0; i < 20; i++) await atk.raw('/api/login', { method: 'POST', body: { username: 'u' + i, password: 'sai' } });
    r = await atk.raw('/api/login', { method: 'POST', body: { username: 'admin', password: 'Kho#2026an' } });
    assert.equal(r.status, 429); assert.match(r.d.error, /quá nhiều lần từ địa chỉ này/);
    step('Dò mật khẩu: tài khoản tạm khóa sau 5 lần sai; IP bị chặn 15 phút sau 20 lần sai; không dò được tên đăng nhập');
    console.log('\nTẤT CẢ KIỂM THỬ BẢO MẬT ĐỀU ĐẠT');
  } catch (e) {
    console.error('✘', e); process.exitCode = 1;
  } finally {
    if (proc && proc.exitCode === null) { proc.kill(); await new Promise((r) => proc.on('exit', r)); }
    await new Promise((r) => setTimeout(r, 500));
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* bỏ qua */ }
  }
})();

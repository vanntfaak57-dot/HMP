// Kiểm thử đầu-cuối: khởi động server với CSDL tạm, chạy nghiệp vụ và đối chiếu kết quả
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const assert = require('assert');
const dir = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), 'kho-'));
const PORT = 3998; const B = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dir }, stdio: 'pipe' });
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
const step = (s) => console.log('✔', s);

(async () => {
  await new Promise((res) => srv.stdout.on('data', (b) => String(b).includes('đang chạy') && res()));
  try {
    assert.equal((await api('/api/items')).status, 401); step('Chặn truy cập khi chưa đăng nhập');
    assert.equal((await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'sai' } })).status, 401); step('Từ chối sai mật khẩu');
    await ok('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin@123' } });
    assert.equal((await api('/api/items')).status, 403); step('Bắt buộc đổi mật khẩu lần đầu');
    await ok('/api/me/password', { method: 'POST', body: { old_password: 'admin@123', new_password: 'MatKhau2026' } });
    await ok('/api/settings', { method: 'PUT', body: { company_name: 'Công ty ABC', opening_date: '2026-09-30' } });

    // Danh mục + tồn đầu tại ngày A = 30/09/2026
    const A = await ok('/api/items', { method: 'POST', body: { code: 'VT001', name: 'Xi măng PCB40', unit: 'Bao', opening_qty: 100, opening_value: 8500000 } });
    const C = await ok('/api/items', { method: 'POST', body: { code: 'VT002', name: 'Thép cuộn D6', unit: 'Kg', opening_qty: 3, opening_value: 1000 } });
    step('Tạo danh mục và số dư đầu kỳ');
    const V = await ok('/api/items', { method: 'POST', body: { code: 'VT009', name: 'Gạch', unit: 'Viên', vat_rate: '10%' } });
    assert.equal((await ok('/api/items')).find((i) => i.id === V.id).vat_rate, '10');
    await ok(`/api/items/${V.id}`, { method: 'PUT', body: { code: 'VT009', name: 'Gạch', unit: 'Viên', vat_rate: 'KCT', opening_qty: 0, opening_value: 0 } });
    assert.equal((await ok('/api/items')).find((i) => i.id === V.id).vat_rate, 'KCT');
    assert.equal((await api('/api/items', { method: 'POST', body: { code: 'VT010', name: 'X', vat_rate: '7%' } })).status, 400);
    const ExcelJS = require('exceljs'); const wbk = new ExcelJS.Workbook(); const wsx = wbk.addWorksheet('a');
    wsx.addRow(['Mã', 'Tên', 'ĐVT', 'SL', 'GT', 'Ghi chú', 'Thuế']); wsx.addRow(['VT011', 'Sơn', 'Thùng', 0, 0, '', 0.08]); wsx.addRow(['VT012', 'Đinh', 'Kg', 0, 0, '', '5%']);
    const fdx = new FormData(); fdx.append('file', new Blob([await wbk.xlsx.writeBuffer()]), 'dm.xlsx');
    await ok('/api/items/import', { method: 'POST', body: fdx });
    const all = await ok('/api/items');
    assert.equal(all.find((i) => i.code === 'VT011').vat_rate, '8'); assert.equal(all.find((i) => i.code === 'VT012').vat_rate, '5');
    step('Thuế suất GTGT: thêm/sửa, chặn giá trị sai, nhập từ Excel (0,08 → 8%, "5%" → 5%)');

    const r = await api('/api/vouchers', { method: 'POST', body: { type: 'N', date: '2026-09-30', lines: [{ item_id: A.id, qty: 1, unit_price: 1 }] } });
    assert.equal(r.status, 400); step('Chặn chứng từ có ngày <= ngày A');

    await ok('/api/vouchers', { method: 'POST', body: { type: 'N', date: '2026-10-05', partner: 'NCC Hà Tiên', lines: [{ item_id: A.id, qty: 50, unit_price: 88000 }] } });
    const neg = await api('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-10-02', lines: [{ item_id: A.id, qty: 120, unit_price: 100000 }] } });
    assert.equal(neg.status, 400); assert.match(neg.d.error, /âm kho/); step('Chặn xuất âm kho (ngày 02/10 mới có 100)');

    // Đọc PDF phiếu xuất
    const pdfPath = path.join(dir, 'px.pdf');
    execFileSync(process.execPath, [path.join(__dirname, 'make-pdf.js'), pdfPath]);
    const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(pdfPath)], { type: 'application/pdf' }), 'phieu_xuat.pdf');
    const p = await ok('/api/pdf/parse', { method: 'POST', body: fd });
    assert.equal(p.type, 'X'); assert.equal(p.number, 'XK-PDF-0015'); assert.equal(p.date, '2026-10-15');
    assert.match(p.partner, /Minh Phát/);
    assert.equal(p.lines.length, 2);
    assert.deepEqual(p.lines.map((l) => [l.code, l.qty, l.unit_price, l.amount]), [['VT001', 120, 100000, 12000000], ['VT002', 200, 18000, 3600000]]);
    assert.equal(p.unmatched.length, 1); assert.equal(p.unmatched[0].qty, 5);
    step(`Đọc PDF: số ${p.number}, ngày ${p.date}, KH "${p.partner}", ${p.lines.length} dòng khớp + ${p.unmatched.length} dòng chưa có mã`);
    await ok('/api/vouchers', { method: 'POST', body: { type: 'X', number: p.number, date: p.date, partner: p.partner, source: 'pdf', attachment: p.attachment, lines: p.lines.filter((l) => l.code === 'VT001') } });
    await ok('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-10-15', lines: [{ item_id: C.id, qty: 1, unit_price: 500 }] } });
    await ok('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-10-20', lines: [{ item_id: C.id, qty: 1, unit_price: 500 }] } });
    await ok('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-10-25', lines: [{ item_id: C.id, qty: 1, unit_price: 500 }] } });
    step('Lưu phiếu xuất từ PDF và nhập tay');

    // Tháng 11
    await ok('/api/vouchers', { method: 'POST', body: { type: 'N', date: '2026-11-03', lines: [{ item_id: A.id, qty: 20, unit_price: 90000 }] } });
    await ok('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-11-10', lines: [{ item_id: A.id, qty: 50, unit_price: 110000 }] } });

    await ok('/api/costing/run', { method: 'POST', body: { month: '2026-11' } });
    const t10 = await ok('/api/reports/nxt?from=2026-10&to=2026-10');
    const a10 = t10.rows.find((x) => x.code === 'VT001'), c10 = t10.rows.find((x) => x.code === 'VT002');
    // BQ T10 VT001 = (8.500.000 + 4.400.000) / (100 + 50) = 86.000
    assert.equal(a10.avg, 86000); assert.equal(a10.out_val, 10320000); assert.equal(a10.close_qty, 30); assert.equal(a10.close_val, 2580000);
    // VT002: 3 lần xuất 1 kg với BQ 333,33 -> 333 + 333 + 334 (dồn chênh lệch làm tròn), tồn = 0
    assert.equal(c10.out_val, 1000); assert.equal(c10.close_val, 0);
    const t11 = await ok('/api/reports/nxt?from=2026-11&to=2026-11');
    const a11 = t11.rows.find((x) => x.code === 'VT001');
    // BQ T11 = (2.580.000 + 1.800.000) / (30 + 20) = 87.600
    assert.equal(a11.open_val, 2580000); assert.equal(a11.avg, 87600); assert.equal(a11.out_val, 4380000); assert.equal(a11.close_val, 0);
    step('Giá vốn BQGQ cuối kỳ: T10 = 86.000đ, T11 = 87.600đ, chênh lệch làm tròn xử lý đúng');

    const xs = await ok('/api/vouchers?type=X');
    const pdfV = xs.find((v) => v.number === 'XK-PDF-0015');
    assert.equal(pdfV.total_cost, 10320000); step('Giá vốn được ghi vào phiếu xuất');

    await ok('/api/periods/2026-10/lock', { method: 'POST', body: { locked: true } });
    assert.equal((await api(`/api/vouchers/${pdfV.id}`, { method: 'DELETE' })).status, 400); step('Khóa sổ chặn sửa/xóa chứng từ');

    const ledger = await ok(`/api/reports/ledger?item_id=${A.id}&from=2026-10&to=2026-11`);
    assert.equal(ledger.lines.at(-1).bal_qty, 0); step('Sổ chi tiết vật tư');
    const x = await fetch(B + '/api/reports/nxt.xlsx?from=2026-10&to=2026-11', { headers: { cookie } });
    assert.equal(x.status, 200); assert.ok((await x.arrayBuffer()).byteLength > 1000); step('Xuất Excel NXT');

    const au = await ok('/api/audit');
    const acts = new Set(au.rows.map((a) => a.action));
    for (const a of ['LOGIN_FAIL', 'LOGIN_OK', 'PASSWORD_CHANGE', 'VOUCHER_CREATE', 'PDF_UPLOAD', 'COSTING_RUN', 'PERIOD_LOCK', 'EXPORT']) assert.ok(acts.has(a), a);
    step(`Nhật ký truy cập ghi ${au.total} sự kiện`);
    console.log('\nTẤT CẢ KIỂM THỬ ĐỀU ĐẠT');
  } catch (e) { console.error('✘', e); process.exitCode = 1; }
  finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
})();

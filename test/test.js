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
    // Danh mục đối tượng
    const KH = await ok('/api/partners', { method: 'POST', body: { kind: 'KH', code: 'KH001', name: 'Công ty CP Xây dựng Minh Phát', tax_code: '0101234567' } });
    const NCC = await ok('/api/partners', { method: 'POST', body: { kind: 'NCC', code: 'NCC001', name: 'Công ty Xi măng Hà Tiên' } });
    assert.equal((await api('/api/partners', { method: 'POST', body: { code: 'X1', name: 'Không loại' } })).status, 400);
    assert.equal((await api('/api/partners', { method: 'POST', body: { kind: 'KH', code: 'kh001', name: 'Trùng mã' } })).status, 400);
    await ok('/api/partners', { method: 'POST', body: { kind: 'NCC', code: 'KH001', name: 'Minh Phát (bán vật tư cho ta)' } }); // cùng mã ở danh mục khác: hợp lệ
    assert.equal((await ok('/api/partners?kind=KH')).length, 1); assert.equal((await ok('/api/partners?kind=NCC')).length, 2);
    const wrong = await api('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-10-06', partner_id: NCC.id, lines: [{ item_id: A.id, qty: 1, unit_price: 1 }] } });
    assert.equal(wrong.status, 400); assert.match(wrong.d.error, /không phải khách hàng/);
    step('Hai danh mục KH và NCC độc lập (Mã/Tên/MST); chặn chọn NCC trên phiếu xuất');

    const pdfPath = path.join(dir, 'px.pdf');
    execFileSync(process.execPath, [path.join(__dirname, 'make-pdf.js'), pdfPath]);
    const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(pdfPath)], { type: 'application/pdf' }), 'phieu_xuat.pdf');
    const p = await ok('/api/pdf/parse?type=X', { method: 'POST', body: fd });
    assert.equal(p.partner_id, KH.id);
    assert.equal(p.tax_code, '0101234567'); assert.equal(p.warehouse, 'KHO1'); assert.equal(p.ref_no, 'XKCH7050');
    assert.equal(p.contact, 'Anh Tuấn'); assert.equal(p.phone, '0912345678'); assert.equal(p.salesperson, 'Nguyễn Văn Bình');
    assert.match(p.delivery_place, /Long Biên/);
    assert.deepEqual(p.lines.map((l) => [l.vat_rate, l.discount_rate]), [['8', 0], ['10', 0]]);
    assert.equal(p.type, 'X'); assert.equal(p.number, 'XK-PDF-0015'); assert.equal(p.date, '2026-10-15');
    assert.match(p.partner, /Minh Phát/);
    assert.equal(p.lines.length, 2);
    assert.deepEqual(p.lines.map((l) => [l.code, l.qty, l.unit_price, l.amount]), [['VT001', 120, 100000, 12000000], ['VT002', 200, 18000, 3600000]]);
    assert.equal(p.unmatched.length, 1); assert.equal(p.unmatched[0].qty, 5);
    step(`Đọc PDF: số ${p.number}, ngày ${p.date}, KH "${p.partner}", ${p.lines.length} dòng khớp + ${p.unmatched.length} dòng chưa có mã`);
    await ok('/api/vouchers', { method: 'POST', body: { type: 'X', number: p.number, date: p.date, partner_id: p.partner_id, partner: p.partner, tax_code: p.tax_code, warehouse: p.warehouse, contact: p.contact, source: 'pdf', attachment: p.attachment, lines: p.lines.filter((l) => l.code === 'VT001') } });
    await ok('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-10-15', lines: [{ item_id: C.id, qty: 1, unit_price: 500 }] } });
    await ok('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-10-20', lines: [{ item_id: C.id, qty: 1, unit_price: 500 }] } });
    await ok('/api/vouchers', { method: 'POST', body: { type: 'X', date: '2026-10-25', lines: [{ item_id: C.id, qty: 1, unit_price: 500 }] } });
    { const sv = (await ok('/api/vouchers?type=X')).find((v) => v.number === 'XK-PDF-0015'); const full = await ok('/api/vouchers/' + sv.id);
      assert.equal(full.tax_code, '0101234567'); assert.equal(full.warehouse, 'KHO1'); assert.equal(full.lines[0].vat_rate, '8'); assert.equal(full.lines[0].vat_amount, 960000); assert.equal(sv.total_vat, 960000); }
    step('Lưu phiếu xuất từ PDF và nhập tay');
    const bd = await ok('/api/items/bulk-delete', { method: 'POST', body: { ids: [V.id, A.id, 99999] } });
    assert.deepEqual(bd.deleted, ['VT009']);
    assert.deepEqual(bd.skipped.map((s) => s.code), ['VT001', '#99999']);
    assert.ok(!(await ok('/api/items')).some((i) => i.code === 'VT009'));
    step('Xóa hàng loạt: xóa mã chưa phát sinh, giữ lại mã đã có chứng từ kèm lý do');

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
    assert.equal(pdfV.partner_code, 'KH001');
    assert.equal((await ok(`/api/vouchers?type=X&partner_id=${KH.id}`)).length, 1);
    const rk = await ok('/api/reports/partners?kind=KH&from=2026-10&to=2026-10');
    const rowKH = rk.rows.find((r) => r.code === 'KH001');
    assert.equal(rowKH.amount, 12000000); assert.equal(rowKH.cost, 10320000); assert.equal(rowKH.profit, 1680000);
    assert.ok(rk.rows.some((r) => r.partner_id === null)); // phiếu chưa gắn đối tượng
    const det = await ok(`/api/reports/partner-detail?kind=KH&key=${encodeURIComponent(rowKH.key)}&from=2026-10&to=2026-10`);
    assert.equal(det.items[0].code, 'VT001'); assert.equal(det.vouchers[0].number, 'XK-PDF-0015');
    step('Phiếu từ PDF tự nhận khách hàng theo MST/tên; báo cáo theo đối tượng');
    const an = await ok('/api/reports/analytics?from=2026-10&to=2026-11');
    assert.equal(an.months.length, 2);
    assert.equal(an.months[0].cost, 10320000 + 1000); assert.equal(an.months[1].cost, 4380000);
    assert.equal(an.totals.profit, an.totals.revenue - an.totals.cost);
    assert.equal(an.top_customers[0].name, 'Công ty CP Xây dựng Minh Phát');
    step(`Dashboard phân tích: doanh thu ${an.totals.revenue.toLocaleString('vi-VN')}, lãi gộp ${an.totals.profit.toLocaleString('vi-VN')}`);

    await ok('/api/periods/2026-10/lock', { method: 'POST', body: { locked: true } });
    assert.equal((await api(`/api/vouchers/${pdfV.id}`, { method: 'DELETE' })).status, 400); step('Khóa sổ chặn sửa/xóa chứng từ');
    const allV = [...await ok('/api/vouchers?type=N'), ...await ok('/api/vouchers?type=X')];
    const nNov = allV.find((v) => v.type === 'N' && v.date === '2026-11-03'), xNov = allV.find((v) => v.type === 'X' && v.date === '2026-11-10');
    const b1 = await ok('/api/vouchers/bulk-delete', { method: 'POST', body: { ids: [pdfV.id, nNov.id] } });
    assert.deepEqual(b1.deleted, []);
    assert.match(b1.skipped.find((x) => x.number === pdfV.number).reason, /khóa sổ/);
    assert.match(b1.skipped.find((x) => x.number === nNov.number).reason, /âm kho/);
    const b2 = await ok('/api/vouchers/bulk-delete', { method: 'POST', body: { ids: [nNov.id, xNov.id] } }); // xóa phiếu xuất trước nên phiếu nhập xóa được
    assert.equal(b2.deleted.length, 2); assert.equal(b2.skipped.length, 0);
    step('Xóa hàng loạt phiếu: giữ lại phiếu kỳ đã khóa sổ / làm âm kho, xóa đúng thứ tự xuất trước nhập sau');

    const ledger = await ok(`/api/reports/ledger?item_id=${A.id}&from=2026-10&to=2026-11`);
    assert.equal(ledger.lines.at(-1).bal_qty, 30); step('Sổ chi tiết vật tư (sau khi xóa 2 phiếu tháng 11: tồn 30)');
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

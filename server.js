// Ứng dụng Quản lý kho - máy chủ
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const { db, tx, now, getSetting, setSetting, UPLOAD_DIR } = require('./src/db');
const auth = require('./src/auth');
const { audit, requireAuth, requireRole } = auth;
const costing = require('./src/costing');
const { parsePdf } = require('./src/pdfparser');
const analytics = require('./src/analytics');

auth.ensureAdmin();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Bọc handler để trả lỗi dạng JSON
const h = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    console.error(e);
    res.status(e.status || 400).json({ error: e.message || 'Lỗi không xác định' });
  }
};
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isMonth = (s) => /^\d{4}-\d{2}$/.test(String(s || ''));
const canWrite = requireRole('admin', 'user');
const adminOnly = requireRole('admin');

// Thuế suất thuế GTGT: 0%, 5%, 8%, 10%, KCT (không chịu thuế), KKKNT (không kê khai, tính nộp thuế)
const VAT_RATES = ['0', '5', '8', '10', 'KCT', 'KKKNT'];
function normVat(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  let s = String(v).trim().toUpperCase().replace(/\s/g, '').replace('%', '').replace(',', '.');
  if (/^0?\.\d+$/.test(s)) s = String(Math.round(Number(s) * 100)); // ô Excel định dạng % (0,1 = 10%)
  else if (/^\d+(\.0+)?$/.test(s)) s = String(Number(s));
  if (!VAT_RATES.includes(s)) throw fail(`Thuế suất GTGT "${v}" không hợp lệ. Chọn một trong: 0%, 5%, 8%, 10%, KCT, KKKNT`);
  return s;
}

// ---------------- Đăng nhập ----------------
app.post('/api/login', h(auth.login));
app.use('/api', requireAuth);
app.post('/api/logout', h(auth.logout));
app.get('/api/me', (req, res) => res.json({
  user: auth.publicUser(req.user),
  settings: { company_name: getSetting('company_name', ''), company_address: getSetting('company_address', ''), opening_date: getSetting('opening_date') },
}));
app.post('/api/me/password', h((req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!auth.verifyPassword(String(old_password || ''), req.user.password_hash)) throw fail('Mật khẩu hiện tại không đúng');
  const err = auth.validatePassword(new_password);
  if (err) throw fail(err);
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(auth.hashPassword(new_password), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.sessionToken);
  audit(req, 'PASSWORD_CHANGE', 'Đổi mật khẩu');
  res.json({ ok: true });
}));

// ---------------- Cài đặt ----------------
app.get('/api/settings', (req, res) => res.json({
  company_name: getSetting('company_name', ''), company_address: getSetting('company_address', ''),
  company_tax: getSetting('company_tax', ''), opening_date: getSetting('opening_date'),
}));
app.put('/api/settings', adminOnly, h((req, res) => {
  const b = req.body || {};
  const old = getSetting('opening_date');
  if (b.opening_date !== undefined && b.opening_date !== old) {
    if (!isDate(b.opening_date)) throw fail('Ngày chốt số dư không hợp lệ');
    const c = db.prepare('SELECT COUNT(*) c FROM vouchers WHERE date <= ?').get(b.opening_date).c;
    if (c) throw fail(`Có ${c} phiếu phát sinh trước hoặc trong ngày ${b.opening_date}, không thể đổi ngày chốt`);
    if (db.prepare('SELECT COUNT(*) c FROM periods WHERE locked = 1').get().c) throw fail('Đã có kỳ khóa sổ, không thể đổi ngày chốt số dư');
    setSetting('opening_date', b.opening_date);
    db.prepare("UPDATE periods SET status = 'dirty'").run();
  }
  for (const k of ['company_name', 'company_address', 'company_tax']) if (b[k] !== undefined) setSetting(k, String(b[k]).slice(0, 300));
  audit(req, 'SETTINGS_UPDATE', JSON.stringify(b));
  res.json({ ok: true });
}));

// ---------------- Danh mục vật tư hàng hóa ----------------

// Giá bán trong danh mục: nhập giá +VAT thì tự tính giá -VAT theo thuế suất; chỉ nhập giá -VAT thì giữ nguyên
function salePrices(b, vat) {
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  const k = 1 + (/^\d+$/.test(vat || '') ? Number(vat) : 0) / 100;
  if (has(b.sale_price_vat)) { const g = num(b.sale_price_vat); if (g < 0) throw fail('Giá bán không hợp lệ'); return { sale_price: Math.round(g / k * 100) / 100, sale_price_vat: g }; }
  if (has(b.sale_price)) { const n = num(b.sale_price); if (n < 0) throw fail('Giá bán không hợp lệ'); return { sale_price: n, sale_price_vat: null }; }
  return { sale_price: null, sale_price_vat: null };
}
const setSale = (id, sp) => db.prepare('UPDATE items SET sale_price = ?, sale_price_vat = ? WHERE id = ?').run(sp.sale_price, sp.sale_price_vat, id);
function assertOpeningEditable() {
  if (db.prepare('SELECT COUNT(*) c FROM periods WHERE locked = 1').get().c) throw fail('Đã có kỳ khóa sổ, không thể sửa số dư đầu kỳ');
}
app.get('/api/items', (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : '9999-12-31';
  const stock = costing.stockQtyAt(date, Number(req.query.exclude) || 0);
  const rows = db.prepare('SELECT * FROM items ORDER BY code').all().map((i) => ({ ...i, stock_qty: stock[i.id] ?? i.opening_qty }));
  res.json(rows);
});
app.post('/api/items', canWrite, h((req, res) => {
  const b = req.body || {};
  if (!b.code || !b.name) throw fail('Mã và tên hàng là bắt buộc');
  if (num(b.opening_qty) || num(b.opening_value)) assertOpeningEditable();
  const sp = salePrices(b, normVat(b.vat_rate));
  const r = db.prepare('INSERT INTO items(code, name, unit, vat_rate, opening_qty, opening_value, note, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(String(b.code).trim(), String(b.name).trim(), b.unit || '', normVat(b.vat_rate), num(b.opening_qty), Math.round(num(b.opening_value)), b.note || '', now());
  setSale(Number(r.lastInsertRowid), sp);
  if (num(b.opening_qty) || num(b.opening_value)) costing.markDirty(costing.firstMonth() || '0000-00');
  audit(req, 'ITEM_CREATE', `${b.code} - ${b.name}${b.vat_rate ? `, thuế GTGT ${b.vat_rate}` : ''}${sp.sale_price != null ? `, giá bán ${sp.sale_price_vat ?? sp.sale_price}${sp.sale_price_vat != null ? ' (+VAT)' : ' (-VAT)'}` : ''}`);
  res.json({ id: Number(r.lastInsertRowid) });
}));
app.put('/api/items/:id', canWrite, h((req, res) => {
  const b = req.body || {};
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!it) throw fail('Không tìm thấy mã hàng', 404);
  const oq = num(b.opening_qty), ov = Math.round(num(b.opening_value));
  const vat = normVat(b.vat_rate);
  const sp = salePrices(b, vat);
  const openingChanged = oq !== it.opening_qty || ov !== it.opening_value;
  if (openingChanged) assertOpeningEditable();
  tx(() => {
    db.prepare('UPDATE items SET code=?, name=?, unit=?, vat_rate=?, opening_qty=?, opening_value=?, note=?, updated_at=? WHERE id=?')
      .run(String(b.code).trim(), String(b.name).trim(), b.unit || '', vat, oq, ov, b.note || '', now(), it.id);
    setSale(it.id, sp);
    if (openingChanged) { costing.checkNoNegative([it.id]); costing.markDirty(costing.firstMonth() || '0000-00'); }
  });
  audit(req, 'ITEM_UPDATE', `${it.code}: ${JSON.stringify({ code: b.code, name: b.name, vat_rate: vat, opening_qty: oq, opening_value: ov, ...sp })} (cũ: thuế ${it.vat_rate ?? '-'}, giá bán ${it.sale_price_vat ?? it.sale_price ?? '-'}, SL ${it.opening_qty}, GT ${it.opening_value})`);
  res.json({ ok: true });
}));
app.delete('/api/items/:id', canWrite, h((req, res) => {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!it) throw fail('Không tìm thấy mã hàng', 404);
  if (db.prepare('SELECT COUNT(*) c FROM voucher_lines WHERE item_id = ?').get(it.id).c) throw fail('Mã hàng đã phát sinh chứng từ, không thể xóa');
  if (it.opening_qty || it.opening_value) assertOpeningEditable();
  db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
  costing.markDirty(costing.firstMonth() || '0000-00');
  audit(req, 'ITEM_DELETE', `${it.code} - ${it.name}`);
  res.json({ ok: true });
}));

// Xóa hàng loạt: xóa các mã được phép, trả về danh sách mã bị bỏ qua kèm lý do
app.post('/api/items/bulk-delete', canWrite, h((req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw fail('Chưa chọn mã hàng nào');
  if (ids.length > 5000) throw fail('Mỗi lần xóa tối đa 5.000 mã');
  const locked = db.prepare('SELECT COUNT(*) c FROM periods WHERE locked = 1').get().c > 0;
  const used = db.prepare('SELECT COUNT(*) c FROM voucher_lines WHERE item_id = ?');
  const deleted = [], skipped = [];
  tx(() => {
    for (const id of ids) {
      const it = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      if (!it) { skipped.push({ code: `#${id}`, reason: 'Không còn tồn tại' }); continue; }
      if (used.get(id).c) { skipped.push({ code: it.code, name: it.name, reason: 'Đã phát sinh chứng từ nhập/xuất' }); continue; }
      if (locked && (it.opening_qty || it.opening_value)) { skipped.push({ code: it.code, name: it.name, reason: 'Có số dư đầu kỳ và đã có kỳ khóa sổ' }); continue; }
      db.prepare('DELETE FROM items WHERE id = ?').run(id);
      deleted.push(it.code);
    }
    if (deleted.length) costing.markDirty(costing.firstMonth() || '0000-00');
  });
  audit(req, 'ITEM_BULK_DELETE', `Xóa ${deleted.length} mã: ${deleted.join(', ') || '(không có)'}${skipped.length ? ` | bỏ qua ${skipped.length}: ${skipped.map((s) => `${s.code} (${s.reason})`).join(', ')}` : ''}`.slice(0, 8000));
  res.json({ deleted, skipped });
}));

// Mẫu Excel nhập danh mục + tồn đầu kỳ
app.get('/api/items/template.xlsx', h(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DanhMuc');
  ws.columns = [
    { header: 'Mã hàng', key: 'code', width: 15 }, { header: 'Tên hàng', key: 'name', width: 40 },
    { header: 'ĐVT', key: 'unit', width: 10 }, { header: 'SL tồn đầu kỳ', key: 'qty', width: 15 },
    { header: 'Giá trị tồn đầu kỳ', key: 'val', width: 20 }, { header: 'Ghi chú', key: 'note', width: 25 },
    { header: 'Thuế suất GTGT (0%, 5%, 8%, 10%, KCT, KKKNT)', key: 'vat', width: 22 },
    { header: 'Giá bán (+VAT)', key: 'sale', width: 16 },
  ];
  ws.addRow({ code: 'VT001', name: 'Xi măng PCB40', unit: 'Bao', qty: 100, val: 8500000, vat: '10%', sale: 99000 });
  ws.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="mau_danh_muc_ton_dau.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

app.post('/api/items/import', canWrite, upload.single('file'), h(async (req, res) => {
  if (!req.file) throw fail('Chưa chọn file');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const ws = wb.worksheets[0];
  const val = (c) => { const v = c.value; if (v && typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : ''); return v; };
  const rows = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const code = String(val(row.getCell(1)) ?? '').trim();
    if (!code) return;
    rows.push({ code, name: String(val(row.getCell(2)) ?? '').trim(), unit: String(val(row.getCell(3)) ?? '').trim(),
      qty: num(val(row.getCell(4))), value: Math.round(num(val(row.getCell(5)))), note: String(val(row.getCell(6)) ?? '').trim(), vat: val(row.getCell(7)), sale_vat: val(row.getCell(8)), line: i });
  });
  if (!rows.length) throw fail('File không có dữ liệu (dòng 1 là tiêu đề, từ dòng 2: Mã, Tên, ĐVT, SL tồn, Giá trị tồn, Ghi chú, Thuế suất GTGT)');
  for (const r of rows) { try { r.vat = normVat(r.vat); r.sp = salePrices({ sale_price_vat: r.sale_vat }, r.vat); } catch (e) { throw fail(`Dòng ${r.line} (mã ${r.code}): ${e.message}`); } }
  assertOpeningEditable();
  let created = 0, updated = 0;
  tx(() => {
    for (const r of rows) {
      if (!r.name) throw fail(`Mã ${r.code} thiếu tên hàng`);
      const ex = db.prepare('SELECT id FROM items WHERE code = ?').get(r.code);
      if (ex) {
        db.prepare('UPDATE items SET name=?, unit=?, vat_rate=?, opening_qty=?, opening_value=?, note=?, updated_at=? WHERE id=?').run(r.name, r.unit, r.vat, r.qty, r.value, r.note, now(), ex.id);
        if (r.sp.sale_price != null) setSale(ex.id, r.sp);
        updated++;
      } else {
        const ins = db.prepare('INSERT INTO items(code, name, unit, vat_rate, opening_qty, opening_value, note, created_at) VALUES (?,?,?,?,?,?,?,?)').run(r.code, r.name, r.unit, r.vat, r.qty, r.value, r.note, now());
        setSale(Number(ins.lastInsertRowid), r.sp);
        created++;
      }
    }
    costing.checkNoNegative(db.prepare('SELECT id FROM items').all().map((x) => x.id));
    costing.markDirty(costing.firstMonth() || '0000-00');
  });
  audit(req, 'ITEM_IMPORT', `Nhập Excel: thêm ${created}, cập nhật ${updated}`);
  res.json({ created, updated });
}));


// ---------------- Danh mục khách hàng & danh mục nhà cung cấp ----------------
// Hai danh mục độc lập (kind = 'KH' | 'NCC'), mỗi đối tượng chỉ gồm Mã / Tên / MST.
const KIND_NAME = { KH: 'khách hàng', NCC: 'nhà cung cấp' };
function needKind(k) {
  if (k !== 'KH' && k !== 'NCC') throw fail('Thiếu loại danh mục (KH hoặc NCC)');
  return k;
}
function cleanPartner(b) {
  const code = String(b.code ?? '').trim().slice(0, 50), name = String(b.name ?? '').trim().slice(0, 300);
  if (!code || !name) throw fail('Mã và tên là bắt buộc');
  return { code, name, tax_code: String(b.tax_code ?? '').trim().slice(0, 20) };
}

app.get('/api/partners', (req, res) => {
  const kind = req.query.kind === 'KH' || req.query.kind === 'NCC' ? req.query.kind : null;
  res.json(db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM vouchers v WHERE v.partner_id = p.id) voucher_count
    FROM partners p ${kind ? 'WHERE p.kind = ?' : ''} ORDER BY p.code`).all(...(kind ? [kind] : [])));
});
app.post('/api/partners', canWrite, h((req, res) => {
  const kind = needKind(req.body?.kind);
  const p = cleanPartner(req.body || {});
  if (db.prepare('SELECT id FROM partners WHERE kind = ? AND code = ?').get(kind, p.code)) throw fail(`Mã ${p.code} đã có trong danh mục ${KIND_NAME[kind]}`);
  const r = db.prepare('INSERT INTO partners(kind, code, name, tax_code, created_at) VALUES (?,?,?,?,?)').run(kind, p.code, p.name, p.tax_code, now());
  audit(req, 'PARTNER_CREATE', `Danh mục ${KIND_NAME[kind]}: ${p.code} - ${p.name}${p.tax_code ? ', MST ' + p.tax_code : ''}`);
  res.json({ id: Number(r.lastInsertRowid) });
}));
app.put('/api/partners/:id', canWrite, h((req, res) => {
  const old = db.prepare('SELECT * FROM partners WHERE id = ?').get(req.params.id);
  if (!old) throw fail('Không tìm thấy', 404);
  const p = cleanPartner(req.body || {});
  if (db.prepare('SELECT id FROM partners WHERE kind = ? AND code = ? AND id <> ?').get(old.kind, p.code, old.id)) throw fail(`Mã ${p.code} đã có trong danh mục ${KIND_NAME[old.kind]}`);
  db.prepare('UPDATE partners SET code=?, name=?, tax_code=?, updated_at=? WHERE id=?').run(p.code, p.name, p.tax_code, now(), old.id);
  audit(req, 'PARTNER_UPDATE', `Danh mục ${KIND_NAME[old.kind]}: ${old.code} → ${p.code} - ${p.name}${p.tax_code ? ', MST ' + p.tax_code : ''} (cũ: ${old.name}${old.tax_code ? ', MST ' + old.tax_code : ''})`);
  res.json({ ok: true });
}));
app.post('/api/partners/bulk-delete', canWrite, h((req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw fail('Chưa chọn dòng nào');
  const deleted = [], skipped = [];
  let kind = null;
  tx(() => {
    for (const id of ids) {
      const p = db.prepare('SELECT * FROM partners WHERE id = ?').get(id);
      if (!p) { skipped.push({ code: `#${id}`, reason: 'Không còn tồn tại' }); continue; }
      kind = p.kind;
      const n = db.prepare('SELECT COUNT(*) c FROM vouchers WHERE partner_id = ?').get(id).c;
      if (n) { skipped.push({ code: p.code, name: p.name, reason: `Đã có ${n} chứng từ` }); continue; }
      db.prepare('DELETE FROM partners WHERE id = ?').run(id);
      deleted.push(p.code);
    }
  });
  audit(req, 'PARTNER_DELETE', `Danh mục ${KIND_NAME[kind] || ''}: xóa ${deleted.length}: ${deleted.join(', ') || '(không có)'}${skipped.length ? ` | bỏ qua: ${skipped.map((x) => `${x.code} (${x.reason})`).join(', ')}` : ''}`);
  res.json({ deleted, skipped });
}));
app.get('/api/partners/template.xlsx', h(async (req, res) => {
  const kind = needKind(req.query.kind);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === 'KH' ? 'KhachHang' : 'NhaCungCap');
  ws.columns = [{ header: kind === 'KH' ? 'Mã khách hàng' : 'Mã nhà cung cấp', width: 18 }, { header: kind === 'KH' ? 'Tên khách hàng' : 'Tên nhà cung cấp', width: 45 }, { header: 'Mã số thuế', width: 16 }];
  ws.addRow(kind === 'KH' ? ['KH001', 'Công ty CP Xây dựng Minh Phát', '0101234567'] : ['NCC001', 'Công ty Xi măng Hà Tiên', '0300000001']);
  ws.getRow(1).font = { bold: true };
  ws.getColumn(3).numFmt = '@';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="mau_danh_muc_${kind === 'KH' ? 'khach_hang' : 'nha_cung_cap'}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));
app.post('/api/partners/import', canWrite, upload.single('file'), h(async (req, res) => {
  const kind = needKind(req.query.kind);
  if (!req.file) throw fail('Chưa chọn file');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const ws = wb.worksheets[0];
  const val = (c) => { const v = c.value; if (v && typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : ''); return v ?? ''; };
  const rows = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const c = [1, 2, 3].map((k) => String(val(row.getCell(k))).trim());
    if (!c[0]) return;
    try { rows.push(cleanPartner({ code: c[0], name: c[1], tax_code: c[2] })); } catch (e) { throw fail(`Dòng ${i}: ${e.message}`); }
  });
  if (!rows.length) throw fail('File không có dữ liệu (dòng 1 là tiêu đề, từ dòng 2: Mã, Tên, Mã số thuế)');
  let created = 0, updated = 0;
  tx(() => {
    for (const p of rows) {
      const ex = db.prepare('SELECT id FROM partners WHERE kind = ? AND code = ?').get(kind, p.code);
      if (ex) { db.prepare('UPDATE partners SET name=?, tax_code=?, updated_at=? WHERE id=?').run(p.name, p.tax_code, now(), ex.id); updated++; }
      else { db.prepare('INSERT INTO partners(kind, code, name, tax_code, created_at) VALUES (?,?,?,?,?)').run(kind, p.code, p.name, p.tax_code, now()); created++; }
    }
  });
  audit(req, 'PARTNER_IMPORT', `Nhập Excel danh mục ${KIND_NAME[kind]}: thêm ${created}, cập nhật ${updated}`);
  res.json({ created, updated });
}));

// Tìm đối tượng khớp với nội dung PDF trong đúng danh mục: ưu tiên mã số thuế, sau đó tên
function matchPartner(type, taxCode, name) {
  const kind = type === 'N' ? 'NCC' : 'KH';
  const digits = String(taxCode || '').replace(/\D/g, '');
  const list = db.prepare('SELECT * FROM partners WHERE kind = ?').all(kind);
  if (digits) { const p = list.find((x) => String(x.tax_code || '').replace(/\D/g, '') === digits); if (p) return p; }
  const nn = (x) => String(x || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  return name ? list.find((x) => nn(x.name) === nn(name)) || null : null;
}

// ---------------- Chứng từ nhập / xuất ----------------
const TYPE_NAME = { N: 'Phiếu nhập kho', X: 'Phiếu xuất kho bán hàng' };
const PREFIX = { N: 'NK', X: 'XK' };

function nextNumber(type) {
  const rows = db.prepare('SELECT number FROM vouchers WHERE type = ? AND number LIKE ?').all(type, PREFIX[type] + '%');
  let max = 0;
  for (const r of rows) { const m = r.number.match(/(\d+)$/); if (m) max = Math.max(max, Number(m[1])); }
  return PREFIX[type] + String(max + 1).padStart(5, '0');
}
app.get('/api/vouchers/next-number', (req, res) => res.json({ number: nextNumber(req.query.type === 'X' ? 'X' : 'N') }));

app.get('/api/vouchers', (req, res) => {
  const where = [], args = [];
  if (req.query.type) { where.push('v.type = ?'); args.push(req.query.type); }
  if (isDate(req.query.from)) { where.push('v.date >= ?'); args.push(req.query.from); }
  if (isDate(req.query.to)) { where.push('v.date <= ?'); args.push(req.query.to); }
  if (req.query.q) { where.push('(v.number LIKE ? OR v.partner LIKE ? OR v.description LIKE ?)'); const q = `%${req.query.q}%`; args.push(q, q, q); }
  if (req.query.partner_id) { where.push('v.partner_id = ?'); args.push(Number(req.query.partner_id)); }
  const rows = db.prepare(`SELECT v.*, (SELECT code FROM partners WHERE id = v.partner_id) partner_code, COALESCE(SUM(l.amount),0) total_amount, COALESCE(SUM(l.vat_amount),0) total_vat, SUM(l.cost_amount) total_cost, COUNT(l.id) line_count,
      SUM(CASE WHEN l.cost_amount IS NULL THEN 1 ELSE 0 END) uncosted, p.status period_status, COALESCE(p.locked,0) locked
    FROM vouchers v LEFT JOIN voucher_lines l ON l.voucher_id = v.id LEFT JOIN periods p ON p.month = substr(v.date,1,7)
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY v.id ORDER BY v.date DESC, v.id DESC LIMIT 2000`).all(...args);
  res.json(rows);
});

function getVoucher(id) {
  const v = db.prepare(`SELECT v.*, (SELECT code FROM partners WHERE id = v.partner_id) partner_code, p.status period_status, COALESCE(p.locked,0) locked FROM vouchers v
    LEFT JOIN periods p ON p.month = substr(v.date,1,7) WHERE v.id = ?`).get(id);
  if (!v) return null;
  v.lines = db.prepare(`SELECT l.*, i.code, i.name, i.unit FROM voucher_lines l JOIN items i ON i.id = l.item_id
    WHERE l.voucher_id = ? ORDER BY l.sort, l.id`).all(id);
  return v;
}
app.get('/api/vouchers/:id', h((req, res) => {
  const v = getVoucher(req.params.id);
  if (!v) throw fail('Không tìm thấy chứng từ', 404);
  res.json(v);
}));

function validateVoucher(b) {
  const type = b.type === 'X' ? 'X' : b.type === 'N' ? 'N' : null;
  if (!type) throw fail('Loại chứng từ không hợp lệ');
  if (!isDate(b.date)) throw fail('Ngày chứng từ không hợp lệ');
  const A = getSetting('opening_date');
  if (!A) throw fail('Chưa thiết lập ngày chốt số dư đầu kỳ (Cài đặt)');
  if (b.date <= A) throw fail(`Ngày chứng từ phải sau ngày chốt số dư ${A}`);
  if (costing.isLocked(b.date.slice(0, 7))) throw fail(`Kỳ ${b.date.slice(0, 7)} đã khóa sổ`);
  const number = String(b.number || '').trim() || nextNumber(type);
  let partner_id = null;
  let partnerName = String(b.partner || '').trim();
  if (b.partner_id) {
    const p = db.prepare('SELECT * FROM partners WHERE id = ?').get(Number(b.partner_id));
    if (!p) throw fail('Đối tượng không tồn tại trong danh mục');
    if (type === 'X' && p.kind !== 'KH') throw fail(`${p.code} - ${p.name} thuộc danh mục nhà cung cấp, không phải khách hàng`);
    if (type === 'N' && p.kind !== 'NCC') throw fail(`${p.code} - ${p.name} thuộc danh mục khách hàng, không phải nhà cung cấp`);
    partner_id = p.id;
    if (!partnerName) partnerName = p.name;
  }
  const lines = (b.lines || []).filter((l) => l && l.item_id);
  if (!lines.length) throw fail('Chứng từ phải có ít nhất một dòng hàng');
  const clean = lines.map((l, i) => {
    const item = db.prepare('SELECT id, code, vat_rate FROM items WHERE id = ?').get(l.item_id);
    if (!item) throw fail(`Dòng ${i + 1}: mã hàng không tồn tại`);
    const qty = num(l.qty);
    if (qty <= 0) throw fail(`Dòng ${i + 1} (${item.code}): số lượng phải lớn hơn 0`);
    const price = num(l.unit_price);
    const discount_rate = num(l.discount_rate);
    if (discount_rate < 0 || discount_rate > 100) throw fail(`Dòng ${i + 1} (${item.code}): tỷ lệ chiết khấu phải từ 0 đến 100%`);
    const amount = l.amount !== undefined && l.amount !== '' && l.amount !== null ? Math.round(num(l.amount)) : Math.round(qty * price * (1 - discount_rate / 100));
    if (type === 'N' && amount < 0) throw fail(`Dòng ${i + 1}: giá trị nhập không hợp lệ`);
    let vat_rate;
    try { vat_rate = l.vat_rate === undefined ? item.vat_rate : normVat(l.vat_rate); } catch (e) { throw fail(`Dòng ${i + 1} (${item.code}): ${e.message}`); }
    const vat_amount = /^\d+$/.test(vat_rate || '') ? Math.round(amount * Number(vat_rate) / 100) : 0;
    const price_vat = l.price_vat === undefined || l.price_vat === null || l.price_vat === '' ? null : num(l.price_vat);
    return { item_id: item.id, qty, unit_price: price, price_vat, amount, discount_rate, vat_rate, vat_amount, sort: i };
  });
  return { type, number, date: b.date, partner_id, partner: partnerName, address: b.address || '', description: b.description || '', ref_no: b.ref_no || '', ...extraFields(b), source: b.source === 'pdf' ? 'pdf' : 'manual', attachment: safeAttachment(b.attachment), lines: clean };
}
// Các trường thông tin thêm trên phiếu (MST, người liên hệ, điện thoại, địa điểm giao hàng, NV bán hàng, mã kho)
const EXTRA_FIELDS = ['tax_code', 'contact', 'phone', 'delivery_place', 'salesperson', 'warehouse'];
function extraFields(b) { return Object.fromEntries(EXTRA_FIELDS.map((k) => [k, String(b[k] ?? '').trim().slice(0, 300)])); }
function saveExtra(id, v) { db.prepare(`UPDATE vouchers SET ${EXTRA_FIELDS.map((k) => k + '=?').join(', ')} WHERE id = ?`).run(...EXTRA_FIELDS.map((k) => v[k]), id); }
function safeAttachment(a) {
  if (!a) return null;
  const s = String(a);
  return /^[a-f0-9]{32}\.pdf$/.test(s) && fs.existsSync(path.join(UPLOAD_DIR, s)) ? s : null;
}
function insertLines(vid, lines) {
  const st = db.prepare('INSERT INTO voucher_lines(voucher_id, item_id, qty, unit_price, price_vat, amount, discount_rate, vat_rate, vat_amount, sort) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const l of lines) st.run(vid, l.item_id, l.qty, l.unit_price, l.price_vat, l.amount, l.discount_rate, l.vat_rate, l.vat_amount, l.sort);
}
const summary = (v) => `${TYPE_NAME[v.type]} ${v.number} ngày ${v.date}, ${v.lines.length} dòng, tổng ${v.lines.reduce((s, l) => s + l.amount, 0).toLocaleString('vi-VN')}`;

app.post('/api/vouchers', canWrite, h((req, res) => {
  const v = validateVoucher(req.body || {});
  if (db.prepare('SELECT id FROM vouchers WHERE type = ? AND number = ?').get(v.type, v.number)) throw fail(`Số phiếu ${v.number} đã tồn tại`);
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO vouchers(type, number, date, partner_id, partner, address, description, ref_no, source, attachment, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.type, v.number, v.date, v.partner_id, v.partner, v.address, v.description, v.ref_no, v.source, v.attachment, req.user.username, now());
    const id = Number(r.lastInsertRowid);
    saveExtra(id, v);
    insertLines(id, v.lines);
    costing.checkNoNegative(v.lines.map((l) => l.item_id));
    costing.markDirty(v.date.slice(0, 7));
    return id;
  });
  audit(req, 'VOUCHER_CREATE', summary(v) + (v.source === 'pdf' ? ' (từ PDF)' : ''));
  res.json({ id });
}));

app.put('/api/vouchers/:id', canWrite, h((req, res) => {
  const old = getVoucher(req.params.id);
  if (!old) throw fail('Không tìm thấy chứng từ', 404);
  if (old.locked) throw fail(`Kỳ ${old.date.slice(0, 7)} đã khóa sổ`);
  const v = validateVoucher({ ...req.body, type: old.type, attachment: req.body.attachment ?? old.attachment });
  const dup = db.prepare('SELECT id FROM vouchers WHERE type = ? AND number = ? AND id <> ?').get(v.type, v.number, old.id);
  if (dup) throw fail(`Số phiếu ${v.number} đã tồn tại`);
  tx(() => {
    db.prepare(`UPDATE vouchers SET number=?, date=?, partner_id=?, partner=?, address=?, description=?, ref_no=?, attachment=?, updated_by=?, updated_at=? WHERE id=?`)
      .run(v.number, v.date, v.partner_id, v.partner, v.address, v.description, v.ref_no, v.attachment, req.user.username, now(), old.id);
    saveExtra(old.id, v);
    db.prepare('DELETE FROM voucher_lines WHERE voucher_id = ?').run(old.id);
    insertLines(old.id, v.lines);
    costing.checkNoNegative([...v.lines.map((l) => l.item_id), ...old.lines.map((l) => l.item_id)]);
    costing.markDirty((old.date < v.date ? old.date : v.date).slice(0, 7));
  });
  audit(req, 'VOUCHER_UPDATE', `${summary(v)} | trước khi sửa: ${summary(old)}`);
  res.json({ ok: true });
}));

app.delete('/api/vouchers/:id', canWrite, h((req, res) => {
  const old = getVoucher(req.params.id);
  if (!old) throw fail('Không tìm thấy chứng từ', 404);
  if (old.locked) throw fail(`Kỳ ${old.date.slice(0, 7)} đã khóa sổ`);
  tx(() => {
    db.prepare('DELETE FROM vouchers WHERE id = ?').run(old.id);
    costing.checkNoNegative(old.lines.map((l) => l.item_id));
    costing.markDirty(old.date.slice(0, 7));
  });
  audit(req, 'VOUCHER_DELETE', summary(old));
  res.json({ ok: true });
}));

// Xóa hàng loạt chứng từ: từng phiếu được xóa riêng (phiếu xuất trước, phiếu nhập sau);
// phiếu thuộc kỳ đã khóa sổ hoặc làm âm kho thì giữ lại kèm lý do
app.post('/api/vouchers/bulk-delete', canWrite, h((req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw fail('Chưa chọn phiếu nào');
  if (ids.length > 2000) throw fail('Mỗi lần xóa tối đa 2.000 phiếu');
  const list = ids.map((id) => getVoucher(id) || { id, missing: true })
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'X' ? -1 : 1));
  const deleted = [], skipped = [];
  for (const v of list) {
    if (v.missing) { skipped.push({ number: `#${v.id}`, reason: 'Không còn tồn tại' }); continue; }
    if (v.locked) { skipped.push({ number: v.number, date: v.date, reason: `Kỳ ${v.date.slice(5, 7)}/${v.date.slice(0, 4)} đã khóa sổ` }); continue; }
    try {
      tx(() => {
        db.prepare('DELETE FROM vouchers WHERE id = ?').run(v.id);
        costing.checkNoNegative(v.lines.map((l) => l.item_id));
        costing.markDirty(v.date.slice(0, 7));
      });
      deleted.push(v.number);
      audit(req, 'VOUCHER_DELETE', summary(v) + ' (xóa hàng loạt)');
    } catch (e) {
      skipped.push({ number: v.number, date: v.date, reason: e.message });
    }
  }
  res.json({ deleted, skipped });
}));

// Đơn giá gần nhất của từng mặt hàng đã bán cho một khách hàng (phiếu xuất) / mua của một nhà cung cấp (phiếu nhập)
app.get('/api/last-prices', h((req, res) => {
  const pid = Number(req.query.partner_id), type = req.query.type === 'N' ? 'N' : 'X';
  if (!pid) return res.json({});
  const rows = db.prepare(`SELECT l.item_id, l.unit_price, l.price_vat, l.discount_rate, l.vat_rate, v.date, v.number
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.partner_id = ? AND v.type = ? AND v.id <> ? ORDER BY v.date DESC, v.id DESC, l.sort DESC`).all(pid, type, Number(req.query.exclude) || 0);
  const out = {};
  for (const r of rows) if (!out[r.item_id]) out[r.item_id] = r;
  res.json(out);
}));

// ---------------- Đọc PDF ----------------
app.post('/api/pdf/parse', canWrite, upload.single('file'), h(async (req, res) => {
  if (!req.file) throw fail('Chưa chọn file PDF');
  if (req.file.buffer.slice(0, 5).toString() !== '%PDF-') throw fail('File không phải PDF');
  const name = crypto.randomBytes(16).toString('hex') + '.pdf';
  fs.writeFileSync(path.join(UPLOAD_DIR, name), req.file.buffer);
  let parsed;
  try { parsed = await parsePdf(req.file.buffer); } catch (e) { throw fail('Không đọc được file PDF: ' + e.message); }
  if (!parsed.error) {
    const want = req.query.type === 'N' || req.query.type === 'X' ? req.query.type : parsed.type || 'X';
    const p = matchPartner(want, parsed.tax_code, parsed.partner);
    if (p) { parsed.partner_id = p.id; parsed.partner_code = p.code; }
  }
  audit(req, 'PDF_UPLOAD', `${req.file.originalname} -> ${parsed.error ? 'lỗi: ' + parsed.error : `nhận diện ${parsed.lines.length} dòng hàng, số ${parsed.number || '?'}`}`);
  res.json({ ...parsed, attachment: name, filename: req.file.originalname });
}));
app.get('/api/attachments/:name', h((req, res) => {
  const name = safeAttachment(req.params.name);
  if (!name) throw fail('Không tìm thấy file', 404);
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(path.join(UPLOAD_DIR, name));
}));

// ---------------- Tính giá xuất kho & kỳ kế toán ----------------
app.get('/api/periods', h((req, res) => {
  const fm = costing.firstMonth();
  if (!fm) return res.json([]);
  const maxV = db.prepare('SELECT MAX(date) d FROM vouchers').get().d;
  const today = now().slice(0, 7);
  let last = maxV ? maxV.slice(0, 7) : fm;
  if (today > last) last = today;
  const map = new Map(db.prepare('SELECT * FROM periods').all().map((p) => [p.month, p]));
  const counts = new Map(db.prepare(`SELECT substr(date,1,7) m, SUM(type='N') n, SUM(type='X') x FROM vouchers GROUP BY m`).all().map((r) => [r.m, r]));
  res.json(costing.monthsBetween(fm, last).reverse().map((m) => ({
    month: m, status: map.get(m)?.status || 'dirty', computed_at: map.get(m)?.computed_at, computed_by: map.get(m)?.computed_by,
    locked: !!map.get(m)?.locked, receipts: counts.get(m)?.n || 0, issues: counts.get(m)?.x || 0,
  })));
}));

app.post('/api/costing/run', canWrite, h((req, res) => {
  const month = req.body?.month;
  if (!isMonth(month)) throw fail('Kỳ không hợp lệ');
  const r = tx(() => costing.runCosting(month, req.user.username));
  audit(req, 'COSTING_RUN', `Tính giá xuất kho BQGQ cuối kỳ đến tháng ${month}: ${r.months.length} kỳ, ${r.lines} dòng xuất`);
  res.json({ months: r.months, lines: r.lines });
}));

app.post('/api/periods/:month/lock', adminOnly, h((req, res) => {
  const m = req.params.month;
  if (!isMonth(m)) throw fail('Kỳ không hợp lệ');
  const locked = !!req.body?.locked;
  if (locked) {
    const p = db.prepare('SELECT status FROM periods WHERE month = ?').get(m);
    if (!p || p.status !== 'computed') throw fail('Phải tính giá xuất kho cho kỳ này trước khi khóa sổ');
  }
  db.prepare(`INSERT INTO periods(month, status, locked) VALUES (?, 'dirty', ?) ON CONFLICT(month) DO UPDATE SET locked = excluded.locked`).run(m, locked ? 1 : 0);
  audit(req, locked ? 'PERIOD_LOCK' : 'PERIOD_UNLOCK', `Kỳ ${m}`);
  res.json({ ok: true });
}));

// ---------------- Báo cáo ----------------
function nxtReport(from, to) {
  const res = costing.compute(to);
  const months = Object.keys(res.months).filter((m) => m >= from && m <= to);
  const items = db.prepare('SELECT * FROM items ORDER BY code').all();
  const rows = items.map((it) => {
    const r = { item_id: it.id, code: it.code, name: it.name, unit: it.unit, open_qty: 0, open_val: 0, in_qty: 0, in_val: 0, out_qty: 0, out_val: 0, close_qty: 0, close_val: 0, avg: 0 };
    months.forEach((m, i) => {
      const d = res.months[m].rows.get(it.id);
      if (!d) return;
      if (i === 0) { r.open_qty = d.open_qty; r.open_val = d.open_val; }
      r.in_qty += d.in_qty; r.in_val += d.in_val; r.out_qty += d.out_qty; r.out_val += d.out_val;
      r.close_qty = d.close_qty; r.close_val = d.close_val; r.avg = d.avg;
    });
    return r;
  });
  return { from, to, months, rows };
}
function reportRange(q) {
  const fm = costing.firstMonth();
  if (!fm) throw fail('Chưa thiết lập ngày chốt số dư đầu kỳ');
  let from = isMonth(q.from) ? q.from : fm;
  const to = isMonth(q.to) ? q.to : from;
  if (from < fm) from = fm;
  if (to < from) throw fail('Kỳ báo cáo không hợp lệ');
  return { from, to };
}
app.get('/api/reports/nxt', h((req, res) => {
  const { from, to } = reportRange(req.query);
  res.json(nxtReport(from, to));
}));

app.get('/api/reports/nxt.xlsx', h(async (req, res) => {
  const { from, to } = reportRange(req.query);
  const rep = nxtReport(from, to);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('NXT');
  ws.addRow([getSetting('company_name', '')]);
  ws.addRow(['BÁO CÁO TỔNG HỢP NHẬP - XUẤT - TỒN KHO']);
  ws.addRow([`Kỳ: ${from} đến ${to} — Giá xuất kho: Bình quân gia quyền cuối kỳ`]);
  ws.addRow([]);
  ws.addRow(['Mã hàng', 'Tên hàng', 'ĐVT', 'Tồn đầu - SL', 'Tồn đầu - GT', 'Nhập - SL', 'Nhập - GT', 'Xuất - SL', 'Xuất - GT', 'Tồn cuối - SL', 'Tồn cuối - GT', 'Đơn giá BQ kỳ cuối']).font = { bold: true };
  const tot = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const r of rep.rows) {
    const vals = [r.open_qty, r.open_val, r.in_qty, r.in_val, r.out_qty, r.out_val, r.close_qty, r.close_val];
    vals.forEach((v, i) => { tot[i] += v; });
    ws.addRow([r.code, r.name, r.unit, ...vals.map((v, i) => (i % 2 ? Math.round(v) : v)), Math.round(r.avg * 100) / 100]);
  }
  ws.addRow(['TỔNG CỘNG', '', '', ...tot.map((v, i) => (i % 2 ? Math.round(v) : v))]).font = { bold: true };
  ws.columns.forEach((c, i) => { c.width = i === 1 ? 35 : 15; if (i >= 3) c.numFmt = '#,##0.##'; });
  ws.getRow(2).font = { bold: true, size: 14 };
  audit(req, 'EXPORT', `Xuất Excel báo cáo NXT ${from} - ${to}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="NXT_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// Sổ chi tiết vật tư hàng hóa
app.get('/api/reports/ledger', h((req, res) => {
  const { from, to } = reportRange(req.query);
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(req.query.item_id);
  if (!it) throw fail('Chọn mã hàng');
  const comp = costing.compute(to);
  const first = comp.months[from]?.rows.get(it.id);
  const lines = db.prepare(`SELECT l.id, l.qty, l.unit_price, l.amount, v.id voucher_id, v.type, v.number, v.date, v.partner, v.description
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE l.item_id = ? AND substr(v.date,1,7) BETWEEN ? AND ? ORDER BY v.date, v.type, v.id, l.sort`).all(it.id, from, to);
  let bq = first ? first.open_qty : 0, bv = first ? first.open_val : 0;
  const out = lines.map((l) => {
    const m = l.date.slice(0, 7);
    let price, value;
    if (l.type === 'N') { price = l.unit_price; value = l.amount; bq += l.qty; bv += l.amount; }
    else { const c = comp.months[m].lineCosts.get(l.id); price = c.cost_price; value = c.cost_amount; bq -= l.qty; bv -= value; }
    return { ...l, price, value, bal_qty: bq, bal_val: bv };
  });
  const months = Object.keys(comp.months).filter((m) => m >= from && m <= to).map((m) => ({ month: m, ...comp.months[m].rows.get(it.id) }));
  res.json({ item: it, from, to, open_qty: first?.open_qty || 0, open_val: first?.open_val || 0, lines: out, months });
}));

function analyticsCtx() {
  const lines = db.prepare(`SELECT l.id, l.item_id, l.qty, l.amount, v.id vid, v.type, v.number, v.date, v.partner_id, v.partner
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.date > ?`).all(getSetting('opening_date') || '0000-00-00')
    .map((r) => ({ id: r.id, item_id: r.item_id, qty: r.qty, amount: r.amount, v: { id: r.vid, type: r.type, number: r.number, date: r.date, partner_id: r.partner_id, partner: r.partner } }));
  return { lines, items: db.prepare('SELECT id, code, name, unit FROM items').all(), partners: db.prepare('SELECT id, kind, code, name FROM partners').all(), compute: costing.compute };
}
app.get('/api/reports/partners', h((req, res) => {
  const { from, to } = reportRange(req.query);
  res.json(analytics.partnerSummary(analyticsCtx(), from, to, req.query.kind));
}));
app.get('/api/reports/partner-detail', h((req, res) => {
  const { from, to } = reportRange(req.query);
  res.json(analytics.partnerDetail(analyticsCtx(), from, to, req.query.kind, String(req.query.key || '')));
}));
app.get('/api/reports/analytics', h((req, res) => {
  const { from, to } = reportRange(req.query);
  res.json(analytics.dashboard(analyticsCtx(), from, to, costing.monthsBetween(from, to)));
}));

app.get('/api/dashboard', h((req, res) => {
  const fm = costing.firstMonth();
  const cur = now().slice(0, 7);
  let stock = null;
  if (fm) {
    const c = costing.compute(cur < fm ? fm : cur);
    const last = c.months[cur < fm ? fm : cur];
    if (last) {
      let q = 0, v = 0, cnt = 0;
      for (const r of last.rows.values()) { v += r.close_val; if (r.close_qty > 0) cnt++; q += r.close_qty; }
      stock = { value: v, items_in_stock: cnt };
    }
  }
  const m = db.prepare(`SELECT v.type, COUNT(DISTINCT v.id) c, COALESCE(SUM(l.amount),0) amt FROM vouchers v LEFT JOIN voucher_lines l ON l.voucher_id = v.id
    WHERE substr(v.date,1,7) = ? GROUP BY v.type`).all(cur);
  res.json({
    month: cur, opening_date: getSetting('opening_date'),
    items: db.prepare('SELECT COUNT(*) c FROM items').get().c,
    stock, this_month: Object.fromEntries(m.map((r) => [r.type, r])),
    dirty: db.prepare(`SELECT COUNT(*) c FROM periods WHERE status='dirty'`).get().c,
    recent: db.prepare('SELECT id, type, number, date, partner FROM vouchers ORDER BY id DESC LIMIT 8').all(),
  });
}));

// ---------------- Người dùng & nhật ký ----------------
app.get('/api/users', adminOnly, (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.username, u.full_name, u.role, u.active, u.created_at, u.locked_until,
    (SELECT MAX(ts) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'LOGIN_OK') last_login,
    (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) active_sessions
    FROM users u ORDER BY u.id`).all(now()));
});
app.post('/api/users', adminOnly, h((req, res) => {
  const b = req.body || {};
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(b.username || '')) throw fail('Tên đăng nhập 3-32 ký tự, chỉ gồm chữ, số, dấu . _ -');
  const err = auth.validatePassword(b.password);
  if (err) throw fail(err);
  if (!['admin', 'user', 'viewer'].includes(b.role)) throw fail('Vai trò không hợp lệ');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(b.username)) throw fail('Tên đăng nhập đã tồn tại');
  db.prepare('INSERT INTO users(username, password_hash, full_name, role, must_change, created_at) VALUES (?,?,?,?,1,?)')
    .run(b.username, auth.hashPassword(b.password), b.full_name || '', b.role, now());
  audit(req, 'USER_CREATE', `${b.username} (${b.role})`);
  res.json({ ok: true });
}));
app.put('/api/users/:id', adminOnly, h((req, res) => {
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw fail('Không tìm thấy người dùng', 404);
  if (u.id === req.user.id && (b.active === false || (b.role && b.role !== 'admin'))) throw fail('Không thể tự khóa hoặc hạ quyền chính mình');
  const changes = [];
  if (b.full_name !== undefined) { db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(b.full_name, u.id); changes.push('họ tên'); }
  if (b.role && ['admin', 'user', 'viewer'].includes(b.role)) { db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, u.id); changes.push('vai trò=' + b.role); }
  if (b.active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, u.id);
    if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    changes.push(b.active ? 'mở khóa' : 'khóa tài khoản');
  }
  if (b.password) {
    const err = auth.validatePassword(b.password);
    if (err) throw fail(err);
    db.prepare('UPDATE users SET password_hash = ?, must_change = 1, failed_count = 0, locked_until = NULL WHERE id = ?').run(auth.hashPassword(b.password), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    changes.push('đặt lại mật khẩu');
  }
  audit(req, 'USER_UPDATE', `${u.username}: ${changes.join(', ')}`);
  res.json({ ok: true });
}));

app.get('/api/audit', adminOnly, (req, res) => {
  const where = [], args = [];
  if (req.query.username) { where.push('username = ?'); args.push(req.query.username); }
  if (req.query.action) { where.push('action = ?'); args.push(req.query.action); }
  if (isDate(req.query.from)) { where.push('ts >= ?'); args.push(req.query.from); }
  if (isDate(req.query.to)) { where.push('ts < ?'); args.push(costing.addDays(req.query.to, 1)); }
  if (req.query.q) { where.push('(detail LIKE ? OR ip LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const page = Math.max(1, Number(req.query.page) || 1);
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_log ${w}`).get(...args).c;
  const rows = db.prepare(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT 100 OFFSET ?`).all(...args, (page - 1) * 100);
  res.json({ total, page, rows });
});
app.get('/api/sessions', adminOnly, (req, res) => {
  res.json(db.prepare(`SELECT s.created_at, s.last_seen, s.expires_at, s.ip, s.ua, u.username FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > ? ORDER BY s.last_seen DESC`).all(now()));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy' }));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`Ứng dụng Quản lý kho đang chạy: http://${HOST}:${PORT}`));

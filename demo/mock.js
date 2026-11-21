// BẢN DEMO: giả lập toàn bộ máy chủ ngay trong trình duyệt.
// Logic nghiệp vụ được chuyển nguyên từ server.js / src/*.js; dữ liệu lưu trong localStorage của trình duyệt.
'use strict';
(function () {
  const DB_KEY = 'kho-demo-v5'; // phiếu cũ không có cờ posted được coi là đã ghi sổ
  const SID_KEY = 'kho-demo-sid';
  const EPS = 1e-9;
  let D = null;
  const ATT = new Map(); // file PDF đính kèm: chỉ giữ trong bộ nhớ của phiên demo

  const pad = (n) => String(n).padStart(2, '0');
  const now = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const isMonth = (s) => /^\d{4}-\d{2}$/.test(String(s || ''));
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const ci = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

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
  const nextId = (t) => { D.seq[t] = (D.seq[t] || 0) + 1; return D.seq[t]; };

  function save() { try { localStorage.setItem(DB_KEY, JSON.stringify(D)); } catch { /* trình duyệt chặn lưu trữ */ } }
  function tx(fn) {
    const snap = JSON.stringify(D);
    try { const r = fn(); save(); return r; } catch (e) { D = JSON.parse(snap); throw e; }
  }
  function hash(pw) { let h = 5381; for (const c of 'kho:' + pw) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return 'h' + h.toString(16); }

  // ---------------- Dữ liệu mẫu ----------------
  function seed() {
    D = { seq: {}, users: [], sessions: [], audit: [], settings: {}, items: [], vouchers: [], lines: [], periods: {}, partners: [] };
    D.settings = { company_name: 'Kho hàng ETC MDA', company_address: '', company_tax: '', opening_date: '2026-09-30' };
    const mkUser = (username, full_name, role, pw) => D.users.push({ id: nextId('users'), username, full_name, role, password_hash: hash(pw), active: 1, must_change: 0, failed_count: 0, locked_until: null, created_at: '2026-09-30 08:00:00' });
    mkUser('admin', 'Quản trị hệ thống', 'admin', 'admin123');
    mkUser('ketoan', 'Nguyễn Thu Hà', 'accountant', 'ketoan123');
    mkUser('thukho', 'Trần Văn Kho', 'storekeeper', 'thukho123');
    const items = [
      ['VT001', 'Xi măng PCB40', 'Bao', 100, 8500000, '8'],
      ['VT002', 'Thép cuộn D6', 'Kg', 500, 7500000, '10'],
      ['VT003', 'Cát vàng', 'm3', 40, 12000000, '10'],
      ['VT004', 'Đá 1x2', 'm3', 25, 8750000, '10'],
      ['VT005', 'Gạch đặc A1', 'Viên', 5000, 6000000, '8'],
    ];
    const SALE = { VT001: 108000, VT002: 19800, VT003: 418000, VT004: 462000, VT005: 1650 };
    for (const [code, name, unit, q, v, vat] of items) D.items.push({ id: nextId('items'), code, name, unit, vat_rate: vat, sale_price_vat: SALE[code], sale_price: Math.round(SALE[code] / (1 + Number(vat) / 100) * 100) / 100, opening_qty: q, opening_value: v, note: '', created_at: '2026-09-30 08:00:00' });
    const PARTNERS = [
      ['KH', 'KH001', 'Công ty CP Xây dựng Đại Việt', '0105556677'],
      ['KH', 'KH002', 'Công ty TNHH Nhà Xanh', '0108889990'],
      ['KH', 'KH003', 'Anh Trần Văn Nam', ''],
      ['KH', 'KH004', 'Công ty CP Xây dựng Minh Phát', '0101234567'],
      ['NCC', 'NCC001', 'Công ty Xi măng Hà Tiên', '0300000001'],
      ['NCC', 'NCC002', 'Công ty Thép Hòa Phát', '0900189284'],
      ['NCC', 'NCC003', 'HTX Cát sỏi Sông Hồng', ''],
    ];
    for (const [kind, code, name, tax] of PARTNERS) D.partners.push({ id: nextId('partners'), kind, code, name, tax_code: tax, created_at: '2026-09-30 08:00:00' });
    const pid = (name) => D.partners.find((p) => p.name === name)?.id || null;
    const id = (c) => D.items.find((i) => i.code === c).id;
    const V = (type, number, date, partner, description, lines) => {
      const vid = nextId('vouchers');
      D.vouchers.push({ id: vid, type, number, date, partner_id: pid(partner), partner, address: '', description, ref_no: '', source: 'manual', attachment: null, created_by: 'ketoan', created_at: date + ' 09:00:00' });
      lines.forEach(([c, qty, price], i) => D.lines.push({ id: nextId('lines'), voucher_id: vid, item_id: id(c), qty, unit_price: price, amount: Math.round(qty * price), cost_price: null, cost_amount: null, sort: i }));
    };
    V('N', 'NK00001', '2026-10-05', 'Công ty Xi măng Hà Tiên', 'Nhập kho mua hàng', [['VT001', 50, 88000]]);
    V('N', 'NK00002', '2026-10-08', 'Công ty Thép Hòa Phát', 'Nhập kho mua hàng', [['VT002', 1000, 15500], ['VT004', 20, 360000]]);
    V('X', 'XK00001', '2026-10-12', 'Công ty CP Xây dựng Đại Việt', 'Xuất kho bán hàng', [['VT003', 10, 380000], ['VT005', 2000, 1500]]);
    V('X', 'XK00002', '2026-10-20', 'Anh Trần Văn Nam', 'Xuất kho bán hàng', [['VT002', 300, 18000], ['VT004', 15, 420000]]);
    V('N', 'NK00003', '2026-11-03', 'Công ty Xi măng Hà Tiên', 'Nhập kho mua hàng', [['VT001', 80, 90000]]);
    V('X', 'XK00003', '2026-11-10', 'Công ty CP Xây dựng Đại Việt', 'Xuất kho bán hàng', [['VT001', 60, 110000]]);
    V('N', 'NK00004', '2026-11-12', 'HTX Cát sỏi Sông Hồng', 'Nhập kho mua hàng', [['VT003', 30, 310000]]);
    V('X', 'XK00004', '2026-11-15', 'Công ty TNHH Nhà Xanh', 'Xuất kho bán hàng', [['VT002', 400, 18500], ['VT005', 1500, 1550]]);
    D.audit.push({ id: nextId('audit'), ts: '2026-09-30 08:00:00', user_id: 1, username: 'admin', action: 'ITEM_IMPORT', detail: 'Nhập Excel: thêm 5, cập nhật 0', ip: '192.168.1.10', ua: 'Chrome / Windows' });
    D.audit.push({ id: nextId('audit'), ts: '2026-11-18 07:55:12', user_id: null, username: null, action: 'LOGIN_FAIL', detail: 'Tên đăng nhập không tồn tại: thukho', ip: '192.168.1.25', ua: 'Safari / iPhone' });
    runCosting('2026-10', 'ketoan');
    save();
  }
  function load() {
    try { const s = localStorage.getItem(DB_KEY); if (s) D = JSON.parse(s); } catch { D = null; }
    if (!D || !D.users) seed();
    if (/An Phát \(DEMO\)/.test(D.settings.company_name || '')) Object.assign(D.settings, { company_name: 'Kho hàng ETC MDA', company_address: '', company_tax: '' });
    D.partners = D.partners || [];
    D.users.forEach((u) => { if (u.role === 'user') u.role = 'accountant'; });
    if (!D.users.some((u) => u.username === 'thukho')) D.users.push({ id: nextId('users'), username: 'thukho', full_name: 'Trần Văn Kho', role: 'storekeeper', password_hash: hash('thukho123'), active: 1, must_change: 0, failed_count: 0, locked_until: null, created_at: '2026-09-30 08:00:00' });
    D.items.forEach((i) => { if (i.vat_rate === undefined) i.vat_rate = null; });
  }
  function resetDemo() { try { localStorage.removeItem(DB_KEY); sessionStorage.removeItem(SID_KEY); } catch { /* bỏ qua */ } D = null; seed(); }

  // ---------------- Phiên & nhật ký ----------------
  let currentSid = null;
  try { currentSid = sessionStorage.getItem(SID_KEY); } catch { /* bỏ qua */ }
  const UA = navigator.userAgent.slice(0, 300);
  const IP = 'trình duyệt demo';
  function audit(user, action, detail) {
    D.audit.push({ id: nextId('audit'), ts: now(), user_id: user?.id ?? null, username: user?.username ?? null, action, detail, ip: IP, ua: UA });
    save();
  }
  function currentUser() {
    const s = D.sessions.find((x) => x.token === currentSid);
    if (!s) return null;
    s.last_seen = now();
    return D.users.find((u) => u.id === s.user_id && u.active) || null;
  }
  const pubUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, must_change: !!u.must_change });
  function validatePassword(pw) {
    if (!pw || pw.length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự';
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Mật khẩu phải gồm cả chữ và số';
    return null;
  }

  // ---------------- Tính giá BQGQ cuối kỳ ----------------
  function addDays(dateStr, n) { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function nextMonth(m) { let [y, mo] = m.split('-').map(Number); mo += 1; if (mo > 12) { mo = 1; y += 1; } return `${y}-${pad(mo)}`; }
  function monthsBetween(a, b) { const out = []; for (let m = a; m <= b; m = nextMonth(m)) out.push(m); return out; }
  const firstMonth = () => (D.settings.opening_date ? addDays(D.settings.opening_date, 1).slice(0, 7) : null);
  const voucherOf = (l) => D.vouchers.find((v) => v.id === l.voucher_id);

  function compute(upto) {
    const A = D.settings.opening_date;
    if (!A) throw fail('Chưa thiết lập ngày chốt số dư đầu kỳ (ngày A) trong phần Cài đặt');
    const fm = firstMonth();
    const result = { months: {}, firstMonth: fm };
    if (!upto || upto < fm) return result;
    const state = new Map(D.items.map((i) => [i.id, { qty: i.opening_qty, val: i.opening_value }]));
    const vmap = new Map(D.vouchers.map((v) => [v.id, v]));
    const lines = D.lines.map((l) => ({ ...l, v: vmap.get(l.voucher_id) }))
      .filter((l) => l.v && l.v.posted !== 0 && l.v.date > A && l.v.date.slice(0, 7) <= upto)
      .sort((a, b) => cmp(a.v.date, b.v.date) || cmp(a.v.type, b.v.type) || a.v.id - b.v.id || a.sort - b.sort || a.id - b.id);
    const byMonth = new Map();
    for (const l of lines) { const m = l.v.date.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(l); }
    for (const m of monthsBetween(fm, upto)) {
      const rows = new Map(); const outLines = new Map();
      for (const [id, s] of state) rows.set(id, { open_qty: s.qty, open_val: s.val, in_qty: 0, in_val: 0, out_qty: 0, out_val: 0, avg: 0, close_qty: 0, close_val: 0 });
      for (const l of byMonth.get(m) || []) {
        const r = rows.get(l.item_id); if (!r) continue;
        if (l.v.type === 'N') { r.in_qty += l.qty; r.in_val += l.amount; }
        else { r.out_qty += l.qty; if (!outLines.has(l.item_id)) outLines.set(l.item_id, []); outLines.get(l.item_id).push(l); }
      }
      const lineCosts = new Map();
      for (const [id, r] of rows) {
        const q = r.open_qty + r.in_qty;
        r.avg = q > EPS ? (r.open_val + r.in_val) / q : 0;
        const outs = outLines.get(id) || [];
        let outVal = 0;
        for (const l of outs) { const amt = Math.round(l.qty * r.avg); lineCosts.set(l.id, { cost_price: r.avg, cost_amount: amt }); outVal += amt; }
        r.close_qty = q - r.out_qty;
        if (Math.abs(r.close_qty) < EPS && outs.length) {
          const diff = Math.round(r.open_val + r.in_val - outVal);
          if (diff !== 0) { lineCosts.get(outs[outs.length - 1].id).cost_amount += diff; outVal += diff; }
          r.close_qty = 0;
        }
        r.out_val = outVal;
        r.close_val = r.open_val + r.in_val - outVal;
        if (Math.abs(r.close_val) < 0.5 && r.close_qty === 0) r.close_val = 0;
        state.set(id, { qty: r.close_qty, val: r.close_val });
      }
      result.months[m] = { rows, lineCosts };
    }
    return result;
  }
  function runCosting(month, username) {
    const res = compute(month);
    let count = 0;
    for (const [m, data] of Object.entries(res.months)) {
      for (const [lineId, c] of data.lineCosts) { const l = D.lines.find((x) => x.id === lineId); l.cost_price = c.cost_price; l.cost_amount = c.cost_amount; count++; }
      D.periods[m] = { ...(D.periods[m] || { locked: 0 }), month: m, status: 'computed', computed_at: now(), computed_by: username };
    }
    return { months: Object.keys(res.months), lines: count };
  }
  function markDirty(from) {
    if (!D.periods[from]) D.periods[from] = { month: from, status: 'dirty', locked: 0 };
    for (const p of Object.values(D.periods)) if (p.month >= from) p.status = 'dirty';
  }
  const isLocked = (m) => !!D.periods[m]?.locked;
  function checkNoNegative(itemIds) {
    const A = D.settings.opening_date;
    for (const id of new Set(itemIds)) {
      const it = D.items.find((i) => i.id === id); if (!it) continue;
      const mv = D.lines.filter((l) => l.item_id === id).map((l) => ({ l, v: voucherOf(l) })).filter(({ v }) => v && v.posted !== 0)
        .sort((a, b) => cmp(a.v.date, b.v.date) || cmp(a.v.type, b.v.type) || a.v.id - b.v.id);
      let bal = it.opening_qty;
      for (const { l, v } of mv) {
        if (A && v.date <= A) continue;
        bal += v.type === 'N' ? l.qty : -l.qty;
        if (bal < -EPS) throw fail(`Mã hàng ${it.code} bị âm kho ngày ${v.date.split('-').reverse().join('/')} (phiếu ${v.number}), thiếu ${(-bal).toLocaleString('vi-VN')}`);
      }
    }
  }
  function stockQtyAt(date, exclude) {
    const A = D.settings.opening_date || '0000-00-00';
    const out = Object.fromEntries(D.items.map((i) => [i.id, i.opening_qty]));
    for (const l of D.lines) {
      const v = voucherOf(l);
      if (!v || v.posted === 0 || v.id === exclude || v.date <= A || v.date > date) continue;
      out[l.item_id] += v.type === 'N' ? l.qty : -l.qty;
    }
    return out;
  }

  // ---------------- Đọc PDF (pdf.js chạy trong trình duyệt) ----------------
  async function extractLines(buf) {
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    const pages = [];
    for (let n = 1; n <= Math.min(pdf.numPages, 20); n++) {
      const page = await pdf.getPage(n);
      const tc = await page.getTextContent();
      const parts = tc.items.filter((it) => it.str && it.str.trim() !== '')
        .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || 8 }));
      parts.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const p of parts) { const line = lines.find((l) => Math.abs(l.y - p.y) <= Math.max(2, p.h * 0.4)); if (line) line.parts.push(p); else lines.push({ y: p.y, parts: [p] }); }
      lines.sort((a, b) => b.y - a.y);
      pages.push(lines.map((l) => {
        l.parts.sort((a, b) => a.x - b.x);
        let s = ''; let prevEnd = null;
        for (const p of l.parts) {
          if (prevEnd !== null) { const gap = p.x - prevEnd; s += gap > p.h * 0.9 ? '\t' : gap > p.h * 0.15 ? ' ' : ''; }
          s += p.s; prevEnd = p.x + p.w;
        }
        return s;
      }).join('\n'));
    }
    return pages.join('\n').normalize('NFC');
  }
  function parseNumber(s) {
    let t = String(s).trim().replace(/\s/g, '');
    if (!/^-?[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
    const lastDot = t.lastIndexOf('.'); const lastComma = t.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else if (lastComma >= 0) t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    else if (lastDot >= 0) t = /^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  const near = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
  function tail(rest) {
    const out = {};
    const vat = rest.length ? rest[rest.length - 1] : null;
    if (vat !== null && [0, 5, 8, 10].includes(vat)) out.vat_rate = String(vat);
    if (rest.length >= 2 && rest[0] >= 0 && rest[0] <= 100) out.discount_rate = rest[0];
    return out;
  }
  function pickNumbers(nums) {
    for (let k = nums.length - 1; k >= 2; k--) for (let j = k - 1; j >= 1; j--) for (let i = j - 1; i >= 0; i--) {
      if (nums[i] > 0 && nums[j] > 0 && near(nums[i] * nums[j], nums[k])) return { qty: nums[i], unit_price: nums[j], amount: nums[k], sure: true, ...tail(nums.slice(k + 1)) };
    }
    if (nums.length >= 2) return { qty: nums[0], unit_price: nums[1], amount: nums[0] * nums[1], sure: false };
    if (nums.length === 1) return { qty: nums[0], unit_price: 0, amount: 0, sure: false };
    return null;
  }
  function parseText(text) {
    const byCode = new Map(D.items.map((i) => [norm(i.code), i]));
    const byName = new Map(D.items.map((i) => [norm(i.name), i]));
    const lines = text.split('\n');
    const result = { type: null, number: null, date: null, partner: null, tax_code: null, address: null, description: null, ref_no: null, lines: [], unmatched: [], warnings: [] };
    if (/PHIẾU\s*NHẬP\s*KHO/i.test(text)) result.type = 'N';
    else if (/PHIẾU\s*XUẤT\s*KHO|HÓA\s*ĐƠN|HOÁ\s*ĐƠN|PHIẾU\s*GIAO\s*HÀNG/i.test(text)) result.type = 'X';
    let partnerIdx = -1;
    for (const [li, raw] of lines.entries()) {
      const line = raw.replace(/\t/g, '  ');
      if (!result.number) {
        const m = line.match(/(?:^|\s)Số(?:\s*phiếu|\s*chứng\s*từ)?\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9\-\/._]*)/i);
        if (m && /\d/.test(m[1]) && !/tài khoản|điện thoại|lượng|fax/i.test(line.slice(0, m.index + 12))) result.number = m[1];
      }
      if (!result.date) { const m = line.match(/Ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/i); if (m) result.date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
      if (!result.partner) {
        const m = raw.match(/(?:Họ\s*(?:và)?\s*tên\s*người\s*(?:nhận|mua|giao)\s*hàng|Tên\s*khách\s*hàng|Khách\s*hàng|Tên\s*đơn\s*vị|Đơn\s*vị\s*bán\s*hàng|Nhà\s*cung\s*cấp|Người\s*mua\s*hàng)\s*[:：]\s*([^\t]+)/i);
        if (m && m[1].trim()) { result.partner = m[1].trim(); partnerIdx = li; }
      }
      if (!result.tax_code && partnerIdx >= 0 && li >= partnerIdx) { const m = raw.match(/(?:Mã\s*số\s*thuế|MST)\s*[:：]?\s*([0-9][0-9\- ]{8,15}[0-9])/i); if (m) result.tax_code = m[1].replace(/\s/g, ''); }
      if (partnerIdx >= 0 && li >= partnerIdx) {
        const grab = (re) => { const m = raw.match(re); return m && m[1].trim() ? m[1].trim() : null; };
        result.contact = result.contact || grab(/Tên\s*người\s*liên\s*hệ\s*[:：]\s*([^\t]+)/i);
        result.phone = result.phone || grab(/Điện\s*thoại\s*[:：]\s*([0-9 .+\-()]{6,})/i);
        result.delivery_place = result.delivery_place || grab(/Địa\s*điểm\s*giao\s*hàng\s*[:：]\s*([^\t]+)/i);
        result.salesperson = result.salesperson || grab(/Nhân\s*viên\s*bán\s*hàng\s*[:：]\s*([^\t]+)/i);
      }
      if (!result.warehouse) { const m = raw.match(/Mã\s*kho\s*[:：]\s*([^\t]+)/i); if (m && m[1].trim()) result.warehouse = m[1].trim(); }
      if (!result.ref_no) { const m = raw.match(/Số\s*phiếu\s*xuất\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9\-\/._]*)/i); if (m) result.ref_no = m[1]; }
      if (!result.address && partnerIdx >= 0 && li >= partnerIdx) { const m = raw.match(/(?:Địa\s*chỉ(?:\s*\(bộ\s*phận\))?)\s*[:：]\s*([^\t]+)/i); if (m && m[1].trim()) result.address = m[1].trim(); }
      if (!result.description) { const m = raw.match(/(?:Lý\s*do\s*(?:xuất|nhập)(?:\s*kho)?|Diễn\s*giải|Nội\s*dung)\s*[:：]\s*([^\t]+)/i); if (m && m[1].trim()) result.description = m[1].trim(); }
      if (!result.ref_no) { const m = raw.match(/(?:Số\s*hóa\s*đơn|Số\s*HĐ|Theo\s*hóa\s*đơn\s*số|Ký\s*hiệu)\s*[:：]?\s*([A-Za-z0-9\-\/]+)/i); if (m && /\d/.test(m[1])) result.ref_no = m[1]; }
    }
    if (!result.date) { const m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/); if (m) result.date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    for (const raw of lines) {
      const cells = raw.split('\t').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;
      let item = null; let idx = -1;
      for (let i = 0; i < cells.length && !item; i++) { const c = norm(cells[i]); if (byCode.has(c)) { item = byCode.get(c); idx = i; } }
      for (let i = 0; i < cells.length && !item; i++) {
        const c = norm(cells[i]);
        if (byName.has(c)) { item = byName.get(c); idx = i; break; }
        const first = c.split(/[\s\-–:]+/)[0];
        if (first && byCode.has(first)) { item = byCode.get(first); idx = i; }
      }
      const nums = [];
      for (let i = (idx >= 0 ? idx + 1 : 0); i < cells.length; i++) { const n = parseNumber(cells[i]); if (n !== null) nums.push(n); }
      if (item) {
        const p = pickNumbers(nums);
        if (!p) { result.warnings.push(`Không đọc được số lượng của mã ${item.code}`); continue; }
        result.lines.push({ item_id: item.id, code: item.code, name: item.name, unit: item.unit, qty: p.qty, unit_price: p.unit_price, amount: Math.round(p.amount), discount_rate: p.discount_rate || 0, vat_rate: p.vat_rate ?? item.vat_rate ?? null, sure: p.sure });
        if (!p.sure) result.warnings.push(`Mã ${item.code}: chưa khớp SL × Đơn giá = Thành tiền, vui lòng kiểm tra lại`);
      } else {
        const first = parseNumber(cells[0]);
        const allNums = cells.map(parseNumber).filter((n) => n !== null);
        if (first !== null && Number.isInteger(first) && first > 0 && first < 1000 && cells.length >= 4 && allNums.length >= 3) {
          const p = pickNumbers(allNums.slice(1));
          if (p && p.sure) result.unmatched.push({ text: cells.slice(1).filter((c) => parseNumber(c) === null).join(' | '), qty: p.qty, unit_price: p.unit_price, amount: Math.round(p.amount) });
        }
      }
    }
    if (!result.lines.length && !result.unmatched.length) result.warnings.push('Không nhận diện được dòng hàng nào. Kiểm tra mã hàng trong PDF đã có trong danh mục chưa.');
    if (result.unmatched.length) result.warnings.push(`Có ${result.unmatched.length} dòng hàng chưa có mã trong danh mục – hãy chọn mã tương ứng hoặc thêm mã mới.`);
    return result;
  }

  // ---------------- Các API ----------------
  const TYPE_NAME = { N: 'Phiếu nhập kho', X: 'Phiếu xuất kho bán hàng' };
  const numberingSettings = () => ({ number_prefix_N: D.settings.number_prefix_N ?? 'NK', number_prefix_X: D.settings.number_prefix_X ?? 'XK', number_digits: Number(D.settings.number_digits || 5) });
  function nextNumber(type) {
    const ns = numberingSettings(); const prefix = ns['number_prefix_' + type];
    const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&') + '(\\d+)$', 'i');
    let max = 0;
    for (const v of D.vouchers) if (v.type === type) { const m = v.number.match(re); if (m) max = Math.max(max, Number(m[1])); }
    return prefix + String(max + 1).padStart(ns.number_digits, '0');
  }
  const period = (m) => D.periods[m] || null;
  function getVoucher(id) {
    const v = D.vouchers.find((x) => x.id === Number(id)); if (!v) return null;
    const p = period(v.date.slice(0, 7));
    return { ...v, posted: v.posted === 0 ? 0 : 1, partner_code: D.partners.find((x) => x.id === v.partner_id)?.code || null, period_status: p?.status || null, locked: p?.locked ? 1 : 0,
      lines: D.lines.filter((l) => l.voucher_id === v.id).sort((a, b) => a.sort - b.sort || a.id - b.id)
        .map((l) => { const it = D.items.find((i) => i.id === l.item_id); return { ...l, code: it.code, name: it.name, unit: it.unit }; }) };
  }
  function validateVoucher(b) {
    const type = b.type === 'X' ? 'X' : b.type === 'N' ? 'N' : null;
    if (!type) throw fail('Loại chứng từ không hợp lệ');
    if (!isDate(b.date)) throw fail('Ngày chứng từ không hợp lệ');
    const A = D.settings.opening_date;
    if (!A) throw fail('Chưa thiết lập ngày chốt số dư đầu kỳ (Cài đặt)');
    if (b.date <= A) throw fail(`Ngày chứng từ phải sau ngày chốt số dư ${A}`);
    if (isLocked(b.date.slice(0, 7))) throw fail(`Kỳ ${b.date.slice(0, 7)} đã khóa sổ`);
    const number = String(b.number || '').trim() || nextNumber(type);
    let partner_id = null; let partnerName = String(b.partner || '').trim();
    if (b.partner_id) {
      const p = D.partners.find((x) => x.id === Number(b.partner_id));
      if (!p) throw fail('Đối tượng không tồn tại trong danh mục');
      if (type === 'X' && p.kind !== 'KH') throw fail(`${p.code} - ${p.name} thuộc danh mục nhà cung cấp, không phải khách hàng`);
      if (type === 'N' && p.kind !== 'NCC') throw fail(`${p.code} - ${p.name} thuộc danh mục khách hàng, không phải nhà cung cấp`);
      partner_id = p.id; if (!partnerName) partnerName = p.name;
    }
    const lines = (b.lines || []).filter((l) => l && l.item_id);
    if (!lines.length) throw fail('Chứng từ phải có ít nhất một dòng hàng');
    const clean = lines.map((l, i) => {
      const item = D.items.find((x) => x.id === Number(l.item_id));
      if (!item) throw fail(`Dòng ${i + 1}: mã hàng không tồn tại`);
      const qty = num(l.qty);
      if (qty <= 0) throw fail(`Dòng ${i + 1} (${item.code}): số lượng phải lớn hơn 0`);
      const price = num(l.unit_price);
      const discount_rate = num(l.discount_rate);
      if (discount_rate < 0 || discount_rate > 100) throw fail(`Dòng ${i + 1} (${item.code}): tỷ lệ chiết khấu phải từ 0 đến 100%`);
      const amount = l.amount !== undefined && l.amount !== '' && l.amount !== null ? Math.round(num(l.amount)) : Math.round(qty * price * (1 - discount_rate / 100));
      let vat_rate;
      try { vat_rate = l.vat_rate === undefined ? (item.vat_rate ?? null) : normVat(l.vat_rate); } catch (e) { throw fail(`Dòng ${i + 1} (${item.code}): ${e.message}`); }
      const vat_amount = /^\d+$/.test(vat_rate || '') ? Math.round(amount * Number(vat_rate) / 100) : 0;
      const price_vat = l.price_vat === undefined || l.price_vat === null || l.price_vat === '' ? null : num(l.price_vat);
      return { item_id: item.id, qty, unit_price: price, price_vat, amount, discount_rate, vat_rate, vat_amount, sort: i };
    });
    const att = b.attachment && ATT.has(b.attachment) ? b.attachment : (b.attachment || null);
    return { type, number, date: b.date, partner_id, partner: partnerName, address: b.address || '', description: b.description || '', ref_no: b.ref_no || '', ...Object.fromEntries(['tax_code', 'contact', 'phone', 'delivery_place', 'salesperson', 'warehouse'].map((k) => [k, String(b[k] ?? '').trim().slice(0, 300)])), source: b.source === 'pdf' ? 'pdf' : 'manual', attachment: att, lines: clean };
  }
  const summary = (v) => `${TYPE_NAME[v.type]} ${v.number} ngày ${v.date}, ${v.lines.length} dòng, tổng ${v.lines.reduce((s, l) => s + l.amount, 0).toLocaleString('vi-VN')}`;
  const insertLines = (vid, lines) => lines.forEach((l) => D.lines.push({ id: nextId('lines'), voucher_id: vid, ...l, cost_price: null, cost_amount: null }));
  const assertOpeningEditable = () => { if (Object.values(D.periods).some((p) => p.locked)) throw fail('Đã có kỳ khóa sổ, không thể sửa số dư đầu kỳ'); };
  function reportRange(q) {
    const fm = firstMonth(); if (!fm) throw fail('Chưa thiết lập ngày chốt số dư đầu kỳ');
    let from = isMonth(q.from) ? q.from : fm; const to = isMonth(q.to) ? q.to : from;
    if (from < fm) from = fm;
    if (to < from) throw fail('Kỳ báo cáo không hợp lệ');
    return { from, to };
  }
  function nxtReport(from, to) {
    const res = compute(to);
    const months = Object.keys(res.months).filter((m) => m >= from && m <= to);
    const rows = [...D.items].sort((a, b) => cmp(a.code, b.code)).map((it) => {
      const r = { item_id: it.id, code: it.code, name: it.name, unit: it.unit, open_qty: 0, open_val: 0, in_qty: 0, in_val: 0, out_qty: 0, out_val: 0, close_qty: 0, close_val: 0, avg: 0 };
      months.forEach((m, i) => {
        const d = res.months[m].rows.get(it.id); if (!d) return;
        if (i === 0) { r.open_qty = d.open_qty; r.open_val = d.open_val; }
        r.in_qty += d.in_qty; r.in_val += d.in_val; r.out_qty += d.out_qty; r.out_val += d.out_val;
        r.close_qty = d.close_qty; r.close_val = d.close_val; r.avg = d.avg;
      });
      return r;
    });
    return { from, to, months, rows };
  }
  const requireRole = (u, ...roles) => { if (!roles.includes(u.role)) throw fail('Bạn không có quyền thực hiện chức năng này', 403); };
  const W = (u) => requireRole(u, ...window.KhoRoles.WRITE_ROLES);
  const ADM = (u) => requireRole(u, 'admin');

  const routes = [];
  const R = (method, path, fn, open = false) => routes.push({ method, re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, open });

  R('POST', '/api/login', ({ body }) => {
    const user = D.users.find((u) => ci(u.username, String(body.username || '').trim()));
    if (!user) { audit(null, 'LOGIN_FAIL', `Tên đăng nhập không tồn tại: ${String(body.username || '').slice(0, 50)}`); throw fail('Sai tên đăng nhập hoặc mật khẩu', 401); }
    if (!user.active) { audit(user, 'LOGIN_FAIL', 'Tài khoản đã bị khóa'); throw fail('Tài khoản đã bị vô hiệu hóa', 403); }
    if (user.locked_until && user.locked_until > now()) { audit(user, 'LOGIN_FAIL', 'Đang bị tạm khóa do nhập sai nhiều lần'); throw fail(`Tài khoản tạm khóa đến ${user.locked_until} do nhập sai mật khẩu nhiều lần`, 429); }
    if (hash(String(body.password || '')) !== user.password_hash) {
      user.failed_count += 1;
      let msg = `Sai mật khẩu lần ${user.failed_count}`;
      if (user.failed_count >= 5) { const d = new Date(Date.now() + 15 * 60000); user.locked_until = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; user.failed_count = 0; msg += ' - tạm khóa 15 phút'; }
      audit(user, 'LOGIN_FAIL', msg); throw fail('Sai tên đăng nhập hoặc mật khẩu', 401);
    }
    user.failed_count = 0; user.locked_until = null;
    currentSid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem(SID_KEY, currentSid); } catch { /* bỏ qua */ }
    D.sessions.push({ token: currentSid, user_id: user.id, created_at: now(), last_seen: now(), ip: IP, ua: UA });
    audit(user, 'LOGIN_OK', 'Đăng nhập thành công');
    return { ok: true, user: pubUser(user) };
  }, true);
  R('POST', '/api/logout', ({ user }) => { D.sessions = D.sessions.filter((s) => s.token !== currentSid); audit(user, 'LOGOUT', 'Đăng xuất'); currentSid = null; try { sessionStorage.removeItem(SID_KEY); } catch { /* bỏ qua */ } return { ok: true }; });
  R('GET', '/api/me', ({ user }) => ({ user: pubUser(user), settings: { ...D.settings } }));
  R('POST', '/api/me/password', ({ user, body }) => {
    if (hash(String(body.old_password || '')) !== user.password_hash) throw fail('Mật khẩu hiện tại không đúng');
    const err = validatePassword(body.new_password); if (err) throw fail(err);
    user.password_hash = hash(body.new_password); user.must_change = 0;
    audit(user, 'PASSWORD_CHANGE', 'Đổi mật khẩu'); return { ok: true };
  });
  R('GET', '/api/settings', () => ({ ...D.settings, ...numberingSettings() }));
  R('PUT', '/api/settings', ({ user, body: b }) => { ADM(user); return tx(() => {
    if (b.opening_date !== undefined && b.opening_date !== D.settings.opening_date) {
      if (!isDate(b.opening_date)) throw fail('Ngày chốt số dư không hợp lệ');
      const c = D.vouchers.filter((v) => v.date <= b.opening_date).length;
      if (c) throw fail(`Có ${c} phiếu phát sinh trước hoặc trong ngày ${b.opening_date}, không thể đổi ngày chốt`);
      assertOpeningEditable();
      D.settings.opening_date = b.opening_date;
      Object.values(D.periods).forEach((p) => { p.status = 'dirty'; });
    }
    for (const k of ['company_name', 'company_address', 'company_tax']) if (b[k] !== undefined) D.settings[k] = String(b[k]).slice(0, 300);
    for (const k of ['number_prefix_N', 'number_prefix_X']) if (b[k] !== undefined) {
      const v = String(b[k]).trim();
      if (!/^[A-Za-z0-9._\-/]{0,12}$/.test(v)) throw fail('Ký hiệu số chứng từ chỉ gồm chữ không dấu, số và . _ - / (tối đa 12 ký tự)');
      D.settings[k] = v;
    }
    if (b.number_digits !== undefined) {
      const d = Number(b.number_digits);
      if (!Number.isInteger(d) || d < 3 || d > 10) throw fail('Số chữ số của số chứng từ phải từ 3 đến 10');
      D.settings.number_digits = d;
    }
    audit(user, 'SETTINGS_UPDATE', JSON.stringify(b)); return { ok: true };
  }); });

  function salePrices(b, vat) {
    const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
    const k = 1 + (/^\d+$/.test(vat || '') ? Number(vat) : 0) / 100;
    if (has(b.sale_price_vat)) { const g = num(b.sale_price_vat); if (g < 0) throw fail('Giá bán không hợp lệ'); return { sale_price: Math.round(g / k * 100) / 100, sale_price_vat: g }; }
    if (has(b.sale_price)) { const n = num(b.sale_price); if (n < 0) throw fail('Giá bán không hợp lệ'); return { sale_price: n, sale_price_vat: null }; }
    return { sale_price: null, sale_price_vat: null };
  }
  R('GET', '/api/items', ({ query }) => {
    const stock = stockQtyAt(isDate(query.date) ? query.date : '9999-12-31', Number(query.exclude) || 0);
    return [...D.items].sort((a, b) => cmp(a.code, b.code)).map((i) => ({ ...i, stock_qty: stock[i.id] ?? i.opening_qty }));
  });
  R('POST', '/api/items', ({ user, body: b }) => { W(user); return tx(() => {
    if (!b.code || !b.name) throw fail('Mã và tên hàng là bắt buộc');
    if (D.items.some((i) => ci(i.code, String(b.code).trim()))) throw fail(`Mã hàng ${b.code} đã tồn tại`);
    if (num(b.opening_qty) || num(b.opening_value)) assertOpeningEditable();
    const id = nextId('items');
    D.items.push({ id, code: String(b.code).trim(), name: String(b.name).trim(), unit: b.unit || '', vat_rate: normVat(b.vat_rate), ...salePrices(b, normVat(b.vat_rate)), opening_qty: num(b.opening_qty), opening_value: Math.round(num(b.opening_value)), note: b.note || '', created_at: now() });
    if (num(b.opening_qty) || num(b.opening_value)) markDirty(firstMonth());
    audit(user, 'ITEM_CREATE', `${b.code} - ${b.name}`); return { id };
  }); });
  R('PUT', '/api/items/:id', ({ user, params, body: b }) => { W(user); return tx(() => {
    const it = D.items.find((i) => i.id === Number(params.id)); if (!it) throw fail('Không tìm thấy mã hàng', 404);
    if (D.items.some((i) => i.id !== it.id && ci(i.code, String(b.code).trim()))) throw fail(`Mã hàng ${b.code} đã tồn tại`);
    const oq = num(b.opening_qty), ov = Math.round(num(b.opening_value));
    const vat = normVat(b.vat_rate);
    const changed = oq !== it.opening_qty || ov !== it.opening_value;
    if (changed) assertOpeningEditable();
    const old = { ...it };
    Object.assign(it, { code: String(b.code).trim(), name: String(b.name).trim(), unit: b.unit || '', vat_rate: vat, ...salePrices(b, vat), opening_qty: oq, opening_value: ov, note: b.note || '', updated_at: now() });
    if (changed) { checkNoNegative([it.id]); markDirty(firstMonth()); }
    audit(user, 'ITEM_UPDATE', `${old.code}: ${JSON.stringify({ code: b.code, name: b.name, vat_rate: vat, opening_qty: oq, opening_value: ov })} (cũ: thuế ${old.vat_rate ?? '-'}, SL ${old.opening_qty}, GT ${old.opening_value})`); return { ok: true };
  }); });
  R('DELETE', '/api/items/:id', ({ user, params }) => { W(user); return tx(() => {
    const it = D.items.find((i) => i.id === Number(params.id)); if (!it) throw fail('Không tìm thấy mã hàng', 404);
    if (D.lines.some((l) => l.item_id === it.id)) throw fail('Mã hàng đã phát sinh chứng từ, không thể xóa');
    if (it.opening_qty || it.opening_value) assertOpeningEditable();
    D.items = D.items.filter((i) => i !== it); markDirty(firstMonth());
    audit(user, 'ITEM_DELETE', `${it.code} - ${it.name}`); return { ok: true };
  }); });
  R('POST', '/api/items/bulk-delete', ({ user, body }) => { W(user);
    const ids = [...new Set((body.ids || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) throw fail('Chưa chọn mã hàng nào');
    const locked = Object.values(D.periods).some((p) => p.locked);
    const deleted = [], skipped = [];
    tx(() => {
      for (const id of ids) {
        const it = D.items.find((i) => i.id === id);
        if (!it) { skipped.push({ code: `#${id}`, reason: 'Không còn tồn tại' }); continue; }
        if (D.lines.some((l) => l.item_id === id)) { skipped.push({ code: it.code, name: it.name, reason: 'Đã phát sinh chứng từ nhập/xuất' }); continue; }
        if (locked && (it.opening_qty || it.opening_value)) { skipped.push({ code: it.code, name: it.name, reason: 'Có số dư đầu kỳ và đã có kỳ khóa sổ' }); continue; }
        D.items = D.items.filter((i) => i !== it); deleted.push(it.code);
      }
      if (deleted.length) markDirty(firstMonth());
    });
    audit(user, 'ITEM_BULK_DELETE', `Xóa ${deleted.length} mã: ${deleted.join(', ') || '(không có)'}${skipped.length ? ` | bỏ qua ${skipped.length}: ${skipped.map((s) => `${s.code} (${s.reason})`).join(', ')}` : ''}`);
    return { deleted, skipped };
  });
  R('POST', '/api/items/import', async ({ user, body }) => {
    W(user);
    const f = body.get('file'); if (!f) throw fail('Chưa chọn file');
    const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const data = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const rows = data.slice(1).filter((r) => String(r[0] ?? '').trim()).map((r) => ({ code: String(r[0]).trim(), name: String(r[1] ?? '').trim(), unit: String(r[2] ?? '').trim(), qty: num(r[3]), value: Math.round(num(r[4])), note: String(r[5] ?? '').trim(), vat: r[6], sale_vat: r[7], line: data.indexOf(r) + 1 }));
    if (!rows.length) throw fail('File không có dữ liệu (dòng 1 là tiêu đề, từ dòng 2: Mã, Tên, ĐVT, SL tồn, Giá trị tồn, Ghi chú, Thuế suất GTGT)');
    for (const r of rows) { try { r.vat = normVat(r.vat); r.sp = salePrices({ sale_price_vat: r.sale_vat }, r.vat); } catch (e) { throw fail(`Dòng ${r.line} (mã ${r.code}): ${e.message}`); } }
    assertOpeningEditable();
    let created = 0, updated = 0;
    tx(() => {
      for (const r of rows) {
        if (!r.name) throw fail(`Mã ${r.code} thiếu tên hàng`);
        const ex = D.items.find((i) => ci(i.code, r.code));
        if (ex) { Object.assign(ex, { name: r.name, unit: r.unit, vat_rate: r.vat, ...(r.sp.sale_price != null ? r.sp : {}), opening_qty: r.qty, opening_value: r.value, note: r.note, updated_at: now() }); updated++; }
        else { D.items.push({ id: nextId('items'), code: r.code, name: r.name, unit: r.unit, vat_rate: r.vat, ...r.sp, opening_qty: r.qty, opening_value: r.value, note: r.note, created_at: now() }); created++; }
      }
      checkNoNegative(D.items.map((i) => i.id)); markDirty(firstMonth());
    });
    audit(user, 'ITEM_IMPORT', `Nhập Excel: thêm ${created}, cập nhật ${updated}`);
    return { created, updated };
  });

  // ---- Danh mục khách hàng & danh mục nhà cung cấp (Mã, Tên, MST)
  const KIND_NAME = { KH: 'khách hàng', NCC: 'nhà cung cấp' };
  const needKind = (k) => { if (k !== 'KH' && k !== 'NCC') throw fail('Thiếu loại danh mục (KH hoặc NCC)'); return k; };
  function cleanPartner(b) {
    const code = String(b.code ?? '').trim().slice(0, 50), name = String(b.name ?? '').trim().slice(0, 300);
    if (!code || !name) throw fail('Mã và tên là bắt buộc');
    return { code, name, tax_code: String(b.tax_code ?? '').trim().slice(0, 20) };
  }
  R('GET', '/api/partners', ({ query }) => D.partners.filter((p) => !(query.kind === 'KH' || query.kind === 'NCC') || p.kind === query.kind)
    .sort((a, b) => cmp(a.code, b.code)).map((p) => ({ ...p, voucher_count: D.vouchers.filter((v) => v.partner_id === p.id).length })));
  R('POST', '/api/partners', ({ user, body }) => { W(user);
    const kind = needKind(body.kind); const p = cleanPartner(body);
    if (D.partners.some((x) => x.kind === kind && ci(x.code, p.code))) throw fail(`Mã ${p.code} đã có trong danh mục ${KIND_NAME[kind]}`);
    const id = tx(() => { const id = nextId('partners'); D.partners.push({ id, kind, ...p, created_at: now() }); return id; });
    audit(user, 'PARTNER_CREATE', `Danh mục ${KIND_NAME[kind]}: ${p.code} - ${p.name}${p.tax_code ? ', MST ' + p.tax_code : ''}`); return { id };
  });
  R('PUT', '/api/partners/:id', ({ user, params, body }) => { W(user);
    const old = D.partners.find((x) => x.id === Number(params.id)); if (!old) throw fail('Không tìm thấy', 404);
    const p = cleanPartner(body);
    if (D.partners.some((x) => x.id !== old.id && x.kind === old.kind && ci(x.code, p.code))) throw fail(`Mã ${p.code} đã có trong danh mục ${KIND_NAME[old.kind]}`);
    const before = { ...old };
    tx(() => Object.assign(old, p, { updated_at: now() }));
    audit(user, 'PARTNER_UPDATE', `Danh mục ${KIND_NAME[old.kind]}: ${before.code} → ${p.code} - ${p.name}${p.tax_code ? ', MST ' + p.tax_code : ''} (cũ: ${before.name}${before.tax_code ? ', MST ' + before.tax_code : ''})`); return { ok: true };
  });
  R('POST', '/api/partners/bulk-delete', ({ user, body }) => { W(user);
    const ids = [...new Set((body.ids || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) throw fail('Chưa chọn dòng nào');
    const deleted = [], skipped = []; let kind = null;
    tx(() => { for (const id of ids) {
      const p = D.partners.find((x) => x.id === id);
      if (!p) { skipped.push({ code: `#${id}`, reason: 'Không còn tồn tại' }); continue; }
      kind = p.kind;
      const n = D.vouchers.filter((v) => v.partner_id === id).length;
      if (n) { skipped.push({ code: p.code, name: p.name, reason: `Đã có ${n} chứng từ` }); continue; }
      D.partners = D.partners.filter((x) => x !== p); deleted.push(p.code);
    } });
    audit(user, 'PARTNER_DELETE', `Danh mục ${KIND_NAME[kind] || ''}: xóa ${deleted.length}: ${deleted.join(', ') || '(không có)'}${skipped.length ? ` | bỏ qua: ${skipped.map((x) => `${x.code} (${x.reason})`).join(', ')}` : ''}`);
    return { deleted, skipped };
  });
  R('POST', '/api/partners/import', async ({ user, body, query }) => { W(user);
    const kind = needKind(query.kind);
    const f = body.get('file'); if (!f) throw fail('Chưa chọn file');
    const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const data = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
    const rows = [];
    data.forEach((r, i) => { if (i === 0 || !String(r[0] ?? '').trim()) return;
      try { rows.push(cleanPartner({ code: String(r[0]).trim(), name: String(r[1] ?? '').trim(), tax_code: String(r[2] ?? '').trim() })); }
      catch (e) { throw fail(`Dòng ${i + 1}: ${e.message}`); } });
    if (!rows.length) throw fail('File không có dữ liệu (dòng 1 là tiêu đề, từ dòng 2: Mã, Tên, Mã số thuế)');
    let created = 0, updated = 0;
    tx(() => { for (const p of rows) {
      const ex = D.partners.find((x) => x.kind === kind && ci(x.code, p.code));
      if (ex) { Object.assign(ex, p, { updated_at: now() }); updated++; } else { D.partners.push({ id: nextId('partners'), kind, ...p, created_at: now() }); created++; }
    } });
    audit(user, 'PARTNER_IMPORT', `Nhập Excel danh mục ${KIND_NAME[kind]}: thêm ${created}, cập nhật ${updated}`); return { created, updated };
  });
  function analyticsCtx() {
    const A = D.settings.opening_date || '0000-00-00';
    const vmap = new Map(D.vouchers.map((v) => [v.id, v]));
    const lines = D.lines.map((l) => ({ id: l.id, item_id: l.item_id, qty: l.qty, amount: l.amount, v: vmap.get(l.voucher_id) })).filter((l) => l.v && l.v.posted !== 0 && l.v.date > A);
    return { lines, items: D.items, partners: D.partners, compute };
  }
  R('GET', '/api/reports/partners', ({ query }) => { const { from, to } = reportRange(query); return window.KhoAnalytics.partnerSummary(analyticsCtx(), from, to, query.kind); });
  R('GET', '/api/reports/partner-detail', ({ query }) => { const { from, to } = reportRange(query); return window.KhoAnalytics.partnerDetail(analyticsCtx(), from, to, query.kind, String(query.key || '')); });
  R('GET', '/api/reports/analytics', ({ query }) => { const { from, to } = reportRange(query); return window.KhoAnalytics.dashboard(analyticsCtx(), from, to, monthsBetween(from, to)); });

  R('GET', '/api/vouchers/next-number', ({ query }) => ({ number: nextNumber(query.type === 'X' ? 'X' : 'N') }));
  R('GET', '/api/vouchers', ({ query: q }) => {
    const s = (q.q || '').toLowerCase();
    return D.vouchers.filter((v) => (!q.type || v.type === q.type) && (!isDate(q.from) || v.date >= q.from) && (!isDate(q.to) || v.date <= q.to)
      && (!s || [v.number, v.partner, v.description].some((x) => String(x || '').toLowerCase().includes(s)))
      && (!q.partner_id || v.partner_id === Number(q.partner_id)))
      .sort((a, b) => cmp(b.date, a.date) || b.id - a.id)
      .map((v) => {
        const ls = D.lines.filter((l) => l.voucher_id === v.id); const p = period(v.date.slice(0, 7));
        return { ...v, posted: v.posted === 0 ? 0 : 1, partner_code: D.partners.find((x) => x.id === v.partner_id)?.code || null, total_amount: ls.reduce((t, l) => t + l.amount, 0), total_vat: ls.reduce((t, l) => t + (l.vat_amount || 0), 0), total_cost: ls.reduce((t, l) => t + (l.cost_amount || 0), 0), line_count: ls.length,
          uncosted: ls.filter((l) => l.cost_amount == null).length, period_status: p?.status || null, locked: p?.locked ? 1 : 0 };
      });
  });
  R('GET', '/api/vouchers/:id', ({ params }) => { const v = getVoucher(params.id); if (!v) throw fail('Không tìm thấy chứng từ', 404); return v; });
  R('POST', '/api/vouchers', ({ user, body }) => { W(user);
    const v = validateVoucher(body);
    if (body.auto_number === true) v.number = nextNumber(v.type);
    if (D.vouchers.some((x) => x.type === v.type && x.number === v.number)) throw fail(`Số phiếu ${v.number} đã tồn tại`);
    const id = tx(() => {
      const id = nextId('vouchers'); const { lines, ...head } = v;
      D.vouchers.push({ id, ...head, posted: 1, created_by: user.username, created_at: now() });
      insertLines(id, lines); checkNoNegative(lines.map((l) => l.item_id)); markDirty(v.date.slice(0, 7));
      return id;
    });
    audit(user, 'VOUCHER_CREATE', summary(v) + (v.source === 'pdf' ? ' (từ PDF)' : '')); return { id };
  });
  R('PUT', '/api/vouchers/:id', ({ user, params, body }) => { W(user);
    const old = getVoucher(params.id); if (!old) throw fail('Không tìm thấy chứng từ', 404);
    if (old.locked) throw fail(`Kỳ ${old.date.slice(0, 7)} đã khóa sổ`);
    if (old.posted !== 0) throw fail(`Chứng từ ${old.number} đã ghi sổ. Bấm "Bỏ ghi" trước khi sửa.`);
    const v = validateVoucher({ ...body, type: old.type, number: String(body.number ?? '').trim() || old.number, attachment: body.attachment ?? old.attachment });
    if (D.vouchers.some((x) => x.type === v.type && x.number === v.number && x.id !== old.id)) throw fail(`Số phiếu ${v.number} đã tồn tại`);
    tx(() => {
      const rec = D.vouchers.find((x) => x.id === old.id); const { lines, type, source, ...head } = v;
      Object.assign(rec, head, { posted: 1, updated_by: user.username, updated_at: now() });
      D.lines = D.lines.filter((l) => l.voucher_id !== old.id); insertLines(old.id, lines);
      checkNoNegative([...lines.map((l) => l.item_id), ...old.lines.map((l) => l.item_id)]);
      markDirty((old.date < v.date ? old.date : v.date).slice(0, 7));
    });
    audit(user, 'VOUCHER_UPDATE', `${summary(v)} | trước khi sửa: ${summary(old)}`);
    audit(user, 'VOUCHER_POST', `Ghi sổ ${TYPE_NAME[v.type]} ${v.number}`); return { ok: true };
  });
  R('DELETE', '/api/vouchers/:id', ({ user, params }) => { W(user);
    const old = getVoucher(params.id); if (!old) throw fail('Không tìm thấy chứng từ', 404);
    if (old.locked) throw fail(`Kỳ ${old.date.slice(0, 7)} đã khóa sổ`);
    tx(() => { D.vouchers = D.vouchers.filter((x) => x.id !== old.id); D.lines = D.lines.filter((l) => l.voucher_id !== old.id); checkNoNegative(old.lines.map((l) => l.item_id)); markDirty(old.date.slice(0, 7)); });
    audit(user, 'VOUCHER_DELETE', summary(old)); return { ok: true };
  });

  function setPosted(v, post, user) {
    if (v.locked) throw fail(`Kỳ ${v.date.slice(5, 7)}/${v.date.slice(0, 4)} đã khóa sổ`);
    if ((v.posted !== 0) === post) return false;
    tx(() => {
      const rec = D.vouchers.find((x) => x.id === v.id);
      Object.assign(rec, { posted: post ? 1 : 0, updated_by: user.username, updated_at: now() });
      if (!post) D.lines.filter((l) => l.voucher_id === v.id).forEach((l) => { l.cost_price = null; l.cost_amount = null; });
      checkNoNegative(v.lines.map((l) => l.item_id)); markDirty(v.date.slice(0, 7));
    });
    audit(user, post ? 'VOUCHER_POST' : 'VOUCHER_UNPOST', `${post ? 'Ghi sổ' : 'Bỏ ghi'} ${TYPE_NAME[v.type]} ${v.number} ngày ${v.date}`);
    return true;
  }
  R('POST', '/api/vouchers/:id/post', ({ user, params, body }) => { W(user);
    const v = getVoucher(params.id); if (!v) throw fail('Không tìm thấy chứng từ', 404);
    setPosted(v, body.post !== false, user); return { ok: true };
  });
  R('POST', '/api/vouchers/bulk-post', ({ user, body }) => { W(user);
    const post = body.post !== false;
    const ids = [...new Set((body.ids || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) throw fail('Chưa chọn phiếu nào');
    const list = ids.map((id) => getVoucher(id) || { id, missing: true }).sort((a, b) => (a.type === b.type ? 0 : (a.type === 'N') === post ? -1 : 1));
    const done = [], skipped = [];
    for (const v of list) {
      if (v.missing) { skipped.push({ number: `#${v.id}`, reason: 'Không còn tồn tại' }); continue; }
      try { if (setPosted(v, post, user)) done.push(v.number); } catch (e) { skipped.push({ number: v.number, date: v.date, reason: e.message }); }
    }
    return { done, skipped };
  });
  R('GET', '/api/last-prices', ({ query }) => {
    const pid = Number(query.partner_id), type = query.type === 'N' ? 'N' : 'X', ex = Number(query.exclude) || 0;
    if (!pid) return {};
    const vs = D.vouchers.filter((v) => v.posted !== 0 && v.partner_id === pid && v.type === type && v.id !== ex).sort((a, b) => cmp(b.date, a.date) || b.id - a.id);
    const out = {};
    for (const v of vs) for (const l of D.lines.filter((x) => x.voucher_id === v.id).sort((a, b) => b.sort - a.sort)) {
      if (!out[l.item_id]) out[l.item_id] = { item_id: l.item_id, unit_price: l.unit_price, price_vat: l.price_vat ?? null, discount_rate: l.discount_rate || 0, vat_rate: l.vat_rate ?? null, date: v.date, number: v.number };
    }
    return out;
  });
  R('POST', '/api/vouchers/bulk-delete', ({ user, body }) => { W(user);
    const ids = [...new Set((body.ids || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) throw fail('Chưa chọn phiếu nào');
    const list = ids.map((id) => getVoucher(id) || { id, missing: true }).sort((a, b) => (a.type === b.type ? 0 : a.type === 'X' ? -1 : 1));
    const deleted = [], skipped = [];
    for (const v of list) {
      if (v.missing) { skipped.push({ number: `#${v.id}`, reason: 'Không còn tồn tại' }); continue; }
      if (v.locked) { skipped.push({ number: v.number, date: v.date, reason: `Kỳ ${v.date.slice(5, 7)}/${v.date.slice(0, 4)} đã khóa sổ` }); continue; }
      try {
        tx(() => { D.vouchers = D.vouchers.filter((x) => x.id !== v.id); D.lines = D.lines.filter((l) => l.voucher_id !== v.id); checkNoNegative(v.lines.map((l) => l.item_id)); markDirty(v.date.slice(0, 7)); });
        deleted.push(v.number); audit(user, 'VOUCHER_DELETE', summary(v) + ' (xóa hàng loạt)');
      } catch (e) { skipped.push({ number: v.number, date: v.date, reason: e.message }); }
    }
    return { deleted, skipped };
  });

  R('POST', '/api/pdf/parse', async ({ user, body, query }) => {
    W(user);
    const f = body.get('file'); if (!f) throw fail('Chưa chọn file PDF');
    const buf = await f.arrayBuffer();
    if (new TextDecoder().decode(buf.slice(0, 5)) !== '%PDF-') throw fail('File không phải PDF');
    const name = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('') + '.pdf';
    ATT.set(name, buf.slice(0));
    let parsed;
    try {
      const text = await extractLines(buf);
      parsed = text.replace(/\s/g, '').length < 20 ? { error: 'File PDF không có lớp chữ (có thể là ảnh scan). Vui lòng dùng PDF xuất từ phần mềm hoặc nhập tay.', text } : { ...parseText(text), text };
    } catch (e) { throw fail('Không đọc được file PDF: ' + e.message); }
    if (!parsed.error) {
      const want = query.type === 'N' || query.type === 'X' ? query.type : parsed.type || 'X';
      const digits = String(parsed.tax_code || '').replace(/\D/g, '');
      const nn = (x) => String(x || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
      const pool = D.partners.filter((x) => x.kind === (want === 'N' ? 'NCC' : 'KH'));
      const pm = (digits && pool.find((x) => String(x.tax_code || '').replace(/\D/g, '') === digits)) || (parsed.partner && pool.find((x) => nn(x.name) === nn(parsed.partner)));
      if (pm) { parsed.partner_id = pm.id; parsed.partner_code = pm.code; }
    }
    audit(user, 'PDF_UPLOAD', `${f.name} -> ${parsed.error ? 'lỗi: ' + parsed.error : `nhận diện ${parsed.lines.length} dòng hàng, số ${parsed.number || '?'}`}`);
    return { ...parsed, attachment: name, filename: f.name };
  });

  R('GET', '/api/periods', () => {
    const fm = firstMonth(); if (!fm) return [];
    const maxV = D.vouchers.reduce((m, v) => (v.date > m ? v.date : m), '');
    let last = maxV ? maxV.slice(0, 7) : fm; const today = now().slice(0, 7); if (today > last) last = today;
    return monthsBetween(fm, last).reverse().map((m) => {
      const p = period(m) || {}; const vs = D.vouchers.filter((v) => v.date.startsWith(m));
      return { month: m, status: p.status || 'dirty', computed_at: p.computed_at, computed_by: p.computed_by, locked: !!p.locked, receipts: vs.filter((v) => v.type === 'N').length, issues: vs.filter((v) => v.type === 'X').length };
    });
  });
  R('POST', '/api/costing/run', ({ user, body }) => { W(user);
    if (!isMonth(body.month)) throw fail('Kỳ không hợp lệ');
    const r = tx(() => runCosting(body.month, user.username));
    audit(user, 'COSTING_RUN', `Tính giá xuất kho BQGQ cuối kỳ đến tháng ${body.month}: ${r.months.length} kỳ, ${r.lines} dòng xuất`);
    return r;
  });
  R('POST', '/api/periods/:month/lock', ({ user, params, body }) => { ADM(user);
    const m = params.month; if (!isMonth(m)) throw fail('Kỳ không hợp lệ');
    const locked = !!body.locked;
    if (locked && period(m)?.status !== 'computed') throw fail('Phải tính giá xuất kho cho kỳ này trước khi khóa sổ');
    tx(() => { D.periods[m] = { ...(period(m) || { month: m, status: 'dirty' }), locked: locked ? 1 : 0 }; });
    audit(user, locked ? 'PERIOD_LOCK' : 'PERIOD_UNLOCK', `Kỳ ${m}`); return { ok: true };
  });

  R('GET', '/api/reports/nxt', ({ query }) => { const { from, to } = reportRange(query); return nxtReport(from, to); });
  R('GET', '/api/reports/ledger', ({ query }) => {
    const { from, to } = reportRange(query);
    const it = D.items.find((i) => i.id === Number(query.item_id)); if (!it) throw fail('Chọn mã hàng');
    const comp = compute(to); const first = comp.months[from]?.rows.get(it.id);
    const lines = D.lines.filter((l) => l.item_id === it.id).map((l) => ({ l, v: voucherOf(l) }))
      .filter(({ v }) => v.posted !== 0 && v.date.slice(0, 7) >= from && v.date.slice(0, 7) <= to)
      .sort((a, b) => cmp(a.v.date, b.v.date) || cmp(a.v.type, b.v.type) || a.v.id - b.v.id || a.l.sort - b.l.sort);
    let bq = first ? first.open_qty : 0, bv = first ? first.open_val : 0;
    const out = lines.map(({ l, v }) => {
      let price, value;
      if (v.type === 'N') { price = l.unit_price; value = l.amount; bq += l.qty; bv += l.amount; }
      else { const c = comp.months[v.date.slice(0, 7)].lineCosts.get(l.id); price = c.cost_price; value = c.cost_amount; bq -= l.qty; bv -= value; }
      return { id: l.id, qty: l.qty, unit_price: l.unit_price, amount: l.amount, voucher_id: v.id, type: v.type, number: v.number, date: v.date, partner: v.partner, description: v.description, price, value, bal_qty: bq, bal_val: bv };
    });
    const months = Object.keys(comp.months).filter((m) => m >= from && m <= to).map((m) => ({ month: m, ...comp.months[m].rows.get(it.id) }));
    return { item: it, from, to, open_qty: first?.open_qty || 0, open_val: first?.open_val || 0, lines: out, months };
  });
  R('GET', '/api/dashboard', () => {
    const fm = firstMonth(); const cur = now().slice(0, 7); let stock = null;
    if (fm) {
      const m = cur < fm ? fm : cur; const last = compute(m).months[m];
      if (last) { let v = 0, cnt = 0; for (const r of last.rows.values()) { v += r.close_val; if (r.close_qty > 0) cnt++; } stock = { value: v, items_in_stock: cnt }; }
    }
    const tm = {};
    for (const v of D.vouchers.filter((x) => x.posted !== 0 && x.date.startsWith(cur))) {
      tm[v.type] = tm[v.type] || { type: v.type, c: 0, amt: 0 }; tm[v.type].c++;
      tm[v.type].amt += D.lines.filter((l) => l.voucher_id === v.id).reduce((s, l) => s + l.amount, 0);
    }
    return { month: cur, opening_date: D.settings.opening_date, items: D.items.length, stock, this_month: tm,
      dirty: Object.values(D.periods).filter((p) => p.status === 'dirty').length,
      recent: [...D.vouchers].sort((a, b) => b.id - a.id).slice(0, 8) };
  });

  R('GET', '/api/users', ({ user }) => { ADM(user); return D.users.map((u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: u.active, created_at: u.created_at, locked_until: u.locked_until,
    last_login: D.audit.filter((a) => a.user_id === u.id && a.action === 'LOGIN_OK').reduce((m, a) => (a.ts > m ? a.ts : m), '') || null,
    active_sessions: D.sessions.filter((s) => s.user_id === u.id).length })); });
  R('POST', '/api/users', ({ user, body: b }) => { ADM(user);
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(b.username || '')) throw fail('Tên đăng nhập 3-32 ký tự, chỉ gồm chữ, số, dấu . _ -');
    const err = validatePassword(b.password); if (err) throw fail(err);
    if (!window.KhoRoles.ROLES[b.role]) throw fail('Vai trò không hợp lệ');
    if (D.users.some((u) => ci(u.username, b.username))) throw fail('Tên đăng nhập đã tồn tại');
    tx(() => D.users.push({ id: nextId('users'), username: b.username, password_hash: hash(b.password), full_name: b.full_name || '', role: b.role, active: 1, must_change: 1, failed_count: 0, locked_until: null, created_at: now() }));
    audit(user, 'USER_CREATE', `${b.username} (${b.role})`); return { ok: true };
  });
  R('PUT', '/api/users/:id', ({ user, params, body: b }) => { ADM(user);
    const u = D.users.find((x) => x.id === Number(params.id)); if (!u) throw fail('Không tìm thấy người dùng', 404);
    if (u.id === user.id && (b.active === false || (b.role && b.role !== 'admin'))) throw fail('Không thể tự khóa hoặc hạ quyền chính mình');
    const changes = [];
    tx(() => {
      if (b.full_name !== undefined) { u.full_name = b.full_name; changes.push('họ tên'); }
      if (b.role && window.KhoRoles.ROLES[b.role]) { u.role = b.role; changes.push('vai trò=' + b.role); }
      if (b.active !== undefined) { u.active = b.active ? 1 : 0; if (!b.active) D.sessions = D.sessions.filter((s) => s.user_id !== u.id); changes.push(b.active ? 'mở khóa' : 'khóa tài khoản'); }
      if (b.password) { const err = validatePassword(b.password); if (err) throw fail(err); Object.assign(u, { password_hash: hash(b.password), must_change: 1, failed_count: 0, locked_until: null }); changes.push('đặt lại mật khẩu'); }
    });
    audit(user, 'USER_UPDATE', `${u.username}: ${changes.join(', ')}`); return { ok: true };
  });
  R('GET', '/api/audit', ({ user, query: q }) => { ADM(user);
    const s = (q.q || '').toLowerCase(); const to = isDate(q.to) ? addDays(q.to, 1) : null;
    const rows = D.audit.filter((a) => (!q.username || a.username === q.username) && (!q.action || a.action === q.action) && (!isDate(q.from) || a.ts >= q.from) && (!to || a.ts < to)
      && (!s || String(a.detail).toLowerCase().includes(s) || String(a.ip).toLowerCase().includes(s))).sort((a, b) => b.id - a.id);
    const page = Math.max(1, Number(q.page) || 1);
    return { total: rows.length, page, rows: rows.slice((page - 1) * 100, page * 100) };
  });
  R('GET', '/api/sessions', ({ user }) => { ADM(user); return D.sessions.map((s) => ({ ...s, username: D.users.find((u) => u.id === s.user_id)?.username })).sort((a, b) => cmp(b.last_seen, a.last_seen)); });

  // ---------------- Thay fetch cho các đường dẫn /api ----------------
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), location.href);
    if (!u.pathname.startsWith('/api/')) return realFetch(url, opts);
    const method = (opts.method || 'GET').toUpperCase();
    const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
    await new Promise((r) => setTimeout(r, 40));
    for (const rt of routes) {
      if (rt.method !== method) continue;
      const m = u.pathname.match(rt.re); if (!m) continue;
      try {
        const user = currentUser();
        if (!rt.open && !user) return json({ error: 'Chưa đăng nhập' }, 401);
        if (user && user.must_change && !['/api/me', '/api/me/password', '/api/logout'].includes(u.pathname)) return json({ error: 'Bạn cần đổi mật khẩu trước khi tiếp tục', must_change: true }, 403);
        const body = opts.body instanceof FormData ? opts.body : opts.body ? JSON.parse(opts.body) : {};
        if (user && !window.KhoRoles.canSeeValues(user.role) && window.KhoRoles.isValueOnlyPath(u.pathname)) return json({ error: 'Quyền Thủ kho chỉ xem số lượng, không xem được dữ liệu giá trị' }, 403);
        const res = await rt.fn({ user, params: m.groups || {}, query: Object.fromEntries(u.searchParams), body });
        save();
        return json(user && !window.KhoRoles.canSeeValues(user.role) ? window.KhoRoles.strip(res) : res);
      } catch (e) {
        console.warn(e);
        return json({ error: e.message || 'Lỗi không xác định' }, e.status || 400);
      }
    }
    return json({ error: 'Không tìm thấy' }, 404);
  };

  load();
  window.KHO_DEMO = { resetDemo, getAttachment: (n) => ATT.get(n) };
})();

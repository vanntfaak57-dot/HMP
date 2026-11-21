// Tính giá xuất kho theo phương pháp BÌNH QUÂN GIA QUYỀN CUỐI KỲ (kỳ = tháng)
//
//   Đơn giá BQ (tháng) = (Giá trị tồn đầu kỳ + Giá trị nhập trong kỳ) / (SL tồn đầu kỳ + SL nhập trong kỳ)
//   Giá vốn xuất       = SL xuất × Đơn giá BQ  (làm tròn đồng)
//   Tồn cuối kỳ        = Tồn đầu + Nhập - Xuất; tồn cuối tháng này là tồn đầu tháng sau.
//   Khi SL tồn cuối = 0, phần chênh lệch làm tròn được dồn vào dòng xuất cuối để giá trị tồn = 0.
const { db, getSetting, now } = require('./db');

const EPS = 1e-9;

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const monthOf = (d) => d.slice(0, 7);
function nextMonth(m) {
  let [y, mo] = m.split('-').map(Number);
  mo += 1;
  if (mo > 12) { mo = 1; y += 1; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}
function monthsBetween(from, to) {
  const out = [];
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m);
  return out;
}

function openingDate() {
  return getSetting('opening_date');
}
// Tháng đầu tiên phát sinh = tháng của ngày (A + 1)
function firstMonth() {
  const A = openingDate();
  return A ? monthOf(addDays(A, 1)) : null;
}

/**
 * Tính toán toàn bộ các tháng từ kỳ đầu tiên đến uptoMonth.
 * Trả về { months: { 'YYYY-MM': { rows: Map(itemId -> số liệu), lineCosts: Map(lineId -> {cost_price, cost_amount}) } } }
 */
function compute(uptoMonth) {
  const A = openingDate();
  if (!A) throw new Error('Chưa thiết lập ngày chốt số dư đầu kỳ (ngày A) trong phần Cài đặt');
  const fm = firstMonth();
  const result = { months: {}, firstMonth: fm };
  if (!uptoMonth || uptoMonth < fm) return result;

  const items = db.prepare('SELECT id, opening_qty, opening_value FROM items').all();
  const state = new Map(items.map((i) => [i.id, { qty: i.opening_qty, val: i.opening_value }]));

  const lines = db.prepare(`
    SELECT l.id, l.item_id, l.qty, l.amount, v.type, v.date
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.date > ? AND substr(v.date, 1, 7) <= ?
    ORDER BY v.date, v.type, v.id, l.sort, l.id`).all(A, uptoMonth);

  const byMonth = new Map();
  for (const l of lines) {
    const m = monthOf(l.date);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(l);
  }

  for (const m of monthsBetween(fm, uptoMonth)) {
    const rows = new Map();
    const outLines = new Map(); // itemId -> [line]
    for (const [id, s] of state) {
      rows.set(id, { open_qty: s.qty, open_val: s.val, in_qty: 0, in_val: 0, out_qty: 0, out_val: 0, avg: 0, close_qty: 0, close_val: 0 });
    }
    for (const l of byMonth.get(m) || []) {
      const r = rows.get(l.item_id);
      if (!r) continue;
      if (l.type === 'N') { r.in_qty += l.qty; r.in_val += l.amount; }
      else {
        r.out_qty += l.qty;
        if (!outLines.has(l.item_id)) outLines.set(l.item_id, []);
        outLines.get(l.item_id).push(l);
      }
    }
    const lineCosts = new Map();
    for (const [id, r] of rows) {
      const q = r.open_qty + r.in_qty;
      r.avg = q > EPS ? (r.open_val + r.in_val) / q : 0;
      const outs = outLines.get(id) || [];
      let outVal = 0;
      for (const l of outs) {
        const amt = Math.round(l.qty * r.avg);
        lineCosts.set(l.id, { cost_price: r.avg, cost_amount: amt });
        outVal += amt;
      }
      r.close_qty = q - r.out_qty;
      if (Math.abs(r.close_qty) < EPS && outs.length) {
        // Hết hàng: dồn chênh lệch làm tròn vào dòng xuất cuối cùng
        const diff = Math.round(r.open_val + r.in_val - outVal);
        if (diff !== 0) {
          const last = outs[outs.length - 1];
          const lc = lineCosts.get(last.id);
          lc.cost_amount += diff;
          outVal += diff;
        }
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

// Ghi giá vốn vào các phiếu xuất của các tháng <= month, đánh dấu kỳ "đã tính"
function runCosting(month, username) {
  const res = compute(month);
  const upd = db.prepare('UPDATE voucher_lines SET cost_price = ?, cost_amount = ? WHERE id = ?');
  const upsert = db.prepare(`INSERT INTO periods(month, status, computed_at, computed_by) VALUES (?, 'computed', ?, ?)
    ON CONFLICT(month) DO UPDATE SET status='computed', computed_at=excluded.computed_at, computed_by=excluded.computed_by`);
  let count = 0;
  for (const [m, data] of Object.entries(res.months)) {
    for (const [lineId, c] of data.lineCosts) { upd.run(c.cost_price, c.cost_amount, lineId); count++; }
    upsert.run(m, now(), username);
  }
  return { months: Object.keys(res.months), lines: count, data: res.months[month] };
}

// Đánh dấu các kỳ từ tháng m trở đi cần tính lại giá
function markDirty(fromMonth) {
  db.prepare(`INSERT INTO periods(month, status) VALUES (?, 'dirty') ON CONFLICT(month) DO UPDATE SET status='dirty'`).run(fromMonth);
  db.prepare(`UPDATE periods SET status='dirty' WHERE month >= ?`).run(fromMonth);
}

function isLocked(month) {
  const r = db.prepare('SELECT locked FROM periods WHERE month = ?').get(month);
  return !!(r && r.locked);
}

// Kiểm tra không có mặt hàng nào bị âm kho ở bất kỳ thời điểm nào
function checkNoNegative(itemIds) {
  const A = openingDate();
  const stmt = db.prepare(`SELECT v.date, v.type, v.number, l.qty FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE l.item_id = ? ORDER BY v.date, CASE v.type WHEN 'N' THEN 0 ELSE 1 END, v.id`);
  for (const id of new Set(itemIds)) {
    const it = db.prepare('SELECT code, opening_qty FROM items WHERE id = ?').get(id);
    if (!it) continue;
    let bal = it.opening_qty;
    for (const r of stmt.all(id)) {
      if (A && r.date <= A) continue;
      bal += r.type === 'N' ? r.qty : -r.qty;
      if (bal < -EPS) {
        throw new Error(`Mã hàng ${it.code} bị âm kho ngày ${r.date.split('-').reverse().join('/')} (phiếu ${r.number}), thiếu ${fmt(-bal)}`);
      }
    }
  }
}
const fmt = (n) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

// Số lượng tồn của từng mặt hàng đến hết ngày date (chỉ số lượng)
function stockQtyAt(date, excludeVoucherId = 0) {
  const A = openingDate();
  const rows = db.prepare(`SELECT i.id, i.opening_qty +
      COALESCE(SUM(CASE WHEN v.type='N' THEN l.qty WHEN v.type='X' THEN -l.qty END), 0) AS qty
    FROM items i
    LEFT JOIN voucher_lines l ON l.item_id = i.id
    LEFT JOIN vouchers v ON v.id = l.voucher_id AND v.date > ? AND v.date <= ? AND v.id <> ?
    GROUP BY i.id`).all(A || '0000-00-00', date, excludeVoucherId);
  return Object.fromEntries(rows.map((r) => [r.id, r.qty]));
}

module.exports = { compute, runCosting, markDirty, isLocked, checkNoNegative, stockQtyAt, monthOf, firstMonth, openingDate, monthsBetween, addDays };

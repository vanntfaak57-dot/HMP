// Tính số liệu báo cáo theo đối tượng và dashboard phân tích.
// Dùng chung cho máy chủ (Node) và bản demo trên trình duyệt: hàm thuần, nhận dữ liệu qua ctx.
//   ctx.items    : [{ id, code, name, unit }]
//   ctx.partners : [{ id, kind, code, name }]
//   ctx.lines    : [{ id, item_id, qty, amount, v: { id, type, number, date, partner_id, partner } }]
//   ctx.compute  : (toMonth) => kết quả tính giá BQGQ cuối kỳ (costing.compute)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KhoAnalytics = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const NO_PARTNER = 'Khách lẻ / chưa chọn đối tượng';
  const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

  // Khóa nhóm đối tượng: theo mã trong danh mục, nếu phiếu cũ chưa gắn mã thì theo tên ghi trên phiếu
  function partnerKey(v) { return v.partner_id ? 'p' + v.partner_id : 'n:' + norm(v.partner); }
  function partnerInfo(ctx, v) {
    if (v.partner_id) {
      const p = ctx.partners.find((x) => x.id === v.partner_id);
      if (p) return { key: 'p' + p.id, partner_id: p.id, code: p.code, name: p.name };
    }
    return { key: 'n:' + norm(v.partner), partner_id: null, code: '', name: v.partner || NO_PARTNER };
  }

  function linesInRange(ctx, from, to) {
    return ctx.lines.filter((l) => { const m = l.v.date.slice(0, 7); return m >= from && m <= to; });
  }
  function costOf(comp, l) {
    const m = comp.months[l.v.date.slice(0, 7)];
    const c = m && m.lineCosts.get(l.id);
    return c ? c.cost_amount : 0;
  }

  function partnerSummary(ctx, from, to, kind) {
    const type = kind === 'NCC' ? 'N' : 'X';
    const comp = ctx.compute(to);
    const map = new Map();
    for (const l of linesInRange(ctx, from, to)) {
      if (l.v.type !== type) continue;
      const info = partnerInfo(ctx, l.v);
      if (!map.has(info.key)) map.set(info.key, { ...info, vouchers: new Set(), qty: 0, amount: 0, cost: 0 });
      const r = map.get(info.key);
      r.vouchers.add(l.v.id); r.qty += l.qty; r.amount += l.amount;
      if (type === 'X') r.cost += costOf(comp, l);
    }
    const rows = [...map.values()].map((r) => ({
      key: r.key, partner_id: r.partner_id, code: r.code, name: r.name, voucher_count: r.vouchers.size, qty: r.qty,
      amount: r.amount, cost: r.cost, profit: type === 'X' ? r.amount - r.cost : 0,
    })).sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((t, r) => ({ voucher_count: t.voucher_count + r.voucher_count, amount: t.amount + r.amount, cost: t.cost + r.cost, profit: t.profit + r.profit }),
      { voucher_count: 0, amount: 0, cost: 0, profit: 0 });
    return { from, to, kind: type === 'N' ? 'NCC' : 'KH', rows, total };
  }

  // Chi tiết một đối tượng: từng mặt hàng và từng phiếu
  function partnerDetail(ctx, from, to, kind, key) {
    const type = kind === 'NCC' ? 'N' : 'X';
    const comp = ctx.compute(to);
    const items = new Map(); const vouchers = new Map();
    let info = null;
    for (const l of linesInRange(ctx, from, to)) {
      if (l.v.type !== type || partnerKey(l.v) !== key) continue;
      info = info || partnerInfo(ctx, l.v);
      const cost = type === 'X' ? costOf(comp, l) : 0;
      const it = ctx.items.find((i) => i.id === l.item_id) || { code: '?', name: '?', unit: '' };
      if (!items.has(l.item_id)) items.set(l.item_id, { code: it.code, name: it.name, unit: it.unit, qty: 0, amount: 0, cost: 0 });
      const r = items.get(l.item_id); r.qty += l.qty; r.amount += l.amount; r.cost += cost;
      if (!vouchers.has(l.v.id)) vouchers.set(l.v.id, { id: l.v.id, number: l.v.number, date: l.v.date, amount: 0, cost: 0 });
      const v = vouchers.get(l.v.id); v.amount += l.amount; v.cost += cost;
    }
    const fin = (r) => ({ ...r, profit: type === 'X' ? r.amount - r.cost : 0 });
    return {
      from, to, kind: type === 'N' ? 'NCC' : 'KH', partner: info,
      items: [...items.values()].map(fin).sort((a, b) => b.amount - a.amount),
      vouchers: [...vouchers.values()].map(fin).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id)),
    };
  }

  function dashboard(ctx, from, to, monthList) {
    const comp = ctx.compute(to);
    const months = monthList.map((m) => ({ month: m, revenue: 0, cost: 0, profit: 0, purchase: 0 }));
    const byMonth = new Map(months.map((m) => [m.month, m]));
    const customers = new Map(); const suppliers = new Map(); const items = new Map();
    const issueV = new Set(); const receiptV = new Set();
    for (const l of linesInRange(ctx, from, to)) {
      const m = byMonth.get(l.v.date.slice(0, 7)); if (!m) continue;
      const info = partnerInfo(ctx, l.v);
      if (l.v.type === 'X') {
        const cost = costOf(comp, l);
        m.revenue += l.amount; m.cost += cost; issueV.add(l.v.id);
        if (!customers.has(info.key)) customers.set(info.key, { key: info.key, partner_id: info.partner_id, name: info.name, value: 0, profit: 0 });
        const c = customers.get(info.key); c.value += l.amount; c.profit += l.amount - cost;
        if (!items.has(l.item_id)) { const it = ctx.items.find((i) => i.id === l.item_id) || {}; items.set(l.item_id, { code: it.code, name: it.name, revenue: 0, cost: 0, qty: 0 }); }
        const r = items.get(l.item_id); r.revenue += l.amount; r.cost += cost; r.qty += l.qty;
      } else {
        m.purchase += l.amount; receiptV.add(l.v.id);
        if (!suppliers.has(info.key)) suppliers.set(info.key, { key: info.key, partner_id: info.partner_id, name: info.name, value: 0 });
        suppliers.get(info.key).value += l.amount;
      }
    }
    months.forEach((m) => { m.profit = m.revenue - m.cost; });
    const last = comp.months[to];
    const stock = [];
    let stockValue = 0, inStock = 0;
    if (last) {
      for (const it of ctx.items) {
        const r = last.rows.get(it.id); if (!r) continue;
        stockValue += r.close_val; if (r.close_qty > 1e-9) inStock++;
        if (Math.abs(r.close_val) > 0.5) stock.push({ code: it.code, name: it.name, unit: it.unit, qty: r.close_qty, value: r.close_val });
      }
    }
    stock.sort((a, b) => b.value - a.value);
    const totals = months.reduce((t, m) => ({ revenue: t.revenue + m.revenue, cost: t.cost + m.cost, purchase: t.purchase + m.purchase }), { revenue: 0, cost: 0, purchase: 0 });
    totals.profit = totals.revenue - totals.cost;
    totals.margin = totals.revenue ? totals.profit / totals.revenue : null;
    totals.stock_value = stockValue; totals.stock_items = inStock; totals.item_count = ctx.items.length;
    totals.issue_count = issueV.size; totals.receipt_count = receiptV.size;
    const top = (map, n) => [...map.values()].sort((a, b) => b.value - a.value).slice(0, n);
    return {
      from, to, months, totals,
      top_customers: top(customers, 6),
      top_suppliers: top(suppliers, 6),
      top_items: [...items.values()].map((r) => ({ ...r, profit: r.revenue - r.cost, value: r.revenue - r.cost })).sort((a, b) => b.profit - a.profit).slice(0, 6),
      stock: stock.slice(0, 8), stock_other: stock.slice(8).reduce((s, r) => s + r.value, 0), stock_other_count: Math.max(0, stock.length - 8),
    };
  }

  // Bán hàng theo mặt hàng: tổng hợp từng mặt hàng + chi tiết từng dòng bán
  function salesByItem(ctx, fromDate, toDate, opts = {}) {
    const ids = new Set((opts.itemIds || []).filter(Boolean));
    const comp = ctx.compute(toDate.slice(0, 7));
    const map = new Map();
    for (const l of ctx.lines) {
      if (l.v.type !== 'X' || l.v.date < fromDate || l.v.date > toDate) continue;
      if (ids.size && !ids.has(l.item_id)) continue;
      if (opts.partnerKey && partnerKey(l.v) !== opts.partnerKey) continue;
      const it = ctx.items.find((i) => i.id === l.item_id) || { code: '?', name: '?', unit: '' };
      const p = partnerInfo(ctx, l.v);
      const cost = costOf(comp, l);
      if (!map.has(l.item_id)) map.set(l.item_id, { item_id: l.item_id, code: it.code, name: it.name, unit: it.unit, qty: 0, amount: 0, cost: 0, vouchers: new Set(), customers: new Set(), lines: [] });
      const r = map.get(l.item_id);
      r.qty += l.qty; r.amount += l.amount; r.cost += cost; r.vouchers.add(l.v.id); r.customers.add(p.key);
      r.lines.push({ date: l.v.date, voucher_id: l.v.id, number: l.v.number, partner: p.name, partner_code: p.code, qty: l.qty, unit_price: l.qty ? l.amount / l.qty : 0, amount: l.amount, cost, profit: l.amount - cost });
    }
    const rows = [...map.values()].map((r) => ({
      item_id: r.item_id, code: r.code, name: r.name, unit: r.unit, qty: r.qty, amount: r.amount, cost: r.cost, profit: r.amount - r.cost,
      avg_price: r.qty ? r.amount / r.qty : 0, voucher_count: r.vouchers.size, customer_count: r.customers.size,
      lines: r.lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.voucher_id - b.voucher_id)),
    })).sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((t, r) => ({ qty: t.qty + r.qty, amount: t.amount + r.amount, cost: t.cost + r.cost, profit: t.profit + r.profit }), { qty: 0, amount: 0, cost: 0, profit: 0 });
    return { from: fromDate, to: toDate, rows, total };
  }

  return { partnerSummary, partnerDetail, dashboard, salesByItem, partnerKey, NO_PARTNER };
});

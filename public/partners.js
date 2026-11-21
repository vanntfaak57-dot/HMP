// Danh mục khách hàng & nhà cung cấp, báo cáo theo đối tượng, dashboard phân tích
'use strict';

const KIND_TITLE = { KH: 'Danh mục khách hàng', NCC: 'Danh mục nhà cung cấp' };
const KIND_OBJ = { KH: 'khách hàng', NCC: 'nhà cung cấp' };
const monthLabel = (m) => (m ? m.split('-').reverse().join('/') : '');

// ---------- Danh mục khách hàng / nhà cung cấp (Mã, Tên, MST) ----------
async function pagePartners(kind) {
  const partners = await api('/api/partners?kind=' + kind);
  const W = canWrite();
  const OBJ = KIND_OBJ[kind];
  const VT = kind === 'KH' ? 'X' : 'N';
  const selected = new Set();
  let filter = '';
  let list = [];
  const updateSelection = () => {
    const visible = new Set(list.map((x) => x.id));
    for (const id of [...selected]) if (!visible.has(id)) selected.delete(id);
    $$('#p-body tr[data-id]').forEach((tr) => {
      const on = selected.has(Number(tr.dataset.id));
      tr.classList.toggle('sel', on);
      const cb = $('input[data-sel]', tr); if (cb) cb.checked = on;
    });
    const all = $('#p-all');
    if (all) { all.checked = list.length > 0 && selected.size === list.length; all.indeterminate = selected.size > 0 && selected.size < list.length; }
    const bar = $('#p-bulk');
    if (bar) { bar.hidden = selected.size === 0; $('#p-bulk-count').textContent = selected.size.toLocaleString('vi-VN'); }
  };
  const cols = W ? 6 : 5;
  const render = () => {
    const f = filter.toLowerCase();
    list = partners.filter((x) => !f || [x.code, x.name, x.tax_code].some((v) => String(v || '').toLowerCase().includes(f)));
    $('#p-body').innerHTML = list.map((x) => `<tr data-id="${x.id}">
      ${W ? `<td class="chk-col"><label class="chk"><input type="checkbox" data-sel="${x.id}" aria-label="Chọn ${esc(x.code)}"></label></td>` : ''}
      <td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.tax_code)}</td>
      <td class="num">${x.voucher_count ? `<a href="#/vouchers/${VT}" data-pv="${x.id}">${x.voucher_count}</a>` : '0'}</td>
      ${W ? `<td><button class="btn small" data-pedit="${x.id}">Sửa</button></td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${cols}" class="muted">Chưa có ${OBJ}. ${W ? `Bấm "+ Thêm ${OBJ}" hoặc nhập từ Excel.` : ''}</td></tr>`;
    $('#p-foot').innerHTML = `<tr><td colspan="${cols}">Tổng cộng: ${list.length.toLocaleString('vi-VN')} ${OBJ}</td></tr>`;
    updateSelection();
  };
  $('#main').innerHTML = `
    <h1>${KIND_TITLE[kind]}</h1>
    <div class="toolbar">
      <input id="p-filter" placeholder="Tìm mã, tên, mã số thuế…" style="width:260px">
      ${W ? `<span id="p-bulk" class="bulk-bar" hidden>Đã chọn <b id="p-bulk-count">0</b>
        <button class="btn danger" id="p-bulk-del" type="button">Xóa các dòng đã chọn</button>
        <button class="btn" id="p-bulk-clear" type="button">Bỏ chọn</button></span>` : ''}
      <span class="spacer"></span>
      ${W ? `<button class="btn primary" id="p-add">+ Thêm ${OBJ}</button>
      <a class="btn" href="/api/partners/template.xlsx?kind=${kind}">Tải file Excel mẫu</a>
      <label class="btn">Nhập từ Excel<input type="file" id="p-import" accept=".xlsx" hidden></label>` : ''}
    </div>
    <div class="table-wrap sticky-head"><table><thead><tr>
      ${W ? '<th class="chk-col"><label class="chk"><input type="checkbox" id="p-all" aria-label="Chọn tất cả" title="Chọn tất cả"></label></th>' : ''}
      <th>Mã ${OBJ}</th><th>Tên ${OBJ}</th><th>Mã số thuế</th><th class="num">Số chứng từ</th>${W ? '<th></th>' : ''}</tr></thead>
      <tbody id="p-body"></tbody><tfoot id="p-foot"></tfoot></table></div>`;
  render();
  $('#p-filter').addEventListener('input', (e) => { filter = e.target.value; render(); });
  $('#p-body').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-sel]'); if (!cb) return;
    if (cb.checked) selected.add(Number(cb.dataset.sel)); else selected.delete(Number(cb.dataset.sel));
    updateSelection();
  });
  $('#p-all')?.addEventListener('change', (e) => { if (e.target.checked) list.forEach((x) => selected.add(x.id)); else selected.clear(); updateSelection(); });
  $('#p-bulk-clear')?.addEventListener('click', () => { selected.clear(); updateSelection(); });
  $('#p-bulk-del')?.addEventListener('click', async () => {
    const chosen = partners.filter((x) => selected.has(x.id));
    const preview = chosen.slice(0, 8).map((x) => x.code).join(', ') + (chosen.length > 8 ? ` và ${chosen.length - 8} mã khác` : '');
    if (!confirm(`Xóa ${chosen.length} ${OBJ}: ${preview}? Dòng đã có chứng từ sẽ được giữ lại.`)) return;
    try {
      const r = await api('/api/partners/bulk-delete', { method: 'POST', body: { ids: chosen.map((x) => x.id) } });
      toast(`Đã xóa ${r.deleted.length} ${OBJ}${r.skipped.length ? `, giữ lại ${r.skipped.length}` : ''}`);
      await route();
      if (r.skipped.length) {
        modal(`<h2>Không xóa được ${r.skipped.length} ${OBJ}</h2><div class="table-wrap"><table><thead><tr><th>Mã</th><th>Tên</th><th>Lý do</th></tr></thead><tbody>
          ${r.skipped.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name || '')}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>
          <div class="actions"><button class="btn primary" data-close>Đóng</button></div>`);
      }
    } catch (err) { toast(err.message, true); }
  });
  $('#main').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-pedit]');
    if (ed) partnerDialog(kind, partners.find((x) => x.id == ed.dataset.pedit));
    const pv = e.target.closest('[data-pv]');
    if (pv) sessionStorage.setItem('vfilter' + VT, JSON.stringify({ from: '2000-01-01', to: '2999-12-31', q: '', partner_id: String(pv.dataset.pv) }));
  });
  $('#p-add')?.addEventListener('click', () => partnerDialog(kind, null));
  $('#p-import')?.addEventListener('change', async (e) => {
    const fd = new FormData(); fd.append('file', e.target.files[0]);
    try { const r = await api('/api/partners/import?kind=' + kind, { method: 'POST', body: fd }); toast(`Đã thêm ${r.created}, cập nhật ${r.updated} ${OBJ}`); route(); }
    catch (err) { toast(err.message, true); }
    e.target.value = '';
  });
}

// Hộp thoại thêm/sửa khách hàng hoặc nhà cung cấp. defaults dùng khi tạo nhanh từ phiếu.
function partnerDialog(kind, p, onSaved, defaults = {}) {
  const OBJ = KIND_OBJ[kind];
  const v = p || defaults;
  modal(`<h2>${p ? 'Sửa' : 'Thêm'} ${OBJ}</h2>
    <form class="form-grid" id="partner-form" autocomplete="off" style="grid-template-columns:1fr">
      <label>Mã ${OBJ} *<input name="code" id="pf-code" required value="${esc(v.code)}"></label>
      <label>Tên ${OBJ} *<input name="name" id="pf-name" required value="${esc(v.name)}"></label>
      <label>Mã số thuế<input name="tax_code" id="pf-tax" inputmode="numeric" value="${esc(v.tax_code)}"></label>
    </form>
    <div class="actions"><button class="btn" data-close>Hủy</button><button class="btn primary" id="partner-save">Lưu</button></div>`, (bg, close) => {
    $(v.code ? '#pf-name' : '#pf-code', bg).focus();
    $('#partner-form', bg).addEventListener('submit', (e) => { e.preventDefault(); $('#partner-save', bg).click(); });
    $('#partner-save', bg).addEventListener('click', async () => {
      const body = { ...Object.fromEntries(new FormData($('#partner-form', bg))), kind };
      try {
        const r = await api(p ? `/api/partners/${p.id}` : '/api/partners', { method: p ? 'PUT' : 'POST', body });
        close(); toast(`Đã lưu ${OBJ} ${body.code}`);
        if (onSaved) onSaved({ ...body, id: p?.id || r.id }); else route();
      } catch (err) { toast(err.message, true); }
    });
  });
}

// ---------- Báo cáo tổng hợp theo đối tượng ----------
function rangeControls(prefix, q) {
  return `Từ kỳ <input type="month" id="${prefix}-from" value="${q.from}"> đến kỳ <input type="month" id="${prefix}-to" value="${q.to}">`;
}
function defaultRange(key) {
  const cur = todayStr().slice(0, 7);
  const first = SETTINGS.opening_date ? (() => { const d = new Date(SETTINGS.opening_date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 7); })() : cur;
  return JSON.parse(sessionStorage.getItem(key) || 'null') || { from: first, to: cur };
}

async function pageReportPartners() {
  const q = defaultRange('rpt-partners');
  q.kind = q.kind || 'KH';
  $('#main').innerHTML = `<div class="page-head"><h1>Tổng hợp theo đối tượng</h1></div>
    <div class="toolbar">
      <div class="seg" role="tablist"><button class="btn" data-kind="KH" role="tab">Bán hàng theo khách hàng</button><button class="btn" data-kind="NCC" role="tab">Mua hàng theo nhà cung cấp</button></div>
      ${rangeControls('rp', q)} <button class="btn primary" id="rp-go">Xem</button>
    </div><div id="rp-out"></div>`;
  const setKind = (k) => { q.kind = k; $$('[data-kind]').forEach((b) => { b.classList.toggle('primary', b.dataset.kind === k); b.setAttribute('aria-selected', b.dataset.kind === k); }); };
  setKind(q.kind);
  const load = async () => {
    q.from = $('#rp-from').value; q.to = $('#rp-to').value;
    sessionStorage.setItem('rpt-partners', JSON.stringify(q));
    const r = await api(`/api/reports/partners?kind=${q.kind}&from=${q.from}&to=${q.to}`);
    const X = r.kind === 'KH';
    $('#rp-out').innerHTML = `<p class="muted small">Kỳ ${monthLabel(r.from)} → ${monthLabel(r.to)}. ${X ? 'Giá vốn tính theo bình quân gia quyền cuối kỳ với dữ liệu hiện tại.' : ''} Bấm vào tên để xem chi tiết · gõ vào ô <b>Lọc</b> dưới tiêu đề để tìm kiếm, lọc từng cột.</p>
      <div class="table-wrap sticky-head report"><table><thead><tr><th>Mã</th><th>${X ? 'Khách hàng' : 'Nhà cung cấp'}</th><th class="num">Số phiếu</th>
        <th class="num v">${X ? 'Doanh thu' : 'Giá trị nhập'}</th>${X ? '<th class="num v">Giá vốn</th><th class="num v">Lãi gộp</th><th class="num v">Tỷ suất LG</th>' : '<th class="num v">Tỷ trọng</th>'}</tr></thead><tbody>
      ${r.rows.map((x) => `<tr><td>${esc(x.code)}</td><td><a href="#" data-pkey="${esc(x.key)}">${esc(x.name)}</a></td><td class="num" ${nv(x.voucher_count)}>${x.voucher_count}</td><td class="num v" ${nv(x.amount)}>${fmtM(x.amount)}</td>
        ${X ? `<td class="num v" ${nv(x.cost)}>${fmtM(x.cost)}</td><td class="num v" ${nv(x.profit)}>${fmtM(x.profit)}</td><td class="num v" ${nv(x.amount ? x.profit / x.amount * 100 : 0)}>${x.amount ? fmtN(x.profit / x.amount * 100, 1) + '%' : ''}</td>`
        : `<td class="num v" ${nv(r.total.amount ? x.amount / r.total.amount * 100 : 0)}>${r.total.amount ? fmtN(x.amount / r.total.amount * 100, 1) + '%' : ''}</td>`}</tr>`).join('')
        || `<tr><td colspan="7" class="muted">Không có phát sinh trong kỳ</td></tr>`}</tbody>
      <tfoot><tr><td colspan="2">Tổng cộng (<span data-count></span> đối tượng)</td><td class="num" data-sum="2" data-fmt="q"></td><td class="num v" data-sum="3"></td>
        ${X ? '<td class="num v" data-sum="4"></td><td class="num v" data-sum="5"></td><td class="v"></td>' : '<td class="v"></td>'}</tr></tfoot></table></div>`;
    if (r.rows.length) tableTools($('#rp-out table'));
  };
  $('#main').addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]'); if (k) { setKind(k.dataset.kind); load().catch((err) => toast(err.message, true)); }
    const a = e.target.closest('[data-pkey]'); if (a) { e.preventDefault(); showPartnerDetail(q.kind, a.dataset.pkey, q.from, q.to); }
  });
  $('#rp-go').addEventListener('click', () => load().catch((err) => toast(err.message, true)));
  await load();
}

async function showPartnerDetail(kind, key, from, to) {
  const r = await api(`/api/reports/partner-detail?kind=${kind}&key=${encodeURIComponent(key)}&from=${from}&to=${to}`);
  const X = r.kind === 'KH';
  const head = `<th class="num">Số lượng</th><th class="num">${X ? 'Doanh thu' : 'Giá trị nhập'}</th>${X ? '<th class="num">Giá vốn</th><th class="num">Lãi gộp</th>' : ''}`;
  const tot = r.items.reduce((t, x) => ({ amount: t.amount + x.amount, cost: t.cost + x.cost, profit: t.profit + x.profit }), { amount: 0, cost: 0, profit: 0 });
  modal(`<h2>${esc(r.partner?.name || '')}</h2><p class="muted">${X ? 'Bán hàng' : 'Mua hàng'} kỳ ${monthLabel(r.from)} → ${monthLabel(r.to)}</p>
    <h3>Theo mặt hàng</h3>
    <div class="table-wrap"><table><thead><tr><th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th>${head}</tr></thead><tbody>
    ${r.items.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.unit)}</td><td class="num">${fmtN(x.qty, 3)}</td><td class="num">${fmtM(x.amount)}</td>
      ${X ? `<td class="num">${fmtM(x.cost)}</td><td class="num">${fmtM(x.profit)}</td>` : ''}</tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4">Tổng cộng</td><td class="num">${fmtM(tot.amount)}</td>${X ? `<td class="num">${fmtM(tot.cost)}</td><td class="num">${fmtM(tot.profit)}</td>` : ''}</tr></tfoot></table></div>
    <h3>Theo chứng từ</h3>
    <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Số phiếu</th><th class="num">${X ? 'Doanh thu' : 'Giá trị nhập'}</th>${X ? '<th class="num">Giá vốn</th><th class="num">Lãi gộp</th>' : ''}</tr></thead><tbody>
    ${r.vouchers.map((v) => `<tr><td>${fmtD(v.date)}</td><td><a href="#/voucher/${v.id}" data-close>${esc(v.number)}</a></td><td class="num">${fmtM(v.amount)}</td>
      ${X ? `<td class="num">${fmtM(v.cost)}</td><td class="num">${fmtM(v.profit)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    <div class="actions"><button class="btn primary" data-close>Đóng</button></div>`, (bg) => bg.querySelector('.modal').classList.add('wide'));
}

// ---------- Dashboard phân tích ----------
// Số gọn kiểu Việt Nam cho trục và nhãn: 850 tr, 1,2 tỷ
function fmtCompact(n) {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + (a / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: a >= 1e10 ? 0 : 1 }) + ' tỷ';
  if (a >= 1e6) return s + (a / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: a >= 1e7 ? 0 : 1 }) + ' tr';
  if (a >= 1e3) return s + Math.round(a / 1e3).toLocaleString('vi-VN') + ' N';
  return s + Math.round(a).toLocaleString('vi-VN');
}
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
  const ticks = []; for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

// Tooltip dùng chung: nội dung gắn bằng textContent
function vizTip() {
  let tip = $('#viz-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'viz-tip'; tip.setAttribute('role', 'status'); document.body.appendChild(tip); }
  return tip;
}
function showTip(el, x, y) {
  const data = JSON.parse(el.dataset.tip);
  const tip = vizTip(); tip.replaceChildren();
  const h = document.createElement('div'); h.className = 'tip-title'; h.textContent = data.title; tip.appendChild(h);
  for (const r of data.rows) {
    const row = document.createElement('div'); row.className = 'tip-row';
    if (r.s) { const k = document.createElement('span'); k.className = 'tip-key ' + r.s; row.appendChild(k); }
    const v = document.createElement('b'); v.textContent = r.v; row.appendChild(v);
    const l = document.createElement('span'); l.className = 'tip-label'; l.textContent = r.l; row.appendChild(l);
    tip.appendChild(row);
  }
  tip.hidden = false;
  const w = tip.offsetWidth, hh = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x + 14)) + 'px';
  tip.style.top = Math.max(8, Math.min(innerHeight - hh - 8, y + 14)) + 'px';
}
function bindTips(root) {
  root.addEventListener('pointermove', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); else vizTip().hidden = true; });
  root.addEventListener('pointerleave', () => { vizTip().hidden = true; });
  root.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) { const b = el.getBoundingClientRect(); showTip(el, b.left + b.width / 2, b.top); } });
  root.addEventListener('focusout', () => { vizTip().hidden = true; });
}
const tipAttr = (title, rows) => `data-tip="${esc(JSON.stringify({ title, rows }))}" tabindex="0"`;

// Biểu đồ cột theo tháng, 2 chuỗi (doanh thu, giá vốn), một trục
function columnChart(months) {
  const max = Math.max(0, ...months.flatMap((m) => [m.revenue, m.cost]));
  if (!max) return '<p class="muted empty-chart">Chưa có doanh thu trong kỳ</p>';
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const pct = (v) => Math.max(0, v / top * 100);
  return `<div class="viz">
    <div class="legend"><span><i class="key s1"></i>Doanh thu</span><span><i class="key s2"></i>Giá vốn</span></div>
    <div class="cplot">
      <div class="yaxis">${ticks.map((t) => `<span style="bottom:${pct(t)}%">${fmtCompact(t)}</span>`).join('')}</div>
      <div class="cgrid">${ticks.map((t) => `<i style="bottom:${pct(t)}%"></i>`).join('')}
        <div class="ccols">${months.map((m) => `<div class="cgroup" ${tipAttr('Tháng ' + monthLabel(m.month), [
          { s: 's1', v: fmtM(m.revenue), l: 'Doanh thu' }, { s: 's2', v: fmtM(m.cost), l: 'Giá vốn' }, { v: fmtM(m.profit), l: 'Lãi gộp' }])}>
          <div class="cbar s1" style="height:${pct(m.revenue)}%"></div><div class="cbar s2" style="height:${pct(m.cost)}%"></div></div>`).join('')}</div>
      </div>
    </div>
    <div class="xaxis">${months.map((m) => `<span>${m.month.slice(5)}/${m.month.slice(2, 4)}</span>`).join('')}</div>
  </div>`;
}
// Biểu đồ thanh ngang một chuỗi, giá trị ở đầu thanh
function barList(rows, { label, value, tipRows, empty, click }) {
  if (!rows.length) return `<p class="muted empty-chart">${empty}</p>`;
  const max = Math.max(...rows.map(value), 0) || 1;
  return `<div class="viz hbars">${rows.map((r) => `<div class="hrow" ${tipAttr(label(r), tipRows(r))} ${click ? `data-click="${esc(click(r))}"` : ''}>
    <span class="hlabel">${esc(label(r))}</span>
    <span class="htrack"><span class="hbar" style="width:calc((100% - 64px) * ${(Math.max(0, value(r)) / max).toFixed(4)})"></span><span class="hval">${fmtCompact(value(r))}</span></span></div>`).join('')}</div>`;
}
function tableView(head, rows) {
  return `<details class="tview"><summary>Xem bảng số liệu</summary><div class="table-wrap"><table><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

async function pageAnalytics() {
  const q = defaultRange('rpt-analytics');
  const cur = todayStr().slice(0, 7);
  const y = cur.slice(0, 4), qn = Math.floor((Number(cur.slice(5)) - 1) / 3);
  const presets = [
    ['Tháng này', cur, cur],
    ['Quý này', `${y}-${String(qn * 3 + 1).padStart(2, '0')}`, cur],
    ['Năm nay', `${y}-01`, cur],
    ['Từ đầu kỳ', defaultRange('__none__').from, cur],
  ];
  $('#main').innerHTML = `<h1>Dashboard phân tích</h1>
    <div class="toolbar filters">${presets.map(([t, f, to], i) => `<button class="btn preset" data-preset="${i}">${t}</button>`).join('')}
      <span class="sep"></span>${rangeControls('an', q)} <button class="btn primary" id="an-go">Xem</button></div>
    <div id="an-out"></div>`;
  const load = async () => {
    q.from = $('#an-from').value; q.to = $('#an-to').value;
    sessionStorage.setItem('rpt-analytics', JSON.stringify(q));
    $$('[data-preset]').forEach((b) => { const p = presets[b.dataset.preset]; b.classList.toggle('on', p[1] === q.from && p[2] === q.to); });
    const out = $('#an-out'); out.style.opacity = out.children.length ? 0.5 : 1;
    const r = await api(`/api/reports/analytics?from=${q.from}&to=${q.to}`);
    const t = r.totals;
    out.style.opacity = 1;
    out.innerHTML = `
      <p class="muted">Kỳ ${monthLabel(r.from)} → ${monthLabel(r.to)} · giá vốn theo bình quân gia quyền cuối kỳ, tính với dữ liệu hiện tại.</p>
      <div class="tiles">
        <div class="tile"><div class="label">Doanh thu</div><div class="value">${fmtM(t.revenue)}</div><div class="sub">${t.issue_count} phiếu xuất</div></div>
        <div class="tile"><div class="label">Giá vốn hàng bán</div><div class="value">${fmtM(t.cost)}</div><div class="sub">${t.revenue ? fmtN(t.cost / t.revenue * 100, 1) + '% doanh thu' : '—'}</div></div>
        <div class="tile"><div class="label">Lãi gộp</div><div class="value">${fmtM(t.profit)}</div><div class="sub">Tỷ suất ${t.margin == null ? '—' : fmtN(t.margin * 100, 1) + '%'}</div></div>
        <div class="tile"><div class="label">Giá trị nhập kho</div><div class="value">${fmtM(t.purchase)}</div><div class="sub">${t.receipt_count} phiếu nhập</div></div>
        <div class="tile"><div class="label">Tồn kho cuối kỳ</div><div class="value">${fmtM(t.stock_value)}</div><div class="sub">${t.stock_items}/${t.item_count} mã còn hàng</div></div>
      </div>
      <div class="chart-card wide-card"><h2>Doanh thu và giá vốn theo tháng</h2>${columnChart(r.months)}
        ${tableView(['Tháng', 'Doanh thu', 'Giá vốn', 'Lãi gộp', 'Nhập kho'], r.months.map((m) => [monthLabel(m.month), fmtM(m.revenue), fmtM(m.cost), fmtM(m.profit), fmtM(m.purchase)]))}</div>
      <div class="chart-grid">
        <div class="chart-card"><h2>Khách hàng doanh thu cao nhất</h2>
          ${barList(r.top_customers, { label: (x) => x.name, value: (x) => x.value, tipRows: (x) => [{ v: fmtM(x.value), l: 'Doanh thu' }, { v: fmtM(x.profit), l: 'Lãi gộp' }], empty: 'Chưa có doanh thu trong kỳ', click: (x) => 'KH|' + x.key })}
          ${tableView(['Khách hàng', 'Doanh thu', 'Lãi gộp'], r.top_customers.map((x) => [x.name, fmtM(x.value), fmtM(x.profit)]))}</div>
        <div class="chart-card"><h2>Mặt hàng lãi gộp cao nhất</h2>
          ${barList(r.top_items, { label: (x) => `${x.code} · ${x.name}`, value: (x) => x.profit, tipRows: (x) => [{ v: fmtM(x.profit), l: 'Lãi gộp' }, { v: fmtM(x.revenue), l: 'Doanh thu' }, { v: x.revenue ? fmtN(x.profit / x.revenue * 100, 1) + '%' : '—', l: 'Tỷ suất' }], empty: 'Chưa có hàng bán trong kỳ' })}
          ${tableView(['Mặt hàng', 'Doanh thu', 'Giá vốn', 'Lãi gộp'], r.top_items.map((x) => [`${x.code} · ${x.name}`, fmtM(x.revenue), fmtM(x.cost), fmtM(x.profit)]))}</div>
        <div class="chart-card"><h2>Nhà cung cấp nhập hàng nhiều nhất</h2>
          ${barList(r.top_suppliers, { label: (x) => x.name, value: (x) => x.value, tipRows: (x) => [{ v: fmtM(x.value), l: 'Giá trị nhập' }], empty: 'Chưa có phiếu nhập trong kỳ', click: (x) => 'NCC|' + x.key })}
          ${tableView(['Nhà cung cấp', 'Giá trị nhập'], r.top_suppliers.map((x) => [x.name, fmtM(x.value)]))}</div>
        <div class="chart-card"><h2>Giá trị tồn kho cuối kỳ theo mặt hàng</h2>
          ${barList(r.stock, { label: (x) => `${x.code} · ${x.name}`, value: (x) => x.value, tipRows: (x) => [{ v: fmtM(x.value), l: 'Giá trị tồn' }, { v: fmtN(x.qty, 3) + ' ' + (x.unit || ''), l: 'Số lượng' }], empty: 'Không còn hàng tồn' })}
          ${r.stock_other_count ? `<p class="muted small">Còn ${r.stock_other_count} mã khác: ${fmtM(r.stock_other)}</p>` : ''}
          ${tableView(['Mặt hàng', 'Số lượng', 'Giá trị tồn'], r.stock.map((x) => [`${x.code} · ${x.name}`, fmtN(x.qty, 3), fmtM(x.value)]))}</div>
      </div>`;
  };
  bindTips($('#main'));
  $('#main').addEventListener('click', (e) => {
    const p = e.target.closest('[data-preset]');
    if (p) { const [, f, to] = presets[p.dataset.preset]; $('#an-from').value = f; $('#an-to').value = to; load().catch((err) => toast(err.message, true)); }
    const c = e.target.closest('[data-click]');
    if (c) { const [kind, key] = c.dataset.click.split('|'); vizTip().hidden = true; showPartnerDetail(kind, key, q.from, q.to).catch((err) => toast(err.message, true)); }
  });
  $('#main').addEventListener('keydown', (e) => { const c = e.target.closest('[data-click]'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); c.click(); } });
  $('#an-go').addEventListener('click', () => load().catch((err) => toast(err.message, true)));
  await load();
}

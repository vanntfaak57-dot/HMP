// Giao diện ứng dụng Quản lý kho (SPA thuần JavaScript)
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (n, d = 2) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }));
const fmtM = (n) => (n === null || n === undefined ? '' : Math.round(Number(n)).toLocaleString('vi-VN'));
const fmtD = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const TYPE = { N: 'Phiếu nhập kho', X: 'Phiếu xuất kho bán hàng' };
const ACTIONS = {
  LOGIN_OK: 'Đăng nhập', LOGIN_FAIL: 'Đăng nhập thất bại', LOGOUT: 'Đăng xuất', PASSWORD_CHANGE: 'Đổi mật khẩu',
  ITEM_CREATE: 'Thêm mã hàng', ITEM_UPDATE: 'Sửa mã hàng', ITEM_DELETE: 'Xóa mã hàng', ITEM_BULK_DELETE: 'Xóa hàng loạt mã hàng', ITEM_IMPORT: 'Nhập Excel danh mục',
  VOUCHER_CREATE: 'Thêm chứng từ', VOUCHER_UPDATE: 'Sửa chứng từ', VOUCHER_DELETE: 'Xóa chứng từ', PDF_UPLOAD: 'Tải PDF',
  COSTING_RUN: 'Tính giá xuất kho', PERIOD_LOCK: 'Khóa sổ', PERIOD_UNLOCK: 'Mở khóa sổ', USER_CREATE: 'Thêm người dùng',
  USER_UPDATE: 'Sửa người dùng', SETTINGS_UPDATE: 'Sửa cài đặt', EXPORT: 'Xuất báo cáo',
};

const VAT_OPTIONS = [['', '-- Chưa chọn --'], ['0', '0%'], ['5', '5%'], ['8', '8%'], ['10', '10%'], ['KCT', 'KCT – Không chịu thuế'], ['KKKNT', 'KKKNT – Không kê khai, tính nộp thuế']];
const vatLabel = (v) => (v == null || v === '' ? '' : /^\d+$/.test(v) ? v + '%' : v);

let ME = null;
let SETTINGS = {};

function toast(msg, err = false) {
  const d = document.createElement('div');
  d.textContent = msg;
  if (err) d.className = 'err';
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), err ? 6000 : 3000);
}

async function api(url, opts = {}) {
  const o = { headers: {}, credentials: 'same-origin', ...opts };
  if (o.body && !(o.body instanceof FormData)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  const r = await fetch(url, o);
  let data = null;
  try { data = await r.json(); } catch { /* không phải JSON */ }
  if (r.status === 401 && url !== '/api/login') { showLogin(); throw new Error(data?.error || 'Chưa đăng nhập'); }
  if (r.status === 403 && data?.must_change) { location.hash = '#/account'; }
  if (!r.ok) throw new Error(data?.error || `Lỗi ${r.status}`);
  return data;
}

function modal(html, onMount) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  onMount?.(bg, close);
  return close;
}

// ---------- Đăng nhập ----------
function showLogin() {
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
    e.target.reset();
    await boot();
  } catch (err) { $('#login-error').textContent = err.message; }
});
$('#logout').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  ME = null;
  showLogin();
});

async function boot() {
  try {
    const r = await api('/api/me');
    ME = r.user; SETTINGS = r.settings;
  } catch { showLogin(); return; }
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-name').textContent = `${ME.full_name || ME.username} (${ME.role})`;
  $('#brand').textContent = SETTINGS.company_name || 'Quản lý kho';
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', ME.role !== 'admin'));
  if (ME.must_change) location.hash = '#/account';
  route();
}

// ---------- Định tuyến ----------
const routes = [
  [/^#\/dashboard$/, pageDashboard],
  [/^#\/items$/, pageItems],
  [/^#\/vouchers\/(N|X)$/, (m) => pageVouchers(m[1])],
  [/^#\/voucher\/new\/(N|X)$/, (m) => pageVoucherForm(m[1], null)],
  [/^#\/voucher\/(\d+)$/, (m) => pageVoucherForm(null, Number(m[1]))],
  [/^#\/costing$/, pageCosting],
  [/^#\/report-nxt$/, pageNXT],
  [/^#\/ledger$/, pageLedger],
  [/^#\/users$/, pageUsers],
  [/^#\/audit$/, pageAudit],
  [/^#\/settings$/, pageSettings],
  [/^#\/account$/, pageAccount],
];
async function route() {
  if (!ME) return;
  const hash = location.hash || '#/dashboard';
  $$('#nav a').forEach((a) => a.classList.toggle('active', hash.startsWith(a.getAttribute('href')) ||
    (hash.startsWith('#/voucher/') && a.getAttribute('href') === '#/vouchers/' + ($('#main').dataset.vtype || ''))));
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      const old = $('#main'); const fresh = old.cloneNode(false); old.replaceWith(fresh); // bỏ các handler của trang trước
      fresh.innerHTML = '<p class="muted">Đang tải…</p>';
      try { await fn(m); } catch (e) { $('#main').innerHTML = `<div class="alert">${esc(e.message)}</div>`; }
      return;
    }
  }
  location.hash = '#/dashboard';
}
window.addEventListener('hashchange', route);
const canWrite = () => ME && ME.role !== 'viewer';

// ---------- Tổng quan ----------
async function pageDashboard() {
  const d = await api('/api/dashboard');
  const N = d.this_month.N || { c: 0, amt: 0 }, X = d.this_month.X || { c: 0, amt: 0 };
  $('#main').innerHTML = `
    <h1>Tổng quan</h1>
    ${!d.opening_date ? `<div class="alert">Chưa thiết lập <b>ngày chốt số dư đầu kỳ (ngày A)</b>. ${ME.role === 'admin' ? '<a href="#/settings">Vào Cài đặt</a>' : 'Liên hệ quản trị.'}</div>` : ''}
    ${d.dirty ? `<div class="alert info">Có ${d.dirty} kỳ phát sinh thay đổi chưa tính lại giá xuất kho. <a href="#/costing">Tính giá xuất kho</a></div>` : ''}
    <div class="cards">
      <div class="card stat"><div class="label">Ngày chốt số dư đầu kỳ</div><div class="value">${fmtD(d.opening_date) || '—'}</div></div>
      <div class="card stat"><div class="label">Số mã vật tư hàng hóa</div><div class="value">${fmtN(d.items)}</div></div>
      <div class="card stat"><div class="label">Giá trị tồn kho hiện tại (tạm tính)</div><div class="value">${d.stock ? fmtM(d.stock.value) : '—'}</div></div>
      <div class="card stat"><div class="label">Nhập kho tháng ${d.month}</div><div class="value">${fmtM(N.amt)}</div><div class="muted">${N.c} phiếu</div></div>
      <div class="card stat"><div class="label">Doanh thu xuất bán tháng ${d.month}</div><div class="value">${fmtM(X.amt)}</div><div class="muted">${X.c} phiếu</div></div>
    </div>
    <div class="toolbar">${canWrite() ? `<a class="btn primary" href="#/voucher/new/N">+ Phiếu nhập kho</a><a class="btn primary" href="#/voucher/new/X">+ Phiếu xuất kho bán hàng</a>` : ''}</div>
    <h2>Chứng từ mới nhập</h2>
    <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Loại</th><th>Số phiếu</th><th>Đối tượng</th></tr></thead><tbody>
    ${d.recent.map((v) => `<tr><td>${fmtD(v.date)}</td><td>${TYPE[v.type]}</td><td><a href="#/voucher/${v.id}">${esc(v.number)}</a></td><td>${esc(v.partner)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Chưa có chứng từ</td></tr>'}
    </tbody></table></div>`;
}

// ---------- Danh mục vật tư & tồn đầu kỳ ----------
async function pageItems() {
  const items = await api('/api/items');
  let filter = '';
  let vatFilter = '';
  const selected = new Set(); // id các mã đang được tích chọn
  const W = canWrite();
  let list = [];
  const updateSelection = () => {
    // Chỉ giữ lựa chọn trong các dòng đang hiển thị để tránh xóa nhầm dòng bị bộ lọc ẩn
    const visible = new Set(list.map((i) => i.id));
    for (const id of [...selected]) if (!visible.has(id)) selected.delete(id);
    $$('#items-body tr[data-id]').forEach((tr) => {
      const on = selected.has(Number(tr.dataset.id));
      tr.classList.toggle('sel', on);
      const cb = $('input[data-sel]', tr); if (cb) cb.checked = on;
    });
    const all = $('#items-all');
    if (all) {
      all.checked = list.length > 0 && selected.size === list.length;
      all.indeterminate = selected.size > 0 && selected.size < list.length;
    }
    const bar = $('#items-bulk');
    if (bar) {
      bar.hidden = selected.size === 0;
      $('#items-bulk-count').textContent = selected.size.toLocaleString('vi-VN');
    }
  };
  const render = () => {
    const f = filter.toLowerCase();
    list = items.filter((i) => (!f || i.code.toLowerCase().includes(f) || i.name.toLowerCase().includes(f)) && (!vatFilter || (vatFilter === '-' ? !i.vat_rate : i.vat_rate === vatFilter)));
    const tq = list.reduce((s, i) => s + i.opening_value, 0);
    $('#items-body').innerHTML = list.map((i) => `<tr data-id="${i.id}">
      ${W ? `<td class="chk-col"><label class="chk"><input type="checkbox" data-sel="${i.id}" aria-label="Chọn ${esc(i.code)}"></label></td>` : ''}
      <td>${esc(i.code)}</td><td>${esc(i.name)}</td><td>${esc(i.unit)}</td>
      <td class="num">${i.vat_rate ? esc(vatLabel(i.vat_rate)) : '<span class="muted">—</span>'}</td>
      <td class="num">${fmtN(i.opening_qty, 3)}</td><td class="num">${fmtM(i.opening_value)}</td>
      <td class="num">${i.opening_qty ? fmtN(i.opening_value / i.opening_qty) : ''}</td>
      <td class="num">${fmtN(i.stock_qty, 3)}</td>
      <td>${canWrite() ? `<button class="btn small" data-edit="${i.id}">Sửa</button> <button class="btn small danger" data-del="${i.id}">Xóa</button>` : ''}</td></tr>`).join('')
      || `<tr><td colspan="${W ? 10 : 9}" class="muted">Chưa có mã hàng</td></tr>`;
    $('#items-foot').innerHTML = `<tr><td colspan="${W ? 6 : 5}">Tổng cộng (${list.length} mã)</td><td class="num">${fmtM(tq)}</td><td colspan="3"></td></tr>`;
    updateSelection();
  };
  $('#main').innerHTML = `
    <h1>Danh mục vật tư hàng hóa &amp; số dư đầu kỳ</h1>
    <div class="alert info">Số dư đầu kỳ là số lượng và giá trị tồn kho chốt tại <b>ngày A = ${fmtD(SETTINGS.opening_date) || '(chưa thiết lập)'}</b>. Chứng từ nhập/xuất phải có ngày sau ngày A.</div>
    <div class="toolbar">
      <input id="items-filter" placeholder="Tìm mã, tên hàng…" style="width:260px">
      <select id="items-vat"><option value="">Mọi thuế suất</option>${VAT_OPTIONS.slice(1).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}<option value="-">Chưa khai báo thuế suất</option></select>
      ${W ? `<span id="items-bulk" class="bulk-bar" hidden>Đã chọn <b id="items-bulk-count">0</b> mã
        <button class="btn danger" id="items-bulk-del" type="button">Xóa các mã đã chọn</button>
        <button class="btn" id="items-bulk-clear" type="button">Bỏ chọn</button></span>` : ''}
      <span class="spacer"></span>
      ${canWrite() ? `<button class="btn primary" id="item-add">+ Thêm mã hàng</button>
      <a class="btn" href="/api/items/template.xlsx">Tải file Excel mẫu</a>
      <label class="btn">Nhập từ Excel<input type="file" id="item-import" accept=".xlsx" hidden></label>` : ''}
    </div>
    <div class="table-wrap sticky-head"><table><thead><tr>${W ? '<th class="chk-col"><label class="chk"><input type="checkbox" id="items-all" aria-label="Chọn tất cả" title="Chọn tất cả"></label></th>' : ''}<th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th><th class="num">Thuế suất GTGT</th><th class="num">SL tồn đầu</th><th class="num">Giá trị tồn đầu</th><th class="num">Đơn giá đầu kỳ</th><th class="num">SL tồn hiện tại</th><th></th></tr></thead>
    <tbody id="items-body"></tbody><tfoot id="items-foot"></tfoot></table></div>`;
  render();
  $('#items-filter').addEventListener('input', (e) => { filter = e.target.value; render(); });
  $('#items-vat').addEventListener('change', (e) => { vatFilter = e.target.value; render(); });
  $('#items-body').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-sel]'); if (!cb) return;
    const id = Number(cb.dataset.sel);
    if (cb.checked) selected.add(id); else selected.delete(id);
    updateSelection();
  });
  $('#items-all')?.addEventListener('change', (e) => {
    if (e.target.checked) list.forEach((i) => selected.add(i.id)); else selected.clear();
    updateSelection();
  });
  $('#items-bulk-clear')?.addEventListener('click', () => { selected.clear(); updateSelection(); });
  $('#items-bulk-del')?.addEventListener('click', async () => {
    const chosen = items.filter((i) => selected.has(i.id));
    if (!chosen.length) return;
    const preview = chosen.slice(0, 8).map((i) => i.code).join(', ') + (chosen.length > 8 ? ` và ${chosen.length - 8} mã khác` : '');
    if (!confirm(`Xóa ${chosen.length} mã hàng: ${preview}? Mã đã phát sinh chứng từ sẽ được giữ lại.`)) return;
    try {
      const r = await api('/api/items/bulk-delete', { method: 'POST', body: { ids: chosen.map((i) => i.id) } });
      toast(`Đã xóa ${r.deleted.length} mã hàng${r.skipped.length ? `, giữ lại ${r.skipped.length} mã` : ''}`);
      await route();
      if (r.skipped.length) {
        modal(`<h2>Không xóa được ${r.skipped.length} mã hàng</h2>
          <div class="table-wrap"><table><thead><tr><th>Mã hàng</th><th>Tên hàng</th><th>Lý do</th></tr></thead><tbody>
          ${r.skipped.map((s) => `<tr><td>${esc(s.code)}</td><td>${esc(s.name || '')}</td><td>${esc(s.reason)}</td></tr>`).join('')}</tbody></table></div>
          <div class="actions"><button class="btn primary" data-close>Đóng</button></div>`);
      }
    } catch (err) { toast(err.message, true); }
  });
  $('#main').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) itemDialog(items.find((i) => i.id == ed.dataset.edit));
    if (del) {
      const it = items.find((i) => i.id == del.dataset.del);
      if (!confirm(`Xóa mã hàng ${it.code} - ${it.name}?`)) return;
      try { await api(`/api/items/${it.id}`, { method: 'DELETE' }); toast('Đã xóa'); route(); } catch (err) { toast(err.message, true); }
    }
  });
  $('#item-add')?.addEventListener('click', () => itemDialog(null));
  $('#item-import')?.addEventListener('change', async (e) => {
    const fd = new FormData(); fd.append('file', e.target.files[0]);
    try { const r = await api('/api/items/import', { method: 'POST', body: fd }); toast(`Đã thêm ${r.created}, cập nhật ${r.updated} mã hàng`); route(); }
    catch (err) { toast(err.message, true); }
  });
}

function itemDialog(it, onSaved) {
  modal(`<h2>${it?.id ? 'Sửa mã hàng' : 'Thêm mã hàng'}</h2>
    <form class="form-grid" id="item-form">
      <label>Mã hàng *<input name="code" required value="${esc(it?.code)}"></label>
      <label>Đơn vị tính<input name="unit" value="${esc(it?.unit)}"></label>
      <label class="wide">Tên hàng *<input name="name" required value="${esc(it?.name)}"></label>
      <label>SL tồn đầu kỳ<input name="opening_qty" type="number" step="any" value="${it?.opening_qty ?? 0}"></label>
      <label>Giá trị tồn đầu kỳ<input name="opening_value" type="number" step="any" value="${it?.opening_value ?? 0}"></label>
      <label>Thuế suất thuế GTGT<select name="vat_rate">${VAT_OPTIONS.map(([v, t]) => `<option value="${v}" ${(it?.vat_rate ?? '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Ghi chú<input name="note" value="${esc(it?.note)}"></label>
    </form>
    <div class="actions"><button class="btn" data-close>Hủy</button><button class="btn primary" id="item-save">Lưu</button></div>`, (bg, close) => {
    $('#item-save', bg).addEventListener('click', async () => {
      const body = Object.fromEntries(new FormData($('#item-form', bg)));
      try {
        const r = await api(it ? `/api/items/${it.id}` : '/api/items', { method: it ? 'PUT' : 'POST', body });
        close(); toast('Đã lưu');
        if (onSaved) onSaved({ id: it?.id || r.id, ...body }); else route();
      } catch (err) { toast(err.message, true); }
    });
  });
}

// ---------- Danh sách chứng từ ----------
async function pageVouchers(type) {
  $('#main').dataset.vtype = type;
  const now = todayStr();
  const q = JSON.parse(sessionStorage.getItem('vfilter' + type) || 'null') || { from: now.slice(0, 8) + '01', to: now, q: '' };
  $('#main').innerHTML = `
    <h1>${TYPE[type]}</h1>
    <div class="toolbar">
      Từ <input type="date" id="vf-from" value="${q.from}"> đến <input type="date" id="vf-to" value="${q.to}">
      <input id="vf-q" placeholder="Số phiếu, đối tượng, diễn giải…" value="${esc(q.q)}">
      <button class="btn" id="vf-go">Lọc</button>
      <span class="spacer"></span>
      ${canWrite() ? `<a class="btn primary" href="#/voucher/new/${type}">+ Thêm ${type === 'N' ? 'phiếu nhập' : 'phiếu xuất'} (nhập tay / từ PDF)</a>` : ''}
    </div>
    <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Số phiếu</th><th>${type === 'N' ? 'Nhà cung cấp / Người giao' : 'Khách hàng'}</th><th>Diễn giải</th>
      <th class="num">${type === 'N' ? 'Giá trị nhập' : 'Doanh thu'}</th>${type === 'X' ? '<th class="num">Giá vốn</th>' : ''}<th>Nguồn</th><th>Trạng thái kỳ</th></tr></thead>
    <tbody id="v-body"><tr><td colspan="8">Đang tải…</td></tr></tbody><tfoot id="v-foot"></tfoot></table></div>`;
  const load = async () => {
    const f = { from: $('#vf-from').value, to: $('#vf-to').value, q: $('#vf-q').value };
    sessionStorage.setItem('vfilter' + type, JSON.stringify(f));
    const rows = await api(`/api/vouchers?type=${type}&from=${f.from}&to=${f.to}&q=${encodeURIComponent(f.q)}`);
    let ta = 0, tc = 0;
    $('#v-body').innerHTML = rows.map((v) => {
      ta += v.total_amount; tc += v.total_cost || 0;
      const st = v.locked ? '<span class="badge">Đã khóa sổ</span>' : v.period_status === 'computed' ? '<span class="badge ok">Đã tính giá</span>' : '<span class="badge warn">Chưa tính giá</span>';
      return `<tr><td>${fmtD(v.date)}</td><td><a href="#/voucher/${v.id}">${esc(v.number)}</a></td><td>${esc(v.partner)}</td><td>${esc(v.description)}</td>
        <td class="num">${fmtM(v.total_amount)}</td>${type === 'X' ? `<td class="num">${v.uncosted ? '<span class="muted">chưa tính</span>' : fmtM(v.total_cost)}</td>` : ''}
        <td>${v.source === 'pdf' ? 'PDF' : 'Nhập tay'}</td><td>${st}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">Không có chứng từ</td></tr>';
    $('#v-foot').innerHTML = `<tr><td colspan="4">Tổng cộng (${rows.length} phiếu)</td><td class="num">${fmtM(ta)}</td>${type === 'X' ? `<td class="num">${fmtM(tc)}</td>` : ''}<td colspan="2"></td></tr>`;
  };
  $('#vf-go').addEventListener('click', () => load().catch((e) => toast(e.message, true)));
  await load();
}

// ---------- Form chứng từ ----------
async function pageVoucherForm(type, id) {
  let v;
  if (id) { v = await api(`/api/vouchers/${id}`); type = v.type; }
  else {
    const { number } = await api(`/api/vouchers/next-number?type=${type}`);
    v = { type, number, date: todayStr(), partner: '', address: '', description: type === 'X' ? 'Xuất kho bán hàng' : 'Nhập kho mua hàng', ref_no: '', lines: [], source: 'manual' };
  }
  $('#main').dataset.vtype = type;
  let items = await api(`/api/items?date=${v.date}&exclude=${id || 0}`);
  const editable = canWrite() && !v.locked;
  let lines = v.lines.map((l) => ({ item_id: l.item_id, qty: l.qty, unit_price: l.unit_price, amount: l.amount, cost_price: l.cost_price, cost_amount: l.cost_amount }));
  if (!lines.length) lines.push({});
  let unmatched = [];
  let state = { attachment: v.attachment || null, source: v.source };
  const X = type === 'X';

  $('#main').innerHTML = `
    <div class="toolbar"><a class="btn" href="#/vouchers/${type}">← Danh sách</a><h1 style="margin:0">${TYPE[type]} ${id ? esc(v.number) : '(mới)'}</h1>
      <span class="spacer"></span>
      ${id ? `<button class="btn" id="v-print">In phiếu</button>` : ''}
      ${state.attachment ? `<a class="btn" target="_blank" href="/api/attachments/${state.attachment}">Xem PDF gốc</a>` : ''}
    </div>
    ${v.locked ? '<div class="alert">Kỳ kế toán của chứng từ này đã khóa sổ – chỉ xem.</div>' : ''}
    ${editable ? `<div class="dropzone" id="pdf-drop">Kéo thả hoặc <b>bấm để chọn file PDF</b> ${X ? 'phiếu xuất kho / hóa đơn bán hàng' : 'phiếu nhập kho'} – hệ thống sẽ đọc và điền sẵn nội dung bên dưới
      <input type="file" id="pdf-file" accept="application/pdf" hidden></div>` : ''}
    <div id="pdf-msg" style="margin-top:10px"></div>
    <div class="card">
      <div class="form-grid" id="v-head">
        <label>Số phiếu<input name="number" value="${esc(v.number)}"></label>
        <label>Ngày chứng từ<input name="date" type="date" value="${v.date}"></label>
        <label>${X ? 'Khách hàng' : 'Nhà cung cấp / Người giao hàng'}<input name="partner" value="${esc(v.partner)}"></label>
        <label>Số hóa đơn / chứng từ gốc<input name="ref_no" value="${esc(v.ref_no)}"></label>
        <label class="wide">Địa chỉ<input name="address" value="${esc(v.address)}"></label>
        <label class="wide">${X ? 'Lý do xuất' : 'Diễn giải'}<input name="description" value="${esc(v.description)}"></label>
      </div>
    </div>
    <div id="unmatched"></div>
    <div class="table-wrap"><table class="lines"><thead><tr><th>#</th><th style="min-width:150px">Mã hàng</th><th>Tên hàng</th><th>ĐVT</th>
      ${X ? '<th class="num">Tồn kho</th>' : ''}<th class="num">Số lượng</th><th class="num">${X ? 'Đơn giá bán' : 'Đơn giá nhập'}</th><th class="num">${X ? 'Doanh thu' : 'Thành tiền'}</th>
      ${X ? '<th class="num">Đơn giá vốn</th><th class="num">Tiền vốn</th>' : ''}<th></th></tr></thead>
      <tbody id="l-body"></tbody><tfoot id="l-foot"></tfoot></table></div>
    <datalist id="dl-items">${items.map((i) => `<option value="${esc(i.code)}">${esc(i.name)}</option>`).join('')}</datalist>
    <div class="toolbar" style="margin-top:12px">
      ${editable ? `<button class="btn" id="l-add">+ Thêm dòng</button>` : ''}
      <span class="spacer"></span>
      ${editable && id ? `<button class="btn danger" id="v-del">Xóa chứng từ</button>` : ''}
      ${editable ? `<button class="btn primary" id="v-save">Lưu chứng từ</button>` : ''}
    </div>
    ${X ? `<p class="muted">Giá vốn được tính theo phương pháp <b>bình quân gia quyền cuối kỳ</b> (theo tháng) khi chạy <a href="#/costing">Tính giá xuất kho</a>. ${v.period_status === 'dirty' && id ? '<span class="badge warn">Kỳ này có thay đổi, cần tính lại giá</span>' : ''}</p>` : ''}
    ${id ? `<p class="muted">Tạo bởi ${esc(v.created_by)} lúc ${esc(v.created_at)}${v.updated_by ? ` · Sửa lần cuối bởi ${esc(v.updated_by)} lúc ${esc(v.updated_at)}` : ''}</p>` : ''}`;

  const byId = (iid) => items.find((i) => i.id == iid);
  const dis = editable ? '' : 'disabled';
  function renderLines() {
    $('#l-body').innerHTML = lines.map((l, i) => {
      const it = byId(l.item_id);
      const low = X && it && Number(l.qty) > it.stock_qty + 1e-9;
      return `<tr data-i="${i}">
        <td>${i + 1}</td>
        <td><input list="dl-items" data-f="code" value="${esc(it?.code || l._code || '')}" ${dis} placeholder="Gõ mã…"></td>
        <td>${esc(it?.name || '')}</td><td>${esc(it?.unit || '')}</td>
        ${X ? `<td class="num" style="${low ? 'color:var(--danger);font-weight:600' : ''}">${it ? fmtN(it.stock_qty, 3) : ''}</td>` : ''}
        <td><input type="number" step="any" data-f="qty" value="${l.qty ?? ''}" ${dis}></td>
        <td><input type="number" step="any" data-f="unit_price" value="${l.unit_price ?? ''}" ${dis}></td>
        <td><input type="number" step="any" data-f="amount" value="${l.amount ?? ''}" ${dis}></td>
        ${X ? `<td class="num">${l.cost_price != null ? fmtN(l.cost_price) : ''}</td><td class="num">${l.cost_amount != null ? fmtM(l.cost_amount) : ''}</td>` : ''}
        <td>${editable ? `<button class="btn small danger" data-rm="${i}">✕</button>` : ''}</td></tr>`;
    }).join('');
    renderFoot();
  }
  function renderFoot() {
    const tq = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const ta = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const tc = lines.reduce((s, l) => s + (Number(l.cost_amount) || 0), 0);
    $('#l-foot').innerHTML = `<tr><td colspan="${X ? 5 : 4}">Tổng cộng</td><td class="num">${fmtN(tq, 3)}</td><td></td><td class="num">${fmtM(ta)}</td>${X ? `<td></td><td class="num">${fmtM(tc)}</td>` : ''}<td></td></tr>`;
  }
  function renderUnmatched() {
    $('#unmatched').innerHTML = unmatched.length ? `<div class="alert"><b>Dòng hàng trong PDF chưa có mã trong danh mục:</b>
      <table style="margin-top:6px"><tr><th>Nội dung</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th><th></th></tr>
      ${unmatched.map((u, i) => `<tr><td>${esc(u.text)}</td><td class="num">${fmtN(u.qty, 3)}</td><td class="num">${fmtN(u.unit_price)}</td><td class="num">${fmtM(u.amount)}</td>
      <td><select data-map="${i}"><option value="">-- Chọn mã có sẵn --</option>${items.map((it) => `<option value="${it.id}">${esc(it.code)} - ${esc(it.name)}</option>`).join('')}</select>
      <button class="btn small" data-newitem="${i}">+ Tạo mã mới</button></td></tr>`).join('')}</table></div>` : '';
  }
  renderLines();

  $('#l-body').addEventListener('input', (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const l = lines[tr.dataset.i]; const f = e.target.dataset.f;
    if (f === 'qty' || f === 'unit_price') {
      l[f] = e.target.value;
      l.amount = Math.round((Number(l.qty) || 0) * (Number(l.unit_price) || 0));
      $('[data-f=amount]', tr).value = l.amount;
      renderFoot();
    } else if (f === 'amount') { l.amount = e.target.value; renderFoot(); }
  });
  $('#l-body').addEventListener('change', (e) => {
    if (e.target.dataset.f !== 'code') return;
    const l = lines[e.target.closest('tr').dataset.i];
    const it = items.find((i) => i.code.toLowerCase() === e.target.value.trim().toLowerCase());
    if (it) { l.item_id = it.id; delete l._code; } else { l.item_id = null; l._code = e.target.value; if (e.target.value) toast(`Mã "${e.target.value}" không có trong danh mục`, true); }
    renderLines();
  });
  $('#l-body').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { lines.splice(Number(rm.dataset.rm), 1); if (!lines.length) lines.push({}); renderLines(); }
  });
  $('#l-add')?.addEventListener('click', () => { lines.push({}); renderLines(); });
  $('#unmatched').addEventListener('change', (e) => {
    const s = e.target.closest('[data-map]'); if (!s || !s.value) return;
    const u = unmatched[s.dataset.map];
    addLine({ item_id: Number(s.value), qty: u.qty, unit_price: u.unit_price, amount: u.amount });
    unmatched.splice(Number(s.dataset.map), 1); renderUnmatched(); renderLines();
  });
  $('#unmatched').addEventListener('click', (e) => {
    const b = e.target.closest('[data-newitem]'); if (!b) return;
    const idx = Number(b.dataset.newitem); const u = unmatched[idx];
    const parts = u.text.split(' | ');
    itemDialog({ code: parts[1] && parts[1].length < 25 ? parts[1] : '', name: parts[0], unit: parts[2] || '', opening_qty: 0, opening_value: 0, id: null, _new: true }, null);
    // Gắn lại handler lưu để tạo mới (không phải sửa)
    const bg = $('.modal-bg:last-child'); const save = $('#item-save', bg);
    const fresh = save.cloneNode(true); save.replaceWith(fresh);
    fresh.addEventListener('click', async () => {
      const body = Object.fromEntries(new FormData($('#item-form', bg)));
      try {
        const r = await api('/api/items', { method: 'POST', body });
        bg.remove(); toast('Đã tạo mã hàng ' + body.code);
        items = await api(`/api/items?date=${$('[name=date]').value}&exclude=${id || 0}`);
        $('#dl-items').innerHTML = items.map((i) => `<option value="${esc(i.code)}">${esc(i.name)}</option>`).join('');
        addLine({ item_id: r.id, qty: u.qty, unit_price: u.unit_price, amount: u.amount });
        unmatched.splice(idx, 1); renderUnmatched(); renderLines();
      } catch (err) { toast(err.message, true); }
    });
  });
  function addLine(l) {
    const empty = lines.findIndex((x) => !x.item_id && !x._code);
    if (empty >= 0) lines[empty] = l; else lines.push(l);
  }
  $('[name=date]').addEventListener('change', async (e) => {
    items = await api(`/api/items?date=${e.target.value}&exclude=${id || 0}`); renderLines();
  });

  // Đọc PDF
  const drop = $('#pdf-drop');
  if (drop) {
    const handle = async (file) => {
      if (!file) return;
      $('#pdf-msg').innerHTML = '<div class="alert info">Đang đọc PDF…</div>';
      const fd = new FormData(); fd.append('file', file);
      try {
        const p = await api('/api/pdf/parse', { method: 'POST', body: fd });
        state.attachment = p.attachment; state.source = 'pdf';
        if (p.error) { $('#pdf-msg').innerHTML = `<div class="alert">${esc(p.error)}</div>`; return; }
        const head = $('#v-head');
        if (p.number) head.querySelector('[name=number]').value = p.number;
        if (p.date) head.querySelector('[name=date]').value = p.date;
        for (const k of ['partner', 'address', 'description', 'ref_no']) if (p[k]) head.querySelector(`[name=${k}]`).value = p[k];
        items = await api(`/api/items?date=${head.querySelector('[name=date]').value}&exclude=${id || 0}`);
        lines = p.lines.map((l) => ({ item_id: l.item_id, qty: l.qty, unit_price: l.unit_price, amount: l.amount }));
        if (!lines.length) lines.push({});
        unmatched = p.unmatched || [];
        const warns = [...p.warnings];
        if (p.type && p.type !== type) warns.unshift(`File có vẻ là ${TYPE[p.type]}, trong khi bạn đang tạo ${TYPE[type]}.`);
        $('#pdf-msg').innerHTML = `<div class="alert info">Đã đọc <b>${esc(p.filename)}</b>: nhận diện ${p.lines.length} dòng hàng. Vui lòng <b>kiểm tra lại</b> trước khi lưu.
          ${warns.length ? `<ul>${warns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
          <details style="margin-top:6px"><summary>Xem nội dung chữ đọc được từ PDF</summary><pre style="white-space:pre-wrap;font-size:12px;max-height:300px;overflow:auto">${esc(p.text)}</pre></details></div>`;
        renderUnmatched(); renderLines();
      } catch (err) { $('#pdf-msg').innerHTML = `<div class="alert">${esc(err.message)}</div>`; }
    };
    drop.addEventListener('click', () => $('#pdf-file').click());
    $('#pdf-file').addEventListener('change', (e) => handle(e.target.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); handle(e.dataTransfer.files[0]); });
  }

  $('#v-save')?.addEventListener('click', async () => {
    const head = Object.fromEntries($$('#v-head input').map((i) => [i.name, i.value]));
    const bad = lines.find((l) => l._code);
    if (bad) return toast(`Mã "${bad._code}" không có trong danh mục`, true);
    if (unmatched.length && !confirm(`Còn ${unmatched.length} dòng hàng trong PDF chưa gán mã. Vẫn lưu?`)) return;
    const body = { ...head, type, source: state.source, attachment: state.attachment, lines: lines.filter((l) => l.item_id) };
    try {
      const r = await api(id ? `/api/vouchers/${id}` : '/api/vouchers', { method: id ? 'PUT' : 'POST', body });
      toast('Đã lưu chứng từ');
      if (id) route(); else location.hash = `#/voucher/${r.id}`;
    } catch (err) { toast(err.message, true); }
  });
  $('#v-del')?.addEventListener('click', async () => {
    if (!confirm(`Xóa ${TYPE[type]} ${v.number}?`)) return;
    try { await api(`/api/vouchers/${id}`, { method: 'DELETE' }); toast('Đã xóa'); location.hash = `#/vouchers/${type}`; } catch (err) { toast(err.message, true); }
  });
  $('#v-print')?.addEventListener('click', () => printVoucher(v));
}

function printVoucher(v) {
  const X = v.type === 'X';
  const d = v.date.split('-');
  const totalAmt = v.lines.reduce((s, l) => s + l.amount, 0);
  const totalCost = v.lines.reduce((s, l) => s + (l.cost_amount || 0), 0);
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(v.number)}</title><style>
    body{font:13px "Times New Roman",serif;margin:30px} table{border-collapse:collapse;width:100%} td,th{border:1px solid #000;padding:4px 6px} th{background:#eee}
    .r{text-align:right}.c{text-align:center}.sig{display:flex;justify-content:space-around;margin-top:30px;text-align:center}.sig div{width:22%}
  </style></head><body>
    <div><b>${esc(SETTINGS.company_name || '')}</b><br>${esc(SETTINGS.company_address || '')}</div>
    <h2 class="c" style="margin:18px 0 4px">${X ? 'PHIẾU XUẤT KHO BÁN HÀNG' : 'PHIẾU NHẬP KHO'}</h2>
    <div class="c">Ngày ${d[2]} tháng ${d[1]} năm ${d[0]} &nbsp;&nbsp; Số: <b>${esc(v.number)}</b></div><br>
    <div>${X ? 'Khách hàng' : 'Họ tên người giao hàng / Nhà cung cấp'}: ${esc(v.partner)}</div>
    <div>Địa chỉ: ${esc(v.address)}</div>
    <div>${X ? 'Lý do xuất' : 'Diễn giải'}: ${esc(v.description)}</div>
    ${v.ref_no ? `<div>Theo chứng từ số: ${esc(v.ref_no)}</div>` : ''}<br>
    <table><tr><th>STT</th><th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th><th>Số lượng</th>
      ${X ? '<th>Đơn giá vốn</th><th>Tiền vốn</th><th>Đơn giá bán</th><th>Doanh thu</th>' : '<th>Đơn giá</th><th>Thành tiền</th>'}</tr>
    ${v.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${esc(l.code)}</td><td>${esc(l.name)}</td><td>${esc(l.unit)}</td><td class="r">${fmtN(l.qty, 3)}</td>
      ${X ? `<td class="r">${l.cost_price != null ? fmtN(l.cost_price) : ''}</td><td class="r">${l.cost_amount != null ? fmtM(l.cost_amount) : ''}</td><td class="r">${fmtN(l.unit_price)}</td><td class="r">${fmtM(l.amount)}</td>`
        : `<td class="r">${fmtN(l.unit_price)}</td><td class="r">${fmtM(l.amount)}</td>`}</tr>`).join('')}
    <tr><td colspan="5" class="c"><b>Cộng</b></td>${X ? `<td></td><td class="r"><b>${fmtM(totalCost)}</b></td><td></td><td class="r"><b>${fmtM(totalAmt)}</b></td>` : `<td></td><td class="r"><b>${fmtM(totalAmt)}</b></td>`}</tr></table>
    <div class="sig"><div><b>Người lập phiếu</b><br><i>(Ký, họ tên)</i></div><div><b>${X ? 'Người nhận hàng' : 'Người giao hàng'}</b><br><i>(Ký, họ tên)</i></div>
      <div><b>Thủ kho</b><br><i>(Ký, họ tên)</i></div><div><b>Kế toán trưởng</b><br><i>(Ký, họ tên)</i></div></div>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// ---------- Tính giá xuất kho ----------
async function pageCosting() {
  const periods = await api('/api/periods');
  $('#main').innerHTML = `
    <h1>Tính giá xuất kho – Bình quân gia quyền cuối kỳ</h1>
    <div class="alert info">
      Đơn giá xuất kho mỗi mã hàng trong tháng = <b>(Giá trị tồn đầu kỳ + Giá trị nhập trong kỳ) / (SL tồn đầu kỳ + SL nhập trong kỳ)</b>.<br>
      Khi tính cho một tháng, hệ thống tự tính lần lượt tất cả các tháng trước đó (tồn cuối tháng trước là tồn đầu tháng sau) và ghi giá vốn vào từng phiếu xuất.
      Kỳ đã tính giá có thể <b>khóa sổ</b> để không ai sửa chứng từ.
    </div>
    <div class="table-wrap"><table><thead><tr><th>Kỳ</th><th class="num">Phiếu nhập</th><th class="num">Phiếu xuất</th><th>Trạng thái</th><th>Tính lần cuối</th><th>Khóa sổ</th><th></th></tr></thead><tbody>
    ${periods.map((p) => `<tr><td><b>${p.month.split('-').reverse().join('/')}</b></td><td class="num">${p.receipts}</td><td class="num">${p.issues}</td>
      <td>${p.status === 'computed' ? '<span class="badge ok">Đã tính giá</span>' : '<span class="badge warn">Cần tính lại</span>'}</td>
      <td class="muted">${p.computed_at ? `${esc(p.computed_at)} – ${esc(p.computed_by)}` : ''}</td>
      <td>${p.locked ? '<span class="badge danger">Đã khóa</span>' : ''}</td>
      <td>${canWrite() ? `<button class="btn small primary" data-run="${p.month}">Tính giá đến kỳ này</button>` : ''}
        ${ME.role === 'admin' ? `<button class="btn small" data-lock="${p.month}" data-locked="${p.locked ? 1 : 0}">${p.locked ? 'Mở khóa' : 'Khóa sổ'}</button>` : ''}
        <a class="btn small" href="#/report-nxt" data-rep="${p.month}">Xem NXT</a></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Chưa thiết lập ngày chốt số dư</td></tr>'}
    </tbody></table></div>`;
  $('#main').addEventListener('click', async (e) => {
    const run = e.target.closest('[data-run]'), lock = e.target.closest('[data-lock]'), rep = e.target.closest('[data-rep]');
    if (rep) sessionStorage.setItem('nxt', JSON.stringify({ from: rep.dataset.rep, to: rep.dataset.rep }));
    try {
      if (run) { const r = await api('/api/costing/run', { method: 'POST', body: { month: run.dataset.run } }); toast(`Đã tính giá ${r.months.length} kỳ, ${r.lines} dòng xuất kho`); route(); }
      if (lock) { await api(`/api/periods/${lock.dataset.lock}/lock`, { method: 'POST', body: { locked: lock.dataset.locked !== '1' } }); toast('Đã cập nhật'); route(); }
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- Báo cáo NXT ----------
async function pageNXT() {
  const cur = todayStr().slice(0, 7);
  const q = JSON.parse(sessionStorage.getItem('nxt') || 'null') || { from: cur, to: cur };
  $('#main').innerHTML = `
    <h1>Tổng hợp nhập – xuất – tồn kho</h1>
    <div class="toolbar">Từ kỳ <input type="month" id="r-from" value="${q.from}"> đến kỳ <input type="month" id="r-to" value="${q.to}">
      <label><input type="checkbox" id="r-hide"> Ẩn mã không phát sinh</label>
      <button class="btn primary" id="r-go">Xem</button><span class="spacer"></span><button class="btn" id="r-xlsx">Xuất Excel</button><button class="btn" onclick="print()">In</button></div>
    <div id="r-out"></div>`;
  const load = async () => {
    const f = { from: $('#r-from').value, to: $('#r-to').value };
    sessionStorage.setItem('nxt', JSON.stringify(f));
    const r = await api(`/api/reports/nxt?from=${f.from}&to=${f.to}`);
    const hide = $('#r-hide').checked;
    const rows = r.rows.filter((x) => !hide || x.open_qty || x.in_qty || x.out_qty || x.close_qty);
    const t = rows.reduce((a, x) => { ['open_val', 'in_val', 'out_val', 'close_val'].forEach((k) => { a[k] += x[k]; }); return a; }, { open_val: 0, in_val: 0, out_val: 0, close_val: 0 });
    $('#r-out').innerHTML = `<p class="muted">Kỳ ${r.from} → ${r.to}. Giá xuất: bình quân gia quyền cuối kỳ (tính trực tiếp theo dữ liệu hiện tại).</p>
    <div class="table-wrap"><table><thead><tr><th rowspan="2">Mã hàng</th><th rowspan="2">Tên hàng</th><th rowspan="2">ĐVT</th>
      <th colspan="2" class="num" style="text-align:center">Tồn đầu kỳ</th><th colspan="2" style="text-align:center">Nhập trong kỳ</th><th colspan="2" style="text-align:center">Xuất trong kỳ</th>
      <th colspan="2" style="text-align:center">Tồn cuối kỳ</th><th rowspan="2" class="num">Đơn giá BQ</th></tr>
      <tr>${'<th class="num">SL</th><th class="num">Giá trị</th>'.repeat(4)}</tr></thead><tbody>
    ${rows.map((x) => `<tr><td><a href="#/ledger" data-led="${x.item_id}">${esc(x.code)}</a></td><td>${esc(x.name)}</td><td>${esc(x.unit)}</td>
      <td class="num">${fmtN(x.open_qty, 3)}</td><td class="num">${fmtM(x.open_val)}</td><td class="num">${fmtN(x.in_qty, 3)}</td><td class="num">${fmtM(x.in_val)}</td>
      <td class="num">${fmtN(x.out_qty, 3)}</td><td class="num">${fmtM(x.out_val)}</td><td class="num">${fmtN(x.close_qty, 3)}</td><td class="num">${fmtM(x.close_val)}</td>
      <td class="num">${fmtN(x.avg)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="3">Tổng cộng</td><td></td><td class="num">${fmtM(t.open_val)}</td><td></td><td class="num">${fmtM(t.in_val)}</td><td></td><td class="num">${fmtM(t.out_val)}</td><td></td><td class="num">${fmtM(t.close_val)}</td><td></td></tr></tfoot></table></div>`;
  };
  $('#r-go').addEventListener('click', () => load().catch((e) => toast(e.message, true)));
  $('#r-hide').addEventListener('change', () => load().catch((e) => toast(e.message, true)));
  $('#r-xlsx').addEventListener('click', () => { location.href = `/api/reports/nxt.xlsx?from=${$('#r-from').value}&to=${$('#r-to').value}`; });
  $('#r-out').addEventListener('click', (e) => {
    const a = e.target.closest('[data-led]');
    if (a) sessionStorage.setItem('ledger', JSON.stringify({ item_id: a.dataset.led, from: $('#r-from').value, to: $('#r-to').value }));
  });
  await load();
}

// ---------- Sổ chi tiết vật tư ----------
async function pageLedger() {
  const items = await api('/api/items');
  const cur = todayStr().slice(0, 7);
  const q = JSON.parse(sessionStorage.getItem('ledger') || 'null') || { item_id: items[0]?.id, from: cur, to: cur };
  $('#main').innerHTML = `<h1>Sổ chi tiết vật tư hàng hóa</h1>
    <div class="toolbar"><select id="lg-item">${items.map((i) => `<option value="${i.id}" ${i.id == q.item_id ? 'selected' : ''}>${esc(i.code)} - ${esc(i.name)}</option>`).join('')}</select>
      Từ kỳ <input type="month" id="lg-from" value="${q.from}"> đến <input type="month" id="lg-to" value="${q.to}"> <button class="btn primary" id="lg-go">Xem</button>
      <span class="spacer"></span><button class="btn" onclick="print()">In</button></div><div id="lg-out"></div>`;
  const load = async () => {
    const f = { item_id: $('#lg-item').value, from: $('#lg-from').value, to: $('#lg-to').value };
    if (!f.item_id) return;
    sessionStorage.setItem('ledger', JSON.stringify(f));
    const r = await api(`/api/reports/ledger?item_id=${f.item_id}&from=${f.from}&to=${f.to}`);
    $('#lg-out').innerHTML = `<p><b>${esc(r.item.code)} – ${esc(r.item.name)}</b> (ĐVT: ${esc(r.item.unit)})</p>
      <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Số phiếu</th><th>Diễn giải</th><th class="num">Đơn giá</th>
        <th class="num">SL nhập</th><th class="num">GT nhập</th><th class="num">SL xuất</th><th class="num">GT xuất</th><th class="num">SL tồn</th><th class="num">GT tồn</th></tr></thead><tbody>
      <tr><td colspan="8"><i>Số dư đầu kỳ</i></td><td class="num">${fmtN(r.open_qty, 3)}</td><td class="num">${fmtM(r.open_val)}</td></tr>
      ${r.lines.map((l) => `<tr><td>${fmtD(l.date)}</td><td><a href="#/voucher/${l.voucher_id}">${esc(l.number)}</a></td><td>${esc(l.partner || l.description)}</td>
        <td class="num">${fmtN(l.price)}</td>
        ${l.type === 'N' ? `<td class="num">${fmtN(l.qty, 3)}</td><td class="num">${fmtM(l.value)}</td><td></td><td></td>` : `<td></td><td></td><td class="num">${fmtN(l.qty, 3)}</td><td class="num">${fmtM(l.value)}</td>`}
        <td class="num">${fmtN(l.bal_qty, 3)}</td><td class="num">${fmtM(l.bal_val)}</td></tr>`).join('')}
      </tbody></table></div>
      <h2>Đơn giá bình quân từng kỳ</h2>
      <div class="table-wrap"><table><thead><tr><th>Kỳ</th><th class="num">SL tồn đầu</th><th class="num">GT tồn đầu</th><th class="num">SL nhập</th><th class="num">GT nhập</th><th class="num">Đơn giá BQ</th><th class="num">SL xuất</th><th class="num">GT xuất</th><th class="num">SL tồn cuối</th><th class="num">GT tồn cuối</th></tr></thead><tbody>
      ${r.months.map((m) => `<tr><td>${m.month}</td><td class="num">${fmtN(m.open_qty, 3)}</td><td class="num">${fmtM(m.open_val)}</td><td class="num">${fmtN(m.in_qty, 3)}</td><td class="num">${fmtM(m.in_val)}</td>
        <td class="num"><b>${fmtN(m.avg)}</b></td><td class="num">${fmtN(m.out_qty, 3)}</td><td class="num">${fmtM(m.out_val)}</td><td class="num">${fmtN(m.close_qty, 3)}</td><td class="num">${fmtM(m.close_val)}</td></tr>`).join('')}
      </tbody></table></div>`;
  };
  $('#lg-go').addEventListener('click', () => load().catch((e) => toast(e.message, true)));
  if (items.length) await load();
}

// ---------- Người dùng ----------
async function pageUsers() {
  const users = await api('/api/users');
  const sessions = await api('/api/sessions');
  const ROLE = { admin: 'Quản trị', user: 'Kế toán / thủ kho', viewer: 'Chỉ xem' };
  $('#main').innerHTML = `<h1>Người dùng</h1>
    <div class="toolbar"><span class="spacer"></span><button class="btn primary" id="u-add">+ Thêm người dùng</button></div>
    <div class="table-wrap"><table><thead><tr><th>Tên đăng nhập</th><th>Họ tên</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th class="num">Phiên đang mở</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.full_name)}</td><td>${ROLE[u.role]}</td>
      <td>${u.active ? '<span class="badge ok">Hoạt động</span>' : '<span class="badge danger">Đã khóa</span>'}</td><td>${esc(u.last_login || '')}</td><td class="num">${u.active_sessions}</td>
      <td><button class="btn small" data-uedit="${u.id}">Sửa</button> <button class="btn small" data-upw="${u.id}">Đặt lại mật khẩu</button>
      <button class="btn small ${u.active ? 'danger' : ''}" data-uact="${u.id}" data-active="${u.active}">${u.active ? 'Khóa' : 'Mở khóa'}</button></td></tr>`).join('')}
    </tbody></table></div>
    <h2>Phiên đăng nhập đang hoạt động</h2>
    <div class="table-wrap"><table><thead><tr><th>Người dùng</th><th>Đăng nhập lúc</th><th>Hoạt động gần nhất</th><th>IP</th><th>Thiết bị / trình duyệt</th></tr></thead><tbody>
    ${sessions.map((s) => `<tr><td>${esc(s.username)}</td><td>${esc(s.created_at)}</td><td>${esc(s.last_seen)}</td><td>${esc(s.ip)}</td><td class="muted" style="font-size:12px">${esc(s.ua)}</td></tr>`).join('')}
    </tbody></table></div>`;
  const form = (u) => `<form class="form-grid" id="u-form">
      ${u ? '' : '<label>Tên đăng nhập *<input name="username" required></label><label>Mật khẩu ban đầu *<input name="password" type="password" required></label>'}
      <label>Họ tên<input name="full_name" value="${esc(u?.full_name)}"></label>
      <label>Vai trò<select name="role">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${u?.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></form>
      <p class="muted">Mật khẩu tối thiểu 8 ký tự, gồm chữ và số. Người dùng phải đổi mật khẩu khi đăng nhập lần đầu.</p>`;
  const save = (u) => modal(`<h2>${u ? 'Sửa' : 'Thêm'} người dùng</h2>${form(u)}<div class="actions"><button class="btn" data-close>Hủy</button><button class="btn primary" id="u-save">Lưu</button></div>`, (bg, close) => {
    $('#u-save', bg).addEventListener('click', async () => {
      const body = Object.fromEntries(new FormData($('#u-form', bg)));
      try { await api(u ? `/api/users/${u.id}` : '/api/users', { method: u ? 'PUT' : 'POST', body }); close(); toast('Đã lưu'); route(); } catch (err) { toast(err.message, true); }
    });
  });
  $('#u-add').addEventListener('click', () => save(null));
  $('#main').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-uedit]'), pw = e.target.closest('[data-upw]'), act = e.target.closest('[data-uact]');
    try {
      if (ed) save(users.find((u) => u.id == ed.dataset.uedit));
      if (pw) {
        const p = prompt('Nhập mật khẩu mới (≥ 8 ký tự, gồm chữ và số):');
        if (p) { await api(`/api/users/${pw.dataset.upw}`, { method: 'PUT', body: { password: p } }); toast('Đã đặt lại mật khẩu'); }
      }
      if (act) { await api(`/api/users/${act.dataset.uact}`, { method: 'PUT', body: { active: act.dataset.active !== '1' } }); route(); }
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- Nhật ký truy cập ----------
async function pageAudit() {
  const users = await api('/api/users');
  $('#main').innerHTML = `<h1>Nhật ký truy cập &amp; thao tác</h1>
    <div class="toolbar">
      <select id="a-user"><option value="">Tất cả người dùng</option>${users.map((u) => `<option>${esc(u.username)}</option>`).join('')}</select>
      <select id="a-action"><option value="">Tất cả thao tác</option>${Object.entries(ACTIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      Từ <input type="date" id="a-from"> đến <input type="date" id="a-to"> <input id="a-q" placeholder="Nội dung, IP…">
      <button class="btn primary" id="a-go">Lọc</button></div>
    <div id="a-out"></div>`;
  let page = 1;
  const load = async () => {
    const p = new URLSearchParams({ username: $('#a-user').value, action: $('#a-action').value, from: $('#a-from').value, to: $('#a-to').value, q: $('#a-q').value, page });
    const r = await api('/api/audit?' + p);
    const pages = Math.max(1, Math.ceil(r.total / 100));
    $('#a-out').innerHTML = `<p class="muted">${r.total} bản ghi · trang ${r.page}/${pages}
      ${page > 1 ? '<button class="btn small" data-pg="-1">‹ Trước</button>' : ''} ${page < pages ? '<button class="btn small" data-pg="1">Sau ›</button>' : ''}</p>
      <div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Người dùng</th><th>Thao tác</th><th>Chi tiết</th><th>IP</th><th>Trình duyệt</th></tr></thead><tbody>
      ${r.rows.map((a) => `<tr><td style="white-space:nowrap">${esc(a.ts)}</td><td>${esc(a.username || '')}</td>
        <td><span class="badge ${a.action === 'LOGIN_FAIL' ? 'danger' : a.action === 'LOGIN_OK' ? 'ok' : ''}">${ACTIONS[a.action] || a.action}</span></td>
        <td style="max-width:480px">${esc(a.detail)}</td><td>${esc(a.ip)}</td><td class="muted" style="font-size:11px;max-width:220px">${esc(a.ua)}</td></tr>`).join('')}
      </tbody></table></div>`;
  };
  $('#a-go').addEventListener('click', () => { page = 1; load(); });
  $('#a-out').addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (b) { page += Number(b.dataset.pg); load(); } });
  await load();
}

// ---------- Cài đặt ----------
async function pageSettings() {
  const s = await api('/api/settings');
  $('#main').innerHTML = `<h1>Cài đặt</h1><div class="card"><form class="form-grid" id="s-form">
    <label class="wide">Tên đơn vị<input name="company_name" value="${esc(s.company_name)}"></label>
    <label class="wide">Địa chỉ<input name="company_address" value="${esc(s.company_address)}"></label>
    <label>Mã số thuế<input name="company_tax" value="${esc(s.company_tax)}"></label>
    <label>Ngày chốt số dư đầu kỳ (ngày A)<input type="date" name="opening_date" value="${esc(s.opening_date || '')}"></label>
    </form><p class="muted">Số dư tồn kho nhập trong danh mục vật tư là số dư cuối ngày A. Mọi chứng từ phải có ngày sau ngày A. Không đổi được ngày A khi đã có chứng từ trước ngày đó hoặc đã khóa sổ.</p>
    <button class="btn primary" id="s-save">Lưu cài đặt</button></div>`;
  $('#s-save').addEventListener('click', async () => {
    const body = Object.fromEntries(new FormData($('#s-form')));
    if (!body.opening_date) delete body.opening_date;
    try { await api('/api/settings', { method: 'PUT', body }); toast('Đã lưu'); await boot(); } catch (err) { toast(err.message, true); }
  });
}

// ---------- Đổi mật khẩu ----------
async function pageAccount() {
  $('#main').innerHTML = `<h1>Đổi mật khẩu</h1>
    ${ME.must_change ? '<div class="alert">Bạn cần đổi mật khẩu trước khi sử dụng hệ thống.</div>' : ''}
    <div class="card" style="max-width:420px"><form class="form-grid" id="pw-form" style="grid-template-columns:1fr">
      <label>Mật khẩu hiện tại<input type="password" name="old_password" required autocomplete="current-password"></label>
      <label>Mật khẩu mới<input type="password" name="new_password" required autocomplete="new-password"></label>
      <label>Nhập lại mật khẩu mới<input type="password" name="confirm" required autocomplete="new-password"></label>
      <button class="btn primary">Đổi mật khẩu</button></form></div>`;
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    if (b.new_password !== b.confirm) return toast('Mật khẩu nhập lại không khớp', true);
    try { await api('/api/me/password', { method: 'POST', body: b }); toast('Đã đổi mật khẩu'); ME.must_change = false; location.hash = '#/dashboard'; boot(); }
    catch (err) { toast(err.message, true); }
  });
}

boot();

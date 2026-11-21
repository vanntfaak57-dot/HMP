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
  VOUCHER_CREATE: 'Thêm chứng từ', VOUCHER_UPDATE: 'Sửa chứng từ', VOUCHER_DELETE: 'Xóa chứng từ', VOUCHER_POST: 'Ghi sổ chứng từ', VOUCHER_UNPOST: 'Bỏ ghi chứng từ', PDF_UPLOAD: 'Tải PDF',
  COSTING_RUN: 'Tính giá xuất kho', PERIOD_LOCK: 'Khóa sổ', PERIOD_UNLOCK: 'Mở khóa sổ', USER_CREATE: 'Thêm người dùng',
  USER_UPDATE: 'Sửa người dùng', PARTNER_CREATE: 'Thêm KH/NCC', PARTNER_UPDATE: 'Sửa KH/NCC', PARTNER_DELETE: 'Xóa KH/NCC', PARTNER_IMPORT: 'Nhập Excel KH/NCC', SETTINGS_UPDATE: 'Sửa cài đặt', EXPORT: 'Xuất báo cáo', BACKUP: 'Sao lưu dữ liệu', UPDATE: 'Cập nhật phần mềm',
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
    if ($('#app-version')) $('#app-version').textContent = r.version ? 'Phiên bản ' + r.version : '';
  } catch { showLogin(); return; }
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-name').textContent = `${ME.full_name || ME.username} (${ROLE_NAMES[ME.role] || ME.role})`;
  document.body.classList.toggle('no-values', !canSeeValues());
  $$('.values-only').forEach((el) => el.classList.toggle('hidden', !canSeeValues()));
  $('#brand').textContent = SETTINGS.company_name || 'Kho hàng ETC MDA';
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', ME.role !== 'admin'));
  if (ME.must_change) location.hash = '#/account';
  route();
}

// ---------- Định tuyến ----------
const routes = [
  [/^#\/dashboard$/, pageDashboard],
  [/^#\/items$/, pageItems],
  [/^#\/customers$/, () => pagePartners('KH')],
  [/^#\/suppliers$/, () => pagePartners('NCC')],
  [/^#\/analytics$/, pageAnalytics],
  [/^#\/report-partners$/, pageReportPartners],
  [/^#\/vouchers\/(N|X)$/, (m) => pageVouchers(m[1])],
  [/^#\/voucher\/new\/(N|X)$/, (m) => pageVoucherForm(m[1], null)],
  [/^#\/voucher\/(\d+)$/, (m) => pageVoucherForm(null, Number(m[1]))],
  [/^#\/costing$/, pageCosting],
  [/^#\/report-nxt$/, pageNXT],
  [/^#\/ledger$/, pageLedger],
  [/^#\/users$/, pageUsers],
  [/^#\/audit$/, pageAudit],
  [/^#\/settings$/, pageSettings],
  [/^#\/update$/, pageUpdate],
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
// Quyền: Quản trị, Kế toán được nhập liệu; Thủ kho chỉ xem số lượng; Chỉ xem: xem toàn bộ, không sửa
const ROLE_NAMES = { admin: 'Quản trị', accountant: 'Kế toán', storekeeper: 'Thủ kho', viewer: 'Chỉ xem' };
const canWrite = () => !!ME && (ME.role === 'admin' || ME.role === 'accountant');
const canSeeValues = () => !!ME && ME.role !== 'storekeeper';

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
      <div class="card stat v"><div class="label">Giá trị tồn kho hiện tại (tạm tính)</div><div class="value">${d.stock ? fmtM(d.stock.value) : '—'}</div></div>
      <div class="card stat"><div class="label">Nhập kho tháng ${d.month}</div><div class="value">${canSeeValues() ? fmtM(N.amt) : N.c + ' phiếu'}</div><div class="muted">${N.c} phiếu</div></div>
      <div class="card stat"><div class="label">${canSeeValues() ? 'Doanh thu xuất bán' : 'Xuất kho'} tháng ${d.month}</div><div class="value">${canSeeValues() ? fmtM(X.amt) : X.c + ' phiếu'}</div><div class="muted">${X.c} phiếu</div></div>
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
      <td class="num v">${i.sale_price != null ? fmtN(i.sale_price_vat ?? round2(i.sale_price * (1 + vatPct(i) / 100))) : '<span class="muted">—</span>'}</td>
      <td class="num">${fmtN(i.opening_qty, 3)}</td><td class="num v">${fmtM(i.opening_value)}</td>
      <td class="num v">${i.opening_qty ? fmtN(i.opening_value / i.opening_qty) : ''}</td>
      <td class="num">${fmtN(i.stock_qty, 3)}</td>
      <td>${canWrite() ? `<button class="btn small" data-edit="${i.id}">Sửa</button> <button class="btn small danger" data-del="${i.id}">Xóa</button>` : ''}</td></tr>`).join('')
      || `<tr><td colspan="${W ? 11 : 10}" class="muted">Chưa có mã hàng</td></tr>`;
    const V = canSeeValues();
    $('#items-foot').innerHTML = `<tr><td colspan="${(W ? 7 : 6) - (V ? 0 : 1)}">Tổng cộng (${list.length} mã)</td><td class="num v">${fmtM(tq)}</td><td colspan="${V ? 3 : 2}"></td></tr>`;
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
    <div class="table-wrap sticky-head"><table><thead><tr>${W ? '<th class="chk-col"><label class="chk"><input type="checkbox" id="items-all" aria-label="Chọn tất cả" title="Chọn tất cả"></label></th>' : ''}<th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th><th class="num">Thuế suất GTGT</th><th class="num v">Giá bán (+VAT)</th><th class="num">SL tồn đầu</th><th class="num v">Giá trị tồn đầu</th><th class="num v">Đơn giá đầu kỳ</th><th class="num">SL tồn hiện tại</th><th></th></tr></thead>
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
      <label>Giá bán (+VAT)<input name="sale_price_vat" id="it-gross" type="number" step="any" min="0" value="${it?.sale_price != null ? (it.sale_price_vat ?? round2(it.sale_price * (1 + vatPct(it) / 100))) : ''}"></label>
      <label>Giá bán (-VAT)<input name="sale_price" id="it-net" type="number" step="any" min="0" value="${it?.sale_price ?? ''}"></label>
      <p class="muted wide" style="margin:0;font-size:12px">Nhập giá có thuế thì phần mềm tự tính giá chưa thuế theo thuế suất (và ngược lại). Giá này được gợi ý khi lập phiếu xuất cho khách chưa từng mua mặt hàng.</p>
    </form>
    <div class="actions"><button class="btn" data-close>Hủy</button><button class="btn primary" id="item-save">Lưu</button></div>`, (bg, close) => {
    // Giá +VAT và -VAT tính qua lại theo thuế suất; ô nhập sau cùng là ô gốc
    let mode = it?.sale_price_vat != null || it?.sale_price == null ? 'gross' : 'net';
    const sync = () => {
      const k = 1 + vatPct({ vat_rate: $('[name=vat_rate]', bg).value }) / 100;
      const g = $('#it-gross', bg), n = $('#it-net', bg);
      if (mode === 'gross') n.value = g.value === '' ? '' : round2(Number(g.value) / k);
      else g.value = n.value === '' ? '' : round2(Number(n.value) * k);
    };
    $('#it-gross', bg).addEventListener('input', () => { mode = 'gross'; sync(); });
    $('#it-net', bg).addEventListener('input', () => { mode = 'net'; sync(); });
    $('[name=vat_rate]', bg).addEventListener('change', sync);
    $('#item-save', bg).addEventListener('click', async () => {
      const body = Object.fromEntries(new FormData($('#item-form', bg)));
      if (mode === 'net') body.sale_price_vat = '';
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
  const vpartners = await api('/api/partners?kind=' + (type === 'X' ? 'KH' : 'NCC'));
  const W = canWrite();
  const NAME = type === 'N' ? 'phiếu nhập' : 'phiếu xuất';
  const cols = (type === 'X' ? 9 : 8) + (W ? 1 : 0);
  const selected = new Set();
  let rows = [];
  $('#main').innerHTML = `
    <h1>${TYPE[type]}</h1>
    <div class="toolbar">
      Từ <input type="date" id="vf-from" value="${q.from}"> đến <input type="date" id="vf-to" value="${q.to}">
      <select id="vf-partner"><option value="">${type === 'X' ? 'Tất cả khách hàng' : 'Tất cả nhà cung cấp'}</option>${vpartners.map((p) => `<option value="${p.id}" ${String(q.partner_id || '') === String(p.id) ? 'selected' : ''}>${esc(p.code)} - ${esc(p.name)}</option>`).join('')}</select>
      <input id="vf-q" placeholder="Số phiếu, đối tượng, diễn giải…" value="${esc(q.q)}">
      <button class="btn" id="vf-go">Lọc</button>
      <span class="spacer"></span>
      ${W ? `<a class="btn primary" href="#/voucher/new/${type}">+ Thêm ${NAME} (nhập tay / từ PDF)</a>` : ''}
    </div>
    ${W ? `<div class="bulk-row"><span id="v-bulk" class="bulk-bar" hidden>Đã chọn <b id="v-bulk-count">0</b> phiếu
      <button class="btn" id="v-bulk-edit" type="button">Mở phiếu</button>
      <button class="btn" id="v-bulk-post" type="button">Ghi sổ</button>
      <button class="btn" id="v-bulk-unpost" type="button">Bỏ ghi</button>
      <button class="btn danger" id="v-bulk-del" type="button">Xóa các phiếu đã chọn</button>
      <button class="btn" id="v-bulk-clear" type="button">Bỏ chọn</button></span></div>` : ''}
    <div class="table-wrap sticky-head"><table><thead><tr>
      ${W ? '<th class="chk-col"><label class="chk"><input type="checkbox" id="v-all" aria-label="Chọn tất cả" title="Chọn tất cả"></label></th>' : ''}
      <th>Ngày</th><th>Số phiếu</th><th>${type === 'N' ? 'Nhà cung cấp / Người giao' : 'Khách hàng'}</th><th>Diễn giải</th>
      <th class="num v">${type === 'N' ? 'Giá trị nhập' : 'Doanh thu'}</th>${type === 'X' ? '<th class="num v">Giá vốn</th>' : ''}<th>Nguồn</th><th>Ghi sổ</th><th>Trạng thái kỳ</th></tr></thead>
    <tbody id="v-body"><tr><td colspan="${cols}">Đang tải…</td></tr></tbody><tfoot id="v-foot"></tfoot></table></div>`;
  const updateSelection = () => {
    const visible = new Set(rows.map((v) => v.id));
    for (const id of [...selected]) if (!visible.has(id)) selected.delete(id);
    $$('#v-body tr[data-id]').forEach((tr) => {
      const on = selected.has(Number(tr.dataset.id));
      tr.classList.toggle('sel', on);
      const cb = $('input[data-sel]', tr); if (cb) cb.checked = on;
    });
    const all = $('#v-all');
    if (all) { all.checked = rows.length > 0 && selected.size === rows.length; all.indeterminate = selected.size > 0 && selected.size < rows.length; }
    const bar = $('#v-bulk');
    if (bar) {
      bar.hidden = selected.size === 0;
      $('#v-bulk-count').textContent = selected.size.toLocaleString('vi-VN');
      const one = selected.size === 1 && rows.find((v) => selected.has(v.id));
      const ed = $('#v-bulk-edit');
      ed.disabled = !one;
      ed.textContent = 'Mở phiếu';
      ed.title = one ? (one.posted ? 'Phiếu đã ghi sổ: mở để xem, bấm Bỏ ghi trong phiếu nếu cần sửa' : 'Mở để sửa') : 'Chọn đúng 1 phiếu';
      const chosen = rows.filter((v) => selected.has(v.id));
      $('#v-bulk-post').disabled = !chosen.some((v) => !v.posted);
      $('#v-bulk-unpost').disabled = !chosen.some((v) => v.posted);
    }
  };
  const load = async () => {
    const f = { from: $('#vf-from').value, to: $('#vf-to').value, q: $('#vf-q').value, partner_id: $('#vf-partner').value };
    sessionStorage.setItem('vfilter' + type, JSON.stringify(f));
    rows = await api(`/api/vouchers?type=${type}&from=${f.from}&to=${f.to}&q=${encodeURIComponent(f.q)}&partner_id=${f.partner_id}`);
    let ta = 0, tc = 0;
    $('#v-body').innerHTML = rows.map((v) => {
      ta += v.total_amount; tc += v.total_cost || 0;
      const st = v.locked ? '<span class="badge">Đã khóa sổ</span>' : v.period_status === 'computed' ? '<span class="badge ok">Đã tính giá</span>' : '<span class="badge warn">Chưa tính giá</span>';
      return `<tr data-id="${v.id}">
        ${W ? `<td class="chk-col"><label class="chk"><input type="checkbox" data-sel="${v.id}" aria-label="Chọn phiếu ${esc(v.number)}"></label></td>` : ''}
        <td>${fmtD(v.date)}</td><td><a href="#/voucher/${v.id}">${esc(v.number)}</a></td><td>${v.partner_code ? `<span class="muted">${esc(v.partner_code)}</span> ` : ''}${esc(v.partner)}</td><td>${esc(v.description)}</td>
        <td class="num v">${fmtM(v.total_amount)}</td>${type === 'X' ? `<td class="num v">${v.uncosted ? '<span class="muted">chưa tính</span>' : fmtM(v.total_cost)}</td>` : ''}
        <td>${v.source === 'pdf' ? 'PDF' : 'Nhập tay'}</td><td>${v.posted ? '<span class="badge ok">Đã ghi sổ</span>' : '<span class="badge warn">Chưa ghi sổ</span>'}</td><td>${st}</td></tr>`;
    }).join('') || `<tr><td colspan="${cols}" class="muted">Không có chứng từ</td></tr>`;
    $('#v-foot').innerHTML = `<tr><td colspan="${W ? 5 : 4}">Tổng cộng (${rows.length} phiếu)</td><td class="num v">${fmtM(ta)}</td>${type === 'X' ? `<td class="num v">${fmtM(tc)}</td>` : ''}<td colspan="3"></td></tr>`;
    updateSelection();
  };
  const reload = () => load().catch((e) => toast(e.message, true));
  $('#vf-go').addEventListener('click', reload);
  $('#vf-partner').addEventListener('change', reload);
  $('#v-body').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-sel]'); if (!cb) return;
    if (cb.checked) selected.add(Number(cb.dataset.sel)); else selected.delete(Number(cb.dataset.sel));
    updateSelection();
  });
  $('#v-all')?.addEventListener('change', (e) => { if (e.target.checked) rows.forEach((v) => selected.add(v.id)); else selected.clear(); updateSelection(); });
  $('#v-bulk-clear')?.addEventListener('click', () => { selected.clear(); updateSelection(); });
  const bulkPost = async (post) => {
    const chosen = rows.filter((v) => selected.has(v.id) && !!v.posted !== post);
    if (!chosen.length) return;
    if (!post && !confirm(`Bỏ ghi ${chosen.length} phiếu? Phiếu bỏ ghi sẽ không được tính vào tồn kho, giá vốn và báo cáo cho đến khi ghi sổ lại.`)) return;
    try {
      const r = await api('/api/vouchers/bulk-post', { method: 'POST', body: { ids: chosen.map((v) => v.id), post } });
      toast(`Đã ${post ? 'ghi sổ' : 'bỏ ghi'} ${r.done.length} phiếu${r.skipped.length ? `, ${r.skipped.length} phiếu không thực hiện được` : ''}`);
      await load();
      if (r.skipped.length) {
        modal(`<h2>Không ${post ? 'ghi sổ' : 'bỏ ghi'} được ${r.skipped.length} phiếu</h2><div class="table-wrap"><table><thead><tr><th>Số phiếu</th><th>Ngày</th><th>Lý do</th></tr></thead><tbody>
          ${r.skipped.map((x) => `<tr><td>${esc(x.number)}</td><td>${fmtD(x.date)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>
          <div class="actions"><button class="btn primary" data-close>Đóng</button></div>`);
      }
    } catch (err) { toast(err.message, true); }
  };
  $('#v-bulk-post')?.addEventListener('click', () => bulkPost(true));
  $('#v-bulk-unpost')?.addEventListener('click', () => bulkPost(false));
  $('#v-bulk-edit')?.addEventListener('click', () => { if (selected.size === 1) location.hash = `#/voucher/${[...selected][0]}`; });
  $('#v-bulk-del')?.addEventListener('click', async () => {
    const chosen = rows.filter((v) => selected.has(v.id));
    if (!chosen.length) return;
    const preview = chosen.slice(0, 8).map((v) => v.number).join(', ') + (chosen.length > 8 ? ` và ${chosen.length - 8} phiếu khác` : '');
    if (!confirm(`Xóa ${chosen.length} ${NAME}: ${preview}? Phiếu thuộc kỳ đã khóa sổ hoặc làm âm kho sẽ được giữ lại.`)) return;
    try {
      const r = await api('/api/vouchers/bulk-delete', { method: 'POST', body: { ids: chosen.map((v) => v.id) } });
      toast(`Đã xóa ${r.deleted.length} phiếu${r.skipped.length ? `, giữ lại ${r.skipped.length} phiếu` : ''}`);
      selected.clear();
      await load();
      if (r.skipped.length) {
        modal(`<h2>Không xóa được ${r.skipped.length} phiếu</h2><div class="table-wrap"><table><thead><tr><th>Số phiếu</th><th>Ngày</th><th>Lý do</th></tr></thead><tbody>
          ${r.skipped.map((x) => `<tr><td>${esc(x.number)}</td><td>${fmtD(x.date)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>
          <div class="actions"><button class="btn primary" data-close>Đóng</button></div>`);
      }
    } catch (err) { toast(err.message, true); }
  });
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
  const posted = !!(id && v.posted);
  // Phiếu đã ghi sổ chỉ xem; muốn sửa phải Bỏ ghi
  const editable = canWrite() && !v.locked && !posted;
  let lines = v.lines.map((l) => ({ item_id: l.item_id, qty: l.qty, unit_price: l.unit_price, price_vat: l.price_vat, mode: l.price_vat != null ? 'gross' : 'net', discount_rate: l.discount_rate || 0, amount: l.amount, vat_rate: l.vat_rate ?? '', cost_price: l.cost_price, cost_amount: l.cost_amount }));
  if (!lines.length) lines.push({});
  let unmatched = [];
  let state = { attachment: v.attachment || null, source: v.source };
  const X = type === 'X';
  const KIND = X ? 'KH' : 'NCC';
  const OBJ = X ? 'khách hàng' : 'nhà cung cấp';
  let allPartners = await api('/api/partners?kind=' + KIND);
  let partnerId = v.partner_id || null;
  const kindPartners = () => allPartners;
  const pickLabel = (p) => `${p.code} - ${p.name}`;
  const curPartner = allPartners.find((p) => p.id === partnerId);
  let lastPrices = {};
  // Nạp đơn giá gần nhất theo khách hàng / nhà cung cấp đang chọn
  async function loadLastPrices() {
    lastPrices = partnerId ? await api(`/api/last-prices?type=${type}&partner_id=${partnerId}&exclude=${id || 0}`) : {};
    let filled = 0;
    for (const l of lines) if (lastPrices[l.item_id] && applyLastPrice(l)) filled++;
    renderLines();
    if (filled) toast(`Đã điền đơn giá lần trước cho ${filled} dòng`);
  }
  // Điền giá lần trước vào dòng chưa có giá; trả về true nếu đã điền
  function suggestOf(l) {
    if (!l.item_id) return null;
    if (lastPrices[l.item_id]) return { ...lastPrices[l.item_id], source: 'last' };
    const it = items.find((i) => i.id === l.item_id);
    if (X && it && it.sale_price != null) return { unit_price: it.sale_price, price_vat: it.sale_price_vat, discount_rate: 0, vat_rate: it.vat_rate, source: 'catalog' };
    return null;
  }
  function applyLastPrice(l) {
    const lp = suggestOf(l);
    if (!lp || Number(l.unit_price) || Number(l.price_vat) || !editable) return false;
    if (lp.price_vat != null) { l.price_vat = lp.price_vat; l.mode = 'gross'; } else { l.unit_price = lp.unit_price; l.mode = 'net'; }
    l.discount_rate = lp.discount_rate || 0;
    if (lp.vat_rate != null && lp.vat_rate !== '') l.vat_rate = lp.vat_rate;
    recalcLine(l);
    return true;
  }

  $('#main').innerHTML = `
    <div class="toolbar"><a class="btn" href="#/vouchers/${type}">← Danh sách</a><h1 style="margin:0">${TYPE[type]} ${id ? esc(v.number) : '(mới)'}</h1>
      <span class="spacer"></span>
      ${id && canWrite() && !v.locked && posted ? `<button class="btn" id="v-unpost" title="Bỏ ghi để sửa chứng từ">Bỏ ghi</button>` : ''}
      ${id && canWrite() && !v.locked && !posted ? `<button class="btn" id="v-post" title="Ghi sổ lại, không thay đổi nội dung">Ghi sổ</button>` : ''}
      ${id ? `<button class="btn" id="v-print">In phiếu</button>` : ''}
      ${state.attachment && canSeeValues() ? `<a class="btn" target="_blank" href="/api/attachments/${state.attachment}">Xem PDF gốc</a>` : ''}
    </div>
    ${v.locked ? '<div class="alert">Kỳ kế toán của chứng từ này đã khóa sổ – chỉ xem.</div>'
      : posted ? `<div class="alert info post-state"><span class="badge ok">Đã ghi sổ</span> Chứng từ chỉ xem.${canWrite() ? ' Muốn sửa, bấm <b>Bỏ ghi</b>, sửa xong bấm <b>Cất &amp; ghi sổ</b>.' : ''}</div>`
      : id ? '<div class="alert post-state"><span class="badge warn">Chưa ghi sổ</span> Chứng từ đang được sửa và <b>không được tính</b> vào tồn kho, giá vốn, báo cáo. Sửa xong bấm <b>Cất &amp; ghi sổ</b>.</div>' : ''}
    ${editable ? `<div class="dropzone" id="pdf-drop">Kéo thả hoặc <b>bấm để chọn file PDF</b> ${X ? 'phiếu xuất kho / hóa đơn bán hàng' : 'phiếu nhập kho'} – hệ thống sẽ đọc và điền sẵn nội dung bên dưới
      <input type="file" id="pdf-file" accept="application/pdf" hidden></div>` : ''}
    <div id="pdf-msg" style="margin-top:10px"></div>
    <div class="card">
      <div class="form-grid" id="v-head">
        <label>Số phiếu${id ? '' : ' <span class="auto-tag" id="num-tag">tự động</span>'}<span class="pick-row"><input name="number" id="v-number" value="${esc(v.number)}" ${id ? '' : 'readonly'}>${!id && editable ? '<button type="button" class="btn small" id="num-manual" title="Tự nhập số phiếu thay vì đánh số tự động">Sửa</button>' : ''}</span></label>
        <label>Ngày chứng từ<input name="date" type="date" value="${v.date}"></label>
        <label>${X ? 'Khách hàng' : 'Nhà cung cấp'} (chọn trong danh mục)<span class="pick-row"><input name="partner_pick" id="v-partner-pick" list="dl-partners" autocomplete="off" placeholder="Gõ mã hoặc tên…" value="${esc(curPartner ? pickLabel(curPartner) : '')}">
          ${editable ? `<button type="button" class="btn small" id="v-partner-new" title="Thêm ${OBJ} mới vào danh mục">+ Mới</button>` : ''}</span></label>
        <label>Tên ${OBJ} in trên phiếu<input name="partner" value="${esc(v.partner)}"></label>
        <label>Mã số thuế ${OBJ}<input name="tax_code" value="${esc(v.tax_code)}"></label>
        <label>Mã kho<input name="warehouse" value="${esc(v.warehouse)}"></label>
        <label>${X ? 'Số phiếu xuất (chứng từ gốc)' : 'Số hóa đơn / chứng từ gốc'}<input name="ref_no" value="${esc(v.ref_no)}"></label>
        ${X ? `<label>Nhân viên bán hàng<input name="salesperson" value="${esc(v.salesperson)}"></label>` : ''}
        <label class="wide">Địa chỉ<input name="address" value="${esc(v.address)}"></label>
        ${X ? `<label>Tên người liên hệ<input name="contact" value="${esc(v.contact)}"></label>
        <label>Điện thoại<input name="phone" value="${esc(v.phone)}"></label>
        <label class="span2">Địa điểm giao hàng<input name="delivery_place" value="${esc(v.delivery_place)}"></label>` : ''}
        <label class="wide">Diễn giải<input name="description" value="${esc(v.description)}"></label>
      </div>
    </div>
    <div id="unmatched"></div>
    <div class="table-wrap"><table class="lines"><thead><tr><th>#</th><th style="min-width:150px">Mã hàng</th><th>Tên hàng</th><th>ĐVT</th>
      ${X ? '<th class="num">Tồn kho</th>' : ''}<th class="num">Số lượng</th><th class="num v">${X ? 'Đơn giá bán (+VAT)' : 'Đơn giá (+VAT)'}</th><th class="num v">${X ? 'Đơn giá bán (-VAT)' : 'Đơn giá (-VAT)'}</th><th class="num v">CK (%)</th><th class="num v">Thành tiền</th>
      <th class="num v">% thuế GTGT</th><th class="num v">Tiền thuế</th>
      ${X ? '<th class="num v">Đơn giá vốn</th><th class="num v">Tiền vốn</th>' : ''}<th></th></tr></thead>
      <tbody id="l-body"></tbody><tfoot id="l-foot"></tfoot></table></div>
    <div class="pay-box v" id="pay-box"></div>
    <datalist id="dl-partners">${kindPartners().map((p) => `<option value="${esc(pickLabel(p))}"></option>`).join('')}</datalist>
    <div id="partner-hint"></div>
    <datalist id="dl-items">${items.map((i) => `<option value="${esc(i.code)}">${esc(i.name)}</option>`).join('')}</datalist>
    <div class="toolbar" style="margin-top:12px">
      ${editable ? `<button class="btn" id="l-add">+ Thêm dòng</button>` : ''}
      <span class="spacer"></span>
      ${canWrite() && !v.locked && id ? `<button class="btn danger" id="v-del">Xóa chứng từ</button>` : ''}
      ${editable ? `<button class="btn primary" id="v-save">Cất &amp; ghi sổ</button>` : ''}
    </div>
    ${X ? `<p class="muted v">Giá vốn được tính theo phương pháp <b>bình quân gia quyền cuối kỳ</b> (theo tháng) khi chạy <a href="#/costing">Tính giá xuất kho</a>. ${v.period_status === 'dirty' && id ? '<span class="badge warn">Kỳ này có thay đổi, cần tính lại giá</span>' : ''}</p>` : ''}
    ${id ? `<p class="muted">Tạo bởi ${esc(v.created_by)} lúc ${esc(v.created_at)}${v.updated_by ? ` · Sửa lần cuối bởi ${esc(v.updated_by)} lúc ${esc(v.updated_at)}` : ''}</p>` : ''}`;

  if (!editable) $$('#v-head input').forEach((i) => { i.disabled = true; });
  $('#num-manual')?.addEventListener('click', () => {
    const n = $('#v-number'); n.readOnly = false; n.focus(); n.select();
    $('#num-tag').textContent = 'nhập tay'; $('#num-manual').remove();
  });
  // Số lượng thay đổi: cập nhật cảnh báo thiếu hàng
  if (X) $('#l-body').addEventListener('change', (e) => { if (e.target.dataset.f === 'qty') setTimeout(renderLines, 0); });

  // Chọn đối tượng: điền tên và địa chỉ theo danh mục
  function setPartner(p) {
    partnerId = p ? p.id : null;
    $('#v-partner-pick').value = p ? pickLabel(p) : '';
    if (p) {
      $('#v-head [name=partner]').value = p.name;
      if (p.tax_code) $('#v-head [name=tax_code]').value = p.tax_code;
      $('#partner-hint').innerHTML = '';
    }
    loadLastPrices().catch((e) => toast(e.message, true));
  }
  function refreshPartnerList() { $('#dl-partners').innerHTML = kindPartners().map((p) => `<option value="${esc(pickLabel(p))}"></option>`).join(''); }
  function nextPartnerCode() {
    const re = new RegExp('^' + KIND + '(\\d+)$', 'i');
    let max = 0; for (const p of allPartners) { const m = p.code.match(re); if (m) max = Math.max(max, Number(m[1])); }
    return KIND + String(max + 1).padStart(3, '0');
  }
  function newPartner(defaults = {}) {
    partnerDialog(KIND, null, (p) => { allPartners.push(p); refreshPartnerList(); setPartner(p); }, { code: nextPartnerCode(), ...defaults });
  }
  $('#v-partner-pick').addEventListener('change', (e) => {
    const val = e.target.value.trim();
    if (!val) { partnerId = null; return; }
    const code = val.split(' - ')[0].trim().toLowerCase();
    const p = kindPartners().find((x) => x.code.toLowerCase() === code) || kindPartners().find((x) => x.name.toLowerCase() === val.toLowerCase());
    if (p) setPartner(p);
    else { partnerId = null; toast(`"${val}" chưa có trong danh mục ${OBJ}. Bấm "+ Mới" để thêm.`, true); }
  });
  $('#v-partner-new')?.addEventListener('click', () => newPartner({ name: $('#v-head [name=partner]').value }));
  $('#partner-hint').addEventListener('click', (e) => {
    const b = e.target.closest('[data-newpartner]'); if (!b) return;
    newPartner(JSON.parse(b.dataset.newpartner));
  });

  const byId = (iid) => items.find((i) => i.id == iid);
  const dis = editable ? '' : 'disabled';
  // Số lượng còn thiếu của một mã hàng trên phiếu xuất (cộng các dòng cùng mã) so với tồn tại ngày chứng từ
  function shortageOf(itemId) {
    const it = byId(itemId); if (!it) return 0;
    const need = lines.filter((x) => x.item_id == itemId).reduce((s, x) => s + (Number(x.qty) || 0), 0);
    return need - it.stock_qty;
  }
  function lastHint(l) {
    if (!editable) return '';
    const lp = suggestOf(l);
    if (!lp) return '';
    const g = lp.price_vat != null ? `${fmtN(lp.price_vat)} (+VAT)` : `${fmtN(lp.unit_price)} (-VAT)`;
    if (lp.source === 'catalog') return `<div class="lp-hint" title="Giá bán khai báo trong danh mục vật tư">Giá danh mục: ${g}</div>`;
    return `<div class="lp-hint" title="Phiếu ${esc(lp.number)}">Lần trước: ${g} · ${fmtD(lp.date)}</div>`;
  }
  function renderLines() {
    // Giữ con trỏ ở đúng ô đang nhập sau khi vẽ lại bảng
    const ae = document.activeElement;
    const tr0 = ae && ae.closest ? ae.closest('#l-body tr') : null;
    const keep = tr0 ? [tr0.dataset.i, ae.dataset.f] : null;
    $('#l-body').innerHTML = lines.map((l, i) => {
      const it = byId(l.item_id);
      const short = X && it ? shortageOf(l.item_id) : 0;
      const low = short > 1e-9;
      return `<tr data-i="${i}">
        <td>${i + 1}</td>
        <td><input list="dl-items" data-f="code" value="${esc(it?.code || l._code || '')}" ${dis} placeholder="Gõ mã…"></td>
        <td>${esc(it?.name || '')}</td><td>${esc(it?.unit || '')}</td>
        ${X ? `<td class="num" style="${low ? 'color:var(--danger);font-weight:600' : ''}">${it ? fmtN(it.stock_qty, 3) : ''}${low ? `<div class="short">Thiếu ${fmtN(short, 3)}</div>` : ''}</td>` : ''}
        <td><input type="number" step="any" data-f="qty" value="${l.qty ?? ''}" ${dis}></td>
        <td class="v"><input type="number" step="any" data-f="price_vat" value="${grossOf(l)}" title="Nhập giá đã có thuế: phần mềm tự tính giá chưa thuế theo % thuế GTGT" ${dis}>${lastHint(l)}</td>
        <td class="v"><input type="number" step="any" data-f="unit_price" value="${l.unit_price ?? ''}" ${dis}></td>
        <td class="v"><input type="number" step="any" min="0" max="100" data-f="discount_rate" class="w-pct" value="${l.discount_rate || ''}" placeholder="0" ${dis}></td>
        <td class="v"><input type="number" step="any" data-f="amount" value="${l.amount ?? ''}" ${dis}></td>
        <td class="v"><select data-f="vat_rate" ${dis}>${VAT_OPTIONS.map(([val, t]) => `<option value="${val}" ${(l.vat_rate ?? '') === val ? 'selected' : ''}>${val === '' ? '—' : /^\d+$/.test(val) ? val + '%' : val}</option>`).join('')}</select></td>
        <td class="num v" data-vat>${fmtM(vatOf(l))}</td>
        ${X ? `<td class="num v">${l.cost_price != null ? fmtN(l.cost_price) : ''}</td><td class="num v">${l.cost_amount != null ? fmtM(l.cost_amount) : ''}</td>` : ''}
        <td>${editable ? `<button class="btn small danger" data-rm="${i}">✕</button>` : ''}</td></tr>`;
    }).join('');
    if (keep && keep[1]) { const el = $(`#l-body tr[data-i="${keep[0]}"] [data-f="${keep[1]}"]`); if (el) el.focus(); }
    renderFoot();
  }
  function renderFoot() {
    const tq = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const ta = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const tv = lines.reduce((s, l) => s + vatOf(l), 0);
    const tc = lines.reduce((s, l) => s + (Number(l.cost_amount) || 0), 0);
    $('#l-foot').innerHTML = `<tr><td colspan="${X ? 5 : 4}">Tổng cộng</td><td class="num">${fmtN(tq, 3)}</td><td class="v"></td><td class="v"></td><td class="v"></td><td class="num v">${fmtM(ta)}</td><td class="v"></td><td class="num v">${fmtM(tv)}</td>${X ? `<td class="v"></td><td class="num v">${fmtM(tc)}</td>` : ''}<td></td></tr>`;
    $$('#l-body tr').forEach((tr) => { const c = $('[data-vat]', tr); if (c) c.textContent = fmtM(vatOf(lines[tr.dataset.i])); });
    $('#pay-box').innerHTML = `<div><span>Cộng tiền hàng</span><b>${fmtM(ta)}</b></div><div><span>Tiền thuế GTGT</span><b>${fmtM(tv)}</b></div>
      <div class="total"><span>Tổng tiền thanh toán</span><b>${fmtM(ta + tv)}</b></div><div class="words">Bằng chữ: <i>${esc(moneyWords(ta + tv))}</i></div>`;
  }
  function renderUnmatched() {
    $('#unmatched').innerHTML = unmatched.length ? `<div class="alert"><b>Dòng hàng trong PDF chưa có mã trong danh mục:</b>
      <table style="margin-top:6px"><tr><th>Nội dung</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th><th></th></tr>
      ${unmatched.map((u, i) => `<tr><td>${esc(u.text)}</td><td class="num">${fmtN(u.qty, 3)}</td><td class="num">${fmtN(u.unit_price)}</td><td class="num">${fmtM(u.amount)}</td>
      <td><select data-map="${i}"><option value="">-- Chọn mã có sẵn --</option>${items.map((it) => `<option value="${it.id}">${esc(it.code)} - ${esc(it.name)}</option>`).join('')}</select>
      <button class="btn small" data-newitem="${i}">+ Tạo mã mới</button></td></tr>`).join('')}</table></div>` : '';
  }
  renderLines();
  if (partnerId) loadLastPrices().catch(() => {});

  $('#l-body').addEventListener('input', (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const l = lines[tr.dataset.i]; const f = e.target.dataset.f;
    // Giá +VAT và giá -VAT tính qua lại theo % thuế GTGT; ô nào người dùng nhập sau cùng là ô gốc
    if (f === 'price_vat') { l.price_vat = e.target.value; l.mode = 'gross'; }
    else if (f === 'unit_price') { l.unit_price = e.target.value; l.mode = 'net'; }
    else if (f === 'qty' || f === 'discount_rate') l[f] = e.target.value;
    else if (f === 'vat_rate') l.vat_rate = e.target.value;
    else if (f === 'amount') { l.amount = e.target.value; renderFoot(); return; }
    else return;
    recalcLine(l);
    if (f !== 'unit_price') $('[data-f=unit_price]', tr).value = l.unit_price ?? '';
    if (f !== 'price_vat') $('[data-f=price_vat]', tr).value = grossOf(l);
    $('[data-f=amount]', tr).value = l.amount;
    renderFoot();
  });
  $('#l-body').addEventListener('change', (e) => {
    if (e.target.dataset.f !== 'code') return;
    const l = lines[e.target.closest('tr').dataset.i];
    const it = items.find((i) => i.code.toLowerCase() === e.target.value.trim().toLowerCase());
    if (it) { l.item_id = it.id; delete l._code; if (!l.vat_rate) { l.vat_rate = it.vat_rate || ''; recalcLine(l); } applyLastPrice(l); } else { l.item_id = null; l._code = e.target.value; if (e.target.value) toast(`Mã "${e.target.value}" không có trong danh mục`, true); }
    setTimeout(renderLines, 0); // vẽ lại sau khi trình duyệt chuyển xong ô đang nhập
  });
  $('#l-body').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { lines.splice(Number(rm.dataset.rm), 1); if (!lines.length) lines.push({}); renderLines(); }
  });
  $('#l-add')?.addEventListener('click', () => { lines.push({}); renderLines(); });
  $('#unmatched').addEventListener('change', (e) => {
    const s = e.target.closest('[data-map]'); if (!s || !s.value) return;
    const u = unmatched[s.dataset.map];
    addLine({ item_id: Number(s.value), qty: u.qty, unit_price: u.unit_price, amount: u.amount, vat_rate: u.vat_rate ?? (items.find((it) => it.id === Number(s.value))?.vat_rate || ''), discount_rate: u.discount_rate || 0 });
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
        addLine({ item_id: r.id, qty: u.qty, unit_price: u.unit_price, amount: u.amount, vat_rate: u.vat_rate ?? (body.vat_rate || ''), discount_rate: u.discount_rate || 0 });
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
        const p = await api('/api/pdf/parse?type=' + type, { method: 'POST', body: fd });
        state.attachment = p.attachment; state.source = 'pdf';
        if (p.error) { $('#pdf-msg').innerHTML = `<div class="alert">${esc(p.error)}</div>`; return; }
        const head = $('#v-head');
        // Số phiếu của app luôn đánh tự động; số trên PDF lưu vào "Số chứng từ gốc"
        if (p.number) p.ref_no = p.ref_no && p.ref_no !== p.number ? `${p.number} / ${p.ref_no}` : p.number;
        if (p.date) head.querySelector('[name=date]').value = p.date;
        for (const k of ['partner', 'address', 'description', 'ref_no', 'tax_code', 'contact', 'phone', 'delivery_place', 'salesperson', 'warehouse']) {
          const el = head.querySelector(`[name=${k}]`); if (p[k] && el) el.value = p[k];
        }
        // Đối tượng trên PDF: khớp danh mục theo MST hoặc tên
        const pm = p.partner_id && kindPartners().find((x) => x.id === p.partner_id);
        if (pm) { setPartner(pm); if (p.partner) head.querySelector('[name=partner]').value = p.partner; }
        else {
          partnerId = null; $('#v-partner-pick').value = '';
          if (p.partner) $('#partner-hint').innerHTML = `<div class="alert">${X ? 'Khách hàng' : 'Nhà cung cấp'} <b>${esc(p.partner)}</b>${p.tax_code ? ` (MST ${esc(p.tax_code)})` : ''} chưa có trong danh mục.
            ${canWrite() ? `<button type="button" class="btn small" data-newpartner="${esc(JSON.stringify({ name: p.partner, tax_code: p.tax_code || '' }))}">+ Thêm vào danh mục ${OBJ}</button>` : ''}</div>`;
        }
        items = await api(`/api/items?date=${head.querySelector('[name=date]').value}&exclude=${id || 0}`);
        lines = p.lines.map((l) => ({ item_id: l.item_id, qty: l.qty, unit_price: l.unit_price, mode: 'net', discount_rate: l.discount_rate || 0, amount: l.amount, vat_rate: l.vat_rate ?? '' }));
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
    head.warehouse = head.warehouse || '';
    const bad = lines.find((l) => l._code);
    if (bad) return toast(`Mã "${bad._code}" không có trong danh mục`, true);
    if (X) {
      const shorts = [...new Set(lines.filter((l) => l.item_id).map((l) => l.item_id))].map((iid) => ({ it: byId(iid), s: shortageOf(iid) })).filter((x) => x.s > 1e-9);
      if (shorts.length) {
        renderLines();
        return toast(`Không đủ hàng để xuất (ngày ${fmtD($('#v-head [name=date]').value)}): ${shorts.map((x) => `${x.it.code} thiếu ${fmtN(x.s, 3)} ${x.it.unit || ''}`).join('; ')}`, true);
      }
    }
    if (unmatched.length && !confirm(`Còn ${unmatched.length} dòng hàng trong PDF chưa gán mã. Vẫn lưu?`)) return;
    delete head.partner_pick;
    if (!partnerId && $('#v-partner-pick').value.trim()) return toast(`"${$('#v-partner-pick').value}" chưa có trong danh mục ${OBJ}. Chọn lại hoặc bấm "+ Mới".`, true);
    const body = { ...head, auto_number: !id && $('#v-number').readOnly, partner_id: partnerId, type, source: state.source, attachment: state.attachment,
      lines: lines.filter((l) => l.item_id).map((l) => ({ ...l, price_vat: l.mode === 'gross' && l.price_vat !== '' && l.price_vat != null ? Number(l.price_vat) : null })) };
    try {
      const r = await api(id ? `/api/vouchers/${id}` : '/api/vouchers', { method: id ? 'PUT' : 'POST', body });
      toast('Đã cất và ghi sổ chứng từ');
      if (id) route(); else location.hash = `#/voucher/${r.id}`;
    } catch (err) { toast(err.message, true); }
  });
  $('#v-del')?.addEventListener('click', async () => {
    if (!confirm(`Xóa ${TYPE[type]} ${v.number}?`)) return;
    try { await api(`/api/vouchers/${id}`, { method: 'DELETE' }); toast('Đã xóa'); location.hash = `#/vouchers/${type}`; } catch (err) { toast(err.message, true); }
  });
  $('#v-print')?.addEventListener('click', () => printVoucher(v));
  $('#v-unpost')?.addEventListener('click', async () => {
    if (!confirm(`Bỏ ghi ${TYPE[type]} ${v.number}? Trong lúc chưa ghi sổ, phiếu không được tính vào tồn kho, giá vốn và báo cáo.`)) return;
    try { await api(`/api/vouchers/${id}/post`, { method: 'POST', body: { post: false } }); toast('Đã bỏ ghi, có thể sửa chứng từ'); route(); }
    catch (err) { toast(err.message, true); }
  });
  $('#v-post')?.addEventListener('click', async () => {
    try { await api(`/api/vouchers/${id}/post`, { method: 'POST', body: { post: true } }); toast('Đã ghi sổ'); route(); }
    catch (err) { toast(err.message, true); }
  });
}

// % thuế dạng số của một dòng (KCT, KKKNT, chưa chọn: 0)
const vatPct = (l) => (/^\d+$/.test(String(l.vat_rate ?? '')) ? Number(l.vat_rate) : 0);
const round2 = (n) => Math.round(n * 100) / 100;
// Đơn giá đã có thuế để hiển thị: giá người dùng nhập (nếu nhập giá +VAT), ngược lại tính từ giá -VAT
function grossOf(l) {
  if (l.mode === 'gross' && l.price_vat !== undefined && l.price_vat !== null) return l.price_vat;
  if (l.unit_price === '' || l.unit_price == null) return '';
  return round2(Number(l.unit_price) * (1 + vatPct(l) / 100));
}
// Tính lại đơn giá và thành tiền của dòng theo ô gốc (giá +VAT hoặc giá -VAT)
function recalcLine(l) {
  const q = Number(l.qty) || 0, ck = 1 - (Number(l.discount_rate) || 0) / 100, k = 1 + vatPct(l) / 100;
  if (l.mode === 'gross' && l.price_vat !== '' && l.price_vat != null) {
    const g = Number(l.price_vat) || 0;
    l.unit_price = round2(g / k);
    l.amount = Math.round(q * g * ck / k); // thành tiền chưa thuế suy từ giá có thuế để tổng thanh toán khớp giá đã nhập
  } else {
    l.amount = Math.round(q * (Number(l.unit_price) || 0) * ck);
  }
}

// Tiền thuế GTGT của một dòng (KCT, KKKNT, chưa chọn: 0)
function vatOf(l) {
  const r = String(l.vat_rate ?? '');
  return /^\d+$/.test(r) ? Math.round((Number(l.amount) || 0) * Number(r) / 100) : 0;
}

// Đọc số tiền bằng chữ: 49136 -> "Bốn mươi chín nghìn một trăm ba mươi sáu đồng chẵn."
function moneyWords(n) {
  n = Math.round(Number(n) || 0);
  const neg = n < 0; n = Math.abs(n);
  if (n === 0) return 'Không đồng.';
  const D = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const read3 = (x, full) => {
    const tr = Math.floor(x / 100), ch = Math.floor((x % 100) / 10), dv = x % 10, w = [];
    if (full || tr) w.push(D[tr], 'trăm');
    if (ch === 0) { if (dv && (full || tr)) w.push('linh'); }
    else if (ch === 1) w.push('mười');
    else w.push(D[ch], 'mươi');
    if (dv) w.push(dv === 1 && ch > 1 ? 'mốt' : dv === 5 && ch > 0 ? 'lăm' : D[dv]);
    return w.join(' ');
  };
  const UNITS = ['', 'nghìn', 'triệu', 'tỷ'];
  const groups = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) groups.push(x % 1000);
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) { if (i % 3 === 0 && i > 0 && parts.length && i >= 3) parts.push('tỷ'); continue; }
    const unit = i === 0 ? '' : i % 3 === 0 ? 'tỷ' : UNITS[i % 3];
    parts.push(read3(g, i < groups.length - 1) + (unit ? ' ' + unit : ''));
  }
  let t = parts.join(' ').replace(/\s+/g, ' ').replace(/(tỷ )+tỷ/g, 'tỷ').trim();
  t = (neg ? 'âm ' : '') + t + ' đồng chẵn.';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Mẫu in phiếu xuất kho bán hàng / phiếu nhập kho
function voucherPaperHtml(v) {
  const X = v.type === 'X';
  const V = canSeeValues();
  const d = v.date.split('-');
  const f2 = (n) => Number(n || 0).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const vatTxt = (r) => (r == null || r === '' ? '' : /^\d+$/.test(r) ? r : r);
  const goods = v.lines.reduce((s, l) => s + l.amount, 0);
  const vat = v.lines.reduce((s, l) => s + vatOf(l), 0);
  const rates = [...new Set(v.lines.map((l) => l.vat_rate).filter((r) => r != null && r !== ''))];
  const rateTxt = rates.length === 1 ? (/^\d+$/.test(rates[0]) ? rates[0] + ' %' : rates[0]) : rates.length ? rates.map((r) => (/^\d+$/.test(r) ? r + '%' : r)).join(', ') : '';
  const row = (label, val, cls = '') => `<div class="ln ${cls}"><b>- ${label}:</b> ${esc(val || '')}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(v.number)}</title><style>
    body{font:13px/1.45 "Times New Roman",Times,serif;margin:28px 34px;color:#000}
    .hd{display:flex;justify-content:space-between;gap:20px}.hd .co{font-size:12px}.hd .co b{font-size:13px;text-transform:uppercase}
    .hd .mst{text-align:right;font-weight:bold;align-self:flex-end;white-space:nowrap}
    h1{text-align:center;font-size:20px;margin:20px 0 2px}.dt{text-align:center;font-style:italic;font-weight:bold}.so{text-align:center;margin:4px 0 14px}
    .ln{margin:3px 0 3px 4px}.ln.u b{font-style:italic;text-decoration:underline}.sub{margin:3px 0 3px 22px}
    table{border-collapse:collapse;width:100%;margin-top:4px}td,th{border:1px solid #000;padding:3px 4px;vertical-align:middle;font-size:12px}
    th{font-weight:bold;text-align:center}.r{text-align:right}.c{text-align:center}.sum td{border:none;padding:3px 6px}
    .box{border:1px solid #000;border-top:none}.box td{border:none;border-top:1px solid #000}
    .words{margin-top:12px;font-size:14px}.words i{font-weight:bold}.datel{text-align:right;font-style:italic;margin:14px 40px 4px 0}
    .sig{display:flex;justify-content:space-around;text-align:center;margin-top:6px}.sig div{width:24%}.sig i{font-size:12px}
  </style></head><body>
    <div class="hd"><div class="co"><b>${esc(SETTINGS.company_name || '')}</b><br>${esc(SETTINGS.company_address || '')}</div>
      <div class="mst">${esc(SETTINGS.company_tax || '')}</div></div>
    <h1>${X ? 'PHIẾU XUẤT KHO BÁN HÀNG' : 'PHIẾU NHẬP KHO'}</h1>
    <div class="dt">Ngày ${d[2]} tháng ${d[1]} năm ${d[0]}</div>
    <div class="so">Số: <b>${esc(v.number)}</b></div>
    ${row(X ? 'Tên khách hàng' : 'Tên nhà cung cấp', v.partner)}
    ${row('Địa chỉ', v.address)}
    ${X ? row('Địa điểm giao hàng', v.delivery_place, 'u') + row('Tên người liên hệ', v.contact) + row('Điện thoại', v.phone) : ''}
    ${row('Mã số thuế', v.tax_code)}
    ${row('Diễn giải', v.description)}
    ${X ? row('Nhân viên bán hàng', v.salesperson) : ''}
    <div class="sub">Mã kho: ${esc(v.warehouse || '')}</div>
    <div class="sub">${X ? 'Số phiếu xuất' : 'Số chứng từ gốc'}: ${esc(v.ref_no || '')}</div>
    <table><thead><tr><th style="width:22px">TT</th><th>Mã hàng</th><th>Tên hàng</th><th>Đơn vị</th><th>Mã kho</th><th>Số lượng</th>
      ${V ? '<th>Đơn giá (+VAT)</th><th>Đơn giá (-VAT)</th><th>Thành tiền</th><th style="width:42px">Tỷ lệ CK (%)</th><th style="width:44px">% thuế GTGT</th>' : ''}</tr></thead><tbody>
    ${v.lines.map((l, i) => {
      const r = String(l.vat_rate ?? '');
      const withVat = l.price_vat != null ? l.price_vat : /^\d+$/.test(r) ? l.unit_price * (1 + Number(r) / 100) : l.unit_price;
      return `<tr><td class="c">${i + 1}</td><td>${esc(l.code)}</td><td>${esc(l.name)}</td><td class="c">${esc(l.unit)}</td><td class="c">${esc(v.warehouse || '')}</td>
        <td class="r">${fmtN(l.qty, 3)}</td>${V ? `<td class="r">${f2(withVat)}</td><td class="r">${f2(l.unit_price)}</td><td class="r">${fmtM(l.amount)}</td>
        <td class="r">${f2(l.discount_rate)}</td><td class="r">${esc(vatTxt(l.vat_rate))}</td>` : ''}</tr>`;
    }).join('')}
    ${V ? `<tr><td colspan="8"><b>Cộng</b></td><td class="r"><b>${fmtM(goods)}</b></td><td></td><td></td></tr>` : `<tr><td colspan="5"><b>Cộng</b></td><td class="r"><b>${fmtN(v.lines.reduce((t, l) => t + Number(l.qty || 0), 0), 3)}</b></td></tr>`}</tbody></table>
    ${V ? `<table class="box"><tr><td style="width:42%"></td><td colspan="2" style="width:38%">Cộng tiền hàng</td><td class="r"><b>${fmtM(goods)}</b></td></tr>
      <tr><td>Thuế suất thuế GTGT: <b style="margin-left:30%">${esc(rateTxt)}</b></td><td colspan="2"><b>Tiền thuế GTGT:</b></td><td class="r"><b>${fmtM(vat)}</b></td></tr>
      <tr><td></td><td colspan="2">Tổng tiền thanh toán</td><td class="r"><b>${fmtM(goods + vat)}</b></td></tr></table>
    <div class="words">Số tiền bằng chữ: <i>${esc(moneyWords(goods + vat))}</i></div>` : ''}
    <div class="words" style="margin-top:4px">Số chứng từ gốc kèm theo:</div><div>...</div>
    <div class="datel">Ngày ..... tháng ..... năm ........</div>
    <div class="sig">${(X ? ['Người nhận hàng', 'Người giao hàng', 'Thủ kho', 'Người lập phiếu'] : ['Người giao hàng', 'Người nhận hàng', 'Thủ kho', 'Người lập phiếu'])
      .map((t) => `<div><b>${t}</b><br><i>(Ký, họ tên)</i></div>`).join('')}</div>
    <script>window.onload=()=>window.print()<\/script></body></html>`;
}

function printVoucher(v) {
  const w = window.open('', '_blank');
  w.document.write(voucherPaperHtml(v));
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
    const V = canSeeValues();
    const rows = r.rows.filter((x) => !hide || x.open_qty || x.in_qty || x.out_qty || x.close_qty);
    const t = rows.reduce((a, x) => { ['open_val', 'in_val', 'out_val', 'close_val'].forEach((k) => { a[k] += x[k]; }); return a; }, { open_val: 0, in_val: 0, out_val: 0, close_val: 0 });
    $('#r-out').innerHTML = `<p class="muted">Kỳ ${r.from} → ${r.to}. Giá xuất: bình quân gia quyền cuối kỳ (tính trực tiếp theo dữ liệu hiện tại).</p>
    <div class="table-wrap"><table><thead><tr><th rowspan="2">Mã hàng</th><th rowspan="2">Tên hàng</th><th rowspan="2">ĐVT</th>
      <th colspan="${V ? 2 : 1}" class="num" style="text-align:center">Tồn đầu kỳ</th><th colspan="${V ? 2 : 1}" style="text-align:center">Nhập trong kỳ</th><th colspan="${V ? 2 : 1}" style="text-align:center">Xuất trong kỳ</th>
      <th colspan="${V ? 2 : 1}" style="text-align:center">Tồn cuối kỳ</th><th rowspan="2" class="num v">Đơn giá BQ</th></tr>
      <tr>${'<th class="num">SL</th><th class="num v">Giá trị</th>'.repeat(4)}</tr></thead><tbody>
    ${rows.map((x) => `<tr><td><a href="#/ledger" data-led="${x.item_id}">${esc(x.code)}</a></td><td>${esc(x.name)}</td><td>${esc(x.unit)}</td>
      <td class="num">${fmtN(x.open_qty, 3)}</td><td class="num v">${fmtM(x.open_val)}</td><td class="num">${fmtN(x.in_qty, 3)}</td><td class="num v">${fmtM(x.in_val)}</td>
      <td class="num">${fmtN(x.out_qty, 3)}</td><td class="num v">${fmtM(x.out_val)}</td><td class="num">${fmtN(x.close_qty, 3)}</td><td class="num v">${fmtM(x.close_val)}</td>
      <td class="num v">${fmtN(x.avg)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="3">Tổng cộng</td><td></td><td class="num v">${fmtM(t.open_val)}</td><td></td><td class="num v">${fmtM(t.in_val)}</td><td></td><td class="num v">${fmtM(t.out_val)}</td><td></td><td class="num v">${fmtM(t.close_val)}</td><td class="v"></td></tr></tfoot></table></div>`;
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
    const V = canSeeValues();
    const r = await api(`/api/reports/ledger?item_id=${f.item_id}&from=${f.from}&to=${f.to}`);
    $('#lg-out').innerHTML = `<p><b>${esc(r.item.code)} – ${esc(r.item.name)}</b> (ĐVT: ${esc(r.item.unit)})</p>
      <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Số phiếu</th><th>Diễn giải</th><th class="num v">Đơn giá</th>
        <th class="num">SL nhập</th><th class="num v">GT nhập</th><th class="num">SL xuất</th><th class="num v">GT xuất</th><th class="num">SL tồn</th><th class="num v">GT tồn</th></tr></thead><tbody>
      <tr><td colspan="${V ? 8 : 5}"><i>Số dư đầu kỳ</i></td><td class="num">${fmtN(r.open_qty, 3)}</td><td class="num v">${fmtM(r.open_val)}</td></tr>
      ${r.lines.map((l) => `<tr><td>${fmtD(l.date)}</td><td><a href="#/voucher/${l.voucher_id}">${esc(l.number)}</a></td><td>${esc(l.partner || l.description)}</td>
        <td class="num v">${fmtN(l.price)}</td>
        ${l.type === 'N' ? `<td class="num">${fmtN(l.qty, 3)}</td><td class="num v">${fmtM(l.value)}</td><td></td><td class="v"></td>` : `<td></td><td class="v"></td><td class="num">${fmtN(l.qty, 3)}</td><td class="num v">${fmtM(l.value)}</td>`}
        <td class="num">${fmtN(l.bal_qty, 3)}</td><td class="num v">${fmtM(l.bal_val)}</td></tr>`).join('')}
      </tbody></table></div>
      <h2>Đơn giá bình quân từng kỳ</h2>
      <div class="table-wrap"><table><thead><tr><th>Kỳ</th><th class="num">SL tồn đầu</th><th class="num v">GT tồn đầu</th><th class="num">SL nhập</th><th class="num v">GT nhập</th><th class="num v">Đơn giá BQ</th><th class="num">SL xuất</th><th class="num v">GT xuất</th><th class="num">SL tồn cuối</th><th class="num v">GT tồn cuối</th></tr></thead><tbody>
      ${r.months.map((m) => `<tr><td>${m.month}</td><td class="num">${fmtN(m.open_qty, 3)}</td><td class="num v">${fmtM(m.open_val)}</td><td class="num">${fmtN(m.in_qty, 3)}</td><td class="num v">${fmtM(m.in_val)}</td>
        <td class="num v"><b>${fmtN(m.avg)}</b></td><td class="num">${fmtN(m.out_qty, 3)}</td><td class="num v">${fmtM(m.out_val)}</td><td class="num">${fmtN(m.close_qty, 3)}</td><td class="num v">${fmtM(m.close_val)}</td></tr>`).join('')}
      </tbody></table></div>`;
  };
  $('#lg-go').addEventListener('click', () => load().catch((e) => toast(e.message, true)));
  if (items.length) await load();
}

// ---------- Người dùng ----------
async function pageUsers() {
  const users = await api('/api/users');
  const sessions = await api('/api/sessions');
  const ROLE = ROLE_NAMES;
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
    <h2 class="wide" style="margin:12px 0 0">Số chứng từ tự động</h2>
    <label>Ký hiệu phiếu nhập kho<input name="number_prefix_N" value="${esc(s.number_prefix_N)}" maxlength="12"></label>
    <label>Ký hiệu phiếu xuất kho bán hàng<input name="number_prefix_X" value="${esc(s.number_prefix_X)}" maxlength="12"></label>
    <label>Số chữ số<input name="number_digits" type="number" min="3" max="10" value="${esc(s.number_digits)}"></label>
    <p class="muted wide" style="margin:0" id="num-preview"></p>
    </form><p class="muted">Số dư tồn kho nhập trong danh mục vật tư là số dư cuối ngày A. Mọi chứng từ phải có ngày sau ngày A. Không đổi được ngày A khi đã có chứng từ trước ngày đó hoặc đã khóa sổ.</p>
    <button class="btn primary" id="s-save">Lưu cài đặt</button></div>
    <div class="card" id="backup-card"><h2 style="margin-top:0">Sao lưu dữ liệu</h2>
      <p class="muted">Tải về toàn bộ dữ liệu (danh mục, chứng từ, người dùng, nhật ký) thành 1 file .db. Nên tải định kỳ và cất ở nơi an toàn. File PDF đính kèm không nằm trong bản sao lưu này.</p>
      <a class="btn" href="/api/backup">Tải bản sao lưu dữ liệu</a></div>`;
  const preview = () => {
    const d = Number($('[name=number_digits]').value) || 5;
    $('#num-preview').textContent = `Ví dụ: phiếu nhập ${$('[name=number_prefix_N]').value}${'1'.padStart(d, '0')}, phiếu xuất ${$('[name=number_prefix_X]').value}${'1'.padStart(d, '0')}. Số tiếp theo = số lớn nhất đang có cùng ký hiệu + 1.`;
  };
  $$('#s-form [name^=number_]').forEach((i) => i.addEventListener('input', preview)); preview();
  $('#s-save').addEventListener('click', async () => {
    const body = Object.fromEntries(new FormData($('#s-form')));
    if (!body.opening_date) delete body.opening_date;
    body.number_digits = Number(body.number_digits);
    try { await api('/api/settings', { method: 'PUT', body }); toast('Đã lưu'); await boot(); } catch (err) { toast(err.message, true); }
  });
}

// ---------- Cập nhật phần mềm ----------
async function pageUpdate() {
  const v = await api('/api/version');
  const MODE = { app: 'App trên máy (KhoETC)', docker: 'Máy chủ online (Docker)', node: 'Chạy từ mã nguồn' };
  $('#main').innerHTML = `<h1>Cập nhật phần mềm</h1>
    <div class="card"><div class="ver-grid">
      <div><div class="muted small">Phiên bản đang chạy</div><div class="ver-big">${esc(v.version)}</div></div>
      <div><div class="muted small">Nguồn</div><div>${v.running_update ? `Bản cập nhật (bản gốc ${esc(v.builtin_version)})` : 'Bản gốc'}</div></div>
      <div><div class="muted small">Kiểu chạy</div><div>${esc(MODE[v.mode] || v.mode)}</div></div>
    </div></div>
    <div class="alert info">Trước khi cập nhật, phần mềm tự <b>sao lưu dữ liệu</b> (thư mục data/backups) rồi tự khởi động lại; dữ liệu được giữ nguyên.
      Nên báo người dùng khác thoát ra trong lúc cập nhật (khoảng 10–30 giây).</div>
    <div class="card"><h2 style="margin-top:0">Cập nhật qua mạng</h2>
      <div class="toolbar"><button class="btn primary" id="up-check">Kiểm tra cập nhật</button><span id="up-result" class="muted"></span></div>
      <details><summary class="muted">Địa chỉ kiểm tra cập nhật</summary>
        <div class="toolbar" style="margin-top:8px"><input id="up-url" style="flex:1;min-width:240px" value="${esc(v.update_url)}"><button class="btn" id="up-url-save">Lưu địa chỉ</button></div>
        <p class="muted small">Mặc định lấy file latest.json trong bản phát hành mới nhất (Releases) của kho GitHub. Kho để chế độ riêng tư thì dùng cách tải gói lên bên dưới.</p></details>
    </div>
    <div class="card"><h2 style="margin-top:0">Cập nhật bằng file</h2>
      <p class="muted">Chọn file gói cập nhật <b>KhoETC-update-x.y.z.khoupd</b>.</p>
      <label class="btn">Chọn file gói cập nhật<input type="file" id="up-file" accept=".khoupd" hidden></label>
    </div>
    ${v.running_update ? `<div class="card"><h2 style="margin-top:0">Quay về bản gốc</h2><p class="muted">Gỡ bản cập nhật ${esc(v.version)}, chạy lại bản gốc ${esc(v.builtin_version)} đi kèm phần mềm. Dữ liệu giữ nguyên.</p>
      <button class="btn danger" id="up-rollback">Quay về bản gốc ${esc(v.builtin_version)}</button></div>` : ''}
    <div id="up-progress"></div>`;
  // Chờ phần mềm khởi động lại với phiên bản mới rồi tải lại trang
  const waitRestart = async (target) => {
    $('#up-progress').innerHTML = `<div class="alert info"><b>Đang khởi động lại phần mềm${target ? ' với phiên bản ' + esc(target) : ''}…</b> Trang sẽ tự tải lại.</div>`;
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 1500));
    while (Date.now() - t0 < 120000) {
      try {
        const r = await fetch('/api/version', { credentials: 'same-origin' });
        if (r.ok) { const d = await r.json(); if (!target || d.version === target) { location.reload(); return; } }
      } catch { /* đang khởi động lại */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    $('#up-progress').innerHTML = '<div class="alert">Phần mềm chưa khởi động lại sau 2 phút. Hãy mở lại phần mềm (bấm KhoETC.exe) rồi tải lại trang.</div>';
  };
  $('#up-url-save').addEventListener('click', async () => {
    try { await api('/api/update/url', { method: 'PUT', body: { url: $('#up-url').value } }); toast('Đã lưu địa chỉ kiểm tra cập nhật'); } catch (err) { toast(err.message, true); }
  });
  $('#up-check').addEventListener('click', async () => {
    $('#up-result').textContent = 'Đang kiểm tra…';
    try {
      const r = await api('/api/update/check', { method: 'POST' });
      if (!r.available) { $('#up-result').textContent = `Đang dùng phiên bản mới nhất (${r.current}).`; return; }
      $('#up-result').innerHTML = `Có phiên bản mới <b>${esc(r.latest)}</b>. <button class="btn primary small" id="up-go">Cập nhật ngay</button>${r.notes ? `<div class="up-notes">${esc(r.notes)}</div>` : ''}`;
      $('#up-go').addEventListener('click', async () => {
        if (!confirm(`Cập nhật lên phiên bản ${r.latest}? Phần mềm sẽ sao lưu dữ liệu rồi khởi động lại.`)) return;
        try { const d = await api('/api/update/download', { method: 'POST' }); toast(`Đã cài phiên bản ${d.version}, sao lưu: ${d.backup}`); waitRestart(d.version); }
        catch (err) { toast(err.message, true); }
      });
    } catch (err) { $('#up-result').textContent = ''; toast(err.message, true); }
  });
  $('#up-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!confirm(`Cập nhật phần mềm bằng file ${f.name}? Phần mềm sẽ sao lưu dữ liệu rồi khởi động lại.`)) return;
    const fd = new FormData(); fd.append('file', f);
    $('#up-progress').innerHTML = '<div class="alert info">Đang tải gói cập nhật lên…</div>';
    try { const d = await api('/api/update/upload', { method: 'POST', body: fd }); toast(`Đã cài phiên bản ${d.version}, sao lưu: ${d.backup}`); waitRestart(d.version); }
    catch (err) { $('#up-progress').innerHTML = ''; toast(err.message, true); }
  });
  $('#up-rollback')?.addEventListener('click', async () => {
    if (!confirm(`Gỡ bản cập nhật ${v.version} và quay về bản gốc ${v.builtin_version}?`)) return;
    try { const d = await api('/api/update/rollback', { method: 'POST' }); waitRestart(d.version); } catch (err) { toast(err.message, true); }
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

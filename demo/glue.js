// Phần bổ sung riêng cho bản demo trực tuyến
'use strict';
// Hộp xác nhận / nhập liệu trong trang (khung demo không hiện confirm()/prompt() của trình duyệt)
function uiConfirm(message) {
  return new Promise((resolve) => {
    modal(`<p>${esc(message)}</p><div class="actions"><button class="btn" data-close id="cf-no">Hủy</button><button class="btn primary" id="cf-yes">Đồng ý</button></div>`, (bg, close) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      $('#cf-yes', bg).addEventListener('click', () => { finish(true); close(); });
      new MutationObserver((_, o) => { if (!bg.isConnected) { finish(false); o.disconnect(); } }).observe(document.body, { childList: true });
      $('#cf-yes', bg).focus();
    });
  });
}
function uiPrompt(message) {
  return new Promise((resolve) => {
    modal(`<p>${esc(message)}</p><input id="pr-input" type="text" style="width:100%"><div class="actions"><button class="btn" data-close>Hủy</button><button class="btn primary" id="pr-ok">Đồng ý</button></div>`, (bg, close) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      $('#pr-ok', bg).addEventListener('click', () => { finish($('#pr-input', bg).value); close(); });
      new MutationObserver((_, o) => { if (!bg.isConnected) { finish(null); o.disconnect(); } }).observe(document.body, { childList: true });
      $('#pr-input', bg).focus();
    });
  });
}
// Mẫu phiếu: hiển thị trong hộp thoại (tách kiểu chữ bằng shadow DOM)
function showPaper(html) {
  modal(`<div class="paper-host"></div><div class="actions"><span class="muted" style="margin-right:auto">Bản cài đặt trên máy có nút In trực tiếp.</span><button class="btn" data-close>Đóng</button></div>`, (bg) => {
    bg.querySelector('.modal').classList.add('wide');
    const root = $('.paper-host', bg).attachShadow({ mode: 'open' });
    root.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace('body{', ':host{display:block;padding:20px;').replace('margin:30px', '');
  });
}
function showColumns() {
  modal(`<h2>Định dạng file Excel danh mục &amp; tồn đầu</h2>
    <p>Dòng 1 là tiêu đề, dữ liệu từ dòng 2, theo đúng thứ tự cột:</p>
    <div class="table-wrap"><table><tr><th>A</th><th>B</th><th>C</th><th>D</th><th>E</th><th>F</th></tr>
    <tr><td>Mã hàng</td><td>Tên hàng</td><td>ĐVT</td><td>SL tồn đầu kỳ</td><td>Giá trị tồn đầu kỳ</td><td>Ghi chú</td></tr>
    <tr><td>VT001</td><td>Xi măng PCB40</td><td>Bao</td><td>100</td><td>8500000</td><td></td></tr></table></div>
    <p class="muted">Mã đã có sẽ được cập nhật, mã mới sẽ được thêm.</p><div class="actions"><button class="btn primary" data-close>Đã hiểu</button></div>`);
}
// Xem PDF gốc đính kèm
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a[href^="/api/attachments/"]');
  if (!a) return;
  e.preventDefault();
  const buf = window.KHO_DEMO.getAttachment(a.getAttribute('href').split('/').pop());
  if (!buf) return toast('Bản demo chỉ giữ file PDF gốc trong phiên đang mở. Bản cài đặt lưu file kèm chứng từ vĩnh viễn.', true);
  modal('<div class="pdf-pages"></div><div class="actions"><button class="btn" data-close>Đóng</button></div>', async (bg) => {
    bg.querySelector('.modal').classList.add('wide');
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
    for (let n = 1; n <= Math.min(pdf.numPages, 5); n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1.5 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      $('.pdf-pages', bg).appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  });
}, true);
// Nút "Thử với PDF mẫu" trên form phiếu
function b64ToBytes(b64) { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
new MutationObserver(() => {
  const drop = document.getElementById('pdf-drop');
  if (!drop || document.getElementById('pdf-sample')) return;
  const row = document.createElement('div');
  row.className = 'sample-row';
  row.innerHTML = '<button class="btn" id="pdf-sample" type="button">Chưa có file? Thử với PDF phiếu xuất kho mẫu</button>';
  drop.after(row);
  row.querySelector('button').addEventListener('click', () => {
    const file = new File([b64ToBytes(window.SAMPLE_PDF)], 'phieu_xuat_kho_mau_XK-PDF-0015.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.getElementById('pdf-file'); input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
}).observe(document.body, { childList: true, subtree: true });
document.getElementById('demo-reset')?.addEventListener('click', async () => {
  if (!(await uiConfirm('Xóa mọi thay đổi và nạp lại dữ liệu mẫu ban đầu?'))) return;
  window.KHO_DEMO.resetDemo(); location.hash = '#dashboard'; location.reload();
});
document.getElementById('demo-reset-login')?.addEventListener('click', () => { window.KHO_DEMO.resetDemo(); toast('Đã nạp lại dữ liệu mẫu'); });

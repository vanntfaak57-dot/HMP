// Sinh file PDF phiếu xuất kho mẫu (giống mẫu 02-VT) để kiểm thử chức năng đọc PDF
const { chromium } = require('playwright');
const out = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(`<html><body style="font-family:'Times New Roman',serif;font-size:13px;padding:30px">
  <div><b>CÔNG TY TNHH THƯƠNG MẠI ABC</b><br>Địa chỉ: 12 Lê Lợi, Hà Nội</div>
  <h2 style="text-align:center">PHIẾU XUẤT KHO</h2>
  <div style="text-align:center">Ngày 15 tháng 10 năm 2026</div>
  <div style="text-align:right">Số: XK-PDF-0015</div>
  <p>Họ và tên người nhận hàng: Công ty CP Xây dựng Minh Phát</p>
  <p>Mã số thuế: 0101234567</p>
  <p>Lý do xuất kho: Xuất bán theo hợp đồng 12/HĐ</p>
  <table border="1" cellspacing="0" cellpadding="6" style="width:100%;border-collapse:collapse">
   <tr><th>STT</th><th>Tên hàng</th><th>Mã số</th><th>ĐVT</th><th>SL yêu cầu</th><th>SL thực xuất</th><th>Đơn giá</th><th>Thành tiền</th></tr>
   <tr><td>1</td><td>Xi măng PCB40</td><td>VT001</td><td>Bao</td><td>120</td><td>120</td><td>100.000</td><td>12.000.000</td></tr>
   <tr><td>2</td><td>Thép cuộn D6</td><td>VT002</td><td>Kg</td><td>200</td><td>200</td><td>18.000</td><td>3.600.000</td></tr>
   <tr><td>3</td><td>Gạch ốp lát 60x60</td><td>GACH60</td><td>Thùng</td><td>5</td><td>5</td><td>250.000</td><td>1.250.000</td></tr>
   <tr><td colspan="7">Cộng</td><td>16.850.000</td></tr>
  </table></body></html>`);
  await p.pdf({ path: out, format: 'A4' });
  await b.close();
})();

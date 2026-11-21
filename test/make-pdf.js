// Sinh file PDF phiếu xuất kho bán hàng mẫu (cùng bố cục mẫu phiếu của đơn vị) để kiểm thử chức năng đọc PDF
const { chromium } = require('playwright');
const out = process.argv[2];
const rows = [
  [1, 'VT001', 'Xi măng PCB40', 'Bao', 'KHO1', 120, '108.000,00', '100.000,00', '12.000.000', '0,00', 8],
  [2, 'VT002', 'Thép cuộn D6', 'Kg', 'KHO1', 200, '19.800,00', '18.000,00', '3.600.000', '0,00', 10],
  [3, 'GACH60', 'Gạch ốp lát 60x60', 'Thùng', 'KHO1', 5, '270.000,00', '250.000,00', '1.250.000', '0,00', 8],
];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(`<html><body style="font-family:'Times New Roman',serif;font-size:13px;padding:24px 30px">
  <div style="display:flex;justify-content:space-between"><div style="font-size:12px"><b>KHO HÀNG ETC MDA</b><br>Số 1 đường Mẫu, Hà Nội</div><b style="align-self:flex-end">0100000000</b></div>
  <h2 style="text-align:center;margin:18px 0 2px">PHIẾU XUẤT KHO BÁN HÀNG</h2>
  <div style="text-align:center;font-style:italic;font-weight:bold">Ngày 15 tháng 10 năm 2026</div>
  <div style="text-align:center;margin:4px 0 12px">Số: <b>XK-PDF-0015</b></div>
  <div><b>- Tên khách hàng:</b> Công ty CP Xây dựng Minh Phát</div>
  <div><b>- Địa chỉ:</b> 12 Láng Hạ, Đống Đa, Hà Nội</div>
  <div><b><i><u>- Địa điểm giao hàng:</u></i></b> Công trình Tòa nhà Minh Phát, Long Biên</div>
  <div><b>- Tên người liên hệ:</b> Anh Tuấn</div>
  <div><b>- Điện thoại:</b> 0912345678</div>
  <div><b>- Mã số thuế:</b> 0101234567</div>
  <div><b>- Diễn giải:</b> Xuất bán theo hợp đồng 12/HĐ</div>
  <div><b>- Nhân viên bán hàng:</b> Nguyễn Văn Bình</div>
  <div style="margin-left:18px">Mã kho: KHO1</div>
  <div style="margin-left:18px">Số phiếu xuất: XKCH7050</div>
  <table border="1" cellspacing="0" cellpadding="4" style="width:100%;border-collapse:collapse;margin-top:4px;font-size:12px">
   <tr><th>TT</th><th>Mã hàng</th><th>Tên hàng</th><th>Đơn vị</th><th>Mã kho</th><th>Số lượng</th><th>Đơn giá (+VAT)</th><th>Đơn giá (-VAT)</th><th>Thành tiền</th><th>Tỷ lệ CK (%)</th><th>% thuế GTGT</th></tr>
   ${rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${i >= 5 ? 'right' : 'left'}">${c}</td>`).join('')}</tr>`).join('')}
   <tr><td colspan="8"><b>Cộng</b></td><td style="text-align:right"><b>16.850.000</b></td><td></td><td></td></tr>
  </table>
  <table style="width:100%;border:1px solid #000;border-top:none;border-collapse:collapse;font-size:12px">
   <tr><td style="width:45%"></td><td>Cộng tiền hàng</td><td style="text-align:right"><b>16.850.000</b></td></tr>
   <tr><td>Thuế suất thuế GTGT:</td><td><b>Tiền thuế GTGT:</b></td><td style="text-align:right"><b>1.420.000</b></td></tr>
   <tr><td></td><td>Tổng tiền thanh toán</td><td style="text-align:right"><b>18.270.000</b></td></tr>
  </table>
  <p>Số tiền bằng chữ: <b><i>Mười tám triệu hai trăm bảy mươi nghìn đồng chẵn.</i></b></p>
  </body></html>`);
  await p.pdf({ path: out, format: 'A4' });
  await b.close();
})();

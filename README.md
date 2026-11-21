# Ứng dụng Quản lý kho

Ứng dụng web quản lý nhập – xuất – tồn kho, tính giá vốn theo phương pháp **bình quân gia quyền cuối kỳ (theo tháng)**, có đăng nhập và nhật ký truy cập. Dữ liệu lưu trong một file SQLite trên máy của bạn (`data/kho.db`).

## Cài đặt & chạy

Yêu cầu: Node.js 22.13 trở lên.

```bash
npm install
npm start
```

Mở trình duyệt: http://127.0.0.1:3000 — đăng nhập lần đầu bằng `admin` / `admin@123`, hệ thống bắt buộc đổi mật khẩu ngay.

Biến môi trường tùy chọn: `PORT` (mặc định 3000), `HOST` (mặc định 127.0.0.1; đặt `0.0.0.0` để máy khác trong mạng LAN truy cập), `DATA_DIR` (thư mục dữ liệu), `ADMIN_PASSWORD` (mật khẩu admin ban đầu), `COOKIE_SECURE=1` (khi chạy sau HTTPS).

## Quy trình sử dụng

1. **Cài đặt** → nhập tên đơn vị và **ngày chốt số dư đầu kỳ (ngày A)**.
2. **Vật tư hàng hóa & tồn đầu** → tải *file Excel mẫu*, điền Mã / Tên / ĐVT / SL tồn / Giá trị tồn tại ngày A / Ghi chú / Thuế suất GTGT / Giá bán (+VAT), rồi *Nhập từ Excel* (hoặc thêm từng mã).
3. **Danh mục khách hàng** và **Danh mục nhà cung cấp** (hai danh mục riêng, mỗi dòng gồm Mã / Tên / Mã số thuế) → thêm từng dòng hoặc nhập từ Excel 3 cột: Mã, Tên, MST. Mã chỉ cần không trùng trong cùng danh mục.
4. **Phiếu nhập kho / Phiếu xuất kho bán hàng** → *Thêm phiếu*:
   - kéo thả file **PDF** phiếu xuất kho / hóa đơn → hệ thống tự đọc số phiếu, ngày, khách hàng, lý do, các dòng hàng (mã, số lượng, đơn giá, thành tiền). Dòng có mã chưa có trong danh mục sẽ được liệt kê để chọn mã hoặc tạo mã mới. Kiểm tra lại rồi bấm *Lưu*. File PDF gốc được lưu kèm chứng từ.
   - hoặc nhập tay.
   - Chọn khách hàng (phiếu xuất) hoặc nhà cung cấp (phiếu nhập) trong danh mục tương ứng; tên tự điền. Khi đọc PDF, hệ thống tự nhận đối tượng theo mã số thuế hoặc tên; nếu chưa có thì gợi ý thêm vào danh mục.
   - Đơn giá: nhập vào cột **Đơn giá (+VAT)** thì phần mềm tự chia ra đơn giá chưa thuế theo % thuế GTGT của dòng; nhập vào cột **Đơn giá (-VAT)** thì giữ nguyên giá đó. Có cột CK (%), tiền thuế GTGT, tổng tiền thanh toán và số tiền bằng chữ.
   - Gợi ý giá: khi chọn khách hàng và mã hàng, phần mềm tự điền **đơn giá lần gần nhất bán mặt hàng đó cho khách đó**; khách chưa từng mua thì điền **giá bán khai báo trong danh mục vật tư**. Phiếu nhập gợi ý giá mua lần trước của nhà cung cấp.
   - **Ghi sổ / Bỏ ghi** (áp dụng cho cả phiếu nhập và phiếu xuất): bấm *Cất & ghi sổ* là chứng từ được ghi sổ và chỉ xem được. Muốn sửa phải bấm **Bỏ ghi**: trong thời gian chưa ghi sổ, chứng từ không được tính vào tồn kho, giá vốn, báo cáo và gợi ý giá; sửa xong bấm *Cất & ghi sổ*. Danh sách phiếu có cột trạng thái và nút ghi sổ / bỏ ghi hàng loạt. Không bỏ ghi được nếu kỳ đã khóa sổ hoặc việc bỏ ghi làm âm kho.
   - Hệ thống chặn chứng từ trước ngày A, chặn xuất âm kho, chặn trùng số phiếu.
5. **Tính giá xuất kho** → chọn tháng, bấm *Tính giá đến kỳ này*. Giá vốn được ghi vào từng dòng phiếu xuất.
6. **Báo cáo**: Dashboard phân tích (doanh thu, giá vốn, lãi gộp, nhập kho, tồn kho theo tháng; top khách hàng, mặt hàng, nhà cung cấp), Tổng hợp nhập-xuất-tồn (xuất Excel, in), Sổ chi tiết vật tư, Tổng hợp theo đối tượng (bán hàng theo khách hàng có lãi gộp, mua hàng theo nhà cung cấp; bấm vào tên để xem chi tiết theo mặt hàng và chứng từ).
7. **Khóa sổ** (admin) kỳ đã tính giá để không ai sửa/xóa chứng từ trong kỳ.

## Cách tính giá vốn

Với mỗi mã hàng, trong mỗi tháng:

- Đơn giá BQ = (Giá trị tồn đầu kỳ + Giá trị nhập trong kỳ) / (SL tồn đầu kỳ + SL nhập trong kỳ)
- Giá vốn mỗi dòng xuất = SL xuất × Đơn giá BQ (làm tròn đồng)
- Tồn cuối tháng = tồn đầu tháng sau. Khi xuất hết hàng, chênh lệch làm tròn dồn vào dòng xuất cuối để giá trị tồn về 0.

Trên phiếu xuất: *Đơn giá bán / Doanh thu* là giá bán (lấy từ PDF hoặc nhập tay); *Đơn giá vốn / Tiền vốn* do hệ thống tính.

## Bảo mật & nhật ký

- Mật khẩu mã hóa scrypt; tối thiểu 8 ký tự gồm chữ và số; nhập sai 5 lần khóa 15 phút; phiên hết hạn sau 8 giờ không hoạt động.
- Vai trò (chỉ **Quản trị** được thêm / sửa người dùng):
  - **Quản trị**: toàn quyền.
  - **Kế toán**: xem toàn bộ dữ liệu, nhập liệu, tính giá.
  - **Thủ kho**: chỉ xem **số lượng** (danh mục, phiếu, nhập-xuất-tồn, sổ chi tiết, mẫu in số lượng); mọi giá trị tiền bị máy chủ loại bỏ, không xem được dashboard phân tích, báo cáo theo đối tượng, giá gần nhất, file PDF gốc.
  - **Chỉ xem**: xem toàn bộ, không sửa.
- **Nhật ký truy cập** ghi: đăng nhập thành công/thất bại, đăng xuất, đổi mật khẩu, thêm/sửa/xóa mã hàng và chứng từ (kèm nội dung trước khi sửa), tải PDF, tính giá, khóa sổ, xuất báo cáo — kèm thời gian, IP, trình duyệt. Trang *Người dùng* hiển thị các phiên đang đăng nhập.

## Sao lưu

Toàn bộ dữ liệu nằm trong thư mục `data/` (CSDL + file PDF đính kèm). Sao chép thư mục này định kỳ để sao lưu.

## Giới hạn hiện tại

- Chỉ đọc được PDF có lớp chữ (xuất từ phần mềm kế toán/hóa đơn điện tử). PDF dạng ảnh scan cần nhập tay.
- Một kho duy nhất; chưa có các loại phiếu khác (trả lại hàng, xuất nội bộ, chuyển kho).

## Dùng chung trong mạng nội bộ

Máy cài phần mềm là máy chủ; máy tính / điện thoại khác cùng mạng (wifi, LAN) mở trình duyệt để dùng, mỗi người một tài khoản, dữ liệu dùng chung.
Bật: Quản trị vào **Cài đặt → Dùng chung trong mạng nội bộ → Bật** (phần mềm tự khởi động lại và hiện đường link + mã QR, ví dụ `http://192.168.1.10:3000`).
Cấu hình lưu trong `kho-config.json` cạnh file chạy (`"host": "0.0.0.0"`). App Windows kèm `MO-TUONG-LUA.bat` (mở tường lửa) và `TU-DONG-CHAY-KHI-BAT-MAY.bat`.

## Đóng gói thành app riêng (không cần cài Node.js)

```bash
npm run build:app
```

Tạo `build/dist/KhoETC-Windows-x64.zip` (file `KhoETC.exe`) và bản Linux. Người dùng chỉ cần giải nén, bấm đúp `KhoETC.exe`: trình duyệt tự mở phần mềm, dữ liệu nằm trong thư mục `data` cạnh file chạy. Xem `tools/HUONG-DAN-APP.txt`.

## Cập nhật phần mềm

Quản trị vào **Hệ thống → Cập nhật phần mềm**:
- **Kiểm tra cập nhật**: đọc `latest.json` trong bản phát hành mới nhất (Releases) của kho GitHub, tải gói `.khoupd`, kiểm tra SHA256, cài đặt.
- **Cập nhật bằng file**: tải lên file `KhoETC-update-x.y.z.khoupd`.
- Trước khi cài, phần mềm tự sao lưu CSDL vào `data/backups`, ghi bản mới vào `data/app`, rồi tự khởi động lại (app trên máy: mở tiến trình mới; Docker/Render: container tự khởi động lại). Bản cập nhật lỗi khi khởi động thì tự quay về bản gốc; có nút **Quay về bản gốc**.

Phát hành phiên bản mới:
1. Tăng `version` trong `package.json`, ghi thay đổi vào `CHANGELOG.md`.
2. `npm run build:app` → `build/dist/` có `KhoETC-update-x.y.z.khoupd`, `latest.json`, `KhoETC-Windows-x64.zip`, `KhoETC-Linux-x64.zip`.
3. Tạo Release trên GitHub, đính kèm các file trên (bắt buộc có `latest.json` và file `.khoupd`).

## Kiểm thử

```bash
npm test                 # nghiệp vụ
node test/test-update.js # cập nhật phần mềm
node test/test-lan.js    # dùng chung trong mạng nội bộ
```

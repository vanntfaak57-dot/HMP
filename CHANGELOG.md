# Lịch sử phiên bản

## 1.3.0
- Truy cập từ Internet bằng tên miền riêng qua Cloudflare Tunnel: Cài đặt → Truy cập từ Internet, dán token đường hầm từ Cloudflare. Phần mềm tự tải cloudflared, tự chạy đường hầm mỗi khi mở, hiện trạng thái kết nối.
- Nhận biết truy cập qua Cloudflare: cookie đăng nhập chỉ gửi qua HTTPS, nhật ký ghi IP thật của người dùng.
- Khôi phục dữ liệu từ bản sao lưu (Cài đặt → Sao lưu dữ liệu → Khôi phục), tự cất dữ liệu cũ trước khi thay.

## 1.2.0
- Dùng chung trong mạng nội bộ: Cài đặt → Dùng chung trong mạng nội bộ → Bật. Máy tính, điện thoại khác cùng mạng mở đường link (có mã QR) để dùng, đăng nhập bằng tài khoản riêng, dữ liệu dùng chung.
- App Windows chạy ngầm, không còn cửa sổ đen; thêm nút Cài đặt → Tắt phần mềm. Nhật ký kỹ thuật ghi vào data/logs/kho.log.
- Không ghi các thông báo kiểm tra dữ liệu (ví dụ "Chưa thiết lập ngày chốt số dư") thành lỗi kỹ thuật.
- Thêm MO-TUONG-LUA.bat (mở tường lửa) và TU-DONG-CHAY-KHI-BAT-MAY.bat (tự chạy khi bật máy).

## 1.1.0
- Thêm chức năng Cập nhật phần mềm (Hệ thống → Cập nhật phần mềm): kiểm tra và cài bản mới qua mạng hoặc bằng file .khoupd; tự sao lưu dữ liệu trước khi cập nhật; có nút quay về bản gốc.
- Hiển thị số phiên bản ở góc dưới menu.

## 1.0.0
- Phiên bản đầu tiên: danh mục vật tư, khách hàng, nhà cung cấp; phiếu nhập/xuất (nhập tay hoặc đọc PDF), ghi sổ/bỏ ghi; giá vốn bình quân gia quyền cuối kỳ; báo cáo nhập-xuất-tồn, sổ chi tiết, theo đối tượng, dashboard; phân quyền Quản trị/Kế toán/Thủ kho/Chỉ xem; nhật ký truy cập.

# Lịch sử phiên bản

## 1.4.1
- Sửa lỗi giao diện hiển thị sai (biểu tượng to, bố cục vỡ) sau khi cập nhật do trình duyệt / Cloudflare dùng lại file cũ: đường dẫn css/js nay gắn số phiên bản, trang chính không lưu tạm.

## 1.4.0
- Giao diện mới theo phong cách phần mềm kế toán doanh nghiệp: thanh trên màu trắng, menu trái có biểu tượng (thu gọn được), bảng kẻ ô gọn gàng, tự chuyển nền tối theo máy.
- Báo cáo nhập – xuất – tồn: cố định dòng tiêu đề, thêm dòng lọc theo từng cột (gõ không dấu; cột số gõ >0, <100, =5…), dòng tổng tự tính theo dòng đang hiện.
- Sổ chi tiết vật tư: chọn nhiều mặt hàng cùng lúc, có bảng tổng hợp và sổ chi tiết từng mã.
- Báo cáo mới: Bán hàng theo mặt hàng (theo khoảng ngày, khách hàng, nhiều mặt hàng; doanh thu, giá vốn, lãi gộp, chi tiết từng lần bán).
- Tổng hợp theo đối tượng: tìm kiếm, lọc từng cột, cố định tiêu đề.
- Nhật ký từng chứng từ: ai tạo, xem, sửa, ghi sổ/bỏ ghi, xóa, thời gian, địa chỉ IP.
- Thủ kho chỉ xem, tra cứu; máy chủ chặn mọi thao tác nhập liệu, sửa, quản trị.
- Bảo mật: chặn IP đăng nhập sai nhiều lần, không dò được tên đăng nhập, mật khẩu mạnh hơn (không chứa tên đăng nhập), chặn đăng nhập qua Internet khi còn mật khẩu ban đầu, chống giả mạo yêu cầu từ trang khác, chính sách nội dung (CSP).

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

# Đưa phần mềm Quản lý kho lên mạng (máy chủ riêng của bạn)

Phần mềm chạy trên máy chủ của bạn, có địa chỉ riêng (ví dụ `https://kho.tencongty.vn`), dùng được trên máy tính và điện thoại ở bất kỳ đâu. Dữ liệu nằm trên máy chủ của bạn, không phụ thuộc dịch vụ nào khác.

Chọn **một** trong hai cách.

---

## Cách 1 — Thuê VPS (khuyên dùng: rẻ, dữ liệu trong tay bạn)

**Cần chuẩn bị**
- 1 VPS Ubuntu 22.04/24.04, tối thiểu 1 CPU, 1 GB RAM, 20 GB ổ đĩa (khoảng 100–200 nghìn đồng/tháng ở các nhà cung cấp trong nước hoặc quốc tế).
- 1 tên miền (ví dụ `tencongty.vn`). Tạo bản ghi **A** `kho` trỏ về địa chỉ IP của VPS.

**Cài đặt (khoảng 5 phút)**
1. Chép file `KhoETC-Online.zip` lên VPS rồi giải nén:
   ```bash
   unzip KhoETC-Online.zip && cd KhoETC-Online/deploy
   ```
2. Chạy lệnh cài (thay bằng tên miền của bạn):
   ```bash
   sudo bash install-vps.sh kho.tencongty.vn
   ```
   Lệnh tự cài Docker, tạo mật khẩu admin ngẫu nhiên (in ra màn hình — **ghi lại**), dựng phần mềm và tự cấp chứng chỉ HTTPS miễn phí.
3. Mở `https://kho.tencongty.vn`, đăng nhập `admin` với mật khẩu vừa in ra, đổi mật khẩu, vào **Cài đặt** điền thông tin đơn vị.

**Vận hành**
- Dữ liệu: thư mục `deploy/data` trên VPS. Sao lưu: vào **Cài đặt → Tải bản sao lưu dữ liệu** (nên làm hằng tuần), hoặc chép thư mục `deploy/data`.
- Cập nhật phiên bản mới: chép mã mới đè lên (giữ nguyên `deploy/data` và `deploy/.env`), rồi `cd deploy && sudo docker compose up -d --build`.
- Xem nhật ký máy chủ: `sudo docker compose logs -f app`.
- Quên mật khẩu admin: `sudo docker compose exec app node server.js --reset-admin` (mật khẩu về `admin@123`, bắt buộc đổi).

---

## Cách 2 — Render.com (không cần quản trị máy chủ)

**Chi phí**: gói Starter + ổ đĩa 1 GB, khoảng 7–8 USD/tháng. Gói Free **không** dùng được vì không giữ dữ liệu.

1. Đưa mã nguồn (thư mục `KhoETC-Online`) lên một kho GitHub riêng (private).
2. Vào render.com → **New +** → **Blueprint** → chọn kho GitHub đó. Render đọc file `render.yaml` và tự tạo dịch vụ kèm ổ đĩa lưu dữ liệu.
3. Khi dịch vụ chạy xong, vào mục **Environment** của dịch vụ xem giá trị `ADMIN_PASSWORD` để đăng nhập lần đầu.
4. Có địa chỉ dạng `https://kho-etc-mda.onrender.com`. Muốn dùng tên miền riêng: **Settings → Custom Domains**.

---

## Bảo mật đã có sẵn
- Chỉ truy cập qua HTTPS; cookie đăng nhập chỉ gửi qua HTTPS.
- Mật khẩu mã hóa; nhập sai 5 lần khóa 15 phút; phiên hết hạn sau 8 giờ.
- Nhật ký truy cập ghi IP thật của người dùng.
- Phần mềm chạy bằng tài khoản không có quyền quản trị bên trong container.
- Phân quyền Quản trị / Kế toán / Thủ kho / Chỉ xem.

Khuyến nghị: dùng mật khẩu mạnh cho mọi tài khoản, tải bản sao lưu định kỳ, chỉ cấp tài khoản cho người cần dùng.

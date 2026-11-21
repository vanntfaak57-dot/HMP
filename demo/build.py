# Ghép bản demo trực tuyến thành 1 file HTML: python3 demo/build.py
import base64, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
d = root / 'demo'
app = (root / 'public' / 'app.js').read_text()
html = (root / 'public' / 'index.html').read_text()

def hashfix(s):
    # Khung hiển thị chỉ cho phép hash dạng #ten (không có #/duong/dan)
    for a, b in [('#\\/voucher\\/new\\/', '#voucher-new-'), ('#\\/voucher\\/', '#voucher-'), ('#\\/vouchers\\/', '#vouchers-'),
                 ('#\\/settings', '#cai-dat'), ('#\\/', '#'),
                 ('#/voucher/new/', '#voucher-new-'), ('#/voucher/', '#voucher-'), ('#/vouchers/', '#vouchers-'),
                 ('#/settings', '#cai-dat'), ('#/', '#')]:
        s = s.replace(a, b)
    return s

def rep(s, a, b, count=1):
    assert a in s, a
    return s.replace(a, b) if count is None else s.replace(a, b, count)

partners = (root / 'public' / 'partners.js').read_text()
app = hashfix(app).rsplit('boot();', 1)[0] + '\n' + hashfix(partners)
app = re.sub(r'(?<![\w.])confirm\(', 'await uiConfirm(', app)
app = re.sub(r'(?<![\w.])prompt\(', 'await uiPrompt(', app)
app = rep(app, "const w = window.open('', '_blank');\n  w.document.write(voucherPaperHtml(v));\n  w.document.close();", 'showPaper(voucherPaperHtml(v));')
app = rep(app, '>In phiếu</button>', '>Xem mẫu phiếu</button>')
app = rep(app, '<button class="btn" onclick="print()">In</button>', '', None)
app = rep(app, '<button class="btn" id="r-xlsx">Xuất Excel</button>', '')
app = rep(app, "$('#r-xlsx').addEventListener", "$('#r-xlsx')?.addEventListener")
app = rep(app, '<a class="btn" href="/api/items/template.xlsx">Tải file Excel mẫu</a>', '<button class="btn" type="button" onclick="showColumns()">Định dạng file Excel</button>')
app = rep(app, '<a class="btn" href="/api/partners/template.xlsx?kind=${kind}">Tải file Excel mẫu</a>', '<button class="btn" type="button" onclick="showPartnerColumns(\'${kind}\')">Định dạng file Excel</button>')
app = rep(app, '<a class="btn" href="/api/backup">Tải bản sao lưu dữ liệu</a>', '<span class="muted">Bản demo không tải file được. Bản chạy trên máy chủ có nút tải bản sao lưu ở đây.</span>')
assert '#/' not in app

body = html.split('<body>')[1].split('<script')[0]
body = hashfix(body)
body = rep(body, '<button class="btn primary" type="submit">Đăng nhập</button>',
  '<button class="btn primary" type="submit">Đăng nhập</button>\n      <div class="demo-hint"><b>Tài khoản dùng thử</b><br>Quản trị: <code>admin</code> / <code>admin123</code><br>Kế toán: <code>ketoan</code> / <code>ketoan123</code><br>Thủ kho: <code>thukho</code> / <code>thukho123</code><br>'
  '<span class="muted">Dữ liệu mẫu, lưu trong trình duyệt của bạn.</span> <a href="#" id="demo-reset-login">Nạp lại dữ liệu mẫu</a></div>')
body = rep(body, '<input name="username" autocomplete="username" required autofocus>', '<input name="username" id="login-user" autocomplete="username" required autofocus value="admin">')
body = rep(body, '<input name="password" type="password" autocomplete="current-password" required>', '<input name="password" id="login-pass" type="password" autocomplete="current-password" required value="admin123">')
body = rep(body, '<div class="brand" id="brand">Kho hàng ETC MDA</div>',
  '<div class="brand" id="brand">Kho hàng ETC MDA</div>\n      <div class="demo-tag">Bản demo · dữ liệu lưu trong trình duyệt · <button id="demo-reset" type="button">Nạp lại dữ liệu mẫu</button></div>')

pdf_b64 = base64.b64encode((d / 'sample.pdf').read_bytes()).decode()
out = f'''<title>Quản lý kho</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap">
<style>
{(d / 'demo.css').read_text()}
</style>
{body}
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script>window.SAMPLE_PDF = "{pdf_b64}";</script>
<script>
{(root / 'src' / 'rolefilter.js').read_text()}
{(root / 'src' / 'analytics.js').read_text()}
</script>
<script>
{(d / 'mock.js').read_text()}
</script>
<script>
{app}
{(d / 'glue.js').read_text()}
boot();
</script>
'''
(d / 'dist').mkdir(exist_ok=True)
(d / 'dist' / 'quan-ly-kho-demo.html').write_text(out)
print('OK', len(out))

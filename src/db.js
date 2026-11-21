// Kết nối CSDL SQLite (tích hợp sẵn trong Node.js >= 22) và khởi tạo cấu trúc bảng
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Khôi phục dữ liệu: file restore-pending.db (do chức năng Khôi phục tạo) thay cho CSDL hiện tại khi khởi động;
// CSDL cũ được cất vào data/backups trước khi thay.
const DB_FILE = path.join(DATA_DIR, 'kho.db');
const RESTORE_PENDING = path.join(DATA_DIR, 'restore-pending.db');
let restoredFrom = null;
if (fs.existsSync(RESTORE_PENDING)) {
  const bdir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const old = path.join(bdir, `truoc-khoi-phuc-${stamp}.db`);
  for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(DB_FILE + ext)) fs.renameSync(DB_FILE + ext, old + ext);
  fs.renameSync(RESTORE_PENDING, DB_FILE);
  restoredFrom = path.basename(old);
  console.log(`>> Đã khôi phục dữ liệu từ bản sao lưu. Dữ liệu trước khi khôi phục cất tại backups/${restoredFrom}`);
}
const db = new DatabaseSync(DB_FILE);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'accountant',    -- admin | accountant | storekeeper | viewer
  active INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen TEXT,
  ip TEXT,
  ua TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  unit TEXT,
  opening_qty REAL NOT NULL DEFAULT 0,
  opening_value REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('N','X')),   -- N: nhập kho, X: xuất kho bán hàng
  number TEXT NOT NULL,
  date TEXT NOT NULL,                              -- YYYY-MM-DD
  partner TEXT,                                    -- nhà cung cấp / khách hàng
  address TEXT,
  description TEXT,
  ref_no TEXT,                                     -- số hóa đơn / chứng từ gốc
  source TEXT NOT NULL DEFAULT 'manual',           -- manual | pdf
  attachment TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  UNIQUE (type, number)
);
CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(date);

CREATE TABLE IF NOT EXISTS voucher_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty REAL NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0,   -- Nhập: đơn giá nhập | Xuất: đơn giá bán
  amount REAL NOT NULL DEFAULT 0,       -- Nhập: giá trị nhập | Xuất: doanh thu
  cost_price REAL,                      -- Xuất: đơn giá vốn (BQGQ cuối kỳ)
  cost_amount REAL,                     -- Xuất: tiền vốn
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lines_item ON voucher_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_lines_voucher ON voucher_lines(voucher_id);

CREATE TABLE IF NOT EXISTS periods (
  month TEXT PRIMARY KEY,               -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'dirty', -- dirty: cần tính lại | computed: đã tính giá
  computed_at TEXT,
  computed_by TEXT,
  locked INTEGER NOT NULL DEFAULT 0
);
`);

// Danh mục khách hàng (kind = 'KH') và danh mục nhà cung cấp (kind = 'NCC'): hai danh mục độc lập,
// mã chỉ cần không trùng trong cùng một danh mục.
const PARTNERS_SQL = (name) => `CREATE TABLE ${name} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('KH','NCC')),
  code TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  tax_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE (kind, code)
)`;
const partnerCols = db.prepare('PRAGMA table_info(partners)').all().map((c) => c.name);
if (!partnerCols.length) {
  db.exec(PARTNERS_SQL('partners'));
} else if (!partnerCols.includes('kind')) {
  // Nâng cấp từ bản cũ (một danh mục chung có cờ is_customer / is_supplier):
  // đối tượng vừa là KH vừa là NCC được tách thành 2 bản ghi, phiếu nhập trỏ sang bản ghi NCC mới.
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(PARTNERS_SQL('partners_new'));
    const ins = db.prepare('INSERT INTO partners_new(id, kind, code, name, tax_code, created_at, updated_at) VALUES (?,?,?,?,?,?,?)');
    const insAuto = db.prepare('INSERT INTO partners_new(kind, code, name, tax_code, created_at, updated_at) VALUES (?,?,?,?,?,?)');
    const old = db.prepare('SELECT * FROM partners').all();
    // Bước 1: chép mọi bản ghi cũ, giữ nguyên id (KH nếu là khách hàng, ngược lại NCC)
    for (const p of old) {
      ins.run(p.id, p.is_customer ? 'KH' : 'NCC', p.code, p.name, p.tax_code, p.created_at, p.updated_at);
      // Phiếu trỏ sai loại (không thể xảy ra với dữ liệu hợp lệ) thì bỏ liên kết
      if (!p.is_supplier) db.prepare("UPDATE vouchers SET partner_id = NULL WHERE partner_id = ? AND type = 'N'").run(p.id);
      if (!p.is_customer) db.prepare("UPDATE vouchers SET partner_id = NULL WHERE partner_id = ? AND type = 'X'").run(p.id);
    }
    // Bước 2: đối tượng vừa là KH vừa là NCC -> thêm bản ghi NCC (id mới), chuyển phiếu nhập sang bản ghi này
    for (const p of old.filter((x) => x.is_customer && x.is_supplier)) {
      const r = insAuto.run('NCC', p.code, p.name, p.tax_code, p.created_at, p.updated_at);
      db.prepare("UPDATE vouchers SET partner_id = ? WHERE partner_id = ? AND type = 'N'").run(Number(r.lastInsertRowid), p.id);
    }
    db.exec('DROP TABLE partners');
    db.exec('ALTER TABLE partners_new RENAME TO partners');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
if (!db.prepare('PRAGMA table_info(vouchers)').all().some((c) => c.name === 'partner_id')) {
  db.exec('ALTER TABLE vouchers ADD COLUMN partner_id INTEGER REFERENCES partners(id)');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_vouchers_partner ON vouchers(partner_id)');

// Nâng cấp CSDL cũ: thêm cột thuế suất GTGT nếu chưa có
if (!db.prepare('PRAGMA table_info(items)').all().some((c) => c.name === 'vat_rate')) {
  db.exec('ALTER TABLE items ADD COLUMN vat_rate TEXT');
}

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Chạy một hàm trong giao dịch; lỗi thì hoàn tác toàn bộ
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function getSetting(key, def = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : def;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// Thông tin bổ sung cho mẫu phiếu xuất kho bán hàng
for (const [table, col, def] of [
  ['vouchers', 'tax_code', 'TEXT'], ['vouchers', 'contact', 'TEXT'], ['vouchers', 'phone', 'TEXT'],
  ['vouchers', 'delivery_place', 'TEXT'], ['vouchers', 'salesperson', 'TEXT'], ['vouchers', 'warehouse', 'TEXT'],
  ['voucher_lines', 'discount_rate', 'REAL NOT NULL DEFAULT 0'], ['voucher_lines', 'vat_rate', 'TEXT'], ['voucher_lines', 'vat_amount', 'REAL NOT NULL DEFAULT 0'], ['voucher_lines', 'price_vat', 'REAL'],
  ['items', 'sale_price', 'REAL'], ['items', 'sale_price_vat', 'REAL'],
  ['vouchers', 'posted', 'INTEGER NOT NULL DEFAULT 1'],
  ['audit_log', 'ref', 'TEXT'], // đối tượng liên quan, ví dụ "voucher:12" (nhật ký theo từng chứng từ) // 1: đã ghi sổ, 0: đã bỏ ghi (không tính vào sổ sách)
]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

// Vai trò: admin (Quản trị) | accountant (Kế toán) | storekeeper (Thủ kho) | viewer (Chỉ xem)
db.exec("UPDATE users SET role = 'accountant' WHERE role = 'user'");

db.exec('CREATE INDEX IF NOT EXISTS idx_audit_ref ON audit_log(ref)');

// Tên đơn vị mặc định (đổi được trong Cài đặt)
if (!getSetting('company_name')) setSetting('company_name', 'Kho hàng ETC MDA');

if (restoredFrom) {
  db.prepare('INSERT INTO audit_log(ts, username, action, detail, ip, ua) VALUES (?,?,?,?,?,?)')
    .run(now(), null, 'RESTORE', `Khôi phục dữ liệu từ bản sao lưu; dữ liệu trước khi khôi phục cất tại backups/${restoredFrom}`, 'máy chủ', '');
}

module.exports = { db, tx, now, getSetting, setSetting, DATA_DIR, UPLOAD_DIR, RESTORE_PENDING };

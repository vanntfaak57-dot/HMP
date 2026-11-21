// Kết nối CSDL SQLite (tích hợp sẵn trong Node.js >= 22) và khởi tạo cấu trúc bảng
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'kho.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',          -- admin | user | viewer
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

// Danh mục khách hàng & nhà cung cấp (đối tượng)
db.exec(`CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  is_customer INTEGER NOT NULL DEFAULT 0,
  is_supplier INTEGER NOT NULL DEFAULT 0,
  tax_code TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  contact TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
)`);
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

module.exports = { db, tx, now, getSetting, setSetting, DATA_DIR, UPLOAD_DIR };

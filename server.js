// Ứng dụng Quản lý kho - máy chủ
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
const path = require('path');
const fs = require('fs');

// Chạy dạng app đóng gói (1 file KhoETC.exe): dữ liệu nằm trong thư mục "data" cạnh file chạy.
// Cổng / chế độ mạng đặt trong file kho-config.json cạnh file chạy: { "port": 3000, "host": "127.0.0.1" }
//   host "127.0.0.1": chỉ máy này dùng | host "0.0.0.0": máy khác trong mạng nội bộ truy cập được
let sea = null;
try { sea = require('node:sea'); if (!sea.isSea()) sea = null; } catch { sea = null; }
const BASE_DIR = sea ? path.dirname(process.execPath) : __dirname;
if (sea) {
  process.removeAllListeners('warning'); // ẩn cảnh báo "SQLite is an experimental feature"
  process.env.DATA_DIR = process.env.DATA_DIR || path.join(BASE_DIR, 'data');
}
// App trên máy chạy ngầm (không có cửa sổ): nhật ký kỹ thuật ghi thêm vào data/logs/kho.log
if (sea) {
  try {
    const logDir = path.join(process.env.DATA_DIR, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'kho.log');
    try { if (fs.statSync(logFile).size > 5 * 1048576) fs.renameSync(logFile, logFile + '.1'); } catch { /* chưa có file */ }
    const util = require('util');
    for (const level of ['log', 'warn', 'error']) {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        try { orig(...args); } catch { /* không có cửa sổ để in */ }
        try { fs.appendFileSync(logFile, `[${new Date().toLocaleString('vi-VN')}] ${util.format(...args)}\n`); } catch { /* bỏ qua */ }
      };
    }
  } catch { /* bỏ qua */ }
}
const CONFIG_FILE = process.env.KHO_CONFIG || path.join(BASE_DIR, 'kho-config.json');
let fileCfg = {};
try { fileCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; } catch { fileCfg = {}; }
const express = require('express');
const multer = require('multer');
// Phiên bản phần mềm (gói cập nhật ghi đè qua KHO_BUILD_VERSION lúc đóng gói)
const APP_VERSION = process.env.KHO_BUILD_VERSION || require('./package.json').version;
// Giao diện nhúng sẵn trong bản đóng gói / gói cập nhật (khi chạy từ mã nguồn thì đọc thư mục public)
let EMBEDDED = null;
try { EMBEDDED = require('kho:assets'); } catch { EMBEDDED = null; }
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const { db, tx, now, getSetting, setSetting, UPLOAD_DIR, DATA_DIR, RESTORE_PENDING } = require('./src/db');
const tunnel = require('./src/tunnel');
const auth = require('./src/auth');
const { audit, requireAuth, requireRole } = auth;
const costing = require('./src/costing');
const { parsePdf } = require('./src/pdfparser');
const analytics = require('./src/analytics');
const roles = require('./src/rolefilter');

auth.ensureAdmin();
// Quên mật khẩu admin: chạy  KhoETC.exe --reset-admin  (hoặc node server.js --reset-admin)
if (process.argv.includes('--reset-admin')) {
  db.prepare("UPDATE users SET password_hash = ?, must_change = 1, active = 1, failed_count = 0, locked_until = NULL WHERE username = 'admin'").run(auth.hashPassword('admin@123'));
  db.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'admin')").run();
  db.prepare('INSERT INTO audit_log(ts, username, action, detail, ip, ua) VALUES (?,?,?,?,?,?)').run(now(), 'admin', 'USER_UPDATE', 'Đặt lại mật khẩu admin bằng lệnh --reset-admin', 'máy chủ', '');
  console.log('Đã đặt lại mật khẩu tài khoản admin thành: admin@123 (bắt buộc đổi khi đăng nhập).');
  process.exit(0);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Yêu cầu ghi dữ liệu phải xuất phát từ chính trang của phần mềm
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
    let host = '';
    try { host = new URL(req.headers.origin).host; } catch { host = 'x'; }
    const fwdHost = auth.viaProxy(req) ? String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() : '';
    if (host !== req.headers.host && host !== fwdHost) return res.status(403).json({ error: 'Yêu cầu không hợp lệ (khác nguồn)' });
  }
  if (process.env.COOKIE_SECURE === '1' || auth.isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
// Trang chính: gắn số phiên bản vào đường dẫn css/js để trình duyệt và Cloudflare không dùng lại file cũ sau khi cập nhật
const readAsset = (name) => (EMBEDDED ? (Object.prototype.hasOwnProperty.call(EMBEDDED, name) ? Buffer.from(EMBEDDED[name], 'base64').toString('utf8') : null) : (() => { try { return fs.readFileSync(path.join(__dirname, 'public', name), 'utf8'); } catch { return null; } })());
app.get(['/', '/index.html'], (req, res, next) => {
  const html = readAsset('/index.html');
  if (html === null) return next();
  const v = encodeURIComponent(APP_VERSION);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html.replace(/(href|src)="\/(style\.css|app\.js|partners\.js)"/g, `$1="/$2?v=${v}"`));
});
if (EMBEDDED) {
  // Giao diện được nhúng bên trong bản đóng gói / gói cập nhật
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    const name = req.path === '/' ? '/index.html' : req.path;
    if (!Object.prototype.hasOwnProperty.call(EMBEDDED, name)) return next();
    const buf = Buffer.from(EMBEDDED[name], 'base64');
    res.setHeader('Content-Type', MIME[path.extname(name)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(Buffer.from(buf));
  });
} else {
  app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Bọc handler để trả lỗi dạng JSON
const h = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    // Lỗi kiểm tra dữ liệu (có mã 4xx) là thông báo cho người dùng, không phải lỗi phần mềm: không ghi nhật ký kỹ thuật
    if (!e.status || e.status >= 500) console.error(e);
    res.status(e.status || 400).json({ error: e.message || 'Lỗi không xác định' });
  }
};
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isMonth = (s) => /^\d{4}-\d{2}$/.test(String(s || ''));
const canWrite = requireRole(...roles.WRITE_ROLES); // Quản trị, Kế toán
const adminOnly = requireRole('admin');

// Thuế suất thuế GTGT: 0%, 5%, 8%, 10%, KCT (không chịu thuế), KKKNT (không kê khai, tính nộp thuế)
const VAT_RATES = ['0', '5', '8', '10', 'KCT', 'KKKNT'];
function normVat(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  let s = String(v).trim().toUpperCase().replace(/\s/g, '').replace('%', '').replace(',', '.');
  if (/^0?\.\d+$/.test(s)) s = String(Math.round(Number(s) * 100)); // ô Excel định dạng % (0,1 = 10%)
  else if (/^\d+(\.0+)?$/.test(s)) s = String(Number(s));
  if (!VAT_RATES.includes(s)) throw fail(`Thuế suất GTGT "${v}" không hợp lệ. Chọn một trong: 0%, 5%, 8%, 10%, KCT, KKKNT`);
  return s;
}

// ---------------- Đăng nhập ----------------
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.post('/api/login', h(auth.login));
app.use('/api', requireAuth);
// Thủ kho: chỉ xem số lượng. Chặn các báo cáo giá trị và xóa mọi trường tiền khỏi dữ liệu trả về.
app.use('/api', (req, res, next) => {
  if (roles.canSeeValues(req.user.role)) return next();
  if (roles.isValueOnlyPath(req.baseUrl + req.path)) return res.status(403).json({ error: 'Quyền Thủ kho chỉ xem số lượng, không xem được dữ liệu giá trị' });
  const orig = res.json.bind(res);
  res.json = (d) => orig(d && d.error ? d : roles.strip(d));
  next();
});
app.post('/api/logout', h(auth.logout));
app.get('/api/me', (req, res) => res.json({
  version: APP_VERSION,
  user: auth.publicUser(req.user),
  settings: { company_name: getSetting('company_name', ''), company_address: getSetting('company_address', ''), opening_date: getSetting('opening_date') },
}));
app.post('/api/me/password', h((req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!auth.verifyPassword(String(old_password || ''), req.user.password_hash)) throw fail('Mật khẩu hiện tại không đúng');
  const err = auth.validatePassword(new_password, req.user.username);
  if (err) throw fail(err);
  if (auth.verifyPassword(String(new_password), req.user.password_hash)) throw fail('Mật khẩu mới phải khác mật khẩu hiện tại');
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(auth.hashPassword(new_password), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.sessionToken);
  audit(req, 'PASSWORD_CHANGE', 'Đổi mật khẩu');
  res.json({ ok: true });
}));

// ---------------- Cài đặt ----------------
app.get('/api/settings', (req, res) => res.json({
  company_name: getSetting('company_name', ''), company_address: getSetting('company_address', ''),
  company_tax: getSetting('company_tax', ''), opening_date: getSetting('opening_date'),
  ...numberingSettings(),
}));
app.put('/api/settings', adminOnly, h((req, res) => {
  const b = req.body || {};
  const old = getSetting('opening_date');
  if (b.opening_date !== undefined && b.opening_date !== old) {
    if (!isDate(b.opening_date)) throw fail('Ngày chốt số dư không hợp lệ');
    const c = db.prepare('SELECT COUNT(*) c FROM vouchers WHERE date <= ?').get(b.opening_date).c;
    if (c) throw fail(`Có ${c} phiếu phát sinh trước hoặc trong ngày ${b.opening_date}, không thể đổi ngày chốt`);
    if (db.prepare('SELECT COUNT(*) c FROM periods WHERE locked = 1').get().c) throw fail('Đã có kỳ khóa sổ, không thể đổi ngày chốt số dư');
    setSetting('opening_date', b.opening_date);
    db.prepare("UPDATE periods SET status = 'dirty'").run();
  }
  for (const k of ['company_name', 'company_address', 'company_tax']) if (b[k] !== undefined) setSetting(k, String(b[k]).slice(0, 300));
  for (const k of ['number_prefix_N', 'number_prefix_X']) if (b[k] !== undefined) {
    const v = String(b[k]).trim();
    if (!/^[A-Za-z0-9._\-/]{0,12}$/.test(v)) throw fail('Ký hiệu số chứng từ chỉ gồm chữ không dấu, số và . _ - / (tối đa 12 ký tự)');
    setSetting(k, v);
  }
  if (b.number_digits !== undefined) {
    const d = Number(b.number_digits);
    if (!Number.isInteger(d) || d < 3 || d > 10) throw fail('Số chữ số của số chứng từ phải từ 3 đến 10');
    setSetting('number_digits', String(d));
  }
  audit(req, 'SETTINGS_UPDATE', JSON.stringify(b));
  res.json({ ok: true });
}));

// Sao lưu: tải về bản sao nhất quán của CSDL (chỉ Quản trị)
app.get('/api/backup', adminOnly, h((req, res) => {
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const name = `kho-sao-luu-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.db`;
  const tmp = path.join(require('os').tmpdir(), crypto.randomBytes(8).toString('hex') + '.db');
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  audit(req, 'BACKUP', 'Tải bản sao lưu dữ liệu ' + name);
  res.download(tmp, name, () => fs.rm(tmp, { force: true }, () => {}));
}));


// ---------------- Cập nhật phần mềm ----------------
// Gói cập nhật (.khoupd) = gzip của 1 file JS đã gộp toàn bộ phần mềm, dòng đầu là thông tin phiên bản:
//   // KHO-UPDATE {"version":"1.2.0","built":"..."}
const zlib = require('zlib');
const cmpVer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const DEFAULT_UPDATE_URL = 'https://github.com/vanntfaak57-dot/HMP/releases/latest/download/latest.json';
const updateUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
let updating = false;

function versionInfo() {
  return {
    version: APP_VERSION, builtin_version: process.env.KHO_BUILTIN_VERSION || APP_VERSION,
    running_update: !!process.env.KHO_RUNNING_UPDATE, update_url: getSetting('update_url', DEFAULT_UPDATE_URL),
    mode: process.env.KHO_DOCKER === '1' ? 'docker' : sea ? 'app' : 'node',
  };
}
function parsePackage(buf) {
  let code;
  try { code = zlib.gunzipSync(buf).toString('utf8'); } catch { throw fail('File không phải gói cập nhật hợp lệ (.khoupd)'); }
  const m = code.match(/^\/\/ KHO-UPDATE (\{.*\})\n/);
  if (!m) throw fail('File không phải gói cập nhật của phần mềm Quản lý kho');
  let meta;
  try { meta = JSON.parse(m[1]); } catch { throw fail('Thông tin phiên bản trong gói cập nhật bị hỏng'); }
  if (!/^\d+\.\d+\.\d+$/.test(meta.version || '')) throw fail('Số phiên bản trong gói cập nhật không hợp lệ');
  return { meta, code };
}
// Khởi động lại tiến trình để chạy phiên bản mới
function restartApp() {
  console.log('\n>> Đang khởi động lại phần mềm...');
  const done = () => setTimeout(() => process.exit(0), 400);
  // Docker / Render: thoát, nền tảng tự khởi động lại container
  if (process.env.KHO_DOCKER === '1' || process.env.KHO_RESTART_MODE === 'exit') return done();
  const { spawn } = require('child_process');
  const args = sea ? process.argv.slice(2) : [...process.execArgv, ...process.argv.slice(1)];
  const env = { ...process.env, KHO_RESTART: '1', NO_BROWSER: '1' };
  delete env.KHO_RUNNING_UPDATE;
  if (process.platform === 'win32') {
    // mở cửa sổ mới cho phần mềm (cửa sổ cũ tự đóng)
    spawn('cmd.exe', ['/c', 'start', '""', process.execPath, ...args], { detached: true, stdio: 'ignore', windowsHide: true, env }).unref();
  } else {
    spawn(process.execPath, args, { detached: true, stdio: 'ignore', env }).unref();
  }
  done();
}
function applyUpdate(req, buf, source) {
  if (updating) throw fail('Đang cập nhật, vui lòng đợi');
  const { meta, code } = parsePackage(buf);
  const builtin = process.env.KHO_BUILTIN_VERSION || APP_VERSION;
  if (cmpVer(meta.version, APP_VERSION) <= 0) throw fail(`Gói cập nhật là phiên bản ${meta.version}, không mới hơn phiên bản đang chạy ${APP_VERSION}`);
  updating = true;
  try {
    const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
    // 1. Sao lưu dữ liệu trước khi cập nhật
    const bdir = path.join(DATA, 'backups');
    fs.mkdirSync(bdir, { recursive: true });
    const stamp = now().replace(/[-: ]/g, '');
    let backup = path.join(bdir, `truoc-cap-nhat-${APP_VERSION}-len-${meta.version}-${stamp}.db`);
    for (let i = 2; fs.existsSync(backup); i++) backup = path.join(bdir, `truoc-cap-nhat-${APP_VERSION}-len-${meta.version}-${stamp}-${i}.db`);
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    // 2. Ghi bản mới và chọn làm bản chạy
    const appDir = path.join(DATA, 'app');
    fs.mkdirSync(appDir, { recursive: true });
    const file = `kho-${meta.version}.js`;
    fs.writeFileSync(path.join(appDir, file + '.tmp'), code);
    fs.renameSync(path.join(appDir, file + '.tmp'), path.join(appDir, file));
    fs.writeFileSync(path.join(appDir, 'current.json'), JSON.stringify({ version: meta.version, file, installed_at: now(), installed_by: req.user.username, from: APP_VERSION, builtin }, null, 2));
    audit(req, 'UPDATE', `Cập nhật phần mềm ${APP_VERSION} → ${meta.version} (${source}); đã sao lưu dữ liệu: ${path.basename(backup)}`);
    // Xóa các bản cập nhật cũ, giữ bản vừa cài và bản đang chạy
    for (const f of fs.readdirSync(appDir)) {
      if (/^kho-\d+\.\d+\.\d+\.js$/.test(f) && f !== file && f !== `kho-${APP_VERSION}.js`) fs.rmSync(path.join(appDir, f), { force: true });
    }
    return { version: meta.version, backup: path.basename(backup) };
  } catch (e) { updating = false; throw e; }
}

app.get('/api/version', (req, res) => res.json(versionInfo()));
app.put('/api/update/url', adminOnly, h((req, res) => {
  const url = String(req.body?.url || '').trim();
  if (url && !/^https:\/\/\S+$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) throw fail('Địa chỉ kiểm tra cập nhật phải bắt đầu bằng https://');
  setSetting('update_url', url || DEFAULT_UPDATE_URL);
  audit(req, 'SETTINGS_UPDATE', 'Địa chỉ kiểm tra cập nhật: ' + (url || DEFAULT_UPDATE_URL));
  res.json({ ok: true });
}));
async function fetchManifest() {
  const url = getSetting('update_url', DEFAULT_UPDATE_URL);
  let r;
  try { r = await fetch(url, { headers: { 'User-Agent': 'KhoETC-updater' }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw fail('Không kết nối được máy chủ cập nhật: ' + (e.cause?.code || e.message)); }
  if (r.status === 404) throw fail('Không tìm thấy thông tin phiên bản mới tại địa chỉ cập nhật (kho GitHub chưa có bản phát hành, hoặc kho để chế độ riêng tư). Có thể tải gói cập nhật lên thủ công.');
  if (!r.ok) throw fail(`Máy chủ cập nhật trả lỗi ${r.status}`);
  let m;
  try { m = await r.json(); } catch { throw fail('Thông tin phiên bản tại địa chỉ cập nhật không đúng định dạng'); }
  if (!/^\d+\.\d+\.\d+$/.test(m.version || '') || !m.url) throw fail('Thông tin phiên bản tại địa chỉ cập nhật thiếu version/url');
  return { ...m, url: new URL(m.url, url).href };
}
app.post('/api/update/check', adminOnly, h(async (req, res) => {
  const m = await fetchManifest();
  res.json({ current: APP_VERSION, latest: m.version, notes: m.notes || '', available: cmpVer(m.version, APP_VERSION) > 0 });
}));
app.post('/api/update/download', adminOnly, h(async (req, res) => {
  const m = await fetchManifest();
  if (cmpVer(m.version, APP_VERSION) <= 0) throw fail(`Đang dùng phiên bản mới nhất (${APP_VERSION})`);
  let r;
  try { r = await fetch(m.url, { headers: { 'User-Agent': 'KhoETC-updater' }, signal: AbortSignal.timeout(180000) }); }
  catch (e) { throw fail('Không tải được gói cập nhật: ' + (e.cause?.code || e.message)); }
  if (!r.ok) throw fail(`Tải gói cập nhật lỗi ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (m.sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== String(m.sha256).toLowerCase()) throw fail('Gói cập nhật tải về bị lỗi (mã kiểm tra SHA256 không khớp), đã hủy cập nhật');
  const out = applyUpdate(req, buf, 'tải từ ' + new URL(m.url).host);
  res.json({ ok: true, ...out, restarting: true });
  restartApp();
}));
app.post('/api/update/upload', adminOnly, updateUpload.single('file'), h((req, res) => {
  if (!req.file) throw fail('Chưa chọn file gói cập nhật');
  const out = applyUpdate(req, req.file.buffer, 'tải lên ' + String(req.file.originalname).slice(0, 80));
  res.json({ ok: true, ...out, restarting: true });
  restartApp();
}));
app.post('/api/update/rollback', adminOnly, h((req, res) => {
  if (!process.env.KHO_RUNNING_UPDATE) throw fail('Đang chạy bản gốc, không có bản cập nhật để gỡ');
  const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
  const cur = path.join(DATA, 'app', 'current.json');
  fs.renameSync(cur, cur + '.rolledback');
  audit(req, 'UPDATE', `Gỡ bản cập nhật ${APP_VERSION}, quay về bản gốc ${process.env.KHO_BUILTIN_VERSION}`);
  res.json({ ok: true, version: process.env.KHO_BUILTIN_VERSION, restarting: true });
  restartApp();
}));

// Tắt phần mềm (app trên máy chạy ngầm, không có cửa sổ để đóng)
app.post('/api/shutdown', adminOnly, h((req, res) => {
  if (process.env.KHO_DOCKER === '1') throw fail('Bản online chạy trên máy chủ, không tắt từ đây');
  audit(req, 'SETTINGS_UPDATE', 'Tắt phần mềm');
  res.json({ ok: true });
  console.log('>> Tắt phần mềm theo yêu cầu của ' + req.user.username);
  setTimeout(() => process.exit(0), 300);
}));

// ---------------- Khôi phục dữ liệu từ bản sao lưu ----------------
const restoreUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
app.post('/api/restore', adminOnly, restoreUpload.single('file'), h((req, res) => {
  if (!req.file) throw fail('Chưa chọn file sao lưu');
  if (req.body?.confirm !== 'KHOI PHUC') throw fail('Thiếu xác nhận khôi phục');
  if (req.file.buffer.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') throw fail('File không phải bản sao lưu dữ liệu (.db) của phần mềm');
  const tmpFile = path.join(DATA_DIR, `restore-check-${crypto.randomBytes(6).toString('hex')}.db`);
  fs.writeFileSync(tmpFile, req.file.buffer);
  let info;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const chk = new DatabaseSync(tmpFile, { readOnly: true });
    try {
      if (chk.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw fail('Bản sao lưu bị hỏng (kiểm tra toàn vẹn không đạt)');
      const tables = new Set(chk.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
      for (const t of ['users', 'items', 'vouchers', 'voucher_lines', 'settings']) if (!tables.has(t)) throw fail('File không phải bản sao lưu của phần mềm Quản lý kho');
      if (!chk.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1").get().c) throw fail('Bản sao lưu không có tài khoản Quản trị nào đang hoạt động');
      const n = (t) => chk.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
      info = { items: n('items'), vouchers: n('vouchers'), users: n('users') };
    } finally { chk.close(); }
    fs.renameSync(tmpFile, RESTORE_PENDING);
  } catch (e) {
    fs.rmSync(tmpFile, { force: true });
    if (e.status) throw e;
    throw fail('Không đọc được file sao lưu: ' + e.message);
  }
  audit(req, 'RESTORE', `Khôi phục từ ${String(req.file.originalname).slice(0, 80)}: ${info.items} mã hàng, ${info.vouchers} chứng từ, ${info.users} người dùng (khởi động lại để áp dụng)`);
  res.json({ ok: true, ...info, restarting: true });
  restartApp();
}));

// ---------------- Truy cập từ Internet (Cloudflare Tunnel) ----------------
const tunnelAvailable = () => process.env.KHO_DOCKER !== '1';
function tunnelInfo() {
  const token = getSetting('tunnel_token', '');
  return {
    available: tunnelAvailable(), enabled: getSetting('tunnel_enabled', '0') === '1', url: getSetting('tunnel_url', ''),
    has_token: !!token, token_hint: token ? '…' + token.slice(-6) : '', local_service: `http://localhost:${PORT}`,
    running: tunnel.state.running, connected: tunnel.state.connected, downloading: tunnel.state.downloading,
    error: tunnel.state.error, log: tunnel.state.log.slice(-25),
  };
}
app.get('/api/tunnel', adminOnly, (req, res) => res.json(tunnelInfo()));
app.put('/api/tunnel', adminOnly, h((req, res) => {
  if (!tunnelAvailable()) throw fail('Bản online chạy trên máy chủ: không cần đường hầm');
  const b = req.body || {};
  if (b.token !== undefined && String(b.token).trim()) {
    // chấp nhận cả lệnh cài mà Cloudflare hiển thị ("cloudflared.exe service install eyJ..."): lấy phần token
    const m = String(b.token).trim().match(/(eyJ[A-Za-z0-9_\-=]+\.?[A-Za-z0-9_\-=]*\.?[A-Za-z0-9_\-=]*)\s*$/) || String(b.token).trim().match(/([A-Za-z0-9_\-=]{60,})\s*$/);
    if (!m) throw fail('Token không đúng: hãy chép đoạn mã dài bắt đầu bằng "eyJ" trên trang Cloudflare');
    setSetting('tunnel_token', m[1]);
  }
  if (b.url !== undefined) {
    let url = String(b.url).trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (url && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(url)) throw fail('Địa chỉ truy cập phải dạng https://kho.tencongty.vn');
    setSetting('tunnel_url', url);
  }
  if (b.enabled !== undefined) {
    if (b.enabled && !getSetting('tunnel_token', '')) throw fail('Chưa nhập token đường hầm');
    setSetting('tunnel_enabled', b.enabled ? '1' : '0');
  }
  const on = getSetting('tunnel_enabled', '0') === '1';
  if (on) tunnel.start(DATA_DIR, getSetting('tunnel_token', '')); else tunnel.stop();
  audit(req, 'SETTINGS_UPDATE', `Truy cập từ Internet: ${on ? 'bật' : 'tắt'}${getSetting('tunnel_url', '') ? ' (' + getSetting('tunnel_url', '') + ')' : ''}`);
  res.json(tunnelInfo());
}));

// ---------------- Dùng chung trong mạng nội bộ ----------------
const os = require('os');
// Địa chỉ IPv4 trong mạng nội bộ của máy chủ
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ name, ip: a.address, url: `http://${a.address}:${PORT}` });
    }
  }
  // ưu tiên dải mạng gia đình / văn phòng thường gặp
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((a, b) => rank(a.ip) - rank(b.ip));
}
app.get('/api/network', adminOnly, h(async (req, res) => {
  const QR = require('qrcode');
  const addresses = await Promise.all(lanAddresses().map(async (a) => ({ ...a, qr: await QR.toString(a.url, { type: 'svg', margin: 1 }) })));
  res.json({
    lan_enabled: HOST === '0.0.0.0', port: PORT, hostname_url: `http://${os.hostname()}:${PORT}`, addresses,
    mode: process.env.KHO_DOCKER === '1' ? 'docker' : sea ? 'app' : 'node',
    can_change: process.env.KHO_DOCKER !== '1' && !process.env.HOST && !process.env.PORT,
    config_file: CONFIG_FILE,
  });
}));
app.put('/api/network', adminOnly, h((req, res) => {
  if (process.env.KHO_DOCKER === '1') throw fail('Bản online chạy trên máy chủ: truy cập qua tên miền, không cần bật ở đây');
  if (process.env.HOST || process.env.PORT) throw fail('Cổng / chế độ mạng đang được đặt bằng biến môi trường HOST/PORT, không đổi được từ màn hình này');
  const lan = !!req.body?.lan;
  const port = req.body?.port === undefined || req.body.port === '' ? PORT : Number(req.body.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw fail('Cổng phải là số từ 1024 đến 65535');
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...fileCfg, port, host: lan ? '0.0.0.0' : '127.0.0.1' }, null, 2) + '\n');
  audit(req, 'SETTINGS_UPDATE', `${lan ? 'Bật' : 'Tắt'} dùng chung trong mạng nội bộ, cổng ${port}`);
  res.json({ ok: true, lan, port, restarting: true });
  restartApp();
}));

// ---------------- Danh mục vật tư hàng hóa ----------------

// Giá bán trong danh mục: nhập giá +VAT thì tự tính giá -VAT theo thuế suất; chỉ nhập giá -VAT thì giữ nguyên
function salePrices(b, vat) {
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  const k = 1 + (/^\d+$/.test(vat || '') ? Number(vat) : 0) / 100;
  if (has(b.sale_price_vat)) { const g = num(b.sale_price_vat); if (g < 0) throw fail('Giá bán không hợp lệ'); return { sale_price: Math.round(g / k * 100) / 100, sale_price_vat: g }; }
  if (has(b.sale_price)) { const n = num(b.sale_price); if (n < 0) throw fail('Giá bán không hợp lệ'); return { sale_price: n, sale_price_vat: null }; }
  return { sale_price: null, sale_price_vat: null };
}
const setSale = (id, sp) => db.prepare('UPDATE items SET sale_price = ?, sale_price_vat = ? WHERE id = ?').run(sp.sale_price, sp.sale_price_vat, id);
function assertOpeningEditable() {
  if (db.prepare('SELECT COUNT(*) c FROM periods WHERE locked = 1').get().c) throw fail('Đã có kỳ khóa sổ, không thể sửa số dư đầu kỳ');
}
app.get('/api/items', (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : '9999-12-31';
  const stock = costing.stockQtyAt(date, Number(req.query.exclude) || 0);
  const rows = db.prepare('SELECT * FROM items ORDER BY code').all().map((i) => ({ ...i, stock_qty: stock[i.id] ?? i.opening_qty }));
  res.json(rows);
});
app.post('/api/items', canWrite, h((req, res) => {
  const b = req.body || {};
  if (!b.code || !b.name) throw fail('Mã và tên hàng là bắt buộc');
  if (num(b.opening_qty) || num(b.opening_value)) assertOpeningEditable();
  const sp = salePrices(b, normVat(b.vat_rate));
  const r = db.prepare('INSERT INTO items(code, name, unit, vat_rate, opening_qty, opening_value, note, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(String(b.code).trim(), String(b.name).trim(), b.unit || '', normVat(b.vat_rate), num(b.opening_qty), Math.round(num(b.opening_value)), b.note || '', now());
  setSale(Number(r.lastInsertRowid), sp);
  if (num(b.opening_qty) || num(b.opening_value)) costing.markDirty(costing.firstMonth() || '0000-00');
  audit(req, 'ITEM_CREATE', `${b.code} - ${b.name}${b.vat_rate ? `, thuế GTGT ${b.vat_rate}` : ''}${sp.sale_price != null ? `, giá bán ${sp.sale_price_vat ?? sp.sale_price}${sp.sale_price_vat != null ? ' (+VAT)' : ' (-VAT)'}` : ''}`);
  res.json({ id: Number(r.lastInsertRowid) });
}));
app.put('/api/items/:id', canWrite, h((req, res) => {
  const b = req.body || {};
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!it) throw fail('Không tìm thấy mã hàng', 404);
  const oq = num(b.opening_qty), ov = Math.round(num(b.opening_value));
  const vat = normVat(b.vat_rate);
  const sp = salePrices(b, vat);
  const openingChanged = oq !== it.opening_qty || ov !== it.opening_value;
  if (openingChanged) assertOpeningEditable();
  tx(() => {
    db.prepare('UPDATE items SET code=?, name=?, unit=?, vat_rate=?, opening_qty=?, opening_value=?, note=?, updated_at=? WHERE id=?')
      .run(String(b.code).trim(), String(b.name).trim(), b.unit || '', vat, oq, ov, b.note || '', now(), it.id);
    setSale(it.id, sp);
    if (openingChanged) { costing.checkNoNegative([it.id]); costing.markDirty(costing.firstMonth() || '0000-00'); }
  });
  audit(req, 'ITEM_UPDATE', `${it.code}: ${JSON.stringify({ code: b.code, name: b.name, vat_rate: vat, opening_qty: oq, opening_value: ov, ...sp })} (cũ: thuế ${it.vat_rate ?? '-'}, giá bán ${it.sale_price_vat ?? it.sale_price ?? '-'}, SL ${it.opening_qty}, GT ${it.opening_value})`);
  res.json({ ok: true });
}));
app.delete('/api/items/:id', canWrite, h((req, res) => {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!it) throw fail('Không tìm thấy mã hàng', 404);
  if (db.prepare('SELECT COUNT(*) c FROM voucher_lines WHERE item_id = ?').get(it.id).c) throw fail('Mã hàng đã phát sinh chứng từ, không thể xóa');
  if (it.opening_qty || it.opening_value) assertOpeningEditable();
  db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
  costing.markDirty(costing.firstMonth() || '0000-00');
  audit(req, 'ITEM_DELETE', `${it.code} - ${it.name}`);
  res.json({ ok: true });
}));

// Xóa hàng loạt: xóa các mã được phép, trả về danh sách mã bị bỏ qua kèm lý do
app.post('/api/items/bulk-delete', canWrite, h((req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw fail('Chưa chọn mã hàng nào');
  if (ids.length > 5000) throw fail('Mỗi lần xóa tối đa 5.000 mã');
  const locked = db.prepare('SELECT COUNT(*) c FROM periods WHERE locked = 1').get().c > 0;
  const used = db.prepare('SELECT COUNT(*) c FROM voucher_lines WHERE item_id = ?');
  const deleted = [], skipped = [];
  tx(() => {
    for (const id of ids) {
      const it = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      if (!it) { skipped.push({ code: `#${id}`, reason: 'Không còn tồn tại' }); continue; }
      if (used.get(id).c) { skipped.push({ code: it.code, name: it.name, reason: 'Đã phát sinh chứng từ nhập/xuất' }); continue; }
      if (locked && (it.opening_qty || it.opening_value)) { skipped.push({ code: it.code, name: it.name, reason: 'Có số dư đầu kỳ và đã có kỳ khóa sổ' }); continue; }
      db.prepare('DELETE FROM items WHERE id = ?').run(id);
      deleted.push(it.code);
    }
    if (deleted.length) costing.markDirty(costing.firstMonth() || '0000-00');
  });
  audit(req, 'ITEM_BULK_DELETE', `Xóa ${deleted.length} mã: ${deleted.join(', ') || '(không có)'}${skipped.length ? ` | bỏ qua ${skipped.length}: ${skipped.map((s) => `${s.code} (${s.reason})`).join(', ')}` : ''}`.slice(0, 8000));
  res.json({ deleted, skipped });
}));

// Mẫu Excel nhập danh mục + tồn đầu kỳ
app.get('/api/items/template.xlsx', h(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DanhMuc');
  ws.columns = [
    { header: 'Mã hàng', key: 'code', width: 15 }, { header: 'Tên hàng', key: 'name', width: 40 },
    { header: 'ĐVT', key: 'unit', width: 10 }, { header: 'SL tồn đầu kỳ', key: 'qty', width: 15 },
    { header: 'Giá trị tồn đầu kỳ', key: 'val', width: 20 }, { header: 'Ghi chú', key: 'note', width: 25 },
    { header: 'Thuế suất GTGT (0%, 5%, 8%, 10%, KCT, KKKNT)', key: 'vat', width: 22 },
    { header: 'Giá bán (+VAT)', key: 'sale', width: 16 },
  ];
  ws.addRow({ code: 'VT001', name: 'Xi măng PCB40', unit: 'Bao', qty: 100, val: 8500000, vat: '10%', sale: 99000 });
  ws.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="mau_danh_muc_ton_dau.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

app.post('/api/items/import', canWrite, upload.single('file'), h(async (req, res) => {
  if (!req.file) throw fail('Chưa chọn file');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const ws = wb.worksheets[0];
  const val = (c) => { const v = c.value; if (v && typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : ''); return v; };
  const rows = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const code = String(val(row.getCell(1)) ?? '').trim();
    if (!code) return;
    rows.push({ code, name: String(val(row.getCell(2)) ?? '').trim(), unit: String(val(row.getCell(3)) ?? '').trim(),
      qty: num(val(row.getCell(4))), value: Math.round(num(val(row.getCell(5)))), note: String(val(row.getCell(6)) ?? '').trim(), vat: val(row.getCell(7)), sale_vat: val(row.getCell(8)), line: i });
  });
  if (!rows.length) throw fail('File không có dữ liệu (dòng 1 là tiêu đề, từ dòng 2: Mã, Tên, ĐVT, SL tồn, Giá trị tồn, Ghi chú, Thuế suất GTGT)');
  for (const r of rows) { try { r.vat = normVat(r.vat); r.sp = salePrices({ sale_price_vat: r.sale_vat }, r.vat); } catch (e) { throw fail(`Dòng ${r.line} (mã ${r.code}): ${e.message}`); } }
  assertOpeningEditable();
  let created = 0, updated = 0;
  tx(() => {
    for (const r of rows) {
      if (!r.name) throw fail(`Mã ${r.code} thiếu tên hàng`);
      const ex = db.prepare('SELECT id FROM items WHERE code = ?').get(r.code);
      if (ex) {
        db.prepare('UPDATE items SET name=?, unit=?, vat_rate=?, opening_qty=?, opening_value=?, note=?, updated_at=? WHERE id=?').run(r.name, r.unit, r.vat, r.qty, r.value, r.note, now(), ex.id);
        if (r.sp.sale_price != null) setSale(ex.id, r.sp);
        updated++;
      } else {
        const ins = db.prepare('INSERT INTO items(code, name, unit, vat_rate, opening_qty, opening_value, note, created_at) VALUES (?,?,?,?,?,?,?,?)').run(r.code, r.name, r.unit, r.vat, r.qty, r.value, r.note, now());
        setSale(Number(ins.lastInsertRowid), r.sp);
        created++;
      }
    }
    costing.checkNoNegative(db.prepare('SELECT id FROM items').all().map((x) => x.id));
    costing.markDirty(costing.firstMonth() || '0000-00');
  });
  audit(req, 'ITEM_IMPORT', `Nhập Excel: thêm ${created}, cập nhật ${updated}`);
  res.json({ created, updated });
}));


// ---------------- Danh mục khách hàng & danh mục nhà cung cấp ----------------
// Hai danh mục độc lập (kind = 'KH' | 'NCC'), mỗi đối tượng chỉ gồm Mã / Tên / MST.
const KIND_NAME = { KH: 'khách hàng', NCC: 'nhà cung cấp' };
function needKind(k) {
  if (k !== 'KH' && k !== 'NCC') throw fail('Thiếu loại danh mục (KH hoặc NCC)');
  return k;
}
function cleanPartner(b) {
  const code = String(b.code ?? '').trim().slice(0, 50), name = String(b.name ?? '').trim().slice(0, 300);
  if (!code || !name) throw fail('Mã và tên là bắt buộc');
  return { code, name, tax_code: String(b.tax_code ?? '').trim().slice(0, 20) };
}

app.get('/api/partners', (req, res) => {
  const kind = req.query.kind === 'KH' || req.query.kind === 'NCC' ? req.query.kind : null;
  res.json(db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM vouchers v WHERE v.partner_id = p.id) voucher_count
    FROM partners p ${kind ? 'WHERE p.kind = ?' : ''} ORDER BY p.code`).all(...(kind ? [kind] : [])));
});
app.post('/api/partners', canWrite, h((req, res) => {
  const kind = needKind(req.body?.kind);
  const p = cleanPartner(req.body || {});
  if (db.prepare('SELECT id FROM partners WHERE kind = ? AND code = ?').get(kind, p.code)) throw fail(`Mã ${p.code} đã có trong danh mục ${KIND_NAME[kind]}`);
  const r = db.prepare('INSERT INTO partners(kind, code, name, tax_code, created_at) VALUES (?,?,?,?,?)').run(kind, p.code, p.name, p.tax_code, now());
  audit(req, 'PARTNER_CREATE', `Danh mục ${KIND_NAME[kind]}: ${p.code} - ${p.name}${p.tax_code ? ', MST ' + p.tax_code : ''}`);
  res.json({ id: Number(r.lastInsertRowid) });
}));
app.put('/api/partners/:id', canWrite, h((req, res) => {
  const old = db.prepare('SELECT * FROM partners WHERE id = ?').get(req.params.id);
  if (!old) throw fail('Không tìm thấy', 404);
  const p = cleanPartner(req.body || {});
  if (db.prepare('SELECT id FROM partners WHERE kind = ? AND code = ? AND id <> ?').get(old.kind, p.code, old.id)) throw fail(`Mã ${p.code} đã có trong danh mục ${KIND_NAME[old.kind]}`);
  db.prepare('UPDATE partners SET code=?, name=?, tax_code=?, updated_at=? WHERE id=?').run(p.code, p.name, p.tax_code, now(), old.id);
  audit(req, 'PARTNER_UPDATE', `Danh mục ${KIND_NAME[old.kind]}: ${old.code} → ${p.code} - ${p.name}${p.tax_code ? ', MST ' + p.tax_code : ''} (cũ: ${old.name}${old.tax_code ? ', MST ' + old.tax_code : ''})`);
  res.json({ ok: true });
}));
app.post('/api/partners/bulk-delete', canWrite, h((req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw fail('Chưa chọn dòng nào');
  const deleted = [], skipped = [];
  let kind = null;
  tx(() => {
    for (const id of ids) {
      const p = db.prepare('SELECT * FROM partners WHERE id = ?').get(id);
      if (!p) { skipped.push({ code: `#${id}`, reason: 'Không còn tồn tại' }); continue; }
      kind = p.kind;
      const n = db.prepare('SELECT COUNT(*) c FROM vouchers WHERE partner_id = ?').get(id).c;
      if (n) { skipped.push({ code: p.code, name: p.name, reason: `Đã có ${n} chứng từ` }); continue; }
      db.prepare('DELETE FROM partners WHERE id = ?').run(id);
      deleted.push(p.code);
    }
  });
  audit(req, 'PARTNER_DELETE', `Danh mục ${KIND_NAME[kind] || ''}: xóa ${deleted.length}: ${deleted.join(', ') || '(không có)'}${skipped.length ? ` | bỏ qua: ${skipped.map((x) => `${x.code} (${x.reason})`).join(', ')}` : ''}`);
  res.json({ deleted, skipped });
}));
app.get('/api/partners/template.xlsx', h(async (req, res) => {
  const kind = needKind(req.query.kind);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === 'KH' ? 'KhachHang' : 'NhaCungCap');
  ws.columns = [{ header: kind === 'KH' ? 'Mã khách hàng' : 'Mã nhà cung cấp', width: 18 }, { header: kind === 'KH' ? 'Tên khách hàng' : 'Tên nhà cung cấp', width: 45 }, { header: 'Mã số thuế', width: 16 }];
  ws.addRow(kind === 'KH' ? ['KH001', 'Công ty CP Xây dựng Minh Phát', '0101234567'] : ['NCC001', 'Công ty Xi măng Hà Tiên', '0300000001']);
  ws.getRow(1).font = { bold: true };
  ws.getColumn(3).numFmt = '@';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="mau_danh_muc_${kind === 'KH' ? 'khach_hang' : 'nha_cung_cap'}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));
app.post('/api/partners/import', canWrite, upload.single('file'), h(async (req, res) => {
  const kind = needKind(req.query.kind);
  if (!req.file) throw fail('Chưa chọn file');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const ws = wb.worksheets[0];
  const val = (c) => { const v = c.value; if (v && typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : ''); return v ?? ''; };
  const rows = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const c = [1, 2, 3].map((k) => String(val(row.getCell(k))).trim());
    if (!c[0]) return;
    try { rows.push(cleanPartner({ code: c[0], name: c[1], tax_code: c[2] })); } catch (e) { throw fail(`Dòng ${i}: ${e.message}`); }
  });
  if (!rows.length) throw fail('File không có dữ liệu (dòng 1 là tiêu đề, từ dòng 2: Mã, Tên, Mã số thuế)');
  let created = 0, updated = 0;
  tx(() => {
    for (const p of rows) {
      const ex = db.prepare('SELECT id FROM partners WHERE kind = ? AND code = ?').get(kind, p.code);
      if (ex) { db.prepare('UPDATE partners SET name=?, tax_code=?, updated_at=? WHERE id=?').run(p.name, p.tax_code, now(), ex.id); updated++; }
      else { db.prepare('INSERT INTO partners(kind, code, name, tax_code, created_at) VALUES (?,?,?,?,?)').run(kind, p.code, p.name, p.tax_code, now()); created++; }
    }
  });
  audit(req, 'PARTNER_IMPORT', `Nhập Excel danh mục ${KIND_NAME[kind]}: thêm ${created}, cập nhật ${updated}`);
  res.json({ created, updated });
}));

// Tìm đối tượng khớp với nội dung PDF trong đúng danh mục: ưu tiên mã số thuế, sau đó tên
function matchPartner(type, taxCode, name) {
  const kind = type === 'N' ? 'NCC' : 'KH';
  const digits = String(taxCode || '').replace(/\D/g, '');
  const list = db.prepare('SELECT * FROM partners WHERE kind = ?').all(kind);
  if (digits) { const p = list.find((x) => String(x.tax_code || '').replace(/\D/g, '') === digits); if (p) return p; }
  const nn = (x) => String(x || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  return name ? list.find((x) => nn(x.name) === nn(name)) || null : null;
}

// ---------------- Chứng từ nhập / xuất ----------------
const TYPE_NAME = { N: 'Phiếu nhập kho', X: 'Phiếu xuất kho bán hàng' };
// Số chứng từ tự động: <ký hiệu><số thứ tự>, ví dụ NK00001, XK00001 (ký hiệu và số chữ số chỉnh trong Cài đặt)
function numberingSettings() {
  return { number_prefix_N: getSetting('number_prefix_N', 'NK'), number_prefix_X: getSetting('number_prefix_X', 'XK'), number_digits: Number(getSetting('number_digits', '5')) };
}

function nextNumber(type) {
  const ns = numberingSettings();
  const prefix = ns['number_prefix_' + type];
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&') + '(\\d+)$', 'i');
  let max = 0;
  for (const r of db.prepare('SELECT number FROM vouchers WHERE type = ?').all(type)) { const m = r.number.match(re); if (m) max = Math.max(max, Number(m[1])); }
  return prefix + String(max + 1).padStart(ns.number_digits, '0');
}
app.get('/api/vouchers/next-number', (req, res) => res.json({ number: nextNumber(req.query.type === 'X' ? 'X' : 'N') }));

app.get('/api/vouchers', (req, res) => {
  const where = [], args = [];
  if (req.query.type) { where.push('v.type = ?'); args.push(req.query.type); }
  if (isDate(req.query.from)) { where.push('v.date >= ?'); args.push(req.query.from); }
  if (isDate(req.query.to)) { where.push('v.date <= ?'); args.push(req.query.to); }
  if (req.query.q) { where.push('(v.number LIKE ? OR v.partner LIKE ? OR v.description LIKE ?)'); const q = `%${req.query.q}%`; args.push(q, q, q); }
  if (req.query.partner_id) { where.push('v.partner_id = ?'); args.push(Number(req.query.partner_id)); }
  const rows = db.prepare(`SELECT v.*, (SELECT code FROM partners WHERE id = v.partner_id) partner_code, COALESCE(SUM(l.amount),0) total_amount, COALESCE(SUM(l.vat_amount),0) total_vat, SUM(l.cost_amount) total_cost, COUNT(l.id) line_count,
      SUM(CASE WHEN l.cost_amount IS NULL THEN 1 ELSE 0 END) uncosted, p.status period_status, COALESCE(p.locked,0) locked
    FROM vouchers v LEFT JOIN voucher_lines l ON l.voucher_id = v.id LEFT JOIN periods p ON p.month = substr(v.date,1,7)
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY v.id ORDER BY v.date DESC, v.id DESC LIMIT 2000`).all(...args);
  res.json(rows);
});

function getVoucher(id) {
  const v = db.prepare(`SELECT v.*, (SELECT code FROM partners WHERE id = v.partner_id) partner_code, p.status period_status, COALESCE(p.locked,0) locked FROM vouchers v
    LEFT JOIN periods p ON p.month = substr(v.date,1,7) WHERE v.id = ?`).get(id);
  if (!v) return null;
  v.lines = db.prepare(`SELECT l.*, i.code, i.name, i.unit FROM voucher_lines l JOIN items i ON i.id = l.item_id
    WHERE l.voucher_id = ? ORDER BY l.sort, l.id`).all(id);
  return v;
}
const viewLogged = new Map();
app.get('/api/vouchers/:id/audit', h((req, res) => {
  const v = db.prepare('SELECT id, number, type FROM vouchers WHERE id = ?').get(req.params.id);
  if (!v) throw fail('Không tìm thấy chứng từ', 404);
  // nhật ký gắn với chứng từ; bản ghi cũ (trước khi có liên kết) tìm theo số phiếu
  const rows = db.prepare(`SELECT ts, username, action, detail, ip, ua FROM audit_log
    WHERE ref = ? OR (ref IS NULL AND action LIKE 'VOUCHER_%' AND detail LIKE ?) ORDER BY id DESC LIMIT 300`)
    .all('voucher:' + v.id, `%${TYPE_NAME[v.type]} ${v.number} %`);
  res.json(roles.canSeeValues(req.user.role) ? rows : rows.map((r) => ({ ...r, detail: r.detail.replace(/tổng [\d.,]+/g, 'tổng ***').replace(/\| trước khi sửa:.*$/, '') })));
}));
app.get('/api/vouchers/:id', h((req, res) => {
  const v = getVoucher(req.params.id);
  if (!v) throw fail('Không tìm thấy chứng từ', 404);
  const key = req.user.id + ':' + v.id;
  if (!viewLogged.has(key) || Date.now() - viewLogged.get(key) > 10 * 60 * 1000) {
    viewLogged.set(key, Date.now());
    if (viewLogged.size > 20000) viewLogged.clear();
    audit(req, 'VOUCHER_VIEW', `Xem ${TYPE_NAME[v.type]} ${v.number}`, null, 'voucher:' + v.id);
  }
  res.json(v);
}));

function validateVoucher(b) {
  const type = b.type === 'X' ? 'X' : b.type === 'N' ? 'N' : null;
  if (!type) throw fail('Loại chứng từ không hợp lệ');
  if (!isDate(b.date)) throw fail('Ngày chứng từ không hợp lệ');
  const A = getSetting('opening_date');
  if (!A) throw fail('Chưa thiết lập ngày chốt số dư đầu kỳ (Cài đặt)');
  if (b.date <= A) throw fail(`Ngày chứng từ phải sau ngày chốt số dư ${A}`);
  if (costing.isLocked(b.date.slice(0, 7))) throw fail(`Kỳ ${b.date.slice(0, 7)} đã khóa sổ`);
  const number = String(b.number || '').trim() || nextNumber(type);
  let partner_id = null;
  let partnerName = String(b.partner || '').trim();
  if (b.partner_id) {
    const p = db.prepare('SELECT * FROM partners WHERE id = ?').get(Number(b.partner_id));
    if (!p) throw fail('Đối tượng không tồn tại trong danh mục');
    if (type === 'X' && p.kind !== 'KH') throw fail(`${p.code} - ${p.name} thuộc danh mục nhà cung cấp, không phải khách hàng`);
    if (type === 'N' && p.kind !== 'NCC') throw fail(`${p.code} - ${p.name} thuộc danh mục khách hàng, không phải nhà cung cấp`);
    partner_id = p.id;
    if (!partnerName) partnerName = p.name;
  }
  const lines = (b.lines || []).filter((l) => l && l.item_id);
  if (!lines.length) throw fail('Chứng từ phải có ít nhất một dòng hàng');
  const clean = lines.map((l, i) => {
    const item = db.prepare('SELECT id, code, vat_rate FROM items WHERE id = ?').get(l.item_id);
    if (!item) throw fail(`Dòng ${i + 1}: mã hàng không tồn tại`);
    const qty = num(l.qty);
    if (qty <= 0) throw fail(`Dòng ${i + 1} (${item.code}): số lượng phải lớn hơn 0`);
    const price = num(l.unit_price);
    const discount_rate = num(l.discount_rate);
    if (discount_rate < 0 || discount_rate > 100) throw fail(`Dòng ${i + 1} (${item.code}): tỷ lệ chiết khấu phải từ 0 đến 100%`);
    const amount = l.amount !== undefined && l.amount !== '' && l.amount !== null ? Math.round(num(l.amount)) : Math.round(qty * price * (1 - discount_rate / 100));
    if (type === 'N' && amount < 0) throw fail(`Dòng ${i + 1}: giá trị nhập không hợp lệ`);
    let vat_rate;
    try { vat_rate = l.vat_rate === undefined ? item.vat_rate : normVat(l.vat_rate); } catch (e) { throw fail(`Dòng ${i + 1} (${item.code}): ${e.message}`); }
    const vat_amount = /^\d+$/.test(vat_rate || '') ? Math.round(amount * Number(vat_rate) / 100) : 0;
    const price_vat = l.price_vat === undefined || l.price_vat === null || l.price_vat === '' ? null : num(l.price_vat);
    return { item_id: item.id, qty, unit_price: price, price_vat, amount, discount_rate, vat_rate, vat_amount, sort: i };
  });
  return { type, number, date: b.date, partner_id, partner: partnerName, address: b.address || '', description: b.description || '', ref_no: b.ref_no || '', ...extraFields(b), source: b.source === 'pdf' ? 'pdf' : 'manual', attachment: safeAttachment(b.attachment), lines: clean };
}
// Các trường thông tin thêm trên phiếu (MST, người liên hệ, điện thoại, địa điểm giao hàng, NV bán hàng, mã kho)
const EXTRA_FIELDS = ['tax_code', 'contact', 'phone', 'delivery_place', 'salesperson', 'warehouse'];
function extraFields(b) { return Object.fromEntries(EXTRA_FIELDS.map((k) => [k, String(b[k] ?? '').trim().slice(0, 300)])); }
function saveExtra(id, v) { db.prepare(`UPDATE vouchers SET ${EXTRA_FIELDS.map((k) => k + '=?').join(', ')} WHERE id = ?`).run(...EXTRA_FIELDS.map((k) => v[k]), id); }
function safeAttachment(a) {
  if (!a) return null;
  const s = String(a);
  return /^[a-f0-9]{32}\.pdf$/.test(s) && fs.existsSync(path.join(UPLOAD_DIR, s)) ? s : null;
}
function insertLines(vid, lines) {
  const st = db.prepare('INSERT INTO voucher_lines(voucher_id, item_id, qty, unit_price, price_vat, amount, discount_rate, vat_rate, vat_amount, sort) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const l of lines) st.run(vid, l.item_id, l.qty, l.unit_price, l.price_vat, l.amount, l.discount_rate, l.vat_rate, l.vat_amount, l.sort);
}
const summary = (v) => `${TYPE_NAME[v.type]} ${v.number} ngày ${v.date}, ${v.lines.length} dòng, tổng ${v.lines.reduce((s, l) => s + l.amount, 0).toLocaleString('vi-VN')}`;

app.post('/api/vouchers', canWrite, h((req, res) => {
  const v = validateVoucher(req.body || {});
  // Số tự động: luôn lấy số kế tiếp tại thời điểm lưu (tránh trùng khi nhiều người cùng lập phiếu)
  if (req.body?.auto_number === true) v.number = nextNumber(v.type);
  if (db.prepare('SELECT id FROM vouchers WHERE type = ? AND number = ?').get(v.type, v.number)) throw fail(`Số phiếu ${v.number} đã tồn tại`);
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO vouchers(type, number, date, partner_id, partner, address, description, ref_no, source, attachment, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.type, v.number, v.date, v.partner_id, v.partner, v.address, v.description, v.ref_no, v.source, v.attachment, req.user.username, now());
    const id = Number(r.lastInsertRowid);
    saveExtra(id, v);
    insertLines(id, v.lines);
    costing.checkNoNegative(v.lines.map((l) => l.item_id));
    costing.markDirty(v.date.slice(0, 7));
    return id;
  });
  audit(req, 'VOUCHER_CREATE', summary(v) + (v.source === 'pdf' ? ' (từ PDF)' : ''), null, 'voucher:' + id);
  res.json({ id });
}));

app.put('/api/vouchers/:id', canWrite, h((req, res) => {
  const old = getVoucher(req.params.id);
  if (!old) throw fail('Không tìm thấy chứng từ', 404);
  if (old.locked) throw fail(`Kỳ ${old.date.slice(0, 7)} đã khóa sổ`);
  if (old.posted) throw fail(`Chứng từ ${old.number} đã ghi sổ. Bấm "Bỏ ghi" trước khi sửa.`);
  const v = validateVoucher({ ...req.body, type: old.type, number: String(req.body.number ?? '').trim() || old.number, attachment: req.body.attachment ?? old.attachment });
  const dup = db.prepare('SELECT id FROM vouchers WHERE type = ? AND number = ? AND id <> ?').get(v.type, v.number, old.id);
  if (dup) throw fail(`Số phiếu ${v.number} đã tồn tại`);
  tx(() => {
    db.prepare(`UPDATE vouchers SET posted=1, number=?, date=?, partner_id=?, partner=?, address=?, description=?, ref_no=?, attachment=?, updated_by=?, updated_at=? WHERE id=?`)
      .run(v.number, v.date, v.partner_id, v.partner, v.address, v.description, v.ref_no, v.attachment, req.user.username, now(), old.id);
    saveExtra(old.id, v);
    db.prepare('DELETE FROM voucher_lines WHERE voucher_id = ?').run(old.id);
    insertLines(old.id, v.lines);
    costing.checkNoNegative([...v.lines.map((l) => l.item_id), ...old.lines.map((l) => l.item_id)]);
    costing.markDirty((old.date < v.date ? old.date : v.date).slice(0, 7));
  });
  audit(req, 'VOUCHER_UPDATE', `${summary(v)} | trước khi sửa: ${summary(old)}`, null, 'voucher:' + old.id);
  audit(req, 'VOUCHER_POST', `Ghi sổ ${TYPE_NAME[v.type]} ${v.number}`, null, 'voucher:' + old.id);
  res.json({ ok: true });
}));

app.delete('/api/vouchers/:id', canWrite, h((req, res) => {
  const old = getVoucher(req.params.id);
  if (!old) throw fail('Không tìm thấy chứng từ', 404);
  if (old.locked) throw fail(`Kỳ ${old.date.slice(0, 7)} đã khóa sổ`);
  tx(() => {
    db.prepare('DELETE FROM vouchers WHERE id = ?').run(old.id);
    costing.checkNoNegative(old.lines.map((l) => l.item_id));
    costing.markDirty(old.date.slice(0, 7));
  });
  audit(req, 'VOUCHER_DELETE', summary(old), null, 'voucher:' + old.id);
  res.json({ ok: true });
}));

// Ghi sổ / bỏ ghi chứng từ. Bỏ ghi: chứng từ không còn được tính vào tồn kho, giá vốn, báo cáo cho đến khi ghi sổ lại.
function setPosted(v, post, req) {
  if (v.locked) throw fail(`Kỳ ${v.date.slice(5, 7)}/${v.date.slice(0, 4)} đã khóa sổ`);
  if (!!v.posted === post) return false;
  tx(() => {
    db.prepare('UPDATE vouchers SET posted = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(post ? 1 : 0, req.user.username, now(), v.id);
    if (!post) db.prepare('UPDATE voucher_lines SET cost_price = NULL, cost_amount = NULL WHERE voucher_id = ?').run(v.id);
    costing.checkNoNegative(v.lines.map((l) => l.item_id));
    costing.markDirty(v.date.slice(0, 7));
  });
  audit(req, post ? 'VOUCHER_POST' : 'VOUCHER_UNPOST', `${post ? 'Ghi sổ' : 'Bỏ ghi'} ${TYPE_NAME[v.type]} ${v.number} ngày ${v.date}`, null, 'voucher:' + v.id);
  return true;
}
app.post('/api/vouchers/:id/post', canWrite, h((req, res) => {
  const v = getVoucher(req.params.id);
  if (!v) throw fail('Không tìm thấy chứng từ', 404);
  setPosted(v, req.body?.post !== false, req);
  res.json({ ok: true });
}));
// Ghi sổ / bỏ ghi hàng loạt: bỏ ghi phiếu xuất trước phiếu nhập, ghi sổ phiếu nhập trước phiếu xuất
app.post('/api/vouchers/bulk-post', canWrite, h((req, res) => {
  const post = req.body?.post !== false;
  const ids = [...new Set((req.body?.ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw fail('Chưa chọn phiếu nào');
  const list = ids.map((id) => getVoucher(id) || { id, missing: true })
    .sort((a, b) => (a.type === b.type ? 0 : (a.type === 'N') === post ? -1 : 1));
  const done = [], skipped = [];
  for (const v of list) {
    if (v.missing) { skipped.push({ number: `#${v.id}`, reason: 'Không còn tồn tại' }); continue; }
    try { if (setPosted(v, post, req)) done.push(v.number); }
    catch (e) { skipped.push({ number: v.number, date: v.date, reason: e.message }); }
  }
  res.json({ done, skipped });
}));

// Xóa hàng loạt chứng từ: từng phiếu được xóa riêng (phiếu xuất trước, phiếu nhập sau);
// phiếu thuộc kỳ đã khóa sổ hoặc làm âm kho thì giữ lại kèm lý do
app.post('/api/vouchers/bulk-delete', canWrite, h((req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw fail('Chưa chọn phiếu nào');
  if (ids.length > 2000) throw fail('Mỗi lần xóa tối đa 2.000 phiếu');
  const list = ids.map((id) => getVoucher(id) || { id, missing: true })
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'X' ? -1 : 1));
  const deleted = [], skipped = [];
  for (const v of list) {
    if (v.missing) { skipped.push({ number: `#${v.id}`, reason: 'Không còn tồn tại' }); continue; }
    if (v.locked) { skipped.push({ number: v.number, date: v.date, reason: `Kỳ ${v.date.slice(5, 7)}/${v.date.slice(0, 4)} đã khóa sổ` }); continue; }
    try {
      tx(() => {
        db.prepare('DELETE FROM vouchers WHERE id = ?').run(v.id);
        costing.checkNoNegative(v.lines.map((l) => l.item_id));
        costing.markDirty(v.date.slice(0, 7));
      });
      deleted.push(v.number);
      audit(req, 'VOUCHER_DELETE', summary(v) + ' (xóa hàng loạt)', null, 'voucher:' + v.id);
    } catch (e) {
      skipped.push({ number: v.number, date: v.date, reason: e.message });
    }
  }
  res.json({ deleted, skipped });
}));

// Đơn giá gần nhất của từng mặt hàng đã bán cho một khách hàng (phiếu xuất) / mua của một nhà cung cấp (phiếu nhập)
app.get('/api/last-prices', h((req, res) => {
  const pid = Number(req.query.partner_id), type = req.query.type === 'N' ? 'N' : 'X';
  if (!pid) return res.json({});
  const rows = db.prepare(`SELECT l.item_id, l.unit_price, l.price_vat, l.discount_rate, l.vat_rate, v.date, v.number
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.posted = 1 AND v.partner_id = ? AND v.type = ? AND v.id <> ? ORDER BY v.date DESC, v.id DESC, l.sort DESC`).all(pid, type, Number(req.query.exclude) || 0);
  const out = {};
  for (const r of rows) if (!out[r.item_id]) out[r.item_id] = r;
  res.json(out);
}));

// ---------------- Đọc PDF ----------------
app.post('/api/pdf/parse', canWrite, upload.single('file'), h(async (req, res) => {
  if (!req.file) throw fail('Chưa chọn file PDF');
  if (req.file.buffer.slice(0, 5).toString() !== '%PDF-') throw fail('File không phải PDF');
  const name = crypto.randomBytes(16).toString('hex') + '.pdf';
  fs.writeFileSync(path.join(UPLOAD_DIR, name), req.file.buffer);
  let parsed;
  try { parsed = await parsePdf(req.file.buffer); } catch (e) { throw fail('Không đọc được file PDF: ' + e.message); }
  if (!parsed.error) {
    const want = req.query.type === 'N' || req.query.type === 'X' ? req.query.type : parsed.type || 'X';
    const p = matchPartner(want, parsed.tax_code, parsed.partner);
    if (p) { parsed.partner_id = p.id; parsed.partner_code = p.code; }
  }
  audit(req, 'PDF_UPLOAD', `${req.file.originalname} -> ${parsed.error ? 'lỗi: ' + parsed.error : `nhận diện ${parsed.lines.length} dòng hàng, số ${parsed.number || '?'}`}`);
  res.json({ ...parsed, attachment: name, filename: req.file.originalname });
}));
app.get('/api/attachments/:name', h((req, res) => {
  const name = safeAttachment(req.params.name);
  if (!name) throw fail('Không tìm thấy file', 404);
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(path.join(UPLOAD_DIR, name));
}));

// ---------------- Tính giá xuất kho & kỳ kế toán ----------------
app.get('/api/periods', h((req, res) => {
  const fm = costing.firstMonth();
  if (!fm) return res.json([]);
  const maxV = db.prepare('SELECT MAX(date) d FROM vouchers').get().d;
  const today = now().slice(0, 7);
  let last = maxV ? maxV.slice(0, 7) : fm;
  if (today > last) last = today;
  const map = new Map(db.prepare('SELECT * FROM periods').all().map((p) => [p.month, p]));
  const counts = new Map(db.prepare(`SELECT substr(date,1,7) m, SUM(type='N') n, SUM(type='X') x FROM vouchers GROUP BY m`).all().map((r) => [r.m, r]));
  res.json(costing.monthsBetween(fm, last).reverse().map((m) => ({
    month: m, status: map.get(m)?.status || 'dirty', computed_at: map.get(m)?.computed_at, computed_by: map.get(m)?.computed_by,
    locked: !!map.get(m)?.locked, receipts: counts.get(m)?.n || 0, issues: counts.get(m)?.x || 0,
  })));
}));

app.post('/api/costing/run', canWrite, h((req, res) => {
  const month = req.body?.month;
  if (!isMonth(month)) throw fail('Kỳ không hợp lệ');
  const r = tx(() => costing.runCosting(month, req.user.username));
  audit(req, 'COSTING_RUN', `Tính giá xuất kho BQGQ cuối kỳ đến tháng ${month}: ${r.months.length} kỳ, ${r.lines} dòng xuất`);
  res.json({ months: r.months, lines: r.lines });
}));

app.post('/api/periods/:month/lock', adminOnly, h((req, res) => {
  const m = req.params.month;
  if (!isMonth(m)) throw fail('Kỳ không hợp lệ');
  const locked = !!req.body?.locked;
  if (locked) {
    const p = db.prepare('SELECT status FROM periods WHERE month = ?').get(m);
    if (!p || p.status !== 'computed') throw fail('Phải tính giá xuất kho cho kỳ này trước khi khóa sổ');
  }
  db.prepare(`INSERT INTO periods(month, status, locked) VALUES (?, 'dirty', ?) ON CONFLICT(month) DO UPDATE SET locked = excluded.locked`).run(m, locked ? 1 : 0);
  audit(req, locked ? 'PERIOD_LOCK' : 'PERIOD_UNLOCK', `Kỳ ${m}`);
  res.json({ ok: true });
}));

// ---------------- Báo cáo ----------------
function nxtReport(from, to) {
  const res = costing.compute(to);
  const months = Object.keys(res.months).filter((m) => m >= from && m <= to);
  const items = db.prepare('SELECT * FROM items ORDER BY code').all();
  const rows = items.map((it) => {
    const r = { item_id: it.id, code: it.code, name: it.name, unit: it.unit, open_qty: 0, open_val: 0, in_qty: 0, in_val: 0, out_qty: 0, out_val: 0, close_qty: 0, close_val: 0, avg: 0 };
    months.forEach((m, i) => {
      const d = res.months[m].rows.get(it.id);
      if (!d) return;
      if (i === 0) { r.open_qty = d.open_qty; r.open_val = d.open_val; }
      r.in_qty += d.in_qty; r.in_val += d.in_val; r.out_qty += d.out_qty; r.out_val += d.out_val;
      r.close_qty = d.close_qty; r.close_val = d.close_val; r.avg = d.avg;
    });
    return r;
  });
  return { from, to, months, rows };
}
function reportRange(q) {
  const fm = costing.firstMonth();
  if (!fm) throw fail('Chưa thiết lập ngày chốt số dư đầu kỳ');
  let from = isMonth(q.from) ? q.from : fm;
  const to = isMonth(q.to) ? q.to : from;
  if (from < fm) from = fm;
  if (to < from) throw fail('Kỳ báo cáo không hợp lệ');
  return { from, to };
}
app.get('/api/reports/nxt', h((req, res) => {
  const { from, to } = reportRange(req.query);
  res.json(nxtReport(from, to));
}));

app.get('/api/reports/nxt.xlsx', h(async (req, res) => {
  const { from, to } = reportRange(req.query);
  const rep = nxtReport(from, to);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('NXT');
  if (!roles.canSeeValues(req.user.role)) {
    // Thủ kho: chỉ xuất số lượng
    ws.addRow([getSetting('company_name', '')]);
    ws.addRow(['BÁO CÁO TỔNG HỢP NHẬP - XUẤT - TỒN KHO (SỐ LƯỢNG)']);
    ws.addRow([`Kỳ: ${from} đến ${to}`]);
    ws.addRow([]);
    ws.addRow(['Mã hàng', 'Tên hàng', 'ĐVT', 'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối']).font = { bold: true };
    for (const r of rep.rows) ws.addRow([r.code, r.name, r.unit, r.open_qty, r.in_qty, r.out_qty, r.close_qty]);
    ws.columns.forEach((c, i) => { c.width = i === 1 ? 35 : 14; if (i >= 3) c.numFmt = '#,##0.###'; });
    ws.getRow(2).font = { bold: true, size: 14 };
    audit(req, 'EXPORT', `Xuất Excel báo cáo NXT (số lượng) ${from} - ${to}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="NXT_SL_${from}_${to}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }
  ws.addRow([getSetting('company_name', '')]);
  ws.addRow(['BÁO CÁO TỔNG HỢP NHẬP - XUẤT - TỒN KHO']);
  ws.addRow([`Kỳ: ${from} đến ${to} — Giá xuất kho: Bình quân gia quyền cuối kỳ`]);
  ws.addRow([]);
  ws.addRow(['Mã hàng', 'Tên hàng', 'ĐVT', 'Tồn đầu - SL', 'Tồn đầu - GT', 'Nhập - SL', 'Nhập - GT', 'Xuất - SL', 'Xuất - GT', 'Tồn cuối - SL', 'Tồn cuối - GT', 'Đơn giá BQ kỳ cuối']).font = { bold: true };
  const tot = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const r of rep.rows) {
    const vals = [r.open_qty, r.open_val, r.in_qty, r.in_val, r.out_qty, r.out_val, r.close_qty, r.close_val];
    vals.forEach((v, i) => { tot[i] += v; });
    ws.addRow([r.code, r.name, r.unit, ...vals.map((v, i) => (i % 2 ? Math.round(v) : v)), Math.round(r.avg * 100) / 100]);
  }
  ws.addRow(['TỔNG CỘNG', '', '', ...tot.map((v, i) => (i % 2 ? Math.round(v) : v))]).font = { bold: true };
  ws.columns.forEach((c, i) => { c.width = i === 1 ? 35 : 15; if (i >= 3) c.numFmt = '#,##0.##'; });
  ws.getRow(2).font = { bold: true, size: 14 };
  audit(req, 'EXPORT', `Xuất Excel báo cáo NXT ${from} - ${to}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="NXT_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// Sổ chi tiết vật tư hàng hóa
// Sổ chi tiết vật tư: một hoặc nhiều mặt hàng (item_ids=1,2,3)
function ledgerFor(it, from, to, comp) {
  const first = comp.months[from]?.rows.get(it.id);
  const lines = db.prepare(`SELECT l.id, l.qty, l.unit_price, l.amount, v.id voucher_id, v.type, v.number, v.date, v.partner, v.description
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE l.item_id = ? AND v.posted = 1 AND substr(v.date,1,7) BETWEEN ? AND ? ORDER BY v.date, v.type, v.id, l.sort`).all(it.id, from, to);
  let bq = first ? first.open_qty : 0, bv = first ? first.open_val : 0;
  let iq = 0, iv = 0, oq = 0, ov = 0;
  const out = lines.map((l) => {
    const m = l.date.slice(0, 7);
    let price, value;
    if (l.type === 'N') { price = l.unit_price; value = l.amount; bq += l.qty; bv += l.amount; iq += l.qty; iv += l.amount; }
    else { const c = comp.months[m].lineCosts.get(l.id); price = c.cost_price; value = c.cost_amount; bq -= l.qty; bv -= value; oq += l.qty; ov += value; }
    return { ...l, price, value, bal_qty: bq, bal_val: bv };
  });
  const months = Object.keys(comp.months).filter((m) => m >= from && m <= to).map((m) => ({ month: m, ...comp.months[m].rows.get(it.id) }));
  return { item: it, from, to, open_qty: first?.open_qty || 0, open_val: first?.open_val || 0, in_qty: iq, in_val: iv, out_qty: oq, out_val: ov, close_qty: bq, close_val: bv, lines: out, months };
}
app.get('/api/reports/ledger', h((req, res) => {
  const { from, to } = reportRange(req.query);
  const ids = String(req.query.item_ids || req.query.item_id || '').split(',').map(Number).filter(Number.isInteger).slice(0, 500);
  const items = ids.map((id) => db.prepare('SELECT * FROM items WHERE id = ?').get(id)).filter(Boolean);
  if (!items.length) throw fail('Chọn ít nhất một mã hàng');
  const comp = costing.compute(to);
  if (req.query.item_id && !req.query.item_ids) return res.json(ledgerFor(items[0], from, to, comp));
  res.json({ from, to, ledgers: items.map((it) => ledgerFor(it, from, to, comp)) });
}));

// Báo cáo bán hàng theo mặt hàng (nhiều mặt hàng, lọc theo khách hàng, khoảng ngày)
app.get('/api/reports/sales', h((req, res) => {
  const fm = costing.firstMonth();
  if (!fm) throw fail('Chưa thiết lập ngày chốt số dư đầu kỳ');
  const from = isDate(req.query.from) ? req.query.from : costing.addDays(getSetting('opening_date'), 1);
  const to = isDate(req.query.to) ? req.query.to : now().slice(0, 10);
  if (to < from) throw fail('Khoảng ngày không hợp lệ');
  const ids = String(req.query.item_ids || '').split(',').map(Number).filter(Number.isInteger);
  res.json(analytics.salesByItem(analyticsCtx(), from, to, { itemIds: ids, partnerKey: String(req.query.partner || '') }));
}));

function analyticsCtx() {
  const lines = db.prepare(`SELECT l.id, l.item_id, l.qty, l.amount, v.id vid, v.type, v.number, v.date, v.partner_id, v.partner
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.posted = 1 AND v.date > ?`).all(getSetting('opening_date') || '0000-00-00')
    .map((r) => ({ id: r.id, item_id: r.item_id, qty: r.qty, amount: r.amount, v: { id: r.vid, type: r.type, number: r.number, date: r.date, partner_id: r.partner_id, partner: r.partner } }));
  return { lines, items: db.prepare('SELECT id, code, name, unit FROM items').all(), partners: db.prepare('SELECT id, kind, code, name FROM partners').all(), compute: costing.compute };
}
app.get('/api/reports/partners', h((req, res) => {
  const { from, to } = reportRange(req.query);
  res.json(analytics.partnerSummary(analyticsCtx(), from, to, req.query.kind));
}));
app.get('/api/reports/partner-detail', h((req, res) => {
  const { from, to } = reportRange(req.query);
  res.json(analytics.partnerDetail(analyticsCtx(), from, to, req.query.kind, String(req.query.key || '')));
}));
app.get('/api/reports/analytics', h((req, res) => {
  const { from, to } = reportRange(req.query);
  res.json(analytics.dashboard(analyticsCtx(), from, to, costing.monthsBetween(from, to)));
}));

app.get('/api/dashboard', h((req, res) => {
  const fm = costing.firstMonth();
  const cur = now().slice(0, 7);
  let stock = null;
  if (fm) {
    const c = costing.compute(cur < fm ? fm : cur);
    const last = c.months[cur < fm ? fm : cur];
    if (last) {
      let q = 0, v = 0, cnt = 0;
      for (const r of last.rows.values()) { v += r.close_val; if (r.close_qty > 0) cnt++; q += r.close_qty; }
      stock = { value: v, items_in_stock: cnt };
    }
  }
  const m = db.prepare(`SELECT v.type, COUNT(DISTINCT v.id) c, COALESCE(SUM(l.amount),0) amt FROM vouchers v LEFT JOIN voucher_lines l ON l.voucher_id = v.id
    WHERE v.posted = 1 AND substr(v.date,1,7) = ? GROUP BY v.type`).all(cur);
  res.json({
    month: cur, opening_date: getSetting('opening_date'),
    items: db.prepare('SELECT COUNT(*) c FROM items').get().c,
    stock, this_month: Object.fromEntries(m.map((r) => [r.type, r])),
    dirty: db.prepare(`SELECT COUNT(*) c FROM periods WHERE status='dirty'`).get().c,
    recent: db.prepare('SELECT id, type, number, date, partner FROM vouchers ORDER BY id DESC LIMIT 8').all(),
  });
}));

// ---------------- Người dùng & nhật ký ----------------
app.get('/api/users', adminOnly, (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.username, u.full_name, u.role, u.active, u.created_at, u.locked_until,
    (SELECT MAX(ts) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'LOGIN_OK') last_login,
    (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) active_sessions
    FROM users u ORDER BY u.id`).all(now()));
});
app.post('/api/users', adminOnly, h((req, res) => {
  const b = req.body || {};
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(b.username || '')) throw fail('Tên đăng nhập 3-32 ký tự, chỉ gồm chữ, số, dấu . _ -');
  const err = auth.validatePassword(b.password, b.username);
  if (err) throw fail(err);
  if (!roles.ROLES[b.role]) throw fail('Vai trò không hợp lệ');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(b.username)) throw fail('Tên đăng nhập đã tồn tại');
  db.prepare('INSERT INTO users(username, password_hash, full_name, role, must_change, created_at) VALUES (?,?,?,?,1,?)')
    .run(b.username, auth.hashPassword(b.password), b.full_name || '', b.role, now());
  audit(req, 'USER_CREATE', `${b.username} (${b.role})`);
  res.json({ ok: true });
}));
app.put('/api/users/:id', adminOnly, h((req, res) => {
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw fail('Không tìm thấy người dùng', 404);
  if (u.id === req.user.id && (b.active === false || (b.role && b.role !== 'admin'))) throw fail('Không thể tự khóa hoặc hạ quyền chính mình');
  const changes = [];
  if (b.full_name !== undefined) { db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(b.full_name, u.id); changes.push('họ tên'); }
  if (b.role && roles.ROLES[b.role]) { db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, u.id); changes.push('vai trò=' + b.role); }
  if (b.active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, u.id);
    if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    changes.push(b.active ? 'mở khóa' : 'khóa tài khoản');
  }
  if (b.password) {
    const err = auth.validatePassword(b.password, u.username);
    if (err) throw fail(err);
    db.prepare('UPDATE users SET password_hash = ?, must_change = 1, failed_count = 0, locked_until = NULL WHERE id = ?').run(auth.hashPassword(b.password), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    changes.push('đặt lại mật khẩu');
  }
  audit(req, 'USER_UPDATE', `${u.username}: ${changes.join(', ')}`);
  res.json({ ok: true });
}));

app.get('/api/audit', adminOnly, (req, res) => {
  const where = [], args = [];
  if (req.query.username) { where.push('username = ?'); args.push(req.query.username); }
  if (req.query.action) { where.push('action = ?'); args.push(req.query.action); }
  if (isDate(req.query.from)) { where.push('ts >= ?'); args.push(req.query.from); }
  if (isDate(req.query.to)) { where.push('ts < ?'); args.push(costing.addDays(req.query.to, 1)); }
  if (req.query.q) { where.push('(detail LIKE ? OR ip LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const page = Math.max(1, Number(req.query.page) || 1);
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_log ${w}`).get(...args).c;
  const rows = db.prepare(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT 100 OFFSET ?`).all(...args, (page - 1) * 100);
  res.json({ total, page, rows });
});
app.get('/api/sessions', adminOnly, (req, res) => {
  res.json(db.prepare(`SELECT s.created_at, s.last_seen, s.expires_at, s.ip, s.ua, u.username FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > ? ORDER BY s.last_seen DESC`).all(now()));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy' }));

const PORT = Number(process.env.PORT) || Number(fileCfg.port) || 3000;
const HOST = process.env.HOST || fileCfg.host || '127.0.0.1';
function openBrowser(url) {
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
const localUrl = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
const server = app.listen(PORT, HOST, (err) => {
  if (err) return; // Express 5 gọi lại cả khi lỗi (cổng bận): xử lý ở server.on('error')
  if (tunnelAvailable() && getSetting('tunnel_enabled', '0') === '1' && getSetting('tunnel_token', '')) tunnel.start(DATA_DIR, getSetting('tunnel_token', ''));
  console.log(`Ứng dụng Quản lý kho ${APP_VERSION}${process.env.KHO_RUNNING_UPDATE ? ' (bản cập nhật)' : ''} đang chạy: http://${HOST}:${PORT}`);
  if (sea) {
    const lan = HOST === '0.0.0.0' ? lanAddresses() : [];
    if (getSetting('tunnel_url', '')) console.log(`  Truy cập từ Internet: ${getSetting('tunnel_url', '')}`);
    console.log(`\n  ${getSetting('company_name', 'Quản lý kho')}\n  Mở trình duyệt tại: ${localUrl}\n  Dữ liệu lưu tại:   ${process.env.DATA_DIR}\n`);
    if (lan.length) console.log(`  MÁY KHÁC TRONG MẠNG NỘI BỘ truy cập bằng đường link:\n${lan.map((a) => '    ' + a.url).join('\n')}\n    http://${os.hostname()}:${PORT}\n`);
    else console.log('  Đang ở chế độ chỉ máy này dùng. Bật dùng chung trong mạng: Cài đặt > Dùng chung trong mạng nội bộ.\n');
    console.log('  KHÔNG đóng cửa sổ này trong khi đang dùng phần mềm.\n');
    if (process.env.NO_BROWSER !== '1' && !process.argv.includes('--no-browser')) openBrowser(localUrl);
  }
});
let listenTries = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && process.env.KHO_RESTART === '1' && listenTries++ < 40) {
    // vừa khởi động lại sau cập nhật: đợi tiến trình cũ nhả cổng
    return setTimeout(() => server.listen(PORT, HOST), 500);
  }
  if (e.code === 'EADDRINUSE') {
    // Đã có một cửa sổ phần mềm đang chạy: chỉ mở lại trình duyệt
    console.log(`Phần mềm đã đang chạy ở cổng ${PORT}. Đang mở trình duyệt...`);
    if (sea && process.env.NO_BROWSER !== '1' && !process.argv.includes('--no-browser')) openBrowser(localUrl);
    setTimeout(() => process.exit(0), 3000);
  } else {
    console.error(e);
    process.exit(1);
  }
});

// Đăng nhập, phiên làm việc, mã hóa mật khẩu và nhật ký truy cập
const crypto = require('crypto');
const { db, now } = require('./db');

const SESSION_HOURS = 8;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Mật khẩu quá phổ biến, dễ bị đoán
const WEAK = new Set(['admin@123', 'admin123', 'password1', 'abc12345', '12345678a', 'a12345678', 'qwerty123', '123456789a', 'matkhau123', 'matkhau1', 'admin1234', 'abcd1234', '1234abcd', 'iloveyou1', 'ketoan123', 'thukho123', 'khohang123']);
function validatePassword(pw, username = '') {
  if (!pw || pw.length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự';
  if (pw.length > 128) return 'Mật khẩu quá dài';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Mật khẩu phải gồm cả chữ và số';
  if (WEAK.has(pw.toLowerCase())) return 'Mật khẩu này quá phổ biến, dễ bị đoán. Hãy chọn mật khẩu khác';
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return 'Mật khẩu không được chứa tên đăng nhập';
  return null;
}

// Yêu cầu đến qua proxy tin cậy: TRUST_PROXY=1 (Caddy/Render), hoặc cloudflared chạy trên chính máy này
// (kết nối từ 127.0.0.1 kèm header của Cloudflare). Máy khác trong mạng nội bộ không giả mạo được IP.
const isLoopback = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
function viaProxy(req) {
  if (process.env.TRUST_PROXY === '1') return true;
  return isLoopback(req.socket.remoteAddress || '') && !!(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
}
function isHttps(req) {
  return viaProxy(req) && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function clientInfo(req) {
  const fwd = viaProxy(req) ? String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0]).trim() : '';
  const ip = fwd || req.socket.remoteAddress || '';
  return { ip, ua: String(req.headers['user-agent'] || '').slice(0, 300) };
}

function audit(req, action, detail = '', user = null, ref = null) {
  const u = user || req.user || {};
  const { ip, ua } = clientInfo(req);
  db.prepare('INSERT INTO audit_log(ts, user_id, username, action, detail, ip, ua, ref) VALUES (?,?,?,?,?,?,?,?)')
    .run(now(), u.id ?? null, u.username ?? null, action, typeof detail === 'string' ? detail : JSON.stringify(detail), ip, ua, ref);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function addHours(h) {
  const d = new Date(Date.now() + h * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function setCookie(req, res, token, maxAgeSec) {
  // Cookie chỉ gửi qua HTTPS khi truy cập bằng HTTPS (qua Cloudflare / máy chủ online)
  const secure = process.env.COOKIE_SECURE === '1' || isHttps(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure}`);
}

// Giới hạn số lần đăng nhập sai theo địa chỉ IP (chống dò mật khẩu nhiều tài khoản)
const IP_MAX_FAILS = 20;
const IP_WINDOW_MS = 15 * 60 * 1000;
const ipFails = new Map();
function ipBlocked(ip) {
  const e = ipFails.get(ip);
  if (!e) return false;
  if (Date.now() - e.first > IP_WINDOW_MS) { ipFails.delete(ip); return false; }
  return e.count >= IP_MAX_FAILS;
}
function ipFail(ip) {
  const e = ipFails.get(ip);
  if (!e || Date.now() - e.first > IP_WINDOW_MS) ipFails.set(ip, { first: Date.now(), count: 1 });
  else e.count++;
  if (ipFails.size > 10000) ipFails.clear();
}
const DUMMY_HASH = hashPassword('khong-co-tai-khoan-nay-' + crypto.randomBytes(8).toString('hex'));
const GENERIC = 'Sai tên đăng nhập hoặc mật khẩu';

function login(req, res) {
  const { username, password } = req.body || {};
  const { ip } = clientInfo(req);
  if (ipBlocked(ip)) {
    audit(req, 'LOGIN_FAIL', `Chặn tạm thời IP ${ip} do đăng nhập sai quá ${IP_MAX_FAILS} lần`);
    return res.status(429).json({ error: 'Đăng nhập sai quá nhiều lần từ địa chỉ này. Vui lòng thử lại sau 15 phút' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().slice(0, 64));
  if (!user) {
    verifyPassword(String(password || ''), DUMMY_HASH); // cùng thời gian xử lý như tài khoản có thật (không dò được tên đăng nhập)
    ipFail(ip);
    audit(req, 'LOGIN_FAIL', `Tên đăng nhập không tồn tại: ${String(username || '').slice(0, 50)}`);
    return res.status(401).json({ error: GENERIC });
  }
  if (!user.active) {
    verifyPassword(String(password || ''), DUMMY_HASH);
    ipFail(ip);
    audit(req, 'LOGIN_FAIL', 'Tài khoản đã bị khóa', user);
    return res.status(401).json({ error: GENERIC });
  }
  if (user.locked_until && user.locked_until > now()) {
    audit(req, 'LOGIN_FAIL', 'Đang bị tạm khóa do nhập sai nhiều lần', user);
    return res.status(429).json({ error: `Tài khoản tạm khóa ${LOCK_MINUTES} phút do nhập sai mật khẩu nhiều lần` });
  }
  // Tài khoản còn mật khẩu ban đầu (bắt buộc đổi): chỉ cho đăng nhập trên máy chủ / mạng nội bộ, không cho từ Internet
  if (user.must_change && viaProxy(req) && process.env.KHO_DOCKER !== '1') {
    audit(req, 'LOGIN_FAIL', 'Chặn đăng nhập từ Internet khi tài khoản còn mật khẩu ban đầu', user);
    return res.status(403).json({ error: 'Tài khoản đang dùng mật khẩu ban đầu: hãy đăng nhập và đổi mật khẩu trên máy cài phần mềm (hoặc trong mạng nội bộ) trước khi dùng qua Internet' });
  }
  if (!verifyPassword(String(password || ''), user.password_hash)) {
    ipFail(ip);
    const failed = user.failed_count + 1;
    const lockedUntil = failed >= MAX_FAILED ? addHours(LOCK_MINUTES / 60) : null;
    db.prepare('UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?').run(lockedUntil ? 0 : failed, lockedUntil, user.id);
    audit(req, 'LOGIN_FAIL', lockedUntil ? `Sai mật khẩu lần ${failed} - tạm khóa ${LOCK_MINUTES} phút` : `Sai mật khẩu lần ${failed}`, user);
    return res.status(401).json({ error: GENERIC });
  }
  db.prepare('UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?').run(user.id);
  // dọn phiên hết hạn
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  const token = crypto.randomBytes(32).toString('hex');
  const { ua } = clientInfo(req);
  db.prepare('INSERT INTO sessions(token, user_id, created_at, expires_at, last_seen, ip, ua) VALUES (?,?,?,?,?,?,?)')
    .run(token, user.id, now(), addHours(SESSION_HOURS), now(), ip, ua);
  setCookie(req, res, token, SESSION_HOURS * 3600);
  audit(req, 'LOGIN_OK', 'Đăng nhập thành công', user);
  res.json({ ok: true, user: publicUser(user) });
}

function logout(req, res) {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  if (req.user) audit(req, 'LOGOUT', 'Đăng xuất');
  setCookie(req, res, '', 0);
  res.json({ ok: true });
}

function publicUser(u) {
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, must_change: !!u.must_change };
}

// Middleware: bắt buộc đăng nhập
function requireAuth(req, res, next) {
  const token = parseCookies(req).sid;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s || s.expires_at < now()) {
    if (s) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!user || !user.active) return res.status(401).json({ error: 'Tài khoản không hợp lệ' });
  db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token = ?').run(now(), addHours(SESSION_HOURS), token);
  req.user = user;
  req.sessionToken = token;
  // Người dùng phải đổi mật khẩu trước khi dùng các chức năng khác
  if (user.must_change && !['/api/me', '/api/me/password', '/api/logout'].includes(req.baseUrl + req.path)) {
    return res.status(403).json({ error: 'Bạn cần đổi mật khẩu trước khi tiếp tục', must_change: true });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Bạn không có quyền thực hiện chức năng này' });
    next();
  };
}

// Tạo tài khoản quản trị mặc định khi chạy lần đầu
function ensureAdmin() {
  const c = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (c === 0) {
    const pw = process.env.ADMIN_PASSWORD || 'admin@123';
    db.prepare('INSERT INTO users(username, password_hash, full_name, role, must_change, created_at) VALUES (?,?,?,?,1,?)')
      .run('admin', hashPassword(pw), 'Quản trị hệ thống', 'admin', now());
    console.log(`\n>> Đã tạo tài khoản quản trị: admin / ${pw}  (bắt buộc đổi mật khẩu khi đăng nhập lần đầu)\n`);
  }
}

module.exports = {
  isHttps, viaProxy, hashPassword, verifyPassword, validatePassword, audit, login, logout,
  requireAuth, requireRole, ensureAdmin, publicUser,
};

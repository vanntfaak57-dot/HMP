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

function validatePassword(pw) {
  if (!pw || pw.length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Mật khẩu phải gồm cả chữ và số';
  return null;
}

function clientInfo(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  return { ip, ua: String(req.headers['user-agent'] || '').slice(0, 300) };
}

function audit(req, action, detail = '', user = null) {
  const u = user || req.user || {};
  const { ip, ua } = clientInfo(req);
  db.prepare('INSERT INTO audit_log(ts, user_id, username, action, detail, ip, ua) VALUES (?,?,?,?,?,?,?)')
    .run(now(), u.id ?? null, u.username ?? null, action, typeof detail === 'string' ? detail : JSON.stringify(detail), ip, ua);
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

function setCookie(res, token, maxAgeSec) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure}`);
}

function login(req, res) {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!user) {
    audit(req, 'LOGIN_FAIL', `Tên đăng nhập không tồn tại: ${String(username || '').slice(0, 50)}`);
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
  if (!user.active) {
    audit(req, 'LOGIN_FAIL', 'Tài khoản đã bị khóa', user);
    return res.status(403).json({ error: 'Tài khoản đã bị vô hiệu hóa' });
  }
  if (user.locked_until && user.locked_until > now()) {
    audit(req, 'LOGIN_FAIL', 'Đang bị tạm khóa do nhập sai nhiều lần', user);
    return res.status(429).json({ error: `Tài khoản tạm khóa đến ${user.locked_until} do nhập sai mật khẩu nhiều lần` });
  }
  if (!verifyPassword(String(password || ''), user.password_hash)) {
    const failed = user.failed_count + 1;
    const lockedUntil = failed >= MAX_FAILED ? addHours(LOCK_MINUTES / 60) : null;
    db.prepare('UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?').run(lockedUntil ? 0 : failed, lockedUntil, user.id);
    audit(req, 'LOGIN_FAIL', lockedUntil ? `Sai mật khẩu lần ${failed} - tạm khóa ${LOCK_MINUTES} phút` : `Sai mật khẩu lần ${failed}`, user);
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
  db.prepare('UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?').run(user.id);
  const token = crypto.randomBytes(32).toString('hex');
  const { ip, ua } = clientInfo(req);
  db.prepare('INSERT INTO sessions(token, user_id, created_at, expires_at, last_seen, ip, ua) VALUES (?,?,?,?,?,?,?)')
    .run(token, user.id, now(), addHours(SESSION_HOURS), now(), ip, ua);
  setCookie(res, token, SESSION_HOURS * 3600);
  audit(req, 'LOGIN_OK', 'Đăng nhập thành công', user);
  res.json({ ok: true, user: publicUser(user) });
}

function logout(req, res) {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  if (req.user) audit(req, 'LOGOUT', 'Đăng xuất');
  setCookie(res, '', 0);
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
  hashPassword, verifyPassword, validatePassword, audit, login, logout,
  requireAuth, requireRole, ensureAdmin, publicUser,
};

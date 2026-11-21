// Đóng gói phần mềm thành 1 file chạy độc lập (không cần cài Node.js) bằng Node.js Single Executable Application.
//   node tools/build-app.js                 -> gói cập nhật + bản Windows (KhoETC.exe) + bản Linux
//   node tools/build-app.js update          -> chỉ gói cập nhật (.khoupd + latest.json)
//   node tools/build-app.js win --version 1.2.0
// Phiên bản mặc định lấy từ package.json; ghi chú phát hành lấy từ mục tương ứng trong CHANGELOG.md.
// Kết quả: build/dist/
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const WORK = path.join(BUILD, 'work');
const CACHE = path.join(BUILD, 'cache');
const DIST = path.join(BUILD, 'dist');
const NODE_VERSION = process.version; // blob SEA phải tạo bằng đúng phiên bản Node của file chạy
const APP_NAME = 'KhoETC';
const argv = process.argv.slice(2);
const vIdx = argv.indexOf('--version');
const VERSION = vIdx >= 0 ? argv.splice(vIdx, 2)[1] : require('../package.json').version;
if (!/^\d+\.\d+\.\d+$/.test(VERSION)) throw new Error('Phiên bản không hợp lệ: ' + VERSION);
const targets = argv.length ? argv : ['update', 'win', 'linux'];

// Ghi chú phát hành của phiên bản (mục "## x.y.z" trong CHANGELOG.md)
function releaseNotes() {
  try {
    const md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const m = md.match(new RegExp('^## ' + VERSION.replace(/\./g, '\\.') + '[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))', 'm'));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

// Nhúng toàn bộ thư mục public vào mã (module ảo "kho:assets")
const assetsPlugin = {
  name: 'kho-assets',
  setup(b) {
    b.onResolve({ filter: /^kho:assets$/ }, () => ({ path: 'kho-assets', namespace: 'kho' }));
    b.onLoad({ filter: /.*/, namespace: 'kho' }, () => {
      const map = {};
      for (const f of fs.readdirSync(path.join(ROOT, 'public'))) map['/' + f] = fs.readFileSync(path.join(ROOT, 'public', f)).toString('base64');
      return { contents: 'module.exports = ' + JSON.stringify(map) + ';', loader: 'js' };
    });
  },
};
const esbuildOpts = (entry, outfile) => ({
  entryPoints: [path.join(ROOT, entry)], bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  outfile, legalComments: 'none', logLevel: 'warning', plugins: [assetsPlugin],
  define: { 'process.env.KHO_BUILD_VERSION': JSON.stringify(VERSION) },
  // pdf.js 1.10 tự tìm thư viện vẽ ảnh "canvas" (không cần cho việc đọc chữ)
  external: ['canvas'],
});

for (const d of [WORK, CACHE, DIST]) fs.mkdirSync(d, { recursive: true });
const log = (...a) => console.log('>>', ...a);

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u) => https.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return get(res.headers.location);
      if (res.statusCode !== 200) return reject(new Error(`Tải ${u} lỗi ${res.statusCode}`));
      const out = fs.createWriteStream(dest + '.part');
      res.pipe(out);
      out.on('finish', () => { out.close(); fs.renameSync(dest + '.part', dest); resolve(); });
    }).on('error', reject);
    get(url);
  });
}
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function nodeBinary(target) {
  if (target === 'linux' && process.platform === 'linux') return process.execPath;
  if (target === 'win' && process.platform === 'win32') return process.execPath; // dựng ngay trên Windows
  if (target !== 'win') throw new Error('Chưa hỗ trợ: ' + target);
  const file = path.join(CACHE, `node-${NODE_VERSION}-win-x64.exe`);
  if (!fs.existsSync(file)) {
    log(`Tải Node.js ${NODE_VERSION} cho Windows...`);
    await download(`https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`, file);
  }
  // Kiểm tra mã băm với danh sách SHASUMS256 chính thức
  const sums = path.join(CACHE, `SHASUMS256-${NODE_VERSION}.txt`);
  if (!fs.existsSync(sums)) await download(`https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`, sums);
  const line = fs.readFileSync(sums, 'utf8').split('\n').find((l) => l.endsWith(' win-x64/node.exe'));
  if (!line || line.split(/\s+/)[0] !== sha256(file)) { fs.rmSync(file, { force: true }); throw new Error('Mã băm node.exe không khớp, đã xóa file tải về. Chạy lại để tải lại.'); }
  log('node.exe hợp lệ (SHA256 khớp danh sách chính thức)');
  return file;
}

async function main() {
  const esbuild = require('esbuild');
  log(`Phiên bản ${VERSION}`);

  // 1. Gói cập nhật: toàn bộ phần mềm trong 1 file JS, nén gzip, dòng đầu ghi phiên bản
  if (targets.includes('update')) {
    log('Tạo gói cập nhật...');
    const appJs = path.join(WORK, 'kho-app.js');
    await esbuild.build(esbuildOpts('server.js', appJs));
    const header = '// KHO-UPDATE ' + JSON.stringify({ version: VERSION, built: new Date().toISOString() }) + '\n';
    const pkgName = `${APP_NAME}-update-${VERSION}.khoupd`;
    const pkg = require('zlib').gzipSync(Buffer.concat([Buffer.from(header), fs.readFileSync(appJs)]), { level: 9 });
    fs.writeFileSync(path.join(DIST, pkgName), pkg);
    const manifest = { version: VERSION, url: pkgName, sha256: crypto.createHash('sha256').update(pkg).digest('hex'), size: pkg.length, notes: releaseNotes(), released: new Date().toISOString().slice(0, 10) };
    fs.writeFileSync(path.join(DIST, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
    log(`Xong: build/dist/${pkgName} (${(pkg.length / 1048576).toFixed(1)} MB) + build/dist/latest.json`);
  }
  const apps = targets.filter((t) => t !== 'update');
  if (!apps.length) return;

  // 2. File chạy: trình khởi chạy + bản gốc gộp thành 1 file
  log('Gộp mã nguồn cho file chạy (esbuild)...');
  const bundle = path.join(WORK, 'kho.js');
  await esbuild.build(esbuildOpts('launcher.js', bundle));
  const blob = path.join(WORK, 'kho.blob');
  const seaConfig = path.join(WORK, 'sea-config.json');
  fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }, null, 2));
  log('Tạo gói SEA...');
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

  const postject = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
  const readme = fs.readFileSync(path.join(__dirname, 'HUONG-DAN-APP.txt'), 'utf8');
  for (const target of apps) {
    const dirName = `${APP_NAME}-${target === 'win' ? 'Windows' : 'Linux'}-x64`;
    const outDir = path.join(DIST, dirName);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const exe = path.join(outDir, target === 'win' ? `${APP_NAME}.exe` : APP_NAME);
    fs.copyFileSync(await nodeBinary(target), exe);
    fs.chmodSync(exe, 0o755);
    log(`Nhúng ứng dụng vào ${path.basename(exe)}...`);
    execFileSync(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite'], { stdio: 'inherit' });
    if (target === 'win') {
      // Đổi PE subsystem từ console (3) sang Windows GUI (2): bấm đúp không hiện cửa sổ đen, phần mềm chạy ngầm
      const buf = fs.readFileSync(exe);
      const pe = buf.readUInt32LE(0x3c);
      if (buf.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('KhoETC.exe không đúng định dạng PE');
      buf.writeUInt16LE(2, pe + 24 + 68);
      fs.writeFileSync(exe, buf);
      // các file hỗ trợ cho Windows
      for (const f of ['MO-TUONG-LUA.bat', 'TU-DONG-CHAY-KHI-BAT-MAY.bat']) fs.writeFileSync(path.join(outDir, f), fs.readFileSync(path.join(__dirname, 'windows', f), 'utf8').replace(/\r?\n/g, '\r\n'));
    }
    fs.writeFileSync(path.join(outDir, 'HUONG-DAN-SU-DUNG.txt'), (target === 'win' ? readme.replace(/\n/g, '\r\n') : readme.replace(/KhoETC\.exe/g, 'KhoETC')));
    fs.writeFileSync(path.join(outDir, 'kho-config.json'), JSON.stringify({ port: 3000, host: '127.0.0.1' }, null, 2) + '\n');
    const zip = path.join(DIST, dirName + '.zip');
    fs.rmSync(zip, { force: true });
    if (process.platform === 'win32') execFileSync('tar', ['-a', '-c', '-f', zip, dirName], { cwd: DIST }); // tar.exe có sẵn trên Windows 10+
    else execFileSync('zip', ['-r', '-q', '-9', zip, dirName], { cwd: DIST });
    log(`Xong: ${path.relative(ROOT, zip)} (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
  }
}
main().catch((e) => { console.error('LỖI:', e.message); process.exit(1); });

// Đóng gói phần mềm thành 1 file chạy độc lập (không cần cài Node.js) bằng Node.js Single Executable Application.
//   node tools/build-app.js            -> bản Windows (KhoETC.exe) + bản Linux
//   node tools/build-app.js win        -> chỉ bản Windows
// Kết quả: build/dist/*.zip
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
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['win', 'linux'];

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
  // 1. Gộp mã nguồn thành 1 file
  log('Gộp mã nguồn (esbuild)...');
  const bundle = path.join(WORK, 'kho.js');
  require('esbuild').buildSync({
    entryPoints: [path.join(ROOT, 'server.js')], bundle: true, platform: 'node', target: 'node22', format: 'cjs',
    outfile: bundle, legalComments: 'none', logLevel: 'warning',
    // pdf.js 1.10 tự tìm thư viện vẽ ảnh "canvas" (không cần cho việc đọc chữ)
    external: ['canvas'],
  });

  // 2. Cấu hình SEA: nhúng toàn bộ thư mục public
  const assets = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'public'))) assets['public/' + f] = path.join(ROOT, 'public', f);
  const blob = path.join(WORK, 'kho.blob');
  const seaConfig = path.join(WORK, 'sea-config.json');
  fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets }, null, 2));
  log('Tạo gói SEA...');
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

  const postject = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
  const readme = fs.readFileSync(path.join(__dirname, 'HUONG-DAN-APP.txt'), 'utf8');
  for (const target of targets) {
    const dirName = `${APP_NAME}-${target === 'win' ? 'Windows' : 'Linux'}-x64`;
    const outDir = path.join(DIST, dirName);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const exe = path.join(outDir, target === 'win' ? `${APP_NAME}.exe` : APP_NAME);
    fs.copyFileSync(await nodeBinary(target), exe);
    fs.chmodSync(exe, 0o755);
    log(`Nhúng ứng dụng vào ${path.basename(exe)}...`);
    execFileSync(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite'], { stdio: 'inherit' });
    fs.writeFileSync(path.join(outDir, 'HUONG-DAN-SU-DUNG.txt'), (target === 'win' ? readme.replace(/\n/g, '\r\n') : readme.replace(/KhoETC\.exe/g, 'KhoETC')));
    fs.writeFileSync(path.join(outDir, 'kho-config.json'), JSON.stringify({ port: 3000, host: '127.0.0.1' }, null, 2) + '\n');
    const zip = path.join(DIST, dirName + '.zip');
    fs.rmSync(zip, { force: true });
    execFileSync('zip', ['-r', '-q', '-9', zip, dirName], { cwd: DIST });
    log(`Xong: ${path.relative(ROOT, zip)} (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
  }
}
main().catch((e) => { console.error('LỖI:', e.message); process.exit(1); });

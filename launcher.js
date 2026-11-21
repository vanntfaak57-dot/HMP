// Trình khởi chạy phần mềm Quản lý kho.
// Nếu thư mục dữ liệu có bản cập nhật mới hơn bản gốc (data/app/current.json) thì chạy bản cập nhật,
// nếu không (hoặc bản cập nhật lỗi khi khởi động) thì chạy bản gốc đi kèm.
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');

let isSea = false;
try { isSea = require('node:sea').isSea(); } catch { isSea = false; }
const dataDir = process.env.DATA_DIR || (isSea ? path.join(path.dirname(process.execPath), 'data') : path.join(__dirname, 'data'));
process.env.DATA_DIR = dataDir;
const BUILTIN = process.env.KHO_BUILD_VERSION || require('./package.json').version;
process.env.KHO_BUILTIN_VERSION = BUILTIN;
delete process.env.KHO_RUNNING_UPDATE;

const cmpVer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

function runUpdate() {
  const appDir = path.join(dataDir, 'app');
  const cur = path.join(appDir, 'current.json');
  if (!fs.existsSync(cur)) return false;
  let info;
  try { info = JSON.parse(fs.readFileSync(cur, 'utf8')); } catch { return false; }
  const file = path.join(appDir, path.basename(String(info.file || '')));
  if (!info.version || !fs.existsSync(file) || cmpVer(info.version, BUILTIN) <= 0) return false;
  try {
    process.env.KHO_RUNNING_UPDATE = info.version;
    Module.createRequire(file)(file);
    return true;
  } catch (e) {
    console.error(`\nKhông chạy được bản cập nhật ${info.version}, quay về bản gốc ${BUILTIN}:`, e && e.message);
    delete process.env.KHO_RUNNING_UPDATE;
    try { fs.renameSync(cur, cur + '.failed'); } catch { /* bỏ qua */ }
    return false;
  }
}

if (!runUpdate()) require('./server.js');

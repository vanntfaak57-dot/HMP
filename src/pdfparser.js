// Đọc file PDF phiếu xuất kho / phiếu nhập kho / hóa đơn và nhận diện nội dung
// Lưu ý: chỉ đọc được PDF có lớp chữ (xuất từ phần mềm). PDF dạng ảnh scan cần OCR trước.
// Dùng thẳng bản pdf.js đi kèm pdf-parse (đường dẫn cố định để đóng gói được thành 1 file chạy)
const PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
PDFJS.disableWorker = true;
const { db } = require('./db');

// Ghép các mẩu chữ theo tọa độ thành dòng, các ô cách nhau bằng ký tự TAB
async function extractLines(buffer) {
  const pages = [];
  const doc = await PDFJS.getDocument(new Uint8Array(buffer));
  for (let n = 1; n <= Math.min(doc.numPages, 20); n++) {
    const pageData = await doc.getPage(n);
    {
      const tc = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      const parts = tc.items
        .filter((it) => it.str && it.str.trim() !== '')
        .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || 8 }));
      parts.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const p of parts) {
        const line = lines.find((l) => Math.abs(l.y - p.y) <= Math.max(2, p.h * 0.4));
        if (line) line.parts.push(p); else lines.push({ y: p.y, parts: [p] });
      }
      lines.sort((a, b) => b.y - a.y);
      const text = lines.map((l) => {
        l.parts.sort((a, b) => a.x - b.x);
        let s = '';
        let prevEnd = null;
        for (const p of l.parts) {
          if (prevEnd !== null) {
            const gap = p.x - prevEnd;
            s += gap > p.h * 0.9 ? '\t' : gap > p.h * 0.15 ? ' ' : '';
          }
          s += p.s;
          prevEnd = p.x + p.w;
        }
        return s;
      });
      pages.push(text.join('\n'));
    }
  }
  if (doc.destroy) doc.destroy();
  return pages.join('\n').normalize('NFC');
}

// Số kiểu Việt Nam: 1.234.567,5 ; hoặc kiểu Anh: 1,234,567.5
function parseNumber(s) {
  let t = String(s).trim().replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // "1,5" -> 1.5 ; "1,234,567" -> 1234567
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (lastDot >= 0) {
    // "1.234.567" -> 1234567 ; "1.5" -> 1.5 ; "10.000" (VN) -> 10000
    t = /^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const near = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);

// Từ dãy số của một dòng hàng, tìm (số lượng, đơn giá, thành tiền) sao cho SL × ĐG ≈ TT
  // Các số sau cột thành tiền: [tỷ lệ CK %, % thuế GTGT] (mẫu phiếu xuất kho bán hàng)
  function tail(rest) {
    const out = {};
    const vat = rest.length ? rest[rest.length - 1] : null;
    if (vat !== null && [0, 5, 8, 10].includes(vat)) out.vat_rate = String(vat);
    if (rest.length >= 2 && rest[0] >= 0 && rest[0] <= 100) out.discount_rate = rest[0];
    return out;
  }
function pickNumbers(nums) {
  for (let k = nums.length - 1; k >= 2; k--) {
    for (let j = k - 1; j >= 1; j--) {
      for (let i = j - 1; i >= 0; i--) {
        if (nums[i] > 0 && nums[j] > 0 && near(nums[i] * nums[j], nums[k])) {
          return { qty: nums[i], unit_price: nums[j], amount: nums[k], sure: true, ...tail(nums.slice(k + 1)) };
        }
      }
    }
  }
  if (nums.length >= 2) return { qty: nums[0], unit_price: nums[1], amount: nums[0] * nums[1], sure: false };
  if (nums.length === 1) return { qty: nums[0], unit_price: 0, amount: 0, sure: false };
  return null;
}

function parseText(text) {
  const items = db.prepare('SELECT id, code, name, unit FROM items').all();
  const byCode = new Map(items.map((i) => [norm(i.code), i]));
  const byName = new Map(items.map((i) => [norm(i.name), i]));
  const lines = text.split('\n');
  const result = { type: null, number: null, date: null, partner: null, tax_code: null, address: null, description: null, ref_no: null, lines: [], unmatched: [], warnings: [] };

  if (/PHIẾU\s*NHẬP\s*KHO/i.test(text)) result.type = 'N';
  else if (/PHIẾU\s*XUẤT\s*KHO|HÓA\s*ĐƠN|HOÁ\s*ĐƠN|PHIẾU\s*GIAO\s*HÀNG/i.test(text)) result.type = 'X';

  let partnerIdx = -1;
  for (const [li, raw] of lines.entries()) {
    const line = raw.replace(/\t/g, '  ');
    if (!result.number) {
      const m = line.match(/(?:^|\s)Số(?:\s*phiếu|\s*chứng\s*từ)?\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9\-\/._]*)/i);
      if (m && /\d/.test(m[1]) && !/tài khoản|điện thoại|lượng|fax/i.test(line.slice(0, m.index + 12))) result.number = m[1];
    }
    if (!result.date) {
      const m = line.match(/Ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/i);
      if (m) result.date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    if (!result.partner) {
      const m = raw.match(/(?:Họ\s*(?:và)?\s*tên\s*người\s*(?:nhận|mua|giao)\s*hàng|Tên\s*khách\s*hàng|Khách\s*hàng|Tên\s*đơn\s*vị|Đơn\s*vị\s*bán\s*hàng|Nhà\s*cung\s*cấp|Người\s*mua\s*hàng)\s*[:：]\s*([^\t]+)/i);
      if (m && m[1].trim()) { result.partner = m[1].trim(); partnerIdx = li; }
    }
    if (!result.tax_code && partnerIdx >= 0 && li >= partnerIdx) {
      const m = raw.match(/(?:Mã\s*số\s*thuế|MST)\s*[:：]?\s*([0-9][0-9\- ]{8,15}[0-9])/i);
      if (m) result.tax_code = m[1].replace(/[\s]/g, '');
    }
    if (partnerIdx >= 0 && li >= partnerIdx) {
      const grab = (re) => { const m = raw.match(re); return m && m[1].trim() ? m[1].trim() : null; };
      result.contact = result.contact || grab(/Tên\s*người\s*liên\s*hệ\s*[:：]\s*([^\t]+)/i);
      result.phone = result.phone || grab(/Điện\s*thoại\s*[:：]\s*([0-9 .+\-()]{6,})/i);
      result.delivery_place = result.delivery_place || grab(/Địa\s*điểm\s*giao\s*hàng\s*[:：]\s*([^\t]+)/i);
      result.salesperson = result.salesperson || grab(/Nhân\s*viên\s*bán\s*hàng\s*[:：]\s*([^\t]+)/i);
    }
    if (!result.warehouse) { const m = raw.match(/Mã\s*kho\s*[:：]\s*([^\t]+)/i); if (m && m[1].trim()) result.warehouse = m[1].trim(); }
    if (!result.ref_no) { const m = raw.match(/Số\s*phiếu\s*xuất\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9\-\/._]*)/i); if (m) result.ref_no = m[1]; }
    // Địa chỉ của đối tượng: chỉ lấy dòng nằm sau tên khách hàng/NCC (dòng địa chỉ đầu phiếu là của đơn vị mình)
    if (!result.address && partnerIdx >= 0 && li >= partnerIdx) {
      const m = raw.match(/(?:Địa\s*chỉ(?:\s*\(bộ\s*phận\))?)\s*[:：]\s*([^\t]+)/i);
      if (m && m[1].trim()) result.address = m[1].trim();
    }
    if (!result.description) {
      const m = raw.match(/(?:Lý\s*do\s*(?:xuất|nhập)(?:\s*kho)?|Diễn\s*giải|Nội\s*dung)\s*[:：]\s*([^\t]+)/i);
      if (m && m[1].trim()) result.description = m[1].trim();
    }
    if (!result.ref_no) {
      const m = raw.match(/(?:Số\s*hóa\s*đơn|Số\s*HĐ|Theo\s*hóa\s*đơn\s*số|Ký\s*hiệu)\s*[:：]?\s*([A-Za-z0-9\-\/]+)/i);
      if (m && /\d/.test(m[1])) result.ref_no = m[1];
    }
  }
  if (!result.date) {
    const m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (m) result.date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }

  // Nhận diện dòng hàng
  for (const raw of lines) {
    const cells = raw.split('\t').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    let item = null;
    let idx = -1;
    for (let i = 0; i < cells.length && !item; i++) {
      const c = norm(cells[i]);
      if (byCode.has(c)) { item = byCode.get(c); idx = i; }
    }
    // Ô chứa "Mã - Tên" hoặc tên trùng danh mục
    for (let i = 0; i < cells.length && !item; i++) {
      const c = norm(cells[i]);
      if (byName.has(c)) { item = byName.get(c); idx = i; break; }
      const first = c.split(/[\s\-–:]+/)[0];
      if (first && byCode.has(first)) { item = byCode.get(first); idx = i; }
    }
    const nums = [];
    for (let i = (idx >= 0 ? idx + 1 : 0); i < cells.length; i++) {
      const n = parseNumber(cells[i]);
      if (n !== null) nums.push(n);
    }
    if (item) {
      const p = pickNumbers(nums);
      if (!p) { result.warnings.push(`Không đọc được số lượng của mã ${item.code}`); continue; }
      result.lines.push({ item_id: item.id, code: item.code, name: item.name, unit: item.unit, qty: p.qty, unit_price: p.unit_price, amount: Math.round(p.amount), discount_rate: p.discount_rate || 0, vat_rate: p.vat_rate ?? item.vat_rate ?? null, sure: p.sure });
      if (!p.sure) result.warnings.push(`Mã ${item.code}: chưa khớp SL × Đơn giá = Thành tiền, vui lòng kiểm tra lại`);
    } else {
      // Dòng có dạng bảng hàng hóa nhưng mã chưa có trong danh mục
      const first = parseNumber(cells[0]);
      const allNums = cells.map(parseNumber).filter((n) => n !== null);
      if (first !== null && Number.isInteger(first) && first > 0 && first < 1000 && cells.length >= 4 && allNums.length >= 3) {
        const p = pickNumbers(allNums.slice(1));
        if (p && p.sure) {
          const textCells = cells.slice(1).filter((c) => parseNumber(c) === null);
          result.unmatched.push({ text: textCells.join(' | '), qty: p.qty, unit_price: p.unit_price, amount: Math.round(p.amount) });
        }
      }
    }
  }
  if (!result.lines.length && !result.unmatched.length) result.warnings.push('Không nhận diện được dòng hàng nào. Kiểm tra mã hàng trong PDF đã có trong danh mục chưa.');
  if (result.unmatched.length) result.warnings.push(`Có ${result.unmatched.length} dòng hàng chưa có mã trong danh mục – hãy chọn mã tương ứng hoặc thêm mã mới.`);
  return result;
}

async function parsePdf(buffer) {
  const text = await extractLines(buffer);
  if (text.replace(/\s/g, '').length < 20) {
    return { error: 'File PDF không có lớp chữ (có thể là ảnh scan). Vui lòng dùng PDF xuất từ phần mềm hoặc nhập tay.', text };
  }
  return { ...parseText(text), text };
}

module.exports = { parsePdf, parseText, parseNumber, extractLines };

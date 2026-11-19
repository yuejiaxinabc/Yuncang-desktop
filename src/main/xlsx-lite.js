
/**
 * 零依赖 xlsx 写入：exceljs 的兜底。
 *
 * 为什么要有：electron-builder 打 asar 时，exceljs 的传递依赖曾经断过链
 * （unzipper → chainsaw → traverse → which-typed-array → call-bind → get-intrinsic →
 * call-bind-apply-helpers 少一个就整条 require 崩），用户点到「导出/下载模板」直接红字报错。
 * 预打包 exceljs 能解决，但绿色版/手工解包的环境仍可能缺 vendor 文件；
 * 这里用纯 JS 写一个「存储模式」的 zip + 最小 SpreadsheetML，保证导出永远能落地。
 *
 * 只做写：单元格一律 inlineStr，Excel / WPS / Numbers 都能打开。
 */

const zlib = require('node:zlib');

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function xmlEscape(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // 去掉 XML 非法控制字符，否则 Excel 直接报文件损坏
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function colName(n) {
  let s = '';
  let i = n;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function sheetXml(headers, rows) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
  const cells = (vals, r) => {
    const parts = [];
    vals.forEach((v, i) => {
      if (v === undefined || v === null || v === '') return;
      parts.push('<c r="' + colName(i + 1) + r + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(v) + '</t></is></c>');
    });
    return parts.join('');
  };
  out.push('<row r="1">' + cells(headers, 1) + '</row>');
  rows.forEach((row, idx) => {
    out.push('<row r="' + (idx + 2) + '">' + cells(headers.map((h) => (row ? row[h] : '')), idx + 2) + '</row>');
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '</Types>';

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const WORKBOOK = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';

const WORKBOOK_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '</Relationships>';

/** 极简 zip（store，不压缩） */
function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // verNeed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 文件名
    local.writeUInt16LE(0, 8);           // store
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);            // verMade
    cen.writeUInt16LE(20, 6);            // verNeed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(dosTime, 12);
    cen.writeUInt16LE(dosDate, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat(chunks.concat([centralBuf, end]));
}

/** 写一个最小可用的 xlsx 到指定路径 */
function writeXlsx(filePath, headers, rows) {
  const head = (headers || []).map(String);
  const list = Array.isArray(rows) ? rows : [];
  const files = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'xl/workbook.xml', data: WORKBOOK },
    { name: 'xl/_rels/workbook.xml.rels', data: WORKBOOK_RELS },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(head, list) },
  ];
  const buf = zipStore(files);
  require('node:fs').writeFileSync(filePath, buf);
  return { bytes: buf.length, rows: list.length };
}


/** 从 zip 里读出一个成员（支持 store / deflate） */
function unzipEntry(buf, entry) {
  const lh = entry.localOffset;
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('zip 本地头损坏：' + entry.name);
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const start = lh + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error('不支持的压缩方式：' + entry.method);
}

/** 解析中央目录 */
function listEntries(buf) {
  const max = Math.min(buf.length, 66000);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - max; i--) {
    if (i >= 0 && buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是合法的 xlsx（找不到 zip 目录）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    out.push({ name, method, compSize, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, '');
}

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(String(ref || ''));
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * 纯 JS 读 xlsx：足够覆盖 Excel/WPS 导出的常规表格（共享字符串、内联字符串、数字、布尔）。
 * 返回与 tables.readTable 一致的「首行当表头」对象数组。
 */
function readXlsx(filePath) {
  const fs = require('node:fs');
  const buf = fs.readFileSync(filePath);
  const entries = listEntries(buf);
  const find = (name) => entries.find((e) => e.name === name);
  const wbEntry = find('xl/workbook.xml');
  if (!wbEntry) throw new Error('xlsx 里没有 xl/workbook.xml');

  const shared = [];
  const ssEntry = find('xl/sharedStrings.xml');
  if (ssEntry) {
    const xml = unzipEntry(buf, ssEntry).toString('utf8');
    const items = xml.match(/<si[\s>][\s\S]*?<\/si>|<si\/>/g) || [];
    for (const si of items) {
      const texts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
      shared.push(unescapeXml(texts.map((t) => stripTags(t)).join('')));
    }
  }

  const sheetEntry = find('xl/worksheets/sheet1.xml') || entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
  if (!sheetEntry) throw new Error('xlsx 里没有工作表');
  const sheet = unzipEntry(buf, sheetEntry).toString('utf8');

  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(sheet))) {
    const cells = [];
    const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] || cm[3] || '';
      const body = cm[2] || '';
      const refM = /r="([A-Z]+\d+)"/.exec(attrs);
      const tM = /t="([^"]+)"/.exec(attrs);
      const idx = refM ? colIndex(refM[1]) : cells.length;
      let value = '';
      if (tM && tM[1] === 'inlineStr') {
        const ts = body.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        value = unescapeXml(ts.map((t) => stripTags(t)).join(''));
      } else {
        const vM = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body);
        const raw = vM ? unescapeXml(vM[1]) : '';
        if (tM && tM[1] === 's') value = shared[Number(raw)] === undefined ? '' : shared[Number(raw)];
        else if (tM && (tM[1] === 'str' || tM[1] === 'b')) value = raw;
        else value = raw;
      }
      cells[idx] = value;
    }
    rows.push(cells);
  }

  if (!rows.length) return [];
  const header = (rows[0] || []).map((h) => String(h === undefined || h === null ? '' : h).trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const line = rows[i] || [];
    const obj = {};
    let has = false;
    header.forEach((h, c) => {
      const v = line[c] === undefined || line[c] === null ? '' : String(line[c]).trim();
      if (v) has = true;
      if (h) obj[h] = v;
    });
    if (has) out.push(obj);
  }
  return out;
}

module.exports = { writeXlsx, readXlsx, zipStore, crc32, colName };
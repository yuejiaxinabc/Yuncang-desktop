'use strict';

/**
 * 本地表格读写（商品导入模板 / 导出 / 盘点表都走这里）
 *
 * 之所以从 main.js 抽出来：模板下载失败时只有一句「导出失败」，分不清是
 * 弹窗没起来、还是写文件炸了。现在写文件这段是纯函数，能在 smoke 里直接跑。
 */

const fs = require('node:fs');
const path = require('node:path');

function csvCell(v) {
  const s = String(v === undefined || v === null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * exceljs 用 esbuild 预打包成单文件（src/main/vendor/exceljs.bundle.cjs）。
 * 不这么做的话，electron-builder 打出来的 asar 里 exceljs 的传递依赖会缺件：
 * 实测 Windows 安装包报 Cannot find module 'call-bind-apply-helpers'
 * （unzipper → chainsaw → traverse → which-typed-array → call-bind → get-intrinsic 这一串）。
 * 打进一个文件后就不再依赖 node_modules 的解析结果。
 */
const xlsxLite = require('./xlsx-lite');

let cachedExcel = null;
let excelFailed = null;
function requireExcel() {
  if (cachedExcel) return cachedExcel;
  if (excelFailed) throw excelFailed;
  // 测试用：YC_FORCE_LITE=1 强制走零依赖兜底，验证「包坏了也能导出」
  if (process.env.YC_FORCE_LITE === '1') {
    excelFailed = new Error('测试强制使用内置 xlsx 写入');
    excelFailed.code = 'NO_EXCELJS';
    throw excelFailed;
  }
  try {
    cachedExcel = require('./vendor/exceljs.bundle.cjs');
    return cachedExcel;
  } catch (e) {
    excelFailed = new Error('缺少 exceljs 运行包（打包不完整）：' + (e.message || String(e)));
    excelFailed.code = 'NO_EXCELJS';
    throw excelFailed;
  }
}

/**
 * 按扩展名写表：.csv 写带 BOM 的 CSV，其余按 xlsx（exceljs）。
 * rows 是对象数组，headers 决定列与顺序。
 */
async function writeTable(filePath, headers, rows) {
  const head = (headers || []).map(String);
  const list = Array.isArray(rows) ? rows : [];
  if (path.extname(filePath).toLowerCase() === '.csv') {
    const text = [head.map(csvCell).join(',')]
      .concat(list.map((row) => head.map((h) => csvCell(row && row[h])).join(',')))
      .join('\r\n');
    fs.writeFileSync(filePath, '\uFEFF' + text, 'utf8');
    return { ok: true, path: filePath, rows: list.length, format: 'csv', bytes: fs.statSync(filePath).size };
  }

  let ExcelJS;
  try {
    ExcelJS = requireExcel();
  } catch (e) {
    // exceljs 不可用（asar 缺件、绿色版被拆过）→ 用内置的最小 xlsx 写入，导出/模板必须能落地
    const r = xlsxLite.writeXlsx(filePath, head, list);
    return { ok: true, path: filePath, rows: r.rows, format: 'xlsx', bytes: r.bytes, engine: 'xlsx-lite', warning: e.message };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = '云仓桌面端';
  wb.created = new Date();
  const ws = wb.addWorksheet('Sheet1', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(head);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF4FF' } };
  list.forEach((row) => ws.addRow(head.map((h) => (row && row[h] !== undefined ? row[h] : ''))));
  ws.columns.forEach((col) => {
    let width = 12;
    col.eachCell && col.eachCell({ includeEmpty: false }, (cell) => {
      const len = String(cell.value === null || cell.value === undefined ? '' : cell.value).length;
      if (len + 2 > width) width = Math.min(40, len + 2);
    });
    col.width = width;
  });
  await wb.xlsx.writeFile(filePath);
  return { ok: true, path: filePath, rows: list.length, format: 'xlsx', bytes: fs.statSync(filePath).size };
}

/** 读 CSV / XLSX → 行对象（表头作键）；用于商品批量导入 */
async function readTable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    let ExcelJS;
    try {
      ExcelJS = requireExcel();
    } catch (e) {
      // exceljs 缺件时用内置读取器，导入不能因为打包问题变哑巴
      return xlsxLite.readXlsx(filePath);
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('这个工作簿里没有工作表');
    const header = [];
    ws.getRow(1).eachCell((cell, col) => { header[col] = String(cell.text || '').trim(); });
    const rows = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const obj = {};
      let has = false;
      row.eachCell((cell, col) => {
        const key = header[col] || ('col' + col);
        const v = cell.text !== undefined && cell.text !== null ? String(cell.text).trim() : '';
        if (v) has = true;
        obj[key] = v;
      });
      if (has) rows.push(obj);
    });
    return rows;
  }

  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const split = (line) => {
    const out = []; let cur = ''; let quote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quote = false;
        else cur += ch;
      } else if (ch === '"') quote = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0] || '').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const obj = {};
    let has = false;
    header.forEach((h, c) => { const v = (cells[c] || '').trim(); if (v) has = true; obj[h || ('col' + (c + 1))] = v; });
    if (has) rows.push(obj);
  }
  return rows;
}

module.exports = { writeTable, readTable };

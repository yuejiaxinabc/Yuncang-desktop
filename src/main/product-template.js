'use strict';

/**
 * 商品导入模板（与 Web 端 /api/products/template 同一套列结构）
 *
 * 真源：cloud-warehouse/src/lib/product-excel.ts（BASE_COLUMNS / buildColumns / buildTemplate）。
 * 桌面端为什么要本地生成：私有化部署的开放接口里没有 /api/products/template（需要登录会话），
 * 客户端只有 API 密钥，拿不到服务端实时模板；企业版有会话 Cookie 时优先直接下载服务端的。
 *
 * 列结构必须与 Web 一致，否则「桌面下载 → Web 导入」会报「表头不匹配」：
 *   基础 16 列 + 系统里存在仓库时插入「仓库」「货位编码」两列（共 18 列，均必填）
 */

const REQUIRED = new Set(['商品编码', '商品名称']);

const BASE_COLUMNS = [
  { key: 'code', header: '商品编码', width: 16, required: true, hint: '唯一编码，重复编码导入时会被跳过' },
  { key: 'name', header: '商品名称', width: 24, required: true, hint: '必填' },
  { key: 'barcode', header: '条码', width: 18, hint: '可扫码识别，可空' },
  { key: 'category', header: '分类', width: 14, hint: '填已有分类名；不存在的分类不会自动创建' },
  { key: 'unit', header: '单位', width: 12, hint: '填已有计量单位' },
  { key: 'spec', header: '规格', width: 16, hint: '如 400x300x250' },
  { key: 'brand', header: '品牌', width: 14, hint: '可空' },
  { key: 'model', header: '型号', width: 16, hint: '可空' },
  { key: 'costMethod', header: '成本方法', width: 14, hint: '加权平均 / 先进先出 / 月加权（中英均可）' },
  { key: 'costPrice', header: '默认成本', width: 12, numFmt: '0.00', hint: '两位小数' },
  { key: 'salePrice', header: '售价', width: 12, numFmt: '0.00', hint: '两位小数' },
  { key: 'safetyStock', header: '安全库存', width: 12, numFmt: '0.000', hint: '用于低库存预警' },
  { key: 'serial', header: '启用序列号', width: 12, hint: '是 / 否' },
  { key: 'lot', header: '启用批次', width: 12, hint: '是 / 否' },
  { key: 'qty', header: '初始数量', width: 12, numFmt: '0.000', hint: '建商品时同时入库的数量（可空）' },
  { key: 'remark', header: '备注', width: 20, hint: '可空' },
];

const WAREHOUSE_COLUMNS = [
  { key: 'warehouse', header: '仓库', width: 18, required: true, hint: '必须是系统里已存在的仓库名（下拉选择）' },
  { key: 'boxCode', header: '货位编码', width: 18, required: true, hint: '四段：A-01-02-03 = 货架-排-列-货位，必须到第四段' },
];

/** 有仓库时，仓库/货位编码插在「初始数量」前面（与 Web buildColumns 一致） */
function buildColumns(hasWarehouse) {
  if (!hasWarehouse) return BASE_COLUMNS.slice();
  const idx = BASE_COLUMNS.findIndex((c) => c.key === 'qty');
  const out = BASE_COLUMNS.slice();
  out.splice(idx, 0, ...WAREHOUSE_COLUMNS);
  return out;
}

const AC = {
  headerBg: 'FF2563EB',
  requiredBg: 'FFFEE2E2',
  hintBg: 'FFF1F5F9',
};

const NOTES = [
  '1. 第 1 行为表头，请勿改动列名；导入按表头文字匹配，插列不会错位。',
  '2. 带 * 的列为必填（浅红底）；系统里存在仓库时，「仓库」「货位编码」两列必填。',
  '3. 货位编码必须四段：A-01-02-03 = 货架-排-列-货位；三段坐标不能直接入库。',
  '4. 仓库、分类、单位请用下拉里已有的值；重复「商品编码」的行会被跳过，不算失败。',
  '5. 金额两位小数、数量三位小数；填了「初始数量」时才会按仓库/货位建初始库存。',
];

/** 用 ExcelJS 拼模板（带样式、下拉、冻结、说明页） */
function buildWithExcelJS(ExcelJS, cols, dict) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '云仓桌面端';
  wb.created = new Date();

  const ws = wb.addWorksheet('商品导入', { views: [{ state: 'frozen', ySplit: 1 }] });
  const header = cols.map((c) => c.header);
  ws.addRow(header);

  const head = ws.getRow(1);
  head.height = 24;
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? 'FFDC2626' : AC.headerBg } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFDBFE' } } };
    ws.getColumn(i + 1).width = c.width || 14;
  });

  // 第 2 行做格式示例（不写值，只把数字格式落下来，用户接着往下填不会被当成文本）
  const sample = ws.getRow(2);
  cols.forEach((c, i) => {
    if (c.numFmt) sample.getCell(i + 1).numFmt = c.numFmt;
  });

  const addList = (headerText, values) => {
    if (!values || !values.length) return;
    const idx = header.indexOf(headerText);
    if (idx < 0) return;
    const colLetter = ws.getColumn(idx + 1).letter;
    for (let r = 2; r <= 500; r++) {
      ws.getCell(colLetter + r).dataValidation = {
        type: 'list',
        allowBlank: !REQUIRED.has(headerText),
        formulae: ['"' + values.join(',') + '"'],
        showErrorMessage: true,
        errorTitle: '请选择',
        error: '只能从下拉里选',
      };
    }
  };

  addList('仓库', dict.warehouses || []);
  addList('分类', dict.categories || []);
  addList('单位', dict.units || []);
  addList('成本方法', ['加权平均', '先进先出', '月加权', 'WEIGHTED', 'FIFO', 'MONTHLY']);
  addList('启用序列号', ['是', '否']);
  addList('启用批次', ['是', '否']);

  // 第二张：填写说明
  const help = wb.addWorksheet('填写说明');
  help.getColumn(1).width = 18;
  help.getColumn(2).width = 52;
  help.getColumn(3).width = 34;
  const title = help.addRow(['列名', '说明', '必填']);
  title.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  title.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AC.headerBg } }; });
  cols.forEach((c) => {
    const row = help.addRow([c.header, c.hint || '', c.required ? '必填' : '']);
    if (c.required) row.getCell(3).font = { bold: true, color: { argb: 'FFDC2626' } };
  });
  help.addRow([]);
  const noteTitle = help.addRow(['注意事项', '', '']);
  noteTitle.font = { bold: true };
  NOTES.forEach((n) => help.addRow([n, '', '']));

  return { wb, sheetName: '商品导入', headers: header };
}

/** exceljs 缺件时的兜底：表头与列序完全一致，但没有下拉/样式/说明页 */
function buildWithLite(xlsxLite, cols) {
  return { lite: true, headers: cols.map((c) => c.header) };
}

async function writeTemplateTo(filePath, opts) {
  const o = opts || {};
  const cols = buildColumns(!!o.hasWarehouse);
  const dict = { warehouses: o.warehouses || [], categories: o.categories || [], units: o.units || [] };

  let ExcelJS = null;
  if (process.env.YC_FORCE_LITE !== '1') {
    try { ExcelJS = require('./vendor/exceljs.bundle.cjs'); } catch (e) { ExcelJS = null; }
  }

  if (ExcelJS) {
    const { wb } = buildWithExcelJS(ExcelJS, cols, dict);
    await wb.xlsx.writeFile(filePath);
    const fs = require('node:fs');
    return { ok: true, path: filePath, engine: 'xlsx', columns: cols.length, bytes: fs.statSync(filePath).size, sheet: '商品导入', hasWarehouse: !!o.hasWarehouse };
  }

  const xlsxLite = require('./xlsx-lite');
  const { headers } = buildWithLite(xlsxLite, cols);
  const r = xlsxLite.writeXlsx(filePath, headers, []);
  return { ok: true, path: filePath, engine: 'xlsx-lite', columns: cols.length, bytes: r.bytes, sheet: '商品导入', hasWarehouse: !!o.hasWarehouse, note: '当前包内 exceljs 不可用，已用内置写入器生成：表头与列序与 Web 一致，但没有下拉与填写说明页' };
}

/** 导入时的表头校验：与 Web 一样按文字匹配，缺必填列直接拒绝 */
function checkHeaders(headers, hasWarehouse) {
  const list = (headers || []).map((h) => String(h === undefined || h === null ? '' : h).trim());
  const missing = ['商品编码', '商品名称'].filter((h) => list.indexOf(h) < 0);
  if (hasWarehouse) ['仓库', '货位编码'].forEach((h) => { if (list.indexOf(h) < 0) missing.push(h); });
  return { ok: missing.length === 0, missing, headers: list };
}

module.exports = { BASE_COLUMNS, WAREHOUSE_COLUMNS, buildColumns, writeTemplateTo, checkHeaders, NOTES };

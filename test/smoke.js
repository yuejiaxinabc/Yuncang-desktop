'use strict';

// 用随机空闲端口，避免和本机其它监听进程抢 9959
const SMOKE_PORT = Number(process.env.SMOKE_PORT || (20000 + Math.floor(Math.random() * 20000)));
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseEnv, normalizeBaseUrl, loadConfig, publicConfig } = require('../src/main/env');
const { CloudWarehouseClient } = require('../src/main/client');
const { start } = require('./mock-server');

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(['PASS', name]))
    .catch((e) => results.push(['FAIL', name + ' :: ' + e.message]));
}

(async () => {
  // 1) .env 解析
  await check('解析 .env：注释 / export / 引号 / 行内注释', () => {
    const v = parseEnv([
      '# 注释',
      'export CW_BASE_URL="https://a.example.com/"',
      "CW_API_KEY='yc_live_abc'",
      'CW_TIMEOUT_MS=5000 # 行内注释',
      'BAD LINE',
      '',
    ].join('\r\n'));
    assert.equal(v.CW_BASE_URL, 'https://a.example.com/');
    assert.equal(v.CW_API_KEY, 'yc_live_abc');
    assert.equal(v.CW_TIMEOUT_MS, '5000');
  });

  // 2) 地址归一化
  await check('地址归一化：补协议 / 去尾斜杠 / 去误粘的接口路径', () => {
    assert.equal(normalizeBaseUrl('yc.example.com'), 'http://yc.example.com');
    assert.equal(normalizeBaseUrl('https://yc.example.com/'), 'https://yc.example.com');
    assert.equal(normalizeBaseUrl('https://yc.example.com/api/v1/open'), 'https://yc.example.com');
    assert.equal(normalizeBaseUrl('http://1.2.3.4:8080/api'), 'http://1.2.3.4:8080');
  });

  // 3) 配置文件查找
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-desktop-'));
  const envFile = path.join(tmp, '.env');
  fs.writeFileSync(envFile, 'CW_BASE_URL=127.0.0.1:9958\nCW_API_KEY=yc_live_goodkey_1234567890\nCW_TIMEOUT_MS=3000\n');
  await check('从指定 .env 读到地址与密钥，密钥对外脱敏', () => {
    const loaded = loadConfig({ argvPath: envFile, userDataDir: tmp, cwd: tmp, envVarPath: '' });
    assert.equal(loaded.ok, true, JSON.stringify(loaded.problems));
    assert.equal(loaded.config.baseUrl, 'http://127.0.0.1:9958');
    assert.equal(loaded.config.apiKey, 'yc_live_goodkey_1234567890');
    assert.equal(loaded.config.timeoutMs, 3000);
    const pub = publicConfig(loaded);
    assert.equal(pub.keyPrefix, 'yc_live_good…');
    assert.ok(!JSON.stringify(pub).includes('yc_live_goodkey_1234567890'), '脱敏后的配置里不能出现明文密钥');
  });

  await check('缺文件 / 缺字段时给出可操作的问题清单', () => {
    const none = loadConfig({ argvPath: path.join(tmp, 'nope', '.env'), userDataDir: path.join(tmp, 'none'), cwd: path.join(tmp, 'none'), envVarPath: '', programData: path.join(tmp, 'pd') });
    assert.equal(none.ok, false);
    assert.ok(none.problems.some((p) => p.includes('没有找到环境变量文件')));
    const half = path.join(tmp, 'half.env');
    fs.writeFileSync(half, 'CW_BASE_URL=example.com\n');
    const r = loadConfig({ argvPath: half, userDataDir: tmp, cwd: tmp, envVarPath: '' });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('CW_API_KEY')));
  });

  // 4) 客户端行为
  const { server, seen } = await start(9958);
  const client = new CloudWarehouseClient({ baseUrl: 'http://127.0.0.1:9958', apiKey: 'yc_live_goodkey_1234567890', timeoutMs: 2000 });

  await check('GET 自检：带 Bearer 头并解出 data', async () => {
    const r = await client.request('/api/v1/open/me');
    assert.equal(r.ok, true);
    assert.deepEqual(r.data.scopes, ['inventory:read', 'product:read', 'stock:write']);
    assert.equal(seen[seen.length - 1].auth, 'Bearer yc_live_goodkey_1234567890');
  });

  await check('401 翻译成 KEY_INVALID，并保留服务端原文', async () => {
    const bad = new CloudWarehouseClient({ baseUrl: 'http://127.0.0.1:9958', apiKey: 'yc_live_wrong', timeoutMs: 2000 });
    await assert.rejects(() => bad.request('/api/v1/open/me'), (e) => {
      assert.equal(e.code, 'KEY_INVALID');
      assert.equal(e.status, 401);
      return true;
    });
  });

  await check('403 翻译成 SCOPE_DENIED', async () => {
    await assert.rejects(() => client.request('/denied'), (e) => {
      assert.equal(e.code, 'SCOPE_DENIED');
      assert.match(e.message, /transfer:write/);
      return true;
    });
  });

  await check('5xx 翻译成 SERVER_ERROR', async () => {
    await assert.rejects(() => client.request('/boom'), (e) => e.code === 'SERVER_ERROR');
  });

  await check('超时中断并报 TIMEOUT', async () => {
    const slow = new CloudWarehouseClient({ baseUrl: 'http://127.0.0.1:9958', apiKey: 'yc_live_goodkey_1234567890', timeoutMs: 120 });
    await assert.rejects(() => slow.request('/slow'), (e) => e.code === 'TIMEOUT');
  });

  await check('POST 自动带 Idempotency-Key，显式传入时沿用', async () => {
    await client.request('/api/v1/open/stock-in', { method: 'POST', body: { warehouseId: 1, items: [] } });
    const auto = seen[seen.length - 1];
    assert.match(auto.idem, /^desktop-[0-9a-f-]{36}$/);
    await client.request('/api/v1/open/stock-in', { method: 'POST', body: { warehouseId: 1 }, idempotencyKey: 'in-20261114-001' });
    assert.equal(seen[seen.length - 1].idem, 'in-20261114-001');
  });

  await check('GET 不带幂等头（避免污染只读请求）', async () => {
    await client.request('/api/v1/open/inventory', { query: { page: 1 } });
    assert.equal(seen[seen.length - 1].idem, '');
  });

  await check('查询串拼装：空值跳过、中文编码', async () => {
    const u = client.url('/api/v1/open/inventory', { page: 2, keyword: '手套', empty: '', none: null });
    assert.equal(u, 'http://127.0.0.1:9958/api/v1/open/inventory?page=2&keyword=%E6%89%8B%E5%A5%97');
  });

  await check('地址指错（返回 HTML）时明确报 BAD_RESPONSE', async () => {
    const http = require('node:http');
    const html = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>login</html>'); });
    await new Promise((r) => html.listen(SMOKE_PORT, '127.0.0.1', r));
    const c = new CloudWarehouseClient({ baseUrl: 'http://127.0.0.1:' + SMOKE_PORT + '', apiKey: 'yc_live_goodkey_1234567890', timeoutMs: 2000 });
    await assert.rejects(() => c.request('/api/v1/open/me'), (e) => e.code === 'BAD_RESPONSE');
    html.close();
  });

  // 5) 接口档位：桌面专用优先，404 回落开放接口
  await check('桌面专用接口存在时优先走 /api/v1/desktop', async () => {
    const apiProfile = require('../src/main/api-profile');
    const d = await apiProfile.detect(client, 'auto');
    assert.equal(d.profile.id, 'desktop');
    assert.equal(d.me.name, '华东仓作业密钥');
  });

  await check('桌面接口 404 时自动回落开放接口', async () => {
    const apiProfile = require('../src/main/api-profile');
    const { start: startOpenOnly } = require('./mock-server');
    const second = await startOpenOnly(SMOKE_PORT + 1, { desktop: false });
    const c = new CloudWarehouseClient({ baseUrl: 'http://127.0.0.1:' + (SMOKE_PORT + 1), apiKey: 'yc_live_goodkey_1234567890', timeoutMs: 3000 });
    const d = await apiProfile.detect(c, 'auto');
    assert.equal(d.profile.id, 'open');
    assert.equal(d.tried[0].status, 404);
    second.server.close();
  });

  await check('密钥错误时探测直接失败，不静默降级', async () => {
    const apiProfile = require('../src/main/api-profile');
    const bad = new CloudWarehouseClient({ baseUrl: 'http://127.0.0.1:9958', apiKey: 'yc_live_bad', timeoutMs: 2000 });
    await assert.rejects(() => apiProfile.detect(bad, 'auto'), (e) => e.code === 'KEY_INVALID');
  });

  // 6) 本机配置存储
  await check('配置写入 / 读取 / 清除，地址归一化，密钥脱敏', () => {
    const store = require('../src/main/store');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-store-'));
    const w = store.write(dir, { baseUrl: 'yc.example.com/api/v1/desktop', token: 'yc_live_abcdefghijklmn', apiProfile: 'desktop' });
    assert.ok(fs.existsSync(w.file));
    const read = store.read(dir);
    assert.equal(read.ok, true);
    assert.equal(read.baseUrl, 'http://yc.example.com');
    assert.equal(read.token, 'yc_live_abcdefghijklmn');
    assert.equal(read.apiProfile, 'desktop');
    const masked = store.maskToken(read.token);
    assert.ok(!masked.includes('abcdefgh'), '脱敏串不能暴露中间段：' + masked);
    store.clear(dir);
    assert.equal(store.read(dir).ok, false);
    assert.equal(store.normalizeBaseUrl('https://a.cn/api/v1/open'), 'https://a.cn');
  });

  await check('配置文件损坏时给出可读错误，不抛出', () => {
    const store = require('../src/main/store');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-store-bad-'));
    fs.writeFileSync(path.join(dir, 'config.json'), '{ not json');
    const r = store.read(dir);
    assert.equal(r.ok, false);
    assert.match(r.error, /配置文件损坏/);
  });

  // 7) 本机偏好：打印抬头
  await check('打印偏好：默认值 / 保存 / 截断 / 换行压平', () => {
    const prefs = require('../src/main/prefs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-prefs-'));
    const d = prefs.read(dir);
    assert.equal(d.printHeader, '云仓');
    assert.equal(d.printFooter, '云仓 · 开源仓储管理系统');
    const w = prefs.write(dir, { printHeader: '  上海一号仓\n打印  ', printFooter: '内部单据', operator: '张三' });
    assert.equal(w.printHeader, '上海一号仓 打印');
    assert.equal(w.printFooter, '内部单据');
    assert.equal(w.operator, '张三');
    const again = prefs.read(dir);
    assert.equal(again.printHeader, '上海一号仓 打印');
    // 超长截断到 60 字
    const long = prefs.write(dir, { printHeader: 'x'.repeat(200) });
    assert.equal(long.printHeader.length, 60);
  });

  // 8) 草稿箱：断网单存下来、同幂等键覆盖、重放计数、上限
  await check('草稿箱：存 / 同幂等键覆盖 / 计数 / 删除 / 清空', () => {
    const drafts = require('../src/main/drafts');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-drafts-'));
    assert.equal(drafts.readAll(dir).length, 0);
    const a = drafts.add(dir, { kind: 'inbound', label: '入库作业', path: '/api/v1/open/stock-in', body: { warehouseId: 1, items: [{ productId: 1, quantity: 2 }] }, idempotencyKey: 'k1', lastError: '连不上云仓' });
    assert.equal(a.ok, true);
    assert.equal(a.count, 1);
    // 同一个幂等键再存一次 → 覆盖，不新增
    const b = drafts.add(dir, { kind: 'inbound', label: '入库作业', path: '/api/v1/open/stock-in', body: { warehouseId: 1, items: [] }, idempotencyKey: 'k1', lastError: '超时' });
    assert.equal(b.count, 1);
    assert.equal(b.item.id, a.item.id);
    drafts.add(dir, { kind: 'outbound', label: '出库作业', path: '/api/v1/open/stock-out', body: { warehouseId: 2 }, idempotencyKey: 'k2' });
    assert.equal(drafts.readAll(dir).length, 2);
    const t = drafts.touch(dir, a.item.id, '又失败一次');
    assert.equal(t.item.attempts, 1);
    assert.equal(t.item.lastError, '又失败一次');
    const d1 = drafts.remove(dir, a.item.id);
    assert.equal(d1.removed, 1);
    assert.equal(d1.count, 1);
    for (let i = 0; i < 60; i++) drafts.add(dir, { kind: 'inbound', label: '批量', path: '/api/v1/open/stock-in', body: {}, idempotencyKey: 'bulk-' + i });
    assert.equal(drafts.readAll(dir).length, drafts.MAX);
    const c = drafts.clear(dir);
    assert.equal(c.removed, drafts.MAX);
    assert.equal(drafts.readAll(dir).length, 0);
    // 只接受云仓接口路径
    const bad = drafts.add(dir, { path: 'https://evil.example.com/x', body: {} });
    assert.equal(bad.ok, false);
  });

  // 9) 表格写入（商品模板下载走这条路径）
  await check('表格写入：xlsx 可写可读回，csv 带 BOM', async () => {
    const tables = require('../src/main/tables');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-tables-'));
    const xlsx = path.join(dir, 't.xlsx');
    const csv = path.join(dir, 't.csv');
    const r1 = await tables.writeTable(xlsx, ['code', 'name'], [{ code: 'P001', name: '示例商品' }]);
    assert.equal(r1.format, 'xlsx');
    assert.ok(r1.bytes > 2000, 'xlsx 应该有实际内容：' + r1.bytes);
    const back = await tables.readTable(xlsx);
    assert.equal(back.length, 1);
    assert.equal(back[0].code, 'P001');
    const r2 = await tables.writeTable(csv, ['code', 'name'], [{ code: 'P002', name: '带,逗号' }]);
    assert.equal(r2.format, 'csv');
    const raw = fs.readFileSync(csv, 'utf8');
    assert.equal(raw.charCodeAt(0), 0xFEFF);
    assert.match(raw, /"带,逗号"/);
    const back2 = await tables.readTable(csv);
    assert.equal(back2[0].name, '带,逗号');
  });

  // 10) exceljs 缺件时的兜底：导出/模板必须还能落地
  await check('exceljs 缺件时导出仍能落地（内置 xlsx 兜底）', async () => {
    process.env.YC_FORCE_LITE = '1';
    delete require.cache[require.resolve('../src/main/tables')];
    const tables2 = require('../src/main/tables');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-lite-'));
    const out = path.join(dir, 'lite.xlsx');
    const r = await tables2.writeTable(out, ['code', 'name'], [{ code: 'P1', name: '兜底' }]);
    delete process.env.YC_FORCE_LITE;
    assert.equal(r.engine, 'xlsx-lite');
    assert.ok(r.bytes > 1000, 'bytes=' + r.bytes);
    // 用 exceljs 回读，确认是合法 xlsx
    delete require.cache[require.resolve('../src/main/tables')];
    const ExcelJS = require('../src/main/vendor/exceljs.bundle.cjs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    assert.equal(wb.worksheets[0].getCell('A2').value, 'P1');
  });

  // 11) exceljs 缺件时的导入：内置 xlsx 读取器要能读 Excel 生成的文件
  await check('exceljs 缺件时仍能读 xlsx（内置读取器）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-literead-'));
    const file = path.join(dir, 'in.xlsx');
    const ExcelJS = require('../src/main/vendor/exceljs.bundle.cjs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['code', 'name', 'qty']);
    ws.addRow(['P1', '手套 & 口罩', 12]);
    await wb.xlsx.writeFile(file);

    process.env.YC_FORCE_LITE = '1';
    delete require.cache[require.resolve('../src/main/tables')];
    const tables3 = require('../src/main/tables');
    const rows = await tables3.readTable(file);
    delete process.env.YC_FORCE_LITE;
    delete require.cache[require.resolve('../src/main/tables')];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].code, 'P1');
    assert.equal(rows[0].name, '手套 & 口罩');
    assert.equal(rows[0].qty, '12');
  });

  // 12) 商品导入模板：列结构必须与 Web 的 product-excel.ts 一致
  await check('模板列：无仓库 16 列 / 有仓库 18 列，仓库与货位列在初始数量前', async () => {
    const tpl = require('../src/main/product-template');
    assert.equal(tpl.buildColumns(false).length, 16);
    const cols = tpl.buildColumns(true);
    assert.equal(cols.length, 18);
    const heads = cols.map((c) => c.header);
    assert.deepEqual(heads.slice(0, 2), ['商品编码', '商品名称']);
    assert.equal(heads[heads.indexOf('仓库') + 1], '货位编码');
    assert.equal(heads[heads.indexOf('货位编码') + 1], '初始数量');
    assert.equal(heads[heads.length - 1], '备注');
  });

  await check('模板文件：两页（商品导入 / 填写说明）+ 冻结首行 + 下拉 + 数字格式', async () => {
    const tpl = require('../src/main/product-template');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-tpl-'));
    const out = path.join(dir, 't.xlsx');
    const r = await tpl.writeTemplateTo(out, { hasWarehouse: true, warehouses: ['一号主仓'], categories: ['五金'], units: ['个'] });
    assert.equal(r.ok, true);
    assert.equal(r.columns, 18);
    assert.equal(r.engine, 'xlsx');
    const ExcelJS = require('../src/main/vendor/exceljs.bundle.cjs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['商品导入', '填写说明']);
    const ws = wb.worksheets[0];
    assert.equal(ws.views[0].state, 'frozen');
    assert.equal(ws.getRow(1).getCell(1).value, '商品编码');
    // 仓库列有下拉（数据验证）
    const whIdx = ws.getRow(1).values.indexOf('仓库');
    const dv = ws.getCell(2, whIdx).dataValidation;
    assert.ok(dv && dv.type === 'list', '仓库列应有下拉');
    // 金额两位小数
    const costIdx = ws.getRow(1).values.indexOf('默认成本');
    assert.equal(ws.getCell(2, costIdx).numFmt, '0.00');
  });

  await check('导入表头校验：缺必填列直接拒绝', () => {
    const tpl = require('../src/main/product-template');
    assert.equal(tpl.checkHeaders(['商品编码', '商品名称', '条码'], false).ok, true);
    const bad = tpl.checkHeaders(['编码', '名称'], false);
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.missing, ['商品编码', '商品名称']);
    const noWh = tpl.checkHeaders(['商品编码', '商品名称'], true);
    assert.equal(noWh.ok, false);
    assert.deepEqual(noWh.missing, ['仓库', '货位编码']);
  });

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = results.filter((r) => r[0] === 'FAIL');
  for (const [s, n] of results) console.log(s + '  ' + n);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) process.exit(1);
})();

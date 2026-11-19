'use strict';

/**
 * 云仓桌面作业端 · 主进程（v0.2.0 重写）
 *
 * 配置来源优先级：
 *   1. 本机 config.json（界面里填一次，之后不再问；密钥走 safeStorage/DPAPI 加密）
 *   2. .env 预置（企业批量部署/绿色版：地址 + 密钥写在文件里）
 *   3. 都没有 → 界面进首次配置向导
 *
 * 接口档位：桌面专用 API /api/v1/desktop 优先，404 时自动退回 /api/v1/open。
 * 鉴权失败（401）统一回 KEY_INVALID，渲染层弹「密钥已失效」并引导去设置页换。
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');

const { loadConfig, publicConfig, envPathFromArgv } = require('./env');
const updater = require('./update');
const { CloudWarehouseClient, CloudWarehouseError, newIdempotencyKey } = require('./client');
const { SDK_VERSION } = require('./vendor/yuncang-sdk.cjs');
const profileApi = require('./api-profile');
const store = require('./store');
const prefs = require('./prefs');
const drafts = require('./drafts');
const tables = require('./tables');
const productTemplate = require('./product-template');
const enterprise = require('./enterprise');
const fallback = require('./catalog-fallback');

const IS_DEV = process.argv.includes('--dev');
const state = { saved: null, preset: null, source: 'none', client: null, profile: null, ent: null, entBoot: null };

function userDataDir() {
  return app.getPath('userData');
}

/** .env 预置（可选） */
function loadPreset() {
  const loaded = loadConfig({
    argvPath: envPathFromArgv(process.argv),
    userDataDir: userDataDir(),
    appDir: app.isPackaged ? path.dirname(process.execPath) : app.getAppPath(),
    cwd: process.cwd(),
    programData: process.env.ProgramData,
  });
  state.preset = loaded && loaded.ok ? loaded : null;
  return state.preset;
}

/** 当前生效配置 */
function currentConfig() {
  const saved = state.saved;
  if (saved && saved.ok && saved.mode === 'enterprise') {
    return { source: 'saved', mode: 'enterprise', platformUrl: saved.platformUrl, account: saved.account, cookie: saved.cookie, tenant: saved.tenant, file: saved.file, encrypted: saved.encrypted };
  }
  if (saved && saved.ok) return { source: 'saved', mode: 'private', baseUrl: saved.baseUrl, token: saved.token, apiProfile: saved.apiProfile || 'auto', file: saved.file, encrypted: saved.encrypted };
  const preset = state.preset;
  if (preset) return { source: 'preset', baseUrl: preset.config.baseUrl, token: preset.config.apiKey, apiProfile: 'auto', file: preset.file, encrypted: false };
  return null;
}

function applyConfig() {
  const cfg = currentConfig();
  if (!cfg) {
    state.client = null;
    state.source = 'none';
    return null;
  }
  if (cfg.mode === 'enterprise') {
    state.client = null;
    state.ent = enterprise.makeClient(cfg.platformUrl, cfg.cookie, { userAgent: 'YunCangDesktop/' + app.getVersion() });
    state.source = cfg.source;
    return cfg;
  }
  state.ent = null;
  if (cfg.encrypted === false && state.saved && state.saved.ok) {
    // safeStorage 不可用时才走这里，界面上会标注
  }
  state.client = new CloudWarehouseClient({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.token,
    timeoutMs: (state.preset && state.preset.config.timeoutMs) || 20000,
    userAgent: 'YunCangDesktop/' + app.getVersion(),
  });
  state.source = cfg.source;
  return cfg;
}

function statusPayload(extra) {
  const cfg = currentConfig();
  const saved = state.saved || {};
  return Object.assign({
    configured: !!cfg,
    source: state.source,
    baseUrl: cfg ? (cfg.baseUrl || cfg.platformUrl) : '',
    tokenMasked: cfg ? store.maskToken(cfg.token) : '',
    encrypted: cfg ? !!cfg.encrypted : false,
    configFile: saved.file || store.configPath(userDataDir()),
    presetFile: state.preset ? state.preset.file : '',
    mode: (cfg && cfg.mode) || (state.saved && state.saved.mode) || 'private',
    platformUrl: (cfg && cfg.platformUrl) || (state.saved && state.saved.platformUrl) || '',
    account: (cfg && cfg.account) || (state.saved && state.saved.account) || '',
    tenant: (cfg && cfg.tenant) || (state.saved && state.saved.tenant) || null,
    apiProfile: cfg ? cfg.apiProfile : 'auto',
    version: app.getVersion(),
    sdkVersion: SDK_VERSION,
    error: (saved && saved.error) || '',
  }, extra || {});
}

/** 把接口清单里的路径规范成「METHOD /path」键：{id} 占位统一成 :id，尾斜杠去掉 */
function capKey(e) {
  const raw = typeof e === 'string' ? { path: e } : (e || {});
  const pathname = String(raw.path || '').replace(/\{[^}]+\}/g, ':id').replace(/\/+$/, '');
  if (!pathname) return '';
  return String(raw.method || 'GET').toUpperCase() + ' ' + pathname;
}

function capabilityKeys(catalog) {
  const available = ((catalog && catalog.available) || []).map(capKey).filter(Boolean);
  const locked = ((catalog && catalog.locked) || []).map(capKey).filter(Boolean);
  return { available, locked, total: available.length + locked.length };
}

function wireError(e) {
  if (e instanceof CloudWarehouseError) {
    return { ok: false, error: e.message, code: e.code, status: e.status, detail: e.detail, retryAfter: e.retryAfter, meta: e.meta };
  }
  return { ok: false, error: (e && e.message) || String(e), code: (e && e.code) || 'UNKNOWN', status: 0, tried: (e && e.tried) || undefined };
}

/** 平台能力（dotted）→ 桌面端沿用的 scope 名，界面按 scope 控制入口 */
const CAP_TO_SCOPE = {
  'inventory.read': 'inventory:read',
  'product.read': 'product:read',
  'product.create': 'product:write',
  'product.publish': 'product:write',
  'warehouse.manage': 'warehouse:read',
  'warehouse.create': 'warehouse:write',
  'stock.in': 'stock:write',
  'stock.out': 'stock:write',
  'stock.transfer': 'transfer:write',
  'stock.take': 'stocktake:write',
  'order.read': 'order:read',
  'report.read': 'report:read',
  'lot.read': 'lot:read',
  'partner.read': 'partner:read',
  'export.excel': 'export:excel',
};

function scopesFromCapabilities(caps) {
  const out = [];
  for (const c of caps || []) {
    const s = CAP_TO_SCOPE[c];
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

async function enterpriseConnect() {
  const cfg = currentConfig();
  if (!cfg || cfg.mode !== 'enterprise') return { ok: false, code: 'NO_CONFIG', error: '还没有登录企业版' };
  applyConfig();
  try {
    const boot = await enterprise.bootstrap(cfg.platformUrl, cfg.cookie);
    state.entBoot = boot;
    const caps = boot.capabilities || [];
    const scopes = scopesFromCapabilities(caps);
    return {
      ok: true,
      mode: 'enterprise',
      config: statusPayload(),
      profile: { id: 'enterprise', name: '企业版平台', base: cfg.platformUrl },
      me: {
        name: (boot.member && boot.member.name) || cfg.account,
        scopes,
        capabilities: caps,
        warehouseIds: null,
        tenant: boot.tenant,
        member: boot.member,
        plan: boot.plan,
      },
      tenant: boot.tenant,
      member: boot.member,
      plan: boot.plan,
      capabilities: caps,
      // 企业版没有「开放接口清单」，能力来自平台 capabilities，避免误判成「服务端版本偏旧」
      catalog: { available: [], locked: [], scopes, source: 'enterprise', keys: { available: [], locked: [], total: 0 }, capabilities: caps },
      warnings: [],
    };
  } catch (e) {
    return Object.assign(wireError(e), { profile: null, config: statusPayload(), mode: 'enterprise' });
  }
}

async function connect() {
  const cfg = applyConfig();
  if (!cfg) return { ok: false, code: 'NO_CONFIG', error: '还没有配置云仓地址与密钥' };
  if (cfg.mode === 'enterprise') return enterpriseConnect();

  let detected;
  try {
    detected = await profileApi.detect(state.client, cfg.apiProfile);
  } catch (e) {
    return Object.assign(wireError(e), { profile: null, config: statusPayload() });
  }

  state.profile = detected.profile;
  // 探测成功后把档位记到本机配置，下次直接用它，少打一发 404
  if (state.saved && state.saved.ok && state.saved.apiProfile !== detected.profile.id) {
    try {
      store.write(userDataDir(), { baseUrl: state.saved.baseUrl, token: state.saved.token, apiProfile: detected.profile.id, label: state.saved.label });
      state.saved = store.read(userDataDir());
    } catch (e) {}
  }
  const out = { ok: true, config: statusPayload(), profile: { id: detected.profile.id, name: detected.profile.name, base: detected.profile.base }, me: detected.me, warnings: [] };

  try {
    const cat = await state.client.request(detected.profile.catalog, {});
    const d = cat.data || {};
    out.catalog = {
      available: d.endpoints || d.available || [],
      locked: d.lockedEndpoints || d.locked || [],
      scopes: (d.scopes && d.scopes.length ? d.scopes : fallback.SCOPES),
      source: 'server',
      summary: d.summary || null,
      conventions: d.conventions || null,
      baseUrl: d.baseUrl || '',
    };
  } catch (e) {
    const w = wireError(e);
    const scopes = (detected.me && detected.me.scopes) || [];
    out.catalog = Object.assign(fallback.buildCatalog(scopes), { warning: '接口目录取自内置兜底：' + w.error });
    out.warnings.push('接口目录兜底：' + w.error);
  }

  // 能力清单：渲染层拿它决定「查看 / 过账 / 发运 / 录实盘」这些按钮能不能点，
  // 而不是等用户点下去吃一个 404。
  if (out.catalog) out.catalog.keys = capabilityKeys(out.catalog);

  return out;
}

// ---------------- IPC ----------------

ipcMain.handle('app:info', () => ({ version: app.getVersion(), sdkVersion: SDK_VERSION, electron: process.versions.electron, node: process.versions.node, platform: process.platform }));

ipcMain.handle('app:uninstall', () => {
  if (process.platform !== 'win32') return { ok: false, error: '当前系统使用安装包自带卸载方式' };
  const dir = path.dirname(process.execPath);
  let uninstallers = [];
  try {
    uninstallers = fs.readdirSync(dir).filter((f) => /^Uninstall .*\.exe$/i.test(f));
  } catch (e) {
    return { ok: false, error: '读取安装目录失败：' + (e.message || String(e)) };
  }
  if (!uninstallers.length) return { ok: false, error: '没有找到卸载程序（开发模式或绿色版）' };
  // 先清掉本机配置，避免卸载器被用户中途取消后密钥还留在磁盘上
  try { store.clear(userDataDir()); } catch (e) {}
  try {
    spawn(path.join(dir, uninstallers[0]), [], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    return { ok: false, error: '启动卸载程序失败：' + (e.message || String(e)) };
  }
  setTimeout(() => app.quit(), 600);
  return { ok: true };
});

// ---------------- 更新 ----------------
ipcMain.handle('update:check', async () => {
  try {
    return await updater.check(app.getVersion());
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('update:install', async (event, payload) => {
  try {
    const url = String((payload && payload.url) || '');
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '下载地址不合法' };
    const win = BrowserWindow.fromWebContents(event.sender);
    const got = await updater.download(url, payload && payload.sha256, (pct, got_, total) => {
      if (win && !win.isDestroyed()) win.webContents.send('update:progress', { pct, got: got_, total });
    });
    await updater.runInstaller(got.file);
    setTimeout(() => app.quit(), 900);
    return { ok: true, file: got.file, bytes: got.bytes };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

// ---------------- 本地表格（CSV / XLSX 导入导出） ----------------
/**
 * 商品导入导出跟 Web 端一样支持 xlsx：
 *   - 读：csv 直接按文本切，xlsx 用 exceljs 解析首表；
 *   - 写：按扩展名决定 csv 还是 xlsx。
 * 解析/生成都放主进程，渲染层只拿结构化行。
 */
ipcMain.handle('file:pick-table', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || undefined;
  const opts = { title: '选择商品表格', properties: ['openFile'], filters: [{ name: '表格', extensions: ['xlsx', 'xls', 'csv'] }] };
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const file = r.filePaths[0];
  try {
    // csv / xlsx 都交给 tables：xlsx 优先 exceljs（预打包单文件），缺件时自动用内置读取器
    const rows = await tables.readTable(file);
    return { ok: true, path: file, name: path.basename(file), rows };
  } catch (e) {
    return { ok: false, error: '读取失败：' + (e.message || String(e)), code: (e && e.code) || 'READ_FAILED' };
  }
});

// ---------------- 商品导入模板（与 Web 同一套列结构） ----------------
ipcMain.handle('template:save', async (event, payload) => {
  const p = payload || {};
  const parent = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || undefined;
  const opts = { title: '保存商品导入模板', defaultPath: '商品导入模板.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] };
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    return await productTemplate.writeTemplateTo(r.filePath, {
      hasWarehouse: !!p.hasWarehouse,
      warehouses: p.warehouses || [],
      categories: p.categories || [],
      units: p.units || [],
    });
  } catch (e) {
    return { ok: false, error: '模板生成失败：' + (e.message || String(e)), code: (e && e.code) || 'TEMPLATE_FAILED' };
  }
});

/** 企业版：直接用会话 Cookie 下载服务端实时模板（/api/products/template） */
ipcMain.handle('template:fetch', async (event) => {
  const cfg = currentConfig();
  if (!cfg || cfg.mode !== 'enterprise') {
    return { ok: false, code: 'NO_ENTERPRISE_SESSION', error: '私有化部署拿不到服务端模板：开放接口里没有 /products/template（需要登录会话）' };
  }
  const base = String(cfg.platformUrl || '').replace(/\/+$/, '');
  try {
    const res = await fetch(base + '/api/products/template', { headers: { cookie: cfg.cookie, accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
    if (!res.ok) {
      return { ok: false, status: res.status, code: 'TEMPLATE_HTTP_' + res.status, error: '服务端模板接口返回 ' + res.status + (res.status === 401 ? '（会话过期，重新登录）' : '') };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const parent = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || undefined;
    const opts = { title: '保存商品导入模板（服务端实时生成）', defaultPath: '商品导入模板.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] };
    const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, buf);
    return { ok: true, path: r.filePath, engine: 'server', bytes: buf.length };
  } catch (e) {
    return { ok: false, error: '下载服务端模板失败：' + (e.message || String(e)), code: 'TEMPLATE_FETCH_FAILED' };
  }
});

/** 企业版：把 Excel 直接交给服务端导入（/api/products/import），拿逐行结果 */
ipcMain.handle('import:upload', async (_e, payload) => {
  const cfg = currentConfig();
  if (!cfg || cfg.mode !== 'enterprise') {
    return { ok: false, code: 'NO_ENTERPRISE_SESSION', error: '私有化部署没有服务端导入接口（/api/products/import 需要登录会话）' };
  }
  const file = String((payload && payload.path) || '');
  if (!file) return { ok: false, error: '没有选择文件' };
  const base = String(cfg.platformUrl || '').replace(/\/+$/, '');
  try {
    const buf = fs.readFileSync(file);
    if (buf.length > 10 * 1024 * 1024) return { ok: false, error: '文件超过 10MB，服务端会拒绝' };
    const form = new FormData();
    form.append('file', new Blob([buf]), path.basename(file));
    const res = await fetch(base + '/api/products/import', { method: 'POST', headers: { cookie: cfg.cookie }, body: form });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    if (!res.ok || !json || json.success === false) {
      return { ok: false, status: res.status, error: (json && (json.message || json.error)) || ('导入失败：HTTP ' + res.status), raw: text.slice(0, 400) };
    }
    return { ok: true, result: json.data || json };
  } catch (e) {
    return { ok: false, error: '导入请求失败：' + (e.message || String(e)) };
  }
});

ipcMain.handle('file:save-table', async (event, payload) => {
  const name = String((payload && payload.name) || 'export.xlsx');
  const ext = path.extname(name).toLowerCase() === '.csv' ? 'csv' : 'xlsx';
  // 带上父窗口：Windows 上无父窗口的保存框会跑到主窗口后面，用户以为「点了没反应」
  const parent = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || undefined;
  const opts = { title: '保存表格', defaultPath: name, filters: ext === 'csv' ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'Excel', extensions: ['xlsx'] }] };
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    const headers = (payload && payload.headers) || [];
    const rows = (payload && payload.rows) || [];
    return await tables.writeTable(r.filePath, headers, rows);
  } catch (e) {
    return { ok: false, error: '写入失败：' + (e.message || String(e)), code: (e && e.code) || 'WRITE_FAILED' };
  }
});

// ---------------- 本地文件（CSV 导入/导出） ----------------
ipcMain.handle('file:pick-csv', async () => {
  const r = await dialog.showOpenDialog({ title: '选择商品 CSV', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  try {
    const text = fs.readFileSync(r.filePaths[0], 'utf8').replace(/^\uFEFF/, '');
    return { ok: true, path: r.filePaths[0], name: path.basename(r.filePaths[0]), text };
  } catch (e) {
    return { ok: false, error: '读取失败：' + (e.message || String(e)) };
  }
});

ipcMain.handle('file:save-csv', async (_e, payload) => {
  const name = String((payload && payload.name) || 'export.csv');
  const r = await dialog.showSaveDialog({ title: '导出 CSV', defaultPath: name, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(r.filePath, '\uFEFF' + String((payload && payload.content) || ''), 'utf8');
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: '写入失败：' + (e.message || String(e)) };
  }
});

ipcMain.handle('config:status', () => statusPayload());


ipcMain.handle('config:test', async (_e, payload) => {
  const baseUrl = store.normalizeBaseUrl(payload && payload.baseUrl);
  const token = String((payload && payload.token) || '').trim();
  if (!baseUrl) return { ok: false, code: 'BAD_URL', error: '请填写云仓地址' };
  if (!token) return { ok: false, code: 'BAD_TOKEN', error: '请填写密钥' };
  const probe = new CloudWarehouseClient({ baseUrl, apiKey: token, timeoutMs: 12000, userAgent: 'CloudWarehouseDesktop/' + app.getVersion() });
  try {
    const d = await profileApi.detect(probe, (payload && payload.apiProfile) || 'auto');
    return { ok: true, baseUrl, profile: d.profile.id, profileName: d.profile.name, me: d.me, tried: d.tried };
  } catch (e) {
    return wireError(e);
  }
});

ipcMain.handle('config:save', async (_e, payload) => {
  const baseUrl = store.normalizeBaseUrl(payload && payload.baseUrl);
  const incoming = String((payload && payload.token) || '').trim();
  // 设置页允许只改地址：留空密钥时沿用本机已保存的那把
  const token = incoming || (state.saved && state.saved.ok ? state.saved.token : '');
  if (!baseUrl || !token) return { ok: false, code: 'BAD_INPUT', error: '地址与密钥都要填' };
  const probe = new CloudWarehouseClient({ baseUrl, apiKey: token, timeoutMs: 12000, userAgent: 'CloudWarehouseDesktop/' + app.getVersion() });
  let detected;
  try {
    detected = await profileApi.detect(probe, 'auto');
  } catch (e) {
    return Object.assign(wireError(e), { saved: false });
  }
  const w = store.write(userDataDir(), { baseUrl, token, mode: state.saved && state.saved.mode, modeChosen: state.saved && state.saved.modeChosen, apiProfile: detected.profile.id });
  state.saved = store.read(userDataDir());
  applyConfig();
  return { ok: true, saved: true, encrypted: w.encrypted, file: w.file, profile: detected.profile.id, me: detected.me };
});

ipcMain.handle('config:clear', () => {
  const r = store.clear(userDataDir());
  state.saved = store.read(userDataDir());
  applyConfig();
  return Object.assign({ ok: r.ok }, statusPayload());
});

ipcMain.handle('config:reveal', () => {
  const target = (state.saved && state.saved.ok && state.saved.file) || (state.preset && state.preset.file) || store.configPath(userDataDir());
  if (fs.existsSync(target)) { shell.showItemInFolder(target); return { ok: true, path: target }; }
  clipboard.writeText(target);
  return { ok: false, copied: true, path: target };
});

ipcMain.handle('session:connect', () => connect());

// ---------------- 企业版（账号密码登录） ----------------
ipcMain.handle('ent:captcha', async (_e, payload) => {
  try {
    return Object.assign({ ok: true }, await enterprise.captcha(payload && payload.platformUrl));
  } catch (e) {
    return { ok: false, code: (e && e.code) || 'CAPTCHA_FAILED', error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('ent:login', async (_e, payload) => {
  const platformUrl = enterprise.normalizeBase(payload && payload.platformUrl);
  try {
    const r = await enterprise.login(platformUrl, payload || {});
    const tenant = r.bootstrap && r.bootstrap.tenant ? { id: r.bootstrap.tenant.id, code: r.bootstrap.tenant.code, name: r.bootstrap.tenant.name } : null;
    store.write(userDataDir(), { mode: 'enterprise', platformUrl, account: String((payload && payload.account) || ''), cookie: r.cookie, tenant, label: tenant ? tenant.name : '' });
    state.saved = store.read(userDataDir());
    applyConfig();
    state.entBoot = r.bootstrap;
    return { ok: true, config: statusPayload(), bootstrap: r.bootstrap };
  } catch (e) {
    return { ok: false, code: (e && e.code) || 'LOGIN_FAILED', error: (e && e.message) || String(e), status: (e && e.status) || 0 };
  }
});

ipcMain.handle('ent:logout', () => {
  store.clear(userDataDir());
  state.saved = store.read(userDataDir());
  state.ent = null;
  state.entBoot = null;
  applyConfig();
  return Object.assign({ ok: true }, statusPayload());
});

// ---------------- 本机偏好（打印抬头等） ----------------
ipcMain.handle('prefs:get', () => prefs.read(userDataDir()));
ipcMain.handle('prefs:save', (_e, payload) => {
  try {
    return Object.assign({ ok: true }, prefs.write(userDataDir(), payload || {}));
  } catch (e) {
    return { ok: false, error: '保存偏好失败：' + (e.message || String(e)) };
  }
});

// ---------------- 作业草稿箱（断网丢不了单） ----------------
ipcMain.handle('drafts:list', () => {
  const items = drafts.readAll(userDataDir());
  return { ok: true, items, count: items.length, file: drafts.file(userDataDir()), max: drafts.MAX };
});
ipcMain.handle('drafts:add', (_e, payload) => {
  try {
    return drafts.add(userDataDir(), payload || {});
  } catch (e) {
    return { ok: false, error: '草稿保存失败：' + (e.message || String(e)) };
  }
});
ipcMain.handle('drafts:remove', (_e, id) => drafts.remove(userDataDir(), id));
ipcMain.handle('drafts:clear', () => drafts.clear(userDataDir()));
ipcMain.handle('drafts:touch', (_e, payload) => drafts.touch(userDataDir(), (payload && payload.id) || '', (payload && payload.error) || ''));

ipcMain.handle('api:call', async (_e, payload) => {
  const p = payload || {};
  const target0 = String(p.path || '');
  // 企业版：数据走平台自己的 /api/app/*，鉴权用会话 Cookie
  if (state.ent && (target0.startsWith('/api/app/') || target0 === '/api/app')) {
    if (target0.includes('..') || /^https?:/i.test(target0)) {
      return { ok: false, code: 'BAD_PATH', error: '只允许访问企业版平台的 /api/app 接口' };
    }
    try {
      return await enterprise.request(state.ent, target0, { method: p.method, query: p.query, body: p.body });
    } catch (e) {
      return wireError(e);
    }
  }
  if (!state.client) return { ok: false, code: 'NO_CONFIG', error: '还没有配置云仓地址与密钥' };
  const target = String(p.path || '');
  const allowed = target.startsWith('/api/v1/desktop/') || target.startsWith('/api/v1/open/') || target === '/api/v1/open' || target === '/api/v1/desktop/catalog';
  if (!allowed || target.includes('..') || /^https?:/i.test(target)) {
    return { ok: false, code: 'BAD_PATH', error: '只允许访问云仓的桌面/开放接口' };
  }
  try {
    return await state.client.request(target, { method: p.method, query: p.query, body: p.body, idempotencyKey: p.idempotencyKey, idempotent: p.idempotent });
  } catch (e) {
    return wireError(e);
  }
});

// ---------------- 窗口 ----------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0a0f1a',
    title: '云仓',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // 桌面端只用本地界面，所有数据均通过云仓 API 获取
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

app.on('certificate-error', (event, _wc, _url, _error, _cert, callback) => {
  const cfg = currentConfig();
  const allow = !!(cfg && state.preset && state.preset.config && state.preset.config.insecureTls);
  if (allow) { event.preventDefault(); callback(true); } else { callback(false); }
});

app.whenReady().then(async () => {
  state.saved = store.read(userDataDir());
  loadPreset();
  applyConfig();

  if (process.argv.includes('--smoke') || process.argv.includes('--smoke-ui')) {
    const out = await connect();
    console.log('SMOKE_CONNECT ' + JSON.stringify({
      ok: out.ok, code: out.code || '', source: state.source, profile: out.profile && out.profile.id,
      me: out.me && out.me.name, scopes: (out.me && out.me.scopes) || [],
      available: ((out.catalog && out.catalog.available) || []).length,
      locked: ((out.catalog && out.catalog.locked) || []).length,
      warnings: out.warnings || [],
    }));

    if (process.argv.includes('--smoke-ui')) {
      const sizeArg = process.argv.find((a) => a.startsWith('--size='));
      const m = sizeArg ? /^(\d+)x(\d+)$/.exec(sizeArg.slice(7)) : null;
      const winW = m ? Number(m[1]) : 1280;
      const winH = m ? Number(m[2]) : 832;
      const win = new BrowserWindow({ show: false, width: winW, height: winH, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
      const errors = [];
      win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errors.push(String(msg).slice(0, 300)); });
      await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
      await new Promise((r) => setTimeout(r, 1600));
      const clickArg = process.argv.find((a) => a.startsWith('--click='));
      if (clickArg) {
        const sel = clickArg.slice(8);
        await win.webContents.executeJavaScript('(function(){var el=document.querySelector(' + JSON.stringify(sel) + ');if(el)el.click();return !!el;})()');
        await new Promise((r) => setTimeout(r, 900));
      }
      // --eval-file=<path>：跑一段渲染层脚本并打印结果，做点击链路的自动化验证用
      const evalArg = process.argv.find((a) => a.startsWith('--eval-file='));
      if (evalArg) {
        try {
          const code = fs.readFileSync(evalArg.slice(12), 'utf8');
          const out = await win.webContents.executeJavaScript(code, true);
          console.log('SMOKE_EVAL ' + JSON.stringify(out));
        } catch (e) {
          console.log('SMOKE_EVAL_ERROR ' + JSON.stringify((e && e.message) || String(e)));
        }
        await new Promise((r) => setTimeout(r, 600));
      }
      const probe = await win.webContents.executeJavaScript('JSON.stringify({ view: document.body.getAttribute("data-view"), nav: document.querySelectorAll("[data-nav]").length, jobs: document.querySelectorAll("[data-job]").length, rows: document.querySelectorAll("tbody tr").length, title: (document.querySelector(".view-title")||{}).textContent, banner: !!document.querySelector(".banner") })');
      console.log('SMOKE_UI ' + probe + ' errors=' + JSON.stringify(errors));
      const shotArg = process.argv.find((a) => a.startsWith('--shot='));
      if (shotArg) {
        const img = await win.capturePage();
        fs.writeFileSync(shotArg.slice(7), img.toPNG());
        console.log('SMOKE_SHOT ' + shotArg.slice(7));
      }
      app.exit(0);
      return;
    }
    app.exit(0);
    return;
  }

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});


app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

module.exports = { newIdempotencyKey };

'use strict';

/**
 * 环境变量文件加载器
 *
 * 桌面端不内置任何地址与密钥：启动时按固定顺序找一个 .env，读到
 * CW_BASE_URL / CW_API_KEY 就用它登录云仓开放接口。找不到就进「配置」页，
 * 不猜、不兜底到某个线上地址。
 *
 * 查找顺序（先命中先用）：
 *   1. 启动参数 --env <路径>
 *   2. 环境变量 CW_ENV_FILE
 *   3. 程序所在目录/.env            （绿色版：把 .env 与 exe 放一起）
 *   4. 用户数据目录/.env            （安装版：%APPDATA%\云仓客户端\.env）
 *   5. 当前工作目录/.env
 *   6. %ProgramData%\CloudWarehouse\.env  （同一台机器的多用户共享配置）
 */

const fs = require('node:fs');
const path = require('node:path');

const ALIASES = {
  baseUrl: ['CW_BASE_URL', 'CLOUD_WAREHOUSE_BASE_URL', 'YC_BASE_URL', 'CW_URL'],
  apiKey: ['CW_API_KEY', 'CLOUD_WAREHOUSE_API_KEY', 'YC_API_KEY', 'CW_KEY', 'CW_TOKEN'],
  timeoutMs: ['CW_TIMEOUT_MS', 'CLOUD_WAREHOUSE_TIMEOUT_MS'],
  label: ['CW_LABEL', 'CLOUD_WAREHOUSE_LABEL'],
  insecureTls: ['CW_INSECURE_TLS', 'CW_ALLOW_INSECURE'],
};

function stripBom(s) {
  return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 解析 .env：支持注释、export 前缀、单双引号、行内 # 注释 */
function parseEnv(text) {
  const out = {};
  const lines = stripBom(String(text || '')).split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/** 地址归一化：补 http(s)、去尾斜杠、去掉误粘的 /api/v1/open 尾巴 */
function normalizeBaseUrl(input) {
  let v = String(input || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'http://' + v;
  v = v.replace(/\/+$/, '');
  v = v.replace(/\/api(\/v1)?(\/open)?$/i, '');
  v = v.replace(/\/api\/v1$/i, '');
  return v;
}

function pick(values, keys) {
  for (const k of keys) {
    const v = values[k];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function candidateFiles(opts) {
  const o = opts || {};
  const list = [];
  const argvPath = o.argvPath || '';
  if (argvPath) list.push(path.resolve(argvPath));
  if (o.envVarPath) list.push(path.resolve(o.envVarPath));
  if (o.appDir) list.push(path.join(o.appDir, '.env'));
  if (o.userDataDir) list.push(path.join(o.userDataDir, '.env'));
  if (o.cwd) list.push(path.join(o.cwd, '.env'));
  const pd = o.programData || 'C:\\ProgramData';
  list.push(path.join(pd, 'CloudWarehouse', '.env'));
  const seen = new Set();
  return list.filter((p) => {
    const k = process.platform === 'win32' ? p.toLowerCase() : p;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 取启动参数里的 --env=路径 或 --env 路径 */
function envPathFromArgv(argv) {
  const arr = argv || [];
  for (let i = 0; i < arr.length; i++) {
    const a = String(arr[i]);
    if (a === '--env') return arr[i + 1] ? String(arr[i + 1]) : '';
    if (a.startsWith('--env=')) return a.slice(6);
  }
  return '';
}

/**
 * 读取配置。
 * 返回 { ok, file, source, config:{baseUrl,apiKey,timeoutMs,label}, problems[] }
 */
function loadConfig(opts) {
  const o = opts || {};
  const argvPath = o.argvPath !== undefined ? o.argvPath : envPathFromArgv(o.argv);
  const candidates = candidateFiles({
    argvPath,
    envVarPath: o.envVarPath || process.env.CW_ENV_FILE || '',
    appDir: o.appDir,
    userDataDir: o.userDataDir,
    cwd: o.cwd,
    programData: o.programData,
  });

  const problems = [];
  let file = '';
  let values = {};

  for (const p of candidates) {
    try {
      const text = fs.readFileSync(p, 'utf8');
      values = parseEnv(text);
      file = p;
      break;
    } catch (e) {
      if (e && e.code !== 'ENOENT') problems.push('读取失败：' + p + '（' + (e.message || e.code) + '）');
    }
  }

  if (!file) {
    return {
      ok: false,
      file: '',
      source: 'missing',
      config: { baseUrl: '', apiKey: '', timeoutMs: 20000, label: '' },
      problems: problems.concat(['没有找到环境变量文件，已查找：'].concat(candidates)),
      candidates,
    };
  }

  const rawBase = pick(values, ALIASES.baseUrl);
  const rawKey = pick(values, ALIASES.apiKey);
  const timeoutRaw = Number(pick(values, ALIASES.timeoutMs) || 20000);
  const baseUrl = normalizeBaseUrl(rawBase);
  const apiKey = rawKey.trim();

  if (!baseUrl) problems.push('缺少 ' + ALIASES.baseUrl[0] + '（云仓地址）');
  else if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) problems.push('云仓地址格式不对：' + baseUrl);
  if (!apiKey) problems.push('缺少 ' + ALIASES.apiKey[0] + '（云仓 API 密钥）');
  else if (!apiKey.startsWith('yc_live_') && apiKey.length < 16) problems.push('密钥看起来不完整（正常形如 yc_live_…）');

  return {
    ok: problems.length === 0,
    file,
    source: argvPath && path.resolve(argvPath) === file ? 'argv' : 'file',
    config: {
      baseUrl,
      apiKey,
      timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 ? Math.min(120000, timeoutRaw) : 20000,
      label: pick(values, ALIASES.label),
      insecureTls: ['1', 'true', 'yes', 'on'].indexOf(pick(values, ALIASES.insecureTls).toLowerCase()) >= 0,
    },
    problems,
    candidates,
  };
}

/** 给渲染进程看的脱敏配置：密钥只露前缀 */
function publicConfig(loaded) {
  const cfg = (loaded && loaded.config) || {};
  const key = cfg.apiKey || '';
  return {
    ok: !!(loaded && loaded.ok),
    envFile: (loaded && loaded.file) || '',
    baseUrl: cfg.baseUrl || '',
    label: cfg.label || '',
    hasKey: !!key,
    keyPrefix: key ? key.slice(0, 12) + '…' : '',
    keyShape: key ? (key.startsWith('yc_live_') ? 'yc_live' : 'legacy') : 'none',
    timeoutMs: cfg.timeoutMs || 20000,
    insecureTls: !!cfg.insecureTls,
    problems: (loaded && loaded.problems) || [],
    candidates: (loaded && loaded.candidates) || [],
  };
}

module.exports = { parseEnv, normalizeBaseUrl, envPathFromArgv, candidateFiles, loadConfig, publicConfig, ALIASES };

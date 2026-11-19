'use strict';

/**
 * 本机配置存储（首次配置一次，之后不再问）
 *
 * 位置：%APPDATA%\云仓客户端\config.json（macOS 为 ~/Library/Application Support/云仓客户端/）
 * 密钥：能用 Electron safeStorage 就用（Windows 走 DPAPI，绑当前用户），
 *       不可用时退回明文并在界面上标注「未加密存储」。
 *
 * 与 .env 的分工：
 *   - config.json：用户在界面里填的，优先级最高；
 *   - .env：企业预置 / 绿色版批量部署用，只在没有 config.json 时生效。
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = 'config.json';

function safeStorageApi() {
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) return safeStorage;
  } catch (e) {}
  return null;
}

function configPath(userDataDir) {
  return path.join(userDataDir, FILE);
}

function sealToken(token) {
  const ss = safeStorageApi();
  if (!ss) return { token: String(token), enc: 'plain' };
  try {
    return { token: ss.encryptString(String(token)).toString('base64'), enc: 'safeStorage' };
  } catch (e) {
    return { token: String(token), enc: 'plain' };
  }
}

function openToken(stored, enc) {
  if (!stored) return '';
  if (enc !== 'safeStorage') return String(stored);
  const ss = safeStorageApi();
  if (!ss) return '';
  try {
    return ss.decryptString(Buffer.from(String(stored), 'base64'));
  } catch (e) {
    return '';
  }
}

function normalizeBaseUrl(input) {
  let v = String(input || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'http://' + v;
  v = v.replace(/\/+$/, '');
  v = v.replace(/\/api(\/v1)?(\/(open|desktop))?$/i, '');
  v = v.replace(/\/api\/v1$/i, '');
  return v;
}

function read(userDataDir) {
  const file = configPath(userDataDir);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    const mode = json.mode === 'enterprise' ? 'enterprise' : 'private';
    if (mode === 'enterprise') {
      const cookie = openToken(json.cookie, json.cookieEnc || json.enc);
      return {
        ok: !!(json.platformUrl && cookie),
        mode,
        file,
        enc: json.cookieEnc || json.enc || 'plain',
        encrypted: (json.cookieEnc || json.enc) === 'safeStorage',
        baseUrl: String(json.platformUrl || '').replace(/\/+$/, ''),
        platformUrl: String(json.platformUrl || '').replace(/\/+$/, ''),
        account: json.account || '',
        cookie,
        tenant: json.tenant || null,
        token: '',
        apiProfile: 'enterprise',
        label: json.label || '',
        savedAt: json.savedAt || '',
        error: cookie ? '' : '本机保存的企业版会话解不开（可能换了 Windows 账号或系统重装），请重新登录',
      };
    }
    const token = openToken(json.token, json.enc);
    return {
      ok: !!(json.baseUrl && token),
      mode: 'private',
      file,
      enc: json.enc || 'plain',
      encrypted: json.enc === 'safeStorage',
      baseUrl: normalizeBaseUrl(json.baseUrl),
      token,
      apiProfile: json.apiProfile || 'auto',
      label: json.label || '',
      savedAt: json.savedAt || '',
      error: token ? '' : '本机配置里的密钥解不开（可能是换了 Windows 账号或系统重装），请重新填写',
    };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, file, enc: '', baseUrl: '', token: '', apiProfile: 'auto', label: '', savedAt: '', error: '' };
    return { ok: false, file, enc: '', baseUrl: '', token: '', apiProfile: 'auto', label: '', savedAt: '', error: '配置文件损坏：' + (e.message || String(e)) };
  }
}

function write(userDataDir, data) {
  const dir = userDataDir;
  fs.mkdirSync(dir, { recursive: true });
  const mode = data && data.mode === 'enterprise' ? 'enterprise' : 'private';
  let payload;
  if (mode === 'enterprise') {
    // 企业版：登录后存会话 Cookie（加密）+ 企业信息；密钥不落盘，密码也不落盘
    const sealedCookie = sealToken(data.cookie || '');
    payload = {
      version: 2,
      mode: 'enterprise',
      platformUrl: String(data.platformUrl || '').replace(/\/+$/, ''),
      account: String(data.account || ''),
      cookie: sealedCookie.token,
      cookieEnc: sealedCookie.enc,
      tenant: data.tenant || null,
      label: data.label || '',
      savedAt: new Date().toISOString(),
    };
  } else {
    const sealed = sealToken(data.token);
    payload = {
      version: 2,
      mode: 'private',
      baseUrl: normalizeBaseUrl(data.baseUrl),
      token: sealed.token,
      enc: sealed.enc,
      apiProfile: data.apiProfile || 'auto',
      label: data.label || '',
      savedAt: new Date().toISOString(),
    };
  }
  const file = configPath(dir);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch (e) {}
  return { file, encrypted: payload.cookieEnc ? payload.cookieEnc === 'safeStorage' : payload.enc === 'safeStorage' };
}

function clear(userDataDir) {
  const file = configPath(userDataDir);
  try { fs.rmSync(file, { force: true }); return { ok: true, file }; } catch (e) { return { ok: false, file, error: e.message }; }
}

function maskToken(token) {
  const t = String(token || '');
  if (!t) return '';
  if (t.length <= 10) return t.slice(0, 2) + '…';
  return t.slice(0, 10) + '…' + t.slice(-4);
}

module.exports = { read, write, clear, maskToken, normalizeBaseUrl, configPath };

'use strict';

/**
 * 企业版（SaaS 多企业平台）登录与数据访问
 *
 * 与私有化部署的区别：
 *   - 私有化：自己填服务器地址 + API 密钥（Bearer），走 /api/v1/open。
 *   - 企业版：只填账号密码（+平台登录页要求的图形验证码），登录后拿会话 Cookie yc_sess，
 *     数据走 /api/app/*（同样是 JSON 信封 { success, data }，错误码 UNAUTHENTICATED 表示会话过期）。
 *
 * 平台登录接口（从其前端源码读到的契约）：
 *   GET  /api/auth/captcha            -> { success, data: { token, image(dataURL) } }
 *   POST /api/auth/platform/login     -> body { account, password, captchaToken, captchaAnswer }
 *                                        成功时 Set-Cookie: yc_sess=...
 *   GET  /api/app/bootstrap           -> { data: { tenant, plan, member, capabilities, menu } }
 *
 * 会话默认 2 小时（JWT exp），过期后需要重新登录（验证码仍然要填）。
 * Cookie 用 Electron safeStorage 加密后落盘，渲染进程拿不到明文。
 */

const { YunCang, YunCangError } = require('./vendor/yuncang-sdk.cjs');

const DEFAULT_PLATFORM = 'http://119.45.146.101';
const COOKIE_NAME = 'yc_sess';

function normalizeBase(input) {
  let v = String(input || '').trim() || DEFAULT_PLATFORM;
  if (!/^https?:\/\//i.test(v)) v = 'http://' + v;
  return v.replace(/\/+$/, '').replace(/\/api(\/.*)?$/i, '');
}

async function readJson(res) {
  const text = await res.text();
  try { return { json: JSON.parse(text), text }; } catch (e) { return { json: null, text }; }
}

/** 平台登录页的图形验证码：返回 token + dataURL，界面直接显示 */
async function captcha(platformUrl) {
  const base = normalizeBase(platformUrl);
  const res = await fetch(base + '/api/auth/captcha', { headers: { accept: 'application/json' } });
  const { json } = await readJson(res);
  if (!res.ok || !json || !json.success) {
    const err = new Error('取验证码失败：HTTP ' + res.status);
    err.code = 'CAPTCHA_FAILED';
    throw err;
  }
  return { token: json.data.token, image: json.data.image };
}

function pickSessionCookie(setCookieHeaders) {
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : (setCookieHeaders ? String(setCookieHeaders).split(/,(?=[^;]+=)/) : []);
  for (const raw of list) {
    const first = String(raw).split(';')[0];
    const eq = first.indexOf('=');
    if (eq < 0) continue;
    if (first.slice(0, eq).trim() === COOKIE_NAME) return { cookie: first.trim(), raw: String(raw) };
  }
  return null;
}

/** 登录：成功返回 { cookie, bootstrap } */
async function login(platformUrl, creds) {
  const base = normalizeBase(platformUrl);
  const body = {
    account: String((creds && creds.account) || '').trim(),
    password: String((creds && creds.password) || ''),
    captchaToken: String((creds && creds.captchaToken) || '').trim(),
    captchaAnswer: String((creds && creds.captchaAnswer) || '').trim(),
  };
  if (!body.account || !body.password) {
    const err = new Error('账号与密码都要填');
    err.code = 'BAD_INPUT';
    throw err;
  }
  const res = await fetch(base + '/api/auth/platform/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const { json } = await readJson(res);
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : res.headers.get('set-cookie');
  const session = pickSessionCookie(cookies);
  if (!json || !json.success) {
    const err = new Error((json && json.message) || ('登录失败：HTTP ' + res.status));
    err.code = (json && json.code) || 'LOGIN_FAILED';
    err.status = res.status;
    throw err;
  }
  if (!session) {
    const err = new Error('登录成功但没拿到会话 Cookie（服务端可能改了 Cookie 名）');
    err.code = 'NO_SESSION_COOKIE';
    throw err;
  }
  const boot = await bootstrap(base, session.cookie);
  return { cookie: session.cookie, bootstrap: boot, baseUrl: base };
}

/** 用会话 Cookie 读平台自检信息：企业、套餐、成员、能力、菜单 */
async function bootstrap(platformUrl, cookie) {
  const base = normalizeBase(platformUrl);
  const res = await fetch(base + '/api/app/bootstrap', { headers: { cookie, accept: 'application/json' } });
  const { json } = await readJson(res);
  if (!res.ok || !json || !json.success) {
    const err = new Error((json && (json.message || json.code)) || ('读取企业信息失败：HTTP ' + res.status));
    err.code = (json && json.code) || 'BOOTSTRAP_FAILED';
    throw err;
  }
  return json.data;
}

/** 企业版数据客户端：仍然走 SDK（YunCang），只是把鉴权换成会话 Cookie */
function makeClient(platformUrl, cookie, opts) {
  const base = normalizeBase(platformUrl);
  return new YunCang({
    baseUrl: base,
    apiKey: '',
    timeout: (opts && opts.timeoutMs) || 20000,
    retries: 0,
    headers: { Cookie: cookie, 'User-Agent': (opts && opts.userAgent) || 'YunCangDesktop' },
  });
}

/**
 * 调企业版接口。path 必须已带 /api/app 前缀（用 absolute 交给 SDK 直发）。
 * 会话过期统一抛 { code: 'UNAUTHENTICATED' }，上层据此回登录页。
 */
async function request(client, pathname, opts) {
  const o = opts || {};
  try {
    const raw = await client.request(pathname, {
      method: String(o.method || 'GET').toUpperCase(),
      query: o.query,
      body: o.body,
      absolute: true,
      retries: 0,
    });
    return { ok: true, status: 200, data: raw && raw.data !== undefined ? raw.data : raw, raw };
  } catch (e) {
    const status = (e instanceof YunCangError ? e.status : e.status) || 0;
    const body = (e && e.body) || {};
    const code = body.code || (status === 401 ? 'UNAUTHENTICATED' : 'ENTERPRISE_ERROR');
    const err = new Error(body.message || (e && e.message) || '企业版接口调用失败');
    err.code = code;
    err.status = status;
    err.detail = JSON.stringify(body).slice(0, 600);
    throw err;
  }
}

module.exports = { DEFAULT_PLATFORM, normalizeBase, captcha, login, bootstrap, makeClient, request, COOKIE_NAME };

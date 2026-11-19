'use strict';

/**
 * 云仓客户端（桌面端适配层，底座是官方 SDK yuncang-sdk）
 *
 * SDK 负责：鉴权头、幂等键、429/5xx 退避重试、错误码、超时。
 * 本文件只补桌面端一直在用的三样东西（不改调用方）：
 *   1. url() —— 拼出完整地址（日志与调试用）；
 *   2. request(path, {method, query, body}) 的返回形状 { ok, status, data, raw, meta }；
 *   3. 把 SDK 错误再翻译成桌面端的 CloudWarehouseError（code 供界面出文案）。
 *
 * 密钥只存在主进程内存里，渲染进程永远拿不到明文。
 */

const path = require('node:path');
const crypto = require('node:crypto');
const { YunCang, YunCangError } = require(path.join(__dirname, 'vendor', 'yuncang-sdk.cjs'));

const DEFAULT_TIMEOUT = 20000;

function qs(query) {
  if (!query || typeof query !== 'object') return '';
  const parts = [];
  for (const k of Object.keys(query)) {
    const v = query[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function newIdempotencyKey(prefix) {
  return (prefix ? String(prefix) + '-' : '') + crypto.randomUUID();
}

class CloudWarehouseError extends Error {
  constructor(message, info) {
    super(message);
    this.name = 'CloudWarehouseError';
    this.code = (info && info.code) || 'API_ERROR';
    this.status = (info && info.status) || 0;
    this.detail = (info && info.detail) || '';
    this.retryAfter = (info && info.retryAfter) || 0;
    this.meta = (info && info.meta) || null;
  }
}

function describeStatus(status) {
  if (status === 401) return { code: 'KEY_INVALID', message: '密钥无效、已停用、已过期，或来源 IP 不在白名单内（服务端不区分原因，防枚举）' };
  if (status === 403) return { code: 'SCOPE_DENIED', message: '这把密钥没有该作业的权限，或目标仓库不在授权范围内' };
  if (status === 404) return { code: 'NOT_FOUND', message: '接口或资源不存在，确认云仓版本是否支持该开放接口' };
  if (status === 409) return { code: 'IDEMPOTENCY_CONFLICT', message: '同一个 Idempotency-Key 被用在了不同的请求体上' };
  if (status === 429) return { code: 'RATE_LIMITED', message: '已超出这把密钥的每分钟调用上限，稍后重试' };
  if (status >= 500) return { code: 'SERVER_ERROR', message: '云仓服务端异常，可重试；持续失败请联系管理员' };
  if (status >= 400) return { code: 'BAD_REQUEST', message: '参数不合法' };
  return { code: 'UNEXPECTED', message: '未预期的响应（HTTP ' + status + '）' };
}

/** SDK 错误 → 桌面端错误 */
function toDesktopError(err, meta) {
  if (!(err instanceof YunCangError)) {
    return new CloudWarehouseError((err && err.message) || '请求失败', { code: 'UNEXPECTED', meta });
  }
  if (err.code === 'TIMEOUT') {
    return new CloudWarehouseError('请求超时（' + (meta && meta.timeoutMs) + ' 毫秒）', { code: 'TIMEOUT', status: 0, meta });
  }
  if (err.code === 'NETWORK') {
    return new CloudWarehouseError('连不上云仓：' + err.message, { code: 'NETWORK', status: 0, meta });
  }
  if (err.code === 'HTTPS_REQUIRED') {
    return new CloudWarehouseError('云仓要求 HTTPS 访问：内网 http://地址 会被服务端拒绝，请改用域名 + 证书，或让服务端放行内网网段', { code: 'HTTPS_REQUIRED', status: err.status, meta });
  }
  if (err.code === 'IP_NOT_ALLOWED') {
    return new CloudWarehouseError('当前出口 IP 不在该密钥的白名单里，请在云仓后台补上本机 IP', { code: 'IP_NOT_ALLOWED', status: err.status, meta });
  }
  if (err.code === 'BAD_RESPONSE') {
    return new CloudWarehouseError('云仓返回的不是 JSON（地址可能指向了网页而不是接口）', { code: 'BAD_RESPONSE', status: err.status, meta });
  }
  const d = describeStatus(err.status);
  return new CloudWarehouseError(err.message || d.message, {
    code: d.code,
    status: err.status,
    detail: err.body ? JSON.stringify(err.body).slice(0, 800) : '',
    meta,
  });
}

class CloudWarehouseClient {
  constructor(cfg) {
    this.baseUrl = String((cfg && cfg.baseUrl) || '').replace(/\/+$/, '');
    this.apiKey = String((cfg && cfg.apiKey) || '');
    this.timeoutMs = Number((cfg && cfg.timeoutMs) || DEFAULT_TIMEOUT);
    this.userAgent = String((cfg && cfg.userAgent) || 'CloudWarehouseDesktop/0.1.0');
    this.sdk = new YunCang({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      timeout: this.timeoutMs,
      retries: 0, // 桌面端历来自己决定重试策略，保持"一次失败就报错"的界面语义
      headers: { 'User-Agent': this.userAgent },
    });
  }

  url(path, query) {
    const p = String(path || '/');
    return this.baseUrl + (p.startsWith('/') ? p : '/' + p) + qs(query);
  }

  async request(pathname, opts) {
    const o = opts || {};
    const method = String(o.method || 'GET').toUpperCase();
    const started = Date.now();
    const idempotencyKey = o.idempotencyKey || (method !== 'GET' && o.idempotent !== false ? newIdempotencyKey('desktop') : undefined);
    const meta = { status: 0, elapsedMs: 0, path: pathname, method, idempotencyKey: idempotencyKey || '' };

    try {
      const raw = await this.sdk.request(String(pathname), {
        method,
        query: o.query,
        body: o.body,
        idempotencyKey,
        retries: 0,
        absolute: true, // 调用方传的是完整路径（/api/v1/open/… 或 profile 里的 /api/v1/desktop/…）
      });
      meta.elapsedMs = Date.now() - started;
      // SDK 对非 JSON 响应会回 { raw: '<html…>' }
      if (raw && Object.keys(raw).length === 1 && typeof raw.raw === 'string') {
        throw Object.assign(new YunCangError('不是 JSON', { code: 'BAD_RESPONSE', status: 200 }), { body: { raw: raw.raw } });
      }
      return { ok: true, status: 200, data: raw && raw.data !== undefined ? raw.data : raw, raw, meta };
    } catch (err) {
      meta.elapsedMs = Date.now() - started;
      meta.timeoutMs = this.timeoutMs;
      throw toDesktopError(err, meta);
    }
  }

  get(pathname, query) { return this.request(pathname, { query }); }
  post(pathname, body, options) { return this.request(pathname, Object.assign({ method: 'POST', body }, options || {})); }
  put(pathname, body, options) { return this.request(pathname, Object.assign({ method: 'PUT', body }, options || {})); }
  patch(pathname, body, options) { return this.request(pathname, Object.assign({ method: 'PATCH', body }, options || {})); }
  del(pathname, options) { return this.request(pathname, Object.assign({ method: 'DELETE' }, options || {})); }
}

module.exports = { CloudWarehouseClient, CloudWarehouseError, newIdempotencyKey, qs, describeStatus };

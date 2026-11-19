var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var index_exports = {};
__export(index_exports, {
  ENDPOINTS: () => ENDPOINTS,
  SDK_VERSION: () => SDK_VERSION,
  YunCang: () => YunCang,
  YunCangError: () => YunCangError,
  createClient: () => createClient2,
  default: () => index_default,
  fetchAdapter: () => fetchAdapter,
  normalizeBaseUrl: () => normalizeBaseUrl,
  wxAdapter: () => wxAdapter
});
module.exports = __toCommonJS(index_exports);

// src/core.js
var SDK_VERSION = "1.1.0";
var YunCangError = class extends Error {
  constructor(message, info = {}) {
    super(message || "\u8BF7\u6C42\u5931\u8D25");
    this.name = "YunCangError";
    this.status = info.status || 0;
    this.code = info.code || "";
    this.body = info.body || null;
    this.requestId = info.requestId || "";
    this.retryable = !!info.retryable;
    this.hint = info.hint || "";
  }
};
function normalizeBaseUrl(input) {
  let v = String(input || "").trim();
  if (!v) throw new YunCangError("\u7F3A\u5C11\u670D\u52A1\u5668\u5730\u5740 baseUrl", { code: "BAD_URL" });
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  v = v.replace(/\/+$/, "");
  v = v.replace(/\/api(\/v1)?(\/(open|desktop))?$/i, "");
  v = v.replace(/\/api\/v1$/i, "");
  return v;
}
function uuid() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {
  }
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s.slice(0, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12, 16) + "-" + s.slice(16, 20) + "-" + s.slice(20);
}
function buildUrl(base, path, query) {
  const qs = [];
  Object.keys(query || {}).forEach((k) => {
    const v = query[k];
    if (v === void 0 || v === null || v === "") return;
    qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
  });
  return base + path + (qs.length ? (path.indexOf("?") >= 0 ? "&" : "?") + qs.join("&") : "");
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function unwrapResponse(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  if (parsed.success === true && parsed.data !== void 0) {
    const d = parsed.data;
    if (d && typeof d === "object") {
      try {
        if (!Object.prototype.hasOwnProperty.call(d, "data")) {
          Object.defineProperty(d, "data", { value: d, enumerable: false, configurable: true });
        }
      } catch (e) {
      }
      return d;
    }
    return d;
  }
  return parsed;
}
function fetchAdapter(url, init) {
  if (typeof fetch !== "function") {
    throw new YunCangError("\u5F53\u524D\u73AF\u5883\u6CA1\u6709 fetch\uFF0C\u8BF7\u4F20 adapter\uFF08Node 18+ \u6216\u6D4F\u89C8\u5668\u53EF\u7528\uFF09", { code: "NO_FETCH" });
  }
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = init.timeout ? setTimeout(() => ctrl && ctrl.abort(), init.timeout) : null;
  return fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: ctrl ? ctrl.signal : void 0
  }).then(async (res) => {
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  }).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
function wxAdapter(url, init) {
  return new Promise((resolve, reject) => {
    const wx = typeof globalThis !== "undefined" ? globalThis.wx : void 0;
    if (!wx || !wx.request) {
      reject(new YunCangError("\u5F53\u524D\u73AF\u5883\u6CA1\u6709 wx.request", { code: "NO_WX" }));
      return;
    }
    const qi = url.indexOf("?");
    const pathOnly = qi >= 0 ? url.slice(0, qi) : url;
    const query = {};
    if (qi >= 0) {
      url.slice(qi + 1).split("&").forEach((pair) => {
        if (!pair) return;
        const eq = pair.indexOf("=");
        const k = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
        const v = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1)) : "";
        query[k] = v;
      });
    }
    const safeHeaders = {};
    Object.keys(init.headers || {}).forEach((k) => {
      if (/^user-agent$/i.test(k)) return;
      const key = /^content-type$/i.test(k) ? "content-type" : k;
      safeHeaders[key] = init.headers[k];
    });
    wx.request({
      url: pathOnly,
      method: init.method,
      header: safeHeaders,
      data: init.body === void 0 ? void 0 : init.body,
      // 字符串直传，避免对象被序列化成空
      dataType: "text",
      timeout: init.timeout,
      success: (res) => resolve({ status: res.statusCode, headers: res.header || {}, text: typeof res.data === "string" ? res.data : JSON.stringify(res.data) }),
      fail: (err) => reject(new YunCangError(err && err.errMsg || "\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25", { code: "NETWORK", retryable: true }))
    });
  });
}
function pickAdapter(client) {
  if (typeof client.adapter === "function") return client.adapter;
  if (client.adapter === "wx") return wxAdapter;
  if (client.adapter === "fetch") return fetchAdapter;
  if (typeof globalThis !== "undefined" && globalThis.wx && globalThis.wx.request) return wxAdapter;
  return fetchAdapter;
}
function readError(status, body) {
  const b = body || {};
  const code = String(b.code || b.error_code || "");
  let message = b.error || b.message || "HTTP " + status;
  let hint = "";
  if (code === "HTTPS_REQUIRED") hint = "\u8FD9\u4E2A\u5BC6\u94A5\u8981\u6C42 HTTPS\uFF0C\u8BF7\u628A\u670D\u52A1\u5668\u5730\u5740\u6539\u6210 https://";
  else if (code === "IP_NOT_ALLOWED") hint = "\u5F53\u524D\u51FA\u53E3 IP \u4E0D\u5728\u5BC6\u94A5\u767D\u540D\u5355\u91CC\uFF0C\u53BB\u4E91\u4ED3\u540E\u53F0\u52A0\u767D\u540D\u5355";
  else if (code === "SCOPE_DENIED") hint = "\u5BC6\u94A5\u7F3A\u5C11\u8FD9\u4E2A\u64CD\u4F5C\u9700\u8981\u7684\u6743\u9650\uFF08scope\uFF09";
  else if (status === 401) hint = "\u5BC6\u94A5\u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u53BB\u4E91\u4ED3\u540E\u53F0\u91CD\u65B0\u751F\u6210";
  else if (status === 403) hint = "\u5BC6\u94A5\u6CA1\u6709\u6743\u9650\uFF0C\u6216\u8BBF\u95EE\u4E86\u4E0D\u5728\u5141\u8BB8\u8303\u56F4\u5185\u7684\u4ED3\u5E93";
  else if (status === 404) hint = "\u63A5\u53E3\u4E0D\u5B58\u5728\uFF1A\u786E\u8BA4\u670D\u52A1\u5668\u7248\u672C\u652F\u6301 /api/v1/open";
  else if (status === 429) hint = "\u89E6\u53D1\u9650\u6D41\uFF0C\u7A0D\u540E\u91CD\u8BD5";
  return { code, message, hint };
}
function createClient(options = {}) {
  const client = {
    baseUrl: normalizeBaseUrl(options.baseUrl),
    apiKey: String(options.apiKey || "").trim(),
    adapter: options.adapter || "auto",
    timeout: options.timeout || 2e4,
    retries: options.retries === void 0 ? 2 : options.retries,
    headers: options.headers || {},
    apiPrefix: String(options.apiPrefix || "/api/v1/open").replace(/\/+$/, ""),
    onRequest: options.onRequest || null,
    onResponse: options.onResponse || null
  };
  async function request(path, opts = {}) {
    const method = String(opts.method || "GET").toUpperCase();
    const query = opts.query || {};
    const full = opts.absolute || path.indexOf("/api/") === 0 ? path : client.apiPrefix + path;
    const url = buildUrl(client.baseUrl, full, query);
    const headers = Object.assign(
      {
        Authorization: "Bearer " + client.apiKey,
        Accept: "application/json",
        "User-Agent": "yuncang-sdk/" + SDK_VERSION
      },
      client.headers,
      opts.headers || {}
    );
    let bodyText;
    if (opts.body !== void 0 && method !== "GET" && method !== "HEAD") {
      bodyText = JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
    }
    if (method !== "GET" && method !== "HEAD") {
      headers["Idempotency-Key"] = opts.idempotencyKey || uuid();
    }
    const maxRetries = opts.retries === void 0 ? client.retries : opts.retries;
    const send = pickAdapter(client);
    let attempt = 0;
    let lastErr;
    while (attempt <= maxRetries) {
      attempt++;
      if (client.onRequest) client.onRequest({ url, method, attempt });
      try {
        const res = await send(url, {
          method,
          headers,
          body: bodyText,
          timeout: opts.timeout || client.timeout
        });
        if (client.onResponse) client.onResponse({ status: res.status, url });
        const text = res.text || "";
        let parsed = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch (e) {
            parsed = { raw: text };
          }
        }
        if (res.status >= 200 && res.status < 300) {
          return parsed === null ? {} : unwrapResponse(parsed);
        }
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt <= maxRetries) {
          await sleep(Math.min(2e3, 200 * Math.pow(2, attempt - 1)));
          continue;
        }
        const info = readError(res.status, parsed);
        throw new YunCangError(info.message, {
          status: res.status,
          code: info.code,
          body: parsed,
          requestId: parsed && (parsed.requestId || parsed.request_id) || "",
          retryable,
          hint: info.hint
        });
      } catch (e) {
        if (e instanceof YunCangError && !e.retryable) throw e;
        lastErr = e;
        if (attempt <= maxRetries) {
          await sleep(Math.min(2e3, 200 * Math.pow(2, attempt - 1)));
          continue;
        }
        if (e instanceof YunCangError) throw e;
        const aborted = e && (e.name === "AbortError" || /abort/i.test(String(e.message)));
        throw new YunCangError(
          aborted ? "\u8BF7\u6C42\u8D85\u65F6" : "\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25",
          { code: aborted ? "TIMEOUT" : "NETWORK", retryable: !aborted }
        );
      }
    }
    throw lastErr instanceof YunCangError ? lastErr : new YunCangError("\u8BF7\u6C42\u5931\u8D25", { code: "UNKNOWN" });
  }
  async function* paginate(listFn, params = {}, opts = {}) {
    const pageSize = params.pageSize || opts.pageSize || 200;
    const maxPages = opts.maxPages || 200;
    for (let page = 1; page <= maxPages; page++) {
      const res = await listFn(Object.assign({}, params, { page, pageSize }));
      const box = res && res.items === void 0 && res.data ? res.data : res;
      const items = box && box.items || [];
      yield { page, items, total: box && box.total || 0 };
      if (items.length < pageSize) return;
    }
  }
  async function all(listFn, params = {}, opts = {}) {
    const out = [];
    for await (const p of paginate(listFn, params, opts)) out.push(...p.items);
    return out;
  }
  client.request = request;
  client.paginate = paginate;
  client.all = all;
  return client;
}

// src/resources.js
var P = "/api/v1/open";
function attachResources(client) {
  const req = client.request;
  const me = () => req(P + "/me");
  const meta = {
    list: (q) => req(P + "/meta", { query: q })
  };
  const products = {
    /** @param {{keyword?:string,page?:number,pageSize?:number,updatedSince?:string,includeDeleted?:0|1}} q */
    list: (q) => req(P + "/products", { query: q }),
    create: (body) => req(P + "/products", { method: "POST", body })
  };
  const warehouses = {
    list: (q) => req(P + "/warehouses", { query: q }),
    create: (body) => req(P + "/warehouses", { method: "POST", body }),
    /** 只取货位，拼成「货架-排-列-位」四段，方便直接塞下拉框 */
    async locations(warehouseId) {
      const res = await req(P + "/warehouses", { query: { withLocations: 1 } });
      const list = res && res.items || (Array.isArray(res) ? res : []);
      const wh = warehouseId ? list.filter((w) => String(w.id) === String(warehouseId)) : list;
      const out = [];
      wh.forEach((w) => {
        (w.zones || []).forEach((z) => {
          const zc = String(z.code || z.name || "");
          (z.locations || z.boxes || []).forEach((l) => {
            const lc = String(l.code || "");
            const full = zc && lc.indexOf(zc + "-") !== 0 ? zc + "-" + lc : lc;
            out.push({ id: String(l.id), code: full, name: l.name || "", warehouseId: String(w.id), warehouseName: w.name || "" });
          });
        });
      });
      return out;
    }
  };
  const partners = {
    list: (q) => req(P + "/partners", { query: q }),
    create: (body) => req(P + "/partners", { method: "POST", body })
  };
  const inventory = {
    list: (q) => req(P + "/inventory", { query: q }),
    /** 某个商品在某仓的可用量合计 */
    async available(warehouseId, productId) {
      const res = await inventory.list({ warehouseId, productId, pageSize: 50 });
      return (res && res.items || []).reduce((s, x) => s + Number(x.available !== void 0 ? x.available : x.onHand || 0), 0);
    }
  };
  const lots = {
    list: (q) => req(P + "/lots", { query: q })
  };
  const movements = {
    list: (q) => req(P + "/movements", { query: q })
  };
  const orders = {
    list: (q) => req(P + "/orders", { query: q })
  };
  const reports = {
    lowStock: (q) => req(P + "/reports/low-stock", { query: q }),
    stockSummary: (q) => req(P + "/reports/stock-summary", { query: q }),
    stockValue: (q) => req(P + "/reports/stock-value", { query: q })
  };
  const stockIn = {
    create: (body) => req(P + "/stock-in", { method: "POST", body })
  };
  const stockOut = {
    create: (body) => req(P + "/stock-out", { method: "POST", body })
  };
  const transfer = {
    create: (body) => req(P + "/transfer", { method: "POST", body })
  };
  const stocktake = {
    create: (body) => req(P + "/stocktake", { method: "POST", body })
  };
  Object.assign(client, {
    me,
    meta,
    products,
    warehouses,
    partners,
    inventory,
    lots,
    movements,
    orders,
    reports,
    stockIn,
    stockOut,
    transfer,
    stocktake
  });
  return client;
}

// src/endpoints.generated.js
var ENDPOINTS = [
  {
    "id": "inventory",
    "method": "GET",
    "path": "/inventory",
    "scope": "inventory:read",
    "title": "\u5B9E\u65F6\u5E93\u5B58",
    "write": false,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "lots",
    "method": "GET",
    "path": "/lots",
    "scope": "lot:read",
    "title": "\u6279\u6B21\u4E0E\u6548\u671F",
    "write": false,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "low-stock",
    "method": "GET",
    "path": "/reports/low-stock",
    "scope": "report:read",
    "title": "\u4F4E\u5E93\u5B58\u4E0E\u7F3A\u8D27\u6E05\u5355",
    "write": false,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "me",
    "method": "GET",
    "path": "/me",
    "scope": null,
    "title": "\u5BC6\u94A5\u81EA\u68C0",
    "write": false,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "meta",
    "method": "GET",
    "path": "/meta",
    "scope": "product:read",
    "title": "\u5206\u7C7B\u4E0E\u8BA1\u91CF\u5355\u4F4D",
    "write": false,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "movements",
    "method": "GET",
    "path": "/movements",
    "scope": "stock:read",
    "title": "\u5E93\u5B58\u6D41\u6C34",
    "write": false,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "order-detail",
    "method": "GET",
    "path": "/orders/{id}",
    "scope": "order:read",
    "title": "\u5355\u636E\u8BE6\u60C5",
    "write": false,
    "pathParams": [
      "id"
    ],
    "undocumented": false
  },
  {
    "id": "orders",
    "method": "GET",
    "path": "/orders",
    "scope": "order:read",
    "title": "\u5355\u636E\u67E5\u8BE2",
    "write": false,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "partner-create",
    "method": "POST",
    "path": "/partners",
    "scope": "partner:write",
    "title": "\u65B0\u5EFA\u5F80\u6765\u5355\u4F4D",
    "write": true,
    "pathParams": [],
    "undocumented": true
  },
  {
    "id": "partners",
    "method": "GET",
    "path": "/partners",
    "scope": "partner:read",
    "title": "\u5F80\u6765\u5355\u4F4D",
    "write": false,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "product-create",
    "method": "POST",
    "path": "/products",
    "scope": "product:write",
    "title": "\u65B0\u5EFA\u5546\u54C1",
    "write": true,
    "pathParams": [],
    "undocumented": true
  },
  {
    "id": "products",
    "method": "GET",
    "path": "/products",
    "scope": "product:read",
    "title": "\u5546\u54C1\u4E3B\u6570\u636E",
    "write": false,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "stock-in",
    "method": "POST",
    "path": "/stock-in",
    "scope": "stock:write",
    "title": "\u521B\u5EFA\u5165\u5E93\u5355",
    "write": true,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "stock-in-list",
    "method": "GET",
    "path": "/stock-in",
    "scope": "stock:read",
    "title": "\u5165\u5E93\u5355\u5217\u8868",
    "write": false,
    "pathParams": [],
    "undocumented": true
  },
  {
    "id": "stock-in-post",
    "method": "POST",
    "path": "/stock-in/{id}/post",
    "scope": "stock:write",
    "title": "\u5165\u5E93\u5355\u8FC7\u8D26",
    "write": true,
    "pathParams": [
      "id"
    ],
    "undocumented": false
  },
  {
    "id": "stock-out",
    "method": "POST",
    "path": "/stock-out",
    "scope": "stock:write",
    "title": "\u521B\u5EFA\u51FA\u5E93\u5355",
    "write": true,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "stock-out-list",
    "method": "GET",
    "path": "/stock-out",
    "scope": "stock:read",
    "title": "\u51FA\u5E93\u5355\u5217\u8868",
    "write": false,
    "pathParams": [],
    "undocumented": true
  },
  {
    "id": "stock-out-post",
    "method": "POST",
    "path": "/stock-out/{id}/post",
    "scope": "stock:write",
    "title": "\u51FA\u5E93\u5355\u8FC7\u8D26",
    "write": true,
    "pathParams": [
      "id"
    ],
    "undocumented": false
  },
  {
    "id": "stock-summary",
    "method": "GET",
    "path": "/reports/stock-summary",
    "scope": "report:read",
    "title": "\u5E93\u5B58\u6C47\u603B\u62A5\u8868",
    "write": false,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "stock-value",
    "method": "GET",
    "path": "/reports/stock-value",
    "scope": "report:read",
    "title": "\u5E93\u5B58\u91D1\u989D\u6C47\u603B",
    "write": false,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "stocktake",
    "method": "POST",
    "path": "/stocktake",
    "scope": "stocktake:write",
    "title": "\u521B\u5EFA\u76D8\u70B9\u5355",
    "write": true,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "stocktake-count",
    "method": "PATCH",
    "path": "/stocktake/{id}",
    "scope": "stocktake:write",
    "title": "\u5F55\u5165\u5B9E\u76D8",
    "write": true,
    "pathParams": [
      "id"
    ],
    "undocumented": false
  },
  {
    "id": "stocktake-detail",
    "method": "GET",
    "path": "/stocktake/{id}",
    "scope": "stock:read",
    "title": "\u76D8\u70B9\u5355\u660E\u7EC6",
    "write": false,
    "pathParams": [
      "id"
    ],
    "undocumented": false
  },
  {
    "id": "stocktake-settle",
    "method": "POST",
    "path": "/stocktake/{id}/settle",
    "scope": "stocktake:write",
    "title": "\u76D8\u70B9\u7ED3\u7B97",
    "write": true,
    "pathParams": [
      "id"
    ],
    "undocumented": false
  },
  {
    "id": "transfer",
    "method": "POST",
    "path": "/transfer",
    "scope": "transfer:write",
    "title": "\u521B\u5EFA\u8C03\u62E8\u5355",
    "write": true,
    "pathParams": [],
    "undocumented": false
  },
  {
    "id": "transfer-detail",
    "method": "GET",
    "path": "/transfer/{id}",
    "scope": "order:read",
    "title": "\u8C03\u62E8\u5355\u8BE6\u60C5",
    "write": false,
    "pathParams": [
      "id"
    ],
    "undocumented": false
  },
  {
    "id": "transfer-receive",
    "method": "POST",
    "path": "/transfer/{id}/receive",
    "scope": "transfer:write",
    "title": "\u8C03\u62E8\u6536\u8D27",
    "write": true,
    "pathParams": [
      "id"
    ],
    "undocumented": false
  },
  {
    "id": "transfer-send",
    "method": "POST",
    "path": "/transfer/{id}/send",
    "scope": "transfer:write",
    "title": "\u8C03\u62E8\u53D1\u8FD0",
    "write": true,
    "pathParams": [
      "id"
    ],
    "undocumented": false
  },
  {
    "id": "warehouse-create",
    "method": "POST",
    "path": "/warehouses",
    "scope": "warehouse:write",
    "title": "\u65B0\u5EFA\u4ED3\u5E93",
    "write": true,
    "pathParams": [],
    "undocumented": true
  },
  {
    "id": "warehouses",
    "method": "GET",
    "path": "/warehouses",
    "scope": "warehouse:read",
    "title": "\u4ED3\u5E93\u4E0E\u8D27\u4F4D",
    "write": false,
    "pathParams": [],
    "undocumented": false
  }
];
function attachGenerated(client, prefix) {
  const P2 = prefix || "/api/v1/open";
  const groups = {};
  const put = (path0, path1, fn) => {
    const key = path0 || "root";
    groups[key] = groups[key] || {};
    if (!groups[key][path1]) groups[key][path1] = fn;
  };
  put("inventory", "list", (q) => client.request("/inventory", { query: q }));
  put("lots", "list", (q) => client.request("/lots", { query: q }));
  put("reports", "lowStock", (q) => client.request("/reports/low-stock", { query: q }));
  client.me = client.me || ((q) => client.request("/me", { query: q }));
  put("meta", "list", (q) => client.request("/meta", { query: q }));
  put("movements", "list", (q) => client.request("/movements", { query: q }));
  put("orders", "get", (id, q) => client.request("/orders/" + encodeURIComponent(id), { method: "GET", query: q }));
  put("orders", "list", (q) => client.request("/orders", { query: q }));
  put("partners", "create", (body) => client.request("/partners", { method: "POST", body }));
  put("partners", "list", (q) => client.request("/partners", { query: q }));
  put("products", "create", (body) => client.request("/products", { method: "POST", body }));
  put("products", "list", (q) => client.request("/products", { query: q }));
  put("stockIn", "create", (body) => client.request("/stock-in", { method: "POST", body }));
  put("stockIn", "list", (q) => client.request("/stock-in", { query: q }));
  put("stockIn", "post", (id, q) => client.request("/stock-in/" + encodeURIComponent(id) + "/post", { method: "POST", query: q }));
  put("stockOut", "create", (body) => client.request("/stock-out", { method: "POST", body }));
  put("stockOut", "list", (q) => client.request("/stock-out", { query: q }));
  put("stockOut", "post", (id, q) => client.request("/stock-out/" + encodeURIComponent(id) + "/post", { method: "POST", query: q }));
  put("reports", "stockSummary", (q) => client.request("/reports/stock-summary", { query: q }));
  put("reports", "stockValue", (q) => client.request("/reports/stock-value", { query: q }));
  put("stocktake", "create", (body) => client.request("/stocktake", { method: "POST", body }));
  put("stocktake", "enterCount", (id, items) => client.request("/stocktake/" + encodeURIComponent(id), { method: "PATCH", body: { items } }));
  put("stocktake", "get", (id, q) => client.request("/stocktake/" + encodeURIComponent(id), { method: "GET", query: q }));
  put("stocktake", "settle", (id, q) => client.request("/stocktake/" + encodeURIComponent(id) + "/settle", { method: "POST", query: q }));
  put("transfer", "create", (body) => client.request("/transfer", { method: "POST", body }));
  put("transfer", "get", (id, q) => client.request("/transfer/" + encodeURIComponent(id), { method: "GET", query: q }));
  put("transfer", "receive", (id, body) => client.request("/transfer/" + encodeURIComponent(id) + "/receive", { method: "POST", body }));
  put("transfer", "send", (id, q) => client.request("/transfer/" + encodeURIComponent(id) + "/send", { method: "POST", query: q }));
  put("warehouses", "create", (body) => client.request("/warehouses", { method: "POST", body }));
  put("warehouses", "list", (q) => client.request("/warehouses", { query: q }));
  Object.keys(groups).forEach((k) => {
    const cur = client[k];
    if (cur && typeof cur === "object") {
      Object.keys(groups[k]).forEach((m) => {
        if (typeof cur[m] !== "function") cur[m] = groups[k][m];
      });
    } else if (!cur) {
      client[k] = groups[k];
    }
  });
  return client;
}

// src/index.js
var YunCang = class {
  constructor(options) {
    const core = createClient(options || {});
    Object.assign(this, core);
    attachResources(this);
    attachGenerated(this, core.apiPrefix);
  }
};
function createClient2(options) {
  return new YunCang(options);
}
var index_default = YunCang;

'use strict';
const http = require('node:http');

const WAREHOUSES = [
  {
    id: '1', code: 'SH01', name: '上海一号仓', address: '上海市青浦区', status: 1,
    zones: [{ id: 1, code: 'A', name: 'A 区', locations: [
      { id: 11, code: '01-01', name: '一排一位', boxes: [{ id: 111, code: 'A-01-01-01', status: 1 }, { id: 112, code: 'A-01-01-02', status: 1 }] },
      { id: 12, code: '01-02', name: '一排二位', boxes: [{ id: 121, code: 'A-01-02-01', status: 1 }] },
    ] }],
  },
  { id: '2', code: 'SH02', name: '上海二号仓', address: '上海市嘉定区', status: 1,
    zones: [{ id: 2, code: 'B', name: 'B 区', locations: [
      { id: 21, code: '01-01', name: '一排一位', boxes: [{ id: 211, code: 'B-01-01-01', status: 1 }] },
    ] }] },
];
const PRODUCTS = [
  { id: '38', code: 'SKU-1001', name: '丁腈手套 M', unit: '箱', barcode: '6901001234' },
  { id: '39', code: 'SKU-2087', name: '医用棉签 10cm', unit: '包', barcode: '6902087654' },
  { id: '40', code: 'SKU-3310', name: '医用口罩 50 片', unit: '盒', barcode: '6903310111' },
  { id: '41', code: 'SKU-4512', name: '酒精棉片 100 片', unit: '盒', barcode: '6904512000' },
];
const INVENTORY = [
  { productCode: 'SKU-1001', productName: '丁腈手套 M', warehouseName: '上海一号仓', onHand: 1240, locked: 40, available: 1200, avgCost: 12.5 },
  { productCode: 'SKU-2087', productName: '医用棉签 10cm', warehouseName: '上海一号仓', onHand: 86, locked: 0, available: 86, avgCost: 3.2 },
  { productCode: 'SKU-3310', productName: '医用口罩 50 片', warehouseName: '上海二号仓', onHand: 320, locked: 20, available: 300, avgCost: 22 },
];
const ORDERS = [
  { id: '1', orderNo: 'IN-20261114-001', warehouseName: '上海一号仓', status: 'POSTED', createdAt: '2026-11-14T06:20:00Z' },
  { id: '2', orderNo: 'IN-20261113-007', warehouseName: '上海二号仓', status: 'DRAFT', createdAt: '2026-11-13T09:05:00Z' },
];

const CATALOG_ENDPOINTS = [
  { id: 'me', method: 'GET', path: '/api/v1/open/me' },
  { id: 'products', method: 'GET', path: '/api/v1/open/products' },
  { id: 'warehouses', method: 'GET', path: '/api/v1/open/warehouses' },
  { id: 'inventory', method: 'GET', path: '/api/v1/open/inventory' },
  { id: 'orders', method: 'GET', path: '/api/v1/open/orders' },
  { id: 'order-detail', method: 'GET', path: '/api/v1/open/orders/{id}' },
  { id: 'stock-in', method: 'POST', path: '/api/v1/open/stock-in' },
  { id: 'stock-in-post', method: 'POST', path: '/api/v1/open/stock-in/{id}/post' },
  { id: 'stock-out-post', method: 'POST', path: '/api/v1/open/stock-out/{id}/post' },
  { id: 'transfer-send', method: 'POST', path: '/api/v1/open/transfer/{id}/send' },
  { id: 'transfer-receive', method: 'POST', path: '/api/v1/open/transfer/{id}/receive' },
  { id: 'stocktake-detail', method: 'GET', path: '/api/v1/open/stocktake/{id}' },
  { id: 'stocktake-save', method: 'PATCH', path: '/api/v1/open/stocktake/{id}' },
  { id: 'stocktake-settle', method: 'POST', path: '/api/v1/open/stocktake/{id}/settle' },
];

const DETAIL = {
  id: '1', orderNo: 'IN-20261114-001', status: 'POSTED', warehouseName: '上海一号仓',
  createdAt: '2026-11-14T06:20:00Z', remark: '测试到货',
  items: [
    { id: 11, productCode: 'SKU-1001', productName: '丁腈手套 M', unit: '箱', quantity: 12, costPrice: 12.5 },
    { id: 12, productCode: 'SKU-2087', productName: '医用棉签 10cm', unit: '包', quantity: 40, costPrice: 3.2 },
  ],
};

function start(port, opts) {
  const o = opts || {};
  const withDesktop = o.desktop !== false;
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    const auth = req.headers.authorization || '';
    seen.push({ method: req.method, path: p, query: url.search, idem: req.headers['idempotency-key'] || '', auth });
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const ok = (data) => json(200, { success: true, data });

    if (p === '/slow') { setTimeout(() => ok({ ok: true }), 400); return; }
    if (auth !== 'Bearer yc_live_goodkey_1234567890') return json(401, { success: false, error: 'API 密钥无效或已失效' });

    const kw = (url.searchParams.get('keyword') || '').toLowerCase();
    if (withDesktop) {
      if (p === '/api/v1/desktop/me') return ok({ name: '华东仓作业密钥', keyPrefix: 'yc_live_goodkey', scopes: ['product:read', 'inventory:read', 'warehouse:read', 'stock:read', 'report:read', 'stock:write', 'order:read', 'transfer:write', 'stocktake:write'], warehouseIds: [1, 2], serverTime: new Date().toISOString() });
      if (p === '/api/v1/desktop/catalog') return ok({ endpoints: [], lockedEndpoints: [], scopes: [], summary: { total: 0 } });
      if (p === '/api/v1/desktop/warehouses') return ok({ items: WAREHOUSES, total: WAREHOUSES.length });
      if (p === '/api/v1/desktop/products') {
        const items = PRODUCTS.filter((x) => !kw || x.name.toLowerCase().indexOf(kw) >= 0 || x.code.toLowerCase().indexOf(kw) >= 0);
        return ok({ items, total: items.length, page: 1, pageSize: 20 });
      }
      if (p === '/api/v1/desktop/inventory') {
        const pid = url.searchParams.get('productId');
        const rows = pid
          ? INVENTORY.filter((x) => (pid === '38' && x.productCode === 'SKU-1001') || pid !== '38')
          : INVENTORY;
        return ok({ items: rows, total: rows.length, page: 1, pageSize: 50 });
      }
      if (p === '/api/v1/desktop/orders') return ok({ items: ORDERS, total: ORDERS.length, page: 1, pageSize: 20 });
      if (/^\/api\/v1\/desktop\/orders\/[^/]+$/.test(p)) return ok(DETAIL);
      if (/^\/api\/v1\/desktop\/stock-in\/[^/]+\/post$/.test(p) && req.method === 'POST') return ok({ id: '2', status: 'POSTED' });
      if (/^\/api\/v1\/desktop\/stock-out\/[^/]+\/post$/.test(p) && req.method === 'POST') return ok({ id: '3', status: 'POSTED' });
      if (/^\/api\/v1\/desktop\/transfer\/[^/]+\/(send|receive)$/.test(p) && req.method === 'POST') return ok({ ok: true });
      if (/^\/api\/v1\/desktop\/stocktake\/[^/]+$/.test(p)) {
        if (req.method === 'GET') return ok({ id: '9', orderNo: 'ST-20261114-001', status: 'DRAFT', warehouseName: '上海一号仓', items: [
          { id: 91, code: 'SKU-1001', name: '丁腈手套 M', unit: '箱', bookQty: 1240, countQty: null, diffQty: null },
          { id: 92, code: 'SKU-2087', name: '医用棉签 10cm', unit: '包', bookQty: 86, countQty: null, diffQty: null },
        ] });
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          seen.push({ method: 'PATCH', path: p, query: url.search, body, idem: req.headers['idempotency-key'] || '', auth });
          ok({ saved: 2 });
        });
        return;
      }
      if (/^\/api\/v1\/desktop\/stocktake\/[^/]+\/settle$/.test(p) && req.method === 'POST') return ok({ status: 'ADJUSTED' });
      if (p === '/api/v1/desktop/stock-in' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          // remark=FAIL 用来触发「服务端 5xx → 存草稿」这条路径
          if (parsed.remark === 'FAIL') return json(503, { success: false, error: '服务端暂时不可用' });
          return ok({ orderNo: 'IN-20261114-002', status: parsed.autoPost ? 'POSTED' : 'DRAFT', id: '2' });
        });
        return;
      }
      if (p === '/api/v1/desktop/stock-out' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => ok({ orderNo: 'OUT-20261114-001', status: 'POSTED' }));
        return;
      }
      if (p === '/api/v1/desktop/transfer' && req.method === 'POST') return ok({ orderNo: 'TR-20261114-001', status: 'PENDING' });
      if (p === '/api/v1/desktop/stocktake' && req.method === 'POST') return ok({ orderNo: 'ST-20261114-001', status: 'DRAFT' });
    }

    if (p === '/api/v1/open/me') return ok({ name: '开放接口密钥', keyPrefix: 'yc_live_goodkey', scopes: ['inventory:read', 'product:read', 'stock:write'], warehouseIds: [1, 2], serverTime: new Date().toISOString() });
    if (p === '/api/v1/open') return ok({ endpoints: CATALOG_ENDPOINTS, lockedEndpoints: [], scopes: [], summary: { total: CATALOG_ENDPOINTS.length, available: CATALOG_ENDPOINTS.length, forbidden: 0 }, baseUrl: '' });
    if (/^\/api\/v1\/open\/orders\/[^/]+$/.test(p)) return ok(DETAIL);
    if (/^\/api\/v1\/open\/stock-in\/[^/]+\/post$/.test(p) && req.method === 'POST') return ok({ id: '2', status: 'POSTED' });
    if (/^\/api\/v1\/open\/stock-out\/[^/]+\/post$/.test(p) && req.method === 'POST') return ok({ id: '3', status: 'POSTED' });
    if (/^\/api\/v1\/open\/transfer\/[^/]+\/(send|receive)$/.test(p) && req.method === 'POST') return ok({ ok: true });
    if (/^\/api\/v1\/open\/stocktake\/[^/]+\/settle$/.test(p) && req.method === 'POST') return ok({ status: 'ADJUSTED' });
    if (/^\/api\/v1\/open\/stocktake\/[^/]+$/.test(p)) {
      if (req.method === 'GET') return ok({ id: '9', orderNo: 'ST-20261114-001', status: 'DRAFT', warehouseName: '上海一号仓', items: [
        { id: 91, code: 'SKU-1001', name: '丁腈手套 M', unit: '箱', bookQty: 1240, countQty: null, diffQty: null },
        { id: 92, code: 'SKU-2087', name: '医用棉签 10cm', unit: '包', bookQty: 86, countQty: null, diffQty: null },
      ] });
      return ok({ saved: 1 });
    }
    if (p === '/api/v1/open/warehouses') return ok({ items: WAREHOUSES, total: 2 });
    if (p === '/api/v1/open/products') return ok({ items: PRODUCTS, total: PRODUCTS.length });
    if (p === '/api/v1/open/inventory') return ok({ items: INVENTORY, total: INVENTORY.length });
    if (p === '/api/v1/open/orders') return ok({ items: ORDERS, total: ORDERS.length });
    if (p === '/api/v1/open/stock-in' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => ok({ orderNo: 'IN-2', status: 'DRAFT', idem: req.headers['idempotency-key'] || '' }));
      return;
    }
    if (p === '/denied') return json(403, { success: false, error: '该 API 密钥没有 transfer:write 权限' });
    if (p === '/boom') return json(500, { success: false, error: '内部错误' });
    return json(404, { success: false, error: 'not found' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, seen })));
}

module.exports = { start, CATALOG_ENDPOINTS, DETAIL };

'use strict';

/**
 * 内置接口目录兜底
 *
 * 云仓 1.3.8 起有 GET /api/v1/open 自描述清单，正常联网时界面菜单全部来自服务端，
 * 版本升级后菜单自动跟着变。只有在拿不到清单（老版本、断网、清单接口 5xx）时，
 * 才用这份最小目录把主要作业顶上来，保证还能干活。
 */

const pagination = [
  { name: 'page', in: 'query', type: 'number', desc: '页码，默认 1' },
  { name: 'pageSize', in: 'query', type: 'number', desc: '每页条数，默认 100，最大 500' },
];

const ENDPOINTS = [
  { id: 'me', method: 'GET', path: '/api/v1/open/me', scope: null, title: '密钥自检', desc: '确认这把密钥的名称、权限、仓库范围与限速。' },
  { id: 'products', method: 'GET', path: '/api/v1/open/products', scope: 'product:read', title: '商品主数据', desc: '商品档案与库存摘要，支持增量拉取。', params: pagination.concat([{ name: 'keyword', in: 'query', type: 'string', desc: '名称或编码模糊搜索' }]) },
  { id: 'inventory', method: 'GET', path: '/api/v1/open/inventory', scope: 'inventory:read', title: '实时库存', desc: '各仓库各商品的结存快照。', params: pagination.concat([{ name: 'warehouseId', in: 'query', type: 'number', desc: '按仓库过滤' }, { name: 'productId', in: 'query', type: 'number', desc: '按商品过滤' }]) },
  { id: 'warehouses', method: 'GET', path: '/api/v1/open/warehouses', scope: 'warehouse:read', title: '仓库与货位', desc: '仓库列表，可选带库区货位。', params: pagination.concat([{ name: 'withLocations', in: 'query', type: '1 | 0', desc: '是否返回库区货位' }]) },
  { id: 'movements', method: 'GET', path: '/api/v1/open/movements', scope: 'stock:read', title: '库存流水', desc: '出入库明细流水，按时间倒序。', params: pagination },
  { id: 'orders', method: 'GET', path: '/api/v1/open/orders', scope: 'order:read', title: '单据查询', desc: '入库/出库/调拨/盘点单据。', params: pagination.concat([{ name: 'type', in: 'query', type: 'inbound | outbound | transfer | stocktake', desc: '单据类型' }]) },
  { id: 'low-stock', method: 'GET', path: '/api/v1/open/reports/low-stock', scope: 'report:read', title: '低库存清单', desc: '低于安全库存的商品，按缺口降序。', params: pagination },
  { id: 'stock-value', method: 'GET', path: '/api/v1/open/reports/stock-value', scope: 'report:read', title: '库存金额汇总', desc: '按仓库汇总数量与金额。', params: pagination },
  { id: 'stock-in', method: 'POST', path: '/api/v1/open/stock-in', scope: 'stock:write', title: '创建入库单', desc: '外部下达入库，autoPost=true 立即过账。', params: [{ name: 'warehouseId', in: 'body', type: 'number', required: true, desc: '入库仓库' }, { name: 'type', in: 'body', type: 'string', desc: 'PURCHASE | RETURN | OTHER' }, { name: 'autoPost', in: 'body', type: 'boolean', desc: '是否立即过账' }, { name: 'items', in: 'body', type: 'json', required: true, desc: '[{ productId, quantity, costPrice? }]' }] },
  { id: 'stock-out', method: 'POST', path: '/api/v1/open/stock-out', scope: 'stock:write', title: '创建出库单', desc: '外部下达出库，库存不足时保留草稿。', params: [{ name: 'warehouseId', in: 'body', type: 'number', required: true, desc: '出库仓库' }, { name: 'type', in: 'body', type: 'string', desc: 'SALE | OTHER' }, { name: 'autoPost', in: 'body', type: 'boolean', desc: '是否立即过账' }, { name: 'items', in: 'body', type: 'json', required: true, desc: '[{ productId, quantity }]' }] },
  { id: 'transfer', method: 'POST', path: '/api/v1/open/transfer', scope: 'transfer:write', title: '创建调拨单', desc: '仓库间调拨，两端都需在授权范围内。', params: [{ name: 'fromWarehouseId', in: 'body', type: 'number', desc: '调出仓库' }, { name: 'toWarehouseId', in: 'body', type: 'number', desc: '调入仓库' }, { name: 'items', in: 'body', type: 'json', desc: '[{ productId, quantity }]' }] },
  { id: 'stocktake', method: 'POST', path: '/api/v1/open/stocktake', scope: 'stocktake:write', title: '创建盘点单', desc: '建盘点单并录入实盘。', params: [{ name: 'warehouseId', in: 'body', type: 'number', desc: '盘点仓库' }, { name: 'items', in: 'body', type: 'json', desc: '[{ productId }]（countedQty 暂不生效，实盘请在系统内录入）' }] },
];

const SCOPES = [
  { value: 'product:read', label: '商品与基础资料', group: '基础数据' },
  { value: 'partner:read', label: '往来单位', group: '基础数据' },
  { value: 'warehouse:read', label: '仓库与货位', group: '仓储' },
  { value: 'inventory:read', label: '实时库存', group: '库存' },
  { value: 'lot:read', label: '批次与效期', group: '库存' },
  { value: 'stock:read', label: '库存流水', group: '库存' },
  { value: 'order:read', label: '单据查询', group: '单据' },
  { value: 'stock:write', label: '出入库写入', group: '写入' },
  { value: 'transfer:write', label: '调拨写入', group: '写入' },
  { value: 'stocktake:write', label: '盘点写入', group: '写入' },
  { value: 'report:read', label: '报表分析', group: '分析' },
];

function buildCatalog(scopes) {
  const has = function (s) { return !s || scopes.indexOf(s) >= 0; };
  const available = [];
  const locked = [];
  for (const ep of ENDPOINTS) {
    if (has(ep.scope)) available.push(ep);
    else locked.push({ path: ep.path, method: ep.method, title: ep.title, desc: ep.desc, missingScope: ep.scope });
  }
  return { available, locked, scopes: SCOPES, source: 'builtin' };
}

module.exports = { ENDPOINTS, SCOPES, buildCatalog };

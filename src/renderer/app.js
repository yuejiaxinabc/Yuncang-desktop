(function () {
  'use strict';

  var api = window.cw || demoApi();

  var S = {
    view: 'boot',
    status: null, session: null, profile: null, me: null,
    catalog: null,
    invalid: '',
    data: { warehouses: [], locations: {}, warehousesAt: 0, productCache: {}, orders: [], ordersType: 'inbound', ordersPage: 1, ordersTotal: 0, invPage: 1, invRows: [], invTotal: 0, lowStock: [] },
    form: { lines: [], warehouseId: '', toWarehouseId: '', type: '', autoPost: true, remark: '', keyword: '' },
    orders: { status: '', from: '', to: '', keyword: '', selected: {}, busy: false, msg: '', msgOk: true },
    drafts: { items: [], busy: false, msg: '', msgOk: true },
    prefs: { printHeader: '云仓', printFooter: '云仓 · 开源仓储管理系统', operator: '' },
    submit: { busy: false, result: null, error: '', idemKey: '' },
    prodOpen: false, prodBusy: false, prodMsg: '', prodMsgOk: true, prodForm: {},
    update: { checking: false, info: null, pct: 0, busy: false, error: '' },
    count: null,
    setup: { baseUrl: '', token: '', testing: false, error: '', tested: null },
    mode: 'private',
    ent: { platformUrl: 'http://119.45.146.101', account: '', password: '', captchaToken: '', captchaImage: '', answer: '', busy: false, error: '', tenant: null },
    settings: { baseUrl: '', token: '', saving: false, testing: false, error: '', tested: null },
    toastT: null,
  };

  function q(sel, root) { return (root || document).querySelector(sel); }
  function esc(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function toast(msg, isErr) {
    var t = q('#toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' error' : '');
    clearTimeout(S.toastT);
    S.toastT = setTimeout(function () { t.className = 'toast'; }, 3400);
  }
  function isEnt() { return S.mode === 'enterprise'; }
  // 服务端可能只有 /api/v1/open（还没上桌面专用接口），所有数据请求都要跟着探测结果走
  var API_FALLBACK = '/api/v1/open';
  function apiBase() { return (S.profile && S.profile.base) || API_FALLBACK; }
  function apiPath(p) { return apiBase() + (p.charAt(0) === '/' ? p : '/' + p); }
  function isMissing(r) { return r && (r.code === 'NOT_FOUND' || r.status === 404); }
  function scopes() { return (S.me && S.me.scopes) || []; }
  function can(scope) {
    if (!scope) return true;
    var list = scopes();
    if (list.indexOf('*') >= 0) return true;
    return list.indexOf(scope) >= 0;
  }
  // 作业页还需要仓库与商品两个只读权限，否则选不到仓、搜不到商品
  function jobLockReason(scope) {
    // 企业版平台目前只开放了主数据/库存查询，作业类接口还没上（服务端 404「未实现的接口」）
    if (isEnt() && /:(write)$/.test(String(scope || ''))) return '企业版未开放';
    if (!can(scope)) return '未开通';
    // 只有「写作业」才需要仓库/商品这两个只读前置；纯查询页各自判自己的 scope
    if (/:write$/.test(String(scope || ''))) {
      if (!can('warehouse:read')) return '缺仓库权限';
      if (!can('product:read')) return '缺商品权限';
    }
    return '';
  }
  /**
   * 服务端能力探测：开放接口清单（GET /api/v1/open）里有的才能点。
   * 清单没取到时一律放行（老服务端 / 兜底目录），避免误把所有功能锁死。
   */
  function capKey(method, pathname) {
    return String(method || 'GET').toUpperCase() + ' ' + String(pathname || '').replace(/\{[^}]+\}/g, ':id');
  }
  function hasEp(method, pathname) {
    var keys = S.catalog && S.catalog.keys;
    if (!keys || !keys.available || !keys.available.length) return true;
    var k = capKey(method, pathname);
    if (keys.available.indexOf(k) >= 0) return true;
    // 清单里没有的才算缺；锁定清单里有 = 有接口但缺权限，交给 scope 判断
    return false;
  }
  function epLockedByScope(method, pathname) {
    var keys = S.catalog && S.catalog.keys;
    if (!keys || !keys.locked) return false;
    return keys.locked.indexOf(capKey(method, pathname)) >= 0;
  }
  // 0.5.8 起依赖的接口；缺哪个就把对应按钮禁掉，并说明服务端要升级
  var CAPS = [
    { key: 'order-detail', method: 'GET', path: '/api/v1/open/orders/:id', label: '单据详情', feature: '单据查看' },
    { key: 'inbound-post', method: 'POST', path: '/api/v1/open/stock-in/:id/post', label: '入库过账', feature: '草稿过账' },
    { key: 'outbound-post', method: 'POST', path: '/api/v1/open/stock-out/:id/post', label: '出库过账', feature: '草稿过账' },
    { key: 'transfer-send', method: 'POST', path: '/api/v1/open/transfer/:id/send', label: '调拨发运', feature: '调拨发运' },
    { key: 'transfer-receive', method: 'POST', path: '/api/v1/open/transfer/:id/receive', label: '调拨收货', feature: '调拨收货' },
    { key: 'stocktake-detail', method: 'GET', path: '/api/v1/open/stocktake/:id', label: '盘点明细', feature: '盘点录入' },
    { key: 'stocktake-save', method: 'PATCH', path: '/api/v1/open/stocktake/:id', label: '保存实盘', feature: '盘点录入' },
    { key: 'stocktake-settle', method: 'POST', path: '/api/v1/open/stocktake/:id/settle', label: '盘点结算', feature: '盘点结算' }
  ];
  function missingCaps() {
    var keys = S.catalog && S.catalog.keys;
    if (!keys || !keys.available || !keys.available.length) return [];
    return CAPS.filter(function (c) { return keys.available.indexOf(capKey(c.method, c.path)) < 0; });
  }
  function capReady(method, pathname) { return hasEp(method, pathname); }
  function capGate(method, pathname, label) {
    if (capReady(method, pathname)) return '';
    return '服务端还没有「' + label + '」接口（需云仓 1.4.7 及以上），先升级服务端再试';
  }
  function scopeLabel(scope) {
    var m = {
      'stock:write': '出入库', 'transfer:write': '调拨', 'stocktake:write': '盘点',
      'inventory:read': '库存查询', 'order:read': '单据查询', 'report:read': '报表', 'product:read': '商品资料',
      'warehouse:read': '仓库资料', 'stock:read': '库存流水', 'lot:read': '批次效期', 'partner:read': '往来单位',
      'product:write': '商品维护'
    };
    return m[scope] || scope;
  }

  // ---------------- 演示数据（浏览器直接打开时用） ----------------
  function demoApi() {
    var me = { name: '华东仓作业密钥', keyPrefix: 'yc_live_demo', scopes: ['product:read','inventory:read','warehouse:read','stock:read','report:read','stock:write'], warehouseIds: [1,2], serverTime: new Date().toISOString() };
    var warehouses = [{ id: '1', code: 'SH01', name: '上海一号仓' }, { id: '2', code: 'SH02', name: '上海二号仓' }];
    var products = [
      { id: '38', code: 'SKU-1001', name: '丁腈手套 M', unit: '箱', barcode: '6901001' },
      { id: '39', code: 'SKU-2087', name: '医用棉签 10cm', unit: '包', barcode: '6902087' },
      { id: '40', code: 'SKU-3310', name: '医用口罩 50片', unit: '盒', barcode: '6903310' }
    ];
    var data = function (d) { return Promise.resolve({ ok: true, status: 200, data: d, meta: { status: 200, elapsedMs: 32 } }); };
    return {
      app: { info: function () { return Promise.resolve({ version: '0.4.0' }); }, uninstall: function () { return Promise.resolve({ ok: true }); } },
      config: {
        status: function () { return Promise.resolve({ configured: true, source: 'saved', baseUrl: 'https://yc.example.com', tokenMasked: 'yc_live_de…9f2a', encrypted: true, configFile: 'C:\\Users\\Administrator\\AppData\\Roaming\\云仓\\config.json', presetFile: '', apiProfile: 'desktop', version: '0.4.0', error: '' }); },
        test: function () { return Promise.resolve({ ok: true, profile: 'desktop', profileName: '桌面专用接口', me: me }); },
        save: function () { return Promise.resolve({ ok: true, saved: true, encrypted: true }); },
        clear: function () { return Promise.resolve({ ok: true }); },
        reveal: function () { return Promise.resolve({ ok: true, path: '' }); }
      },
      session: { connect: function () { return Promise.resolve({ ok: true, profile: { id: 'desktop', name: '桌面专用接口' }, me: me, catalog: { available: [], locked: [], scopes: [], source: 'server' }, warnings: [] }); } },
      api: {
        call: function (p) {
          if (p.path.indexOf('/warehouses') >= 0) return data({ items: warehouses, total: 2 });
          if (p.path.indexOf('/products') >= 0) {
            var kw = (p.query && p.query.keyword) || '';
            return data({ items: products.filter(function (x) { return !kw || x.name.indexOf(kw) >= 0 || x.code.indexOf(kw) >= 0; }), total: 3 });
          }
          if (p.path.indexOf('/inventory') >= 0) return data({ items: [{ productCode: 'SKU-1001', productName: '丁腈手套 M', warehouseName: '上海一号仓', onHand: 1240, locked: 40, available: 1200 }], total: 1 });
          if (p.path.indexOf('/orders') >= 0) return data({ items: [{ orderNo: 'IN-20261114-001', warehouse: '上海一号仓', status: 'POSTED', createdAt: '2026-11-14T06:20:00Z' }], total: 1 });
          if (p.method === 'POST') return data({ orderNo: 'IN-20261114-002', status: p.body && p.body.autoPost ? 'POSTED' : 'DRAFT' });
          return data({});
        }
      }
    };
  }

  // ---------------- 数据层：进页面自动查，不让人填接口 ----------------
  var loading = { warehouses: false };
  function apiOk(r) {
    if (!r) return false;
    if (r.code === 'KEY_INVALID') { S.invalid = r.error || '密钥已失效'; go('settings'); return false; }
    if (isMissing(r)) { toast('服务器没有这个接口（' + apiBase() + '），可能是云仓版本较旧或缺该模块', true); return false; }
    if (r.code === 'SCOPE_DENIED') { S.data.denied = r.error || '权限不足'; return false; }
    return true;
  }

  async function loadWarehouses(force) {
    if (!force && S.data.warehouses.length && Date.now() - S.data.warehousesAt < 120000) return S.data.warehouses;
    if (loading.warehouses) return S.data.warehouses;
    loading.warehouses = true;
    try {
      var path = isEnt() ? '/api/app/warehouses' : apiPath('/warehouses');
      var r = await api.api.call({ path: path, method: 'GET', query: isEnt() ? {} : { page: 1, pageSize: 200, withLocations: 1 } });
      if (!apiOk(r)) { S.data.warehouseError = (r && r.error) || '仓库清单读取失败'; return []; }
      S.data.warehouseError = '';
      var items = (r.data && (r.data.items || r.data)) || [];
      S.data.warehouses = (Array.isArray(items) ? items : []).map(function (w) { return { id: String(w.id), code: w.code || '', name: w.name || '', status: w.status }; });
      // 货位：zones[].locations[].boxes[] 摊平成四段（货架-排-列-位），供入库时选放置位置
      S.data.locations = {};
      S.data.boxes = {};
      S.data.boxStats = {};
      (Array.isArray(items) ? items : []).forEach(function (w) {
        var flat = [];
        (w.zones || []).forEach(function (z) {
          (z.locations || []).forEach(function (l) {
            var zcode = String(z.code || z.name || '').trim();
            var lcode = String(l.code || '').trim();
            // 小货位 code 通常是「排-列-位」三段，前面补货架段才是完整坐标
            var full = zcode && lcode.indexOf(zcode + '-') !== 0 ? (zcode + '-' + lcode) : lcode;
            flat.push({ id: String(l.id), code: lcode, full: full, name: l.name || '', zone: zcode });
          });
        });
        S.data.locations[String(w.id)] = flat;

        // 四段小货位。服务端可能在三个层级任一位置下发 boxes：
        //   warehouse.boxes[] / zone.boxes[] / zone.locations[].boxes[]
        // 编码可能是完整四段（A-01-01-01），也可能只给末段（01），按所在层级补齐。
        var boxes = [];
        var seen = {};
        function pushBox(b, zcode, lcode) {
          if (!b) return;
          var raw = String(b.code || b.boxCode || '').trim();
          var id = b.id === undefined || b.id === null ? '' : String(b.id);
          if (!id && !raw) return;
          var four;
          if (/^[A-Za-z0-9]+-\d+-\d+-\d+$/.test(raw)) four = raw;
          else if (zcode && lcode && raw) four = zcode + '-' + lcode + '-' + raw;
          else if (zcode && raw) four = zcode + '-' + raw;
          else four = raw;
          var key = id || four;
          if (seen[key]) return;
          seen[key] = 1;
          boxes.push({ id: id, code: four, zone: zcode || '', location: lcode || '', status: b.status === undefined ? 1 : b.status });
        }
        var zoneCount = 0, locCount = 0;
        (w.boxes || []).forEach(function (b) { pushBox(b, '', ''); });
        (w.zones || []).forEach(function (z) {
          zoneCount++;
          var zcode = String(z.code || z.name || '').trim();
          (z.boxes || []).forEach(function (b) { pushBox(b, zcode, ''); });
          (z.locations || []).forEach(function (l) {
            locCount++;
            var lcode = String(l.code || '').trim();
            (l.boxes || []).forEach(function (b) { pushBox(b, zcode, lcode); });
          });
        });
        S.data.boxes[String(w.id)] = boxes;
        S.data.boxStats[String(w.id)] = { zones: zoneCount, locations: locCount, boxes: boxes.length, rawZones: (w.zones || []).length };
      });
      S.data.warehousesAt = Date.now();
    } catch (e) {
      S.data.warehouses = [];
    } finally {
      loading.warehouses = false;
    }
    return S.data.warehouses;
  }

  var productCache = {};
  async function searchProducts(keyword) {
    var kw = String(keyword || '').trim();
    if (kw.length < 2) return [];
    if (productCache[kw] && Date.now() - productCache[kw].at < 300000) return productCache[kw].list;
    var r = await api.api.call({ path: isEnt() ? '/api/app/products' : apiPath('/products'), method: 'GET', query: { keyword: kw, page: 1, pageSize: 20 } });
    if (!apiOk(r)) return [];
    var items = (r.data && (r.data.items || r.data)) || [];
    var list = (Array.isArray(items) ? items : []).map(function (p) {
      // 企业版商品的编码字段叫 sku，单位只给 unitId，名称/条码同名
      return { id: String(p.id), code: p.code || p.sku || '', name: p.name || '', unit: p.unit || '', barcode: p.barcode || '' };
    });
    productCache[kw] = { at: Date.now(), list: list };
    return list;
  }



  // ---------------- 外壳 ----------------
  function loadingHtml() {
    return '<div class="boot-splash"><div>' + logoHero() + '<div class="t">正在连接云仓…</div></div></div>';
  }
  function logoHero() {
    return '<div class="logo-hero"><img src="assets/logo.png" alt="云仓" /><div class="shine"></div></div>';
  }

  var NAV = [
    { group: '作业', items: [
      { id: 'inbound', name: '入库作业', icon: '↓', scope: 'stock:write' },
      { id: 'outbound', name: '出库作业', icon: '↑', scope: 'stock:write' },
      { id: 'transfer', name: '仓库调拨', icon: '⇄', scope: 'transfer:write' },
      { id: 'stocktake', name: '仓库盘点', icon: '✓', scope: 'stocktake:write' }
    ]},
    { group: '查询', items: [
      { id: 'inventory', name: '库存查询', icon: '▤', scope: 'inventory:read' },
      { id: 'orders', name: '单据记录', icon: '≡', scope: 'order:read' },
      { id: 'products', name: '商品档案', icon: '▦', scope: 'product:read' }
    ]},
    { group: '系统', items: [
      { id: 'settings', name: '设置', icon: '⚙', scope: null }
    ]}
  ];

  function navHtml() {
    var html = '<div class="nav-group">' +
      '<button class="nav-item' + (S.view === 'workbench' ? ' active' : '') + '" data-nav="workbench"><span class="ico">◆</span><span>工作台</span></button>' +
      '</div>';
    var ENT_LOCKED = { inbound: 1, outbound: 1, transfer: 1, stocktake: 1, orders: 1 };
    NAV.forEach(function (g) {
      html += '<div class="nav-group"><div class="nav-label">' + esc(g.group) + '</div>';
      g.items.forEach(function (it) {
        var reason = it.scope ? jobLockReason(it.scope) : '';
        if (isEnt() && ENT_LOCKED[it.id]) reason = '企业版未开放';
        var locked = !!reason;
        var active = S.view === it.id;
        html += '<button class="nav-item' + (active ? ' active' : '') + (locked ? ' locked' : '') + '"' +
          (locked ? ' data-locked="' + esc(reason) + '"' : ' data-nav="' + it.id + '"') + '>' +
          '<span class="ico">' + it.icon + '</span><span>' + esc(it.name) + '</span>' +
          (locked ? '<span class="tail">' + esc(reason) + '</span>' : '') +
          '</button>';
      });
      html += '</div>';
    });
    return html;
  }

  function viewTitle() {
    var map = { workbench: ['工作台', '今天要做的事'], inbound: ['入库作业', '收货上架，一次一单'], outbound: ['出库作业', '拣货出库，库存不足会拦下'], transfer: ['仓库调拨', '仓与仓之间的移动'], stocktake: ['仓库盘点', '整仓全盘，或按商品抽盘'], inventory: ['库存查询', '按商品或仓库查结存'], orders: ['单据记录', '入库 / 出库 / 调拨 / 盘点'], products: ['商品档案', '新增、导入、导出商品主数据'], settings: ['设置', '服务器地址与密钥'] };
    return map[S.view] || ['云仓', ''];
  }

  function shellHtml(content) {
    var t = viewTitle();
    var online = !!(S.session && S.session.ok);
    var status = S.status || {};
    return '<div class="shell">' +
      '<aside class="sidebar">' +
        '<div class="brand"><div class="brand-logo tile"><img src="assets/logo-mark.png" alt="" /></div><div><div class="brand-name">云仓</div><div class="brand-sub">YUNCANG</div></div></div>' +
        navHtml() +
        '<div class="sidebar-foot">' +
          '<div class="conn-pill ' + (online ? 'online' : 'offline') + '"><span class="dot"></span>' +
            '<div style="min-width:0"><div>' + (online ? (S.me && S.me.name ? esc(S.me.name) : '已连接') : '未连接') + '</div>' +
            '<div class="host">' + esc(status.baseUrl || '') + '</div></div></div>' +
          '<div class="foot-actions"><button class="btn sm ghost" data-action="reload">重连</button>' +
          '<button class="btn sm ghost" data-nav="settings">设置</button></div>' +
          '<div class="foot-version"><span>v' + esc(status.version || '0.5.9') + (status.sdkVersion ? ' · SDK ' + esc(status.sdkVersion) : '') + '</span><span>' + esc(Array.isArray(S.me && S.me.warehouseIds) ? ('仓库 ' + S.me.warehouseIds.length + ' 个') : '仓库 全部') + '</span></div>' +
        '</div>' +
      '</aside>' +
      '<main class="main">' +
        '<header class="topbar"><div><div class="view-title">' + esc(t[0]) + '</div><div class="view-sub">' + esc(t[1]) + '</div></div>' +
        '<div class="top-actions"><button class="btn sm" data-action="reload">刷新</button></div></header>' +
        '<div class="content"><div class="wrap">' + content + '</div></div>' +
      '</main></div>';
  }

  // ---------------- 工作台 ----------------
  function workbenchHtml() {
    var me = S.me || {};
    var whs = S.data.warehouses;
    var recent = S.data.orders || [];
    var html = '';
    if (S.invalid) {
      html += '<div class="banner danger"><div style="flex:1"><b>密钥已失效。</b>' + esc(S.invalid) + '</div>' +
        '<button class="btn sm" data-nav="settings">去更换密钥</button></div>';
    }
    if (S.data.warehouseError) {
      html += '<div class="banner warn"><div style="flex:1"><b>仓库清单没读到：</b>' + esc(S.data.warehouseError) + '</div></div>';
    }
    if (isEnt()) {
      var t = (S.ent && S.ent.tenant) || {};
      html += '<div class="banner info"><div style="flex:1"><b>企业版。</b>' +
        esc((t.name || '当前企业') + (t.code ? '（' + t.code + '）' : '')) + ' · 数据经云仓 SDK 走平台接口；' +
        '入库/出库/调拨/盘点的平台接口未上线，作业入口已置灰。</div></div>';
    }
    var missing = missingCaps();
    if (missing.length) {
      var feats = [];
      missing.forEach(function (m) { if (feats.indexOf(m.feature) < 0) feats.push(m.feature); });
      html += '<div class="banner warn"><div style="flex:1"><b>服务端版本偏旧。</b>' + esc(feats.join(' / ')) + ' 需要的开放接口还没上线，相关按钮会置灰；升级服务端到 1.4.7 及以上即恢复。</div>' +
        '<button class="btn sm ghost" data-nav="settings">查看诊断</button></div>';
    }
    if (S.drafts.items.length) {
      html += '<div class="banner info"><div style="flex:1"><b>草稿箱里还有 ' + S.drafts.items.length + ' 单没提交成功。</b>网络恢复后可以直接重放，幂等键不变，不会重复入账。</div>' +
        '<button class="btn sm" data-action="draft-replay-all"' + (S.drafts.busy ? ' disabled' : '') + '>' + (S.drafts.busy ? '重放中…' : '全部重放') + '</button></div>';
    }
    html += '<div class="grid-4">' +
      stat(isEnt() ? '企业' : '仓库', isEnt() ? ((S.ent.tenant && S.ent.tenant.code) || '—') : (whs.length ? String(whs.length) + ' 个' : (S.data.warehouseError ? '读取失败' : '加载中')), isEnt() ? ((S.ent.tenant && S.ent.tenant.name) || '') : (whs.length ? whs.map(function (w) { return w.name; }).slice(0, 3).join(' / ') : '正在读取仓库清单')) +
      stat('作业权限', String(scopes().length) + ' 项', can('stock:write') ? '可入库出库' : '仅查询') +
      stat('今日单据', String(recent.length ? recent.length : '—'), recent.length ? '最近更新时间 ' + new Date().toLocaleTimeString('zh-CN') : '打开单据记录查看') +
      stat('服务器', '已连接', (S.status && S.status.baseUrl) || '') +
      '</div>';

    html += '<div class="section"><div class="section-head"><h3>开始作业</h3><span class="hint">点进去就是表单，仓库和商品自动带出来</span></div>' +
      '<div class="grid-4">' +
      jobCard('inbound', '入库', '收货、上架、补库存', 'stock:write') +
      jobCard('outbound', '出库', '拣货、发货、领用', 'stock:write') +
      jobCard('transfer', '调拨', '仓到仓转移', 'transfer:write') +
      jobCard('stocktake', '盘点', '整仓全盘或抽盘', 'stocktake:write') +
      '</div></div>';

    html += '<div class="section"><div class="section-head"><h3>最近单据</h3><span class="hint">自动加载最新 5 条</span></div>' +
      '<div class="card flat" id="recent-box">' + (S.data.ordersError ? '<div class="banner warn" style="margin:0"><div>' + esc(S.data.ordersError) + '</div></div>' : recentHtml()) + '</div></div>';

    if (S.drafts.items.length || S.drafts.msg) html += draftsCardHtml();
    return html;
  }

  function stat(title, value, note) {
    return '<div class="card stat"><h4>' + esc(title) + '</h4><div class="v">' + esc(value) + '</div><div class="n">' + esc(note) + '</div></div>';
  }
  function jobCard(id, name, desc, scope) {
    var reason = jobLockReason(scope);
    var locked = !!reason;
    return '<button class="card job-card' + (locked ? ' locked' : '') + '"' + (locked ? ' data-locked="' + esc(reason) + '"' : ' data-nav="' + id + '"') + '>' +
      '<div class="job-card-head"><span class="job-name">' + esc(name) + '</span>' + (locked ? '<span class="chip dim">' + esc(reason) + '</span>' : '<span class="chip dim">开始</span>') + '</div>' +
      '<div class="hint" style="line-height:1.6;margin-top:6px">' + esc(desc) + '</div></button>';
  }
  function recentHtml() {
    var rows = S.data.orders || [];
    if (!rows.length) return '<div class="empty">还没有单据记录</div>';
    return '<div class="table-wrap" style="margin:0"><table><thead><tr><th>单号</th><th>仓库</th><th>状态</th><th>时间</th></tr></thead><tbody>' +
      rows.slice(0, 5).map(function (r) {
        return '<tr><td class="mono">' + esc(r.orderNo || r.id || '—') + '</td><td>' + esc(r.warehouseName || r.warehouse || '—') + '</td>' +
          '<td>' + statusChip(r.status) + '</td><td>' + esc(fmtTime(r.createdAt)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  // ---------------- 草稿箱（断网没提交成功的作业） ----------------
  function draftsCardHtml() {
    var items = S.drafts.items || [];
    var body = '<div class="section"><div class="section-head"><h3>草稿箱</h3><span class="hint">' +
      (items.length ? '提交失败时自动存下，重放沿用原幂等键' : '暂时没有待重放的作业') + '</span></div>';
    if (S.drafts.msg) body += '<div class="banner ' + (S.drafts.msgOk ? 'info' : 'warn') + '" style="margin-bottom:10px"><div>' + esc(S.drafts.msg) + '</div></div>';
    if (!items.length) return body + '</div>';
    body += '<div class="card flat"><div class="table-wrap" style="margin:0"><table><thead><tr>' +
      '<th>类型</th><th>内容</th><th>失败原因</th><th>时间</th><th style="width:170px">操作</th></tr></thead><tbody>' +
      items.map(function (d) {
        return '<tr><td>' + esc(d.label || d.kind) + '</td>' +
          '<td class="mono" style="font-size:12px">' + esc(draftSummary(d)) + '</td>' +
          '<td>' + esc(d.lastError || '—') + (d.attempts ? '（试过 ' + esc(d.attempts) + ' 次）' : '') + '</td>' +
          '<td>' + esc(fmtTime(d.updatedAt || d.createdAt)) + '</td>' +
          '<td><button class="btn sm" data-action="draft-replay" data-id="' + esc(d.id) + '"' + (S.drafts.busy ? ' disabled' : '') + '>重放</button> ' +
          '<button class="btn sm ghost" data-action="draft-drop" data-id="' + esc(d.id) + '">删除</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="run-bar"><button class="btn primary" data-action="draft-replay-all"' + (S.drafts.busy ? ' disabled' : '') + '>全部重放</button>' +
      '<button class="btn ghost" data-action="draft-clear">清空草稿箱</button>' +
      '<span class="hint">重放会照原样再发一次；服务端 24 小时内认同一个幂等键，重复点也只落一张单</span></div></div></div>';
    return body;
  }

  function draftSummary(d) {
    var b = d.body || {};
    var n = (b.items && b.items.length) || 0;
    var wh = b.warehouseId || b.fromWhId || '';
    return '仓 ' + wh + (b.toWhId ? ' → ' + b.toWhId : '') + ' · ' + n + ' 行' + (b.remark ? ' · ' + b.remark : '');
  }

  async function loadDrafts() {
    try {
      var r = await api.drafts.list();
      S.drafts.items = (r && r.items) || [];
    } catch (e) {
      S.drafts.items = [];
    }
    return S.drafts.items;
  }

  async function replayDraft(id) {
    var d = (S.drafts.items || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!d) return { ok: false, error: '草稿不存在' };
    S.drafts.busy = true; S.drafts.msg = '正在重放…'; S.drafts.msgOk = true; render();
    var r = await api.api.call({ path: d.path, method: d.method || 'POST', body: d.body || {}, idempotencyKey: d.idempotencyKey || '' });
    S.drafts.busy = false;
    if (r && r.ok) {
      await api.drafts.remove(d.id);
      S.drafts.msg = '重放成功' + ((r.data && r.data.orderNo) ? '：' + r.data.orderNo : '') + '（' + (d.label || d.kind) + '）';
      S.drafts.msgOk = true;
      await loadDrafts();
      if (S.view === 'workbench') refreshRecent();
      render();
      return { ok: true };
    }
    var err = (r && r.error) || '重放失败';
    await api.drafts.touch({ id: d.id, error: err });
    S.drafts.msg = '重放失败：' + err + '（草稿留着，稍后再试）';
    S.drafts.msgOk = false;
    await loadDrafts();
    render();
    return { ok: false, error: err };
  }

  async function replayAllDrafts() {
    var list = (S.drafts.items || []).slice();
    if (!list.length) return toast('草稿箱是空的');
    var ok = 0, fail = 0, lastErr = '';
    for (var i = 0; i < list.length; i++) {
      var one = await replayDraft(list[i].id);
      if (one.ok) ok++; else { fail++; lastErr = one.error || ''; }
    }
    S.drafts.msg = '全部重放完成：成功 ' + ok + ' 单，失败 ' + fail + ' 单' + (fail ? '（' + lastErr + '）' : '');
    S.drafts.msgOk = fail === 0;
    render();
  }

  function statusChip(s) {
    var v = String(s || '').toUpperCase();
    var map = { POSTED: ['已过账', 'ok'], DRAFT: ['草稿', 'dim'], CANCELLED: ['已取消', 'dim'], PENDING: ['待处理', 'dim'], APPROVED: ['已审批', 'ok'], COMPLETED: ['已完成', 'ok'] };
    var hit = map[v] || [s || '—', 'dim'];
    return '<span class="chip ' + hit[1] + '">' + esc(hit[0]) + '</span>';
  }
  function fmtTime(t) {
    if (!t) return '—';
    var d = new Date(t);
    if (isNaN(d.getTime())) return String(t);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // ---------------- 作业页 ----------------
  var JOBS = {
    inbound: { title: '入库作业', endpoint: 'stock-in', from: true, to: false,
      types: [
        { v: 'PURCHASE', t: '采购入库' }, { v: 'RETURN', t: '退货入库' }, { v: 'TRANSFER', t: '调拨入库' },
        { v: 'PRODUCTION', t: '生产入库' }, { v: 'ADJUST', t: '盘盈入库' }, { v: 'OTHER', t: '其他入库' },
      ],
      hint: '收货建单，勾了「直接入账」会立刻加库存；放置货位必须选四段（货架-排-列-位）' },
    outbound: { title: '出库作业', endpoint: 'stock-out', from: true, to: false,
      types: [{ v: 'SALE', t: '销售出库' }, { v: 'PICK', t: '领料出库' }, { v: 'RETURN', t: '退货出库' }, { v: 'TRANSFER', t: '调拨出库' }, { v: 'MAINTAIN', t: '维修出库' }, { v: 'REPLACE', t: '更换出库' }, { v: 'OTHER', t: '其他出库' }],
      hint: '拣货出库，库存不够会被服务端拦下并保留草稿' },
    transfer: { title: '仓库调拨', endpoint: 'transfer', from: true, to: true,
      types: [], hint: '选调出仓与调入仓，商品在两仓之间移动' },
    stocktake: { title: '仓库盘点', endpoint: 'stocktake', from: true, to: false,
      types: [], hint: '不填商品即整仓全盘（系统自动拉该仓有库存的商品）' }
  };

  /**
   * 货位为空的两种完全不同的原因，别混成一句话：
   *  - 仓库本身没库区：去 Web「仓库管理」生成货位；
   *  - 有库区、货位，但服务端没下发小货位（开放接口只给 zones.locations）：
   *    这是服务端缺字段，客户端再怎么点都没用。
   */
  function boxEmptyReason() {
    var id = String(S.form.warehouseId || '');
    var st = (S.data.boxStats || {})[id] || null;
    if (!st) return '仓库信息还没加载完，点右上「刷新」重试';
    if (!st.rawZones) return '这个仓库还没有库区货位：去 Web 端「仓库管理 → 生成货位」或新建仓库';
    if (!st.boxes) {
      return '服务端只返回了 ' + st.zones + ' 个库区 / ' + st.locations + ' 个货位，没有下发四段小货位（boxes）——' +
        '需要在服务端 /api/v1/open/warehouses?withLocations=1 的返回里补上 boxes[]；补好之前入库这一步做不了';
    }
    return '这个仓库还没有四段小货位';
  }

  function jobHtml(kind) {
    var JOB = JOBS[kind];
    if (!JOB) return workbenchHtml();
    var whs = S.data.warehouses;
    var html = '';

    html += '<div class="card">' +
      '<div class="hint" style="margin-bottom:14px">' + esc(JOB.hint) + '</div>' +
      '<div class="form-grid">' +
        selectField('仓库', 'sel-warehouse', whs, S.form.warehouseId, whs.length ? '' : '正在读取仓库…') +
        (JOB.to ? selectField('调入仓库', 'sel-to-warehouse', whs, S.form.toWarehouseId, '') : '') +
        (JOB.types.length ? typeField(JOB.types) : '') +
        (kind !== 'stocktake' ? toggleField('直接入账', 'sel-autopost', S.form.autoPost, '勾上就不留草稿，立刻影响库存') : '') +
        '<div class="field wide"><label>备注</label><input id="inp-remark" placeholder="选填，例如「上午到货」「客户加急」" value="' + esc(S.form.remark) + '" /></div>' +
      '</div>' +
      (kind !== 'stocktake' ? pickerHtml() : '') +
      (kind !== 'stocktake' ? linesHtml(kind) : '<div class="hint" style="margin-top:14px">整仓全盘：提交后系统按该仓库有库存的商品生成盘点单，再逐项录实盘数。</div>') +
      '<div class="run-bar">' +
        '<button class="btn primary" data-action="submit"' + (S.submit.busy ? ' disabled' : '') + '>' + (S.submit.busy ? '提交中…' : '提交' + esc(JOB.title.replace('作业', '')) + '单') + '</button>' +
        '<button class="btn ghost" data-action="reset-form">清空重填</button>' +
        '<span class="hint">提交后按服务端返回的单号与状态展示</span>' +
      '</div>' +
      resultHtml() +
      (kind === 'stocktake' ? countSheetHtml() : '') +
    '</div>';
    return html;
  }

  function selectField(label, id, list, value, placeholder) {
    var opts = '<option value="">' + esc(placeholder || '请选择') + '</option>' +
      list.map(function (w) { return '<option value="' + esc(w.id) + '"' + (String(value) === String(w.id) ? ' selected' : '') + '>' + esc(w.name + (w.code ? '（' + w.code + '）' : '')) + '</option>'; }).join('');
    return '<div class="field"><label>' + esc(label) + '</label><select id="' + id + '">' + opts + '</select></div>';
  }
  function typeField(types) {
    var cur = S.form.type || types[0].v;
    return '<div class="field"><label>类型</label><select id="sel-type">' +
      types.map(function (t) { return '<option value="' + esc(t.v) + '"' + (cur === t.v ? ' selected' : '') + '>' + esc(t.t) + '</option>'; }).join('') +
      '</select></div>';
  }
  function toggleField(label, id, checked, hint) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<label class="switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + ' /><span></span></label>' +
      '<div class="hi">' + esc(hint) + '</div></div>';
  }

  function pickerHtml() {
    return '<div class="picker-wrap">' +
      '<label class="picker-label">加商品</label>' +
      '<div class="picker">' +
        '<input id="inp-picker" autocomplete="off" placeholder="输入商品编码 / 名称 / 条码搜索，回车选中第一条" />' +
        '<div id="picker-list" class="picker-list"></div>' +
      '</div>' +
      '<div class="hint" style="margin-top:6px">搜的是云仓里的真实商品档案，边打边搜</div>' +
    '</div>';
  }

  function linesHtml(kind) {
    var lines = S.form.lines;
    if (!lines.length) return '<div class="empty" style="padding:34px 10px">还没有商品，用上面的搜索框加一条</div>';
    var showLot = kind === 'inbound';
    var showAvail = kind === 'outbound';
    var showLoc = kind === 'inbound';
    var boxes = (S.data.boxes && S.data.boxes[String(S.form.warehouseId)]) || [];
    return '<div class="table-wrap" style="margin-top:14px"><table class="line-table"><thead><tr>' +
      '<th>商品</th><th style="width:120px">编码</th><th style="width:80px">单位</th>' +
      (showAvail ? '<th style="width:90px">可用</th>' : '') +
      (showLot ? '<th style="width:120px">批次</th>' : '') +
      (showLoc ? '<th style="width:190px">放置货位（四段）</th>' : '') +
      '<th style="width:130px">数量</th><th style="width:60px"></th></tr></thead><tbody>' +
      lines.map(function (l, i) {
        return '<tr>' +
          '<td>' + esc(l.name) + '</td>' +
          '<td class="mono">' + esc(l.code) + '</td>' +
          '<td>' + esc(l.unit || '—') + '</td>' +
          (showAvail ? '<td class="mono">' + (l.available === null || l.available === undefined ? '—' : esc(l.available)) + '</td>' : '') +
          (showLot ? '<td><input class="mini-input" data-line="' + i + '" data-field="lot" value="' + esc(l.lot || '') + '" placeholder="选填" /></td>' : '') +
          (showLoc ? '<td>' + (boxes.length
            ? '<select class="mini-input" data-line="' + i + '" data-field="boxId"><option value="">选择货位</option>' +
              boxes.map(function (bx) { return '<option value="' + esc(bx.id) + '" data-code="' + esc(bx.code) + '"' + (String(l.boxId) === String(bx.id) ? ' selected' : '') + '>' + esc(bx.code) + '</option>'; }).join('') +
              '</select>'
              // 服务端没下发 boxes 时不要把人卡死：允许直接填四段编码，服务端 findBoxByAnyCode 能认
            : '<input class="mini-input" data-line="' + i + '" data-field="boxCode" value="' + esc(l.boxCode || '') + '" placeholder="A-01-01-01" title="' + esc(boxEmptyReason()) + '" />') + '</td>' : '') +
          '<td><input class="mini-input" type="number" min="0" step="any" data-line="' + i + '" data-field="qty" value="' + esc(l.qty) + '" /></td>' +
          '<td><button class="btn sm ghost" data-action="remove-line" data-index="' + i + '">删</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function resultHtml() {
    if (S.submit.error) {
      return '<div class="banner danger" style="margin-top:16px"><div style="flex:1">' + esc(S.submit.error) + '</div></div>';
    }
    var r = S.submit.result;
    if (!r) return '';
    var posted = String(r.status || '').toUpperCase() === 'POSTED';
    var warn = r.postError ? '<div class="banner warn" style="margin-top:12px"><div><b>已建单但没过账：</b>' + esc(r.postError) + '<br/>单据保留为草稿，补足库存或在云仓后台处理后可再次过账。</div></div>' : '';
    return '<div class="card flat" style="margin-top:16px">' +
      '<div class="panel-head"><h3 style="margin:0;font-size:13px">' + (posted ? '已建单并过账' : '已建单') + '</h3>' +
      (posted ? '<span class="chip ok">库存已更新</span>' : '<span class="chip dim">草稿</span>') + '</div>' +
      '<div class="kv">' +
        '<div class="k">单号</div><div class="v">' + esc(r.orderNo || r.id || '—') + '</div>' +
        '<div class="k">状态</div><div class="v">' + statusChip(r.status) + '</div>' +
        '<div class="k">明细条数</div><div class="v">' + esc((S.form.lines || []).length) + '</div>' +
      '</div>' + warn + '</div>';
  }

  // ---------------- 库存查询 ----------------
  async function loadInventory(page) {
    S.data.invPage = page || 1;
    var r = await api.api.call({
      path: isEnt() ? '/api/app/inventory' : apiPath('/inventory'), method: 'GET',
      query: isEnt()
        ? { keyword: S.form.invKeyword || '', page: S.data.invPage, pageSize: 50 }
        : { warehouseId: S.form.invWarehouseId || '', keyword: S.form.invKeyword || '', page: S.data.invPage, pageSize: 50 }
    });
    if (!apiOk(r)) return;
    if (!r.ok) { S.data.invRows = []; toast(r.error || '库存查询失败', true); return; }
    var rows = (r.data && r.data.items) || [];
    if (isEnt()) {
      // 企业版库存字段：sku / productName / warehouseName / qty / lockedQty / avgCost
      rows = rows.map(function (x) {
        var onHand = num(x.qty !== undefined ? x.qty : x.onHand);
        var locked = num(x.lockedQty !== undefined ? x.lockedQty : x.locked);
        return {
          productCode: x.sku || x.productCode || '',
          productName: x.productName || x.name || '',
          warehouseName: x.warehouseName || x.warehouseCode || '',
          onHand: onHand, locked: locked, available: onHand - locked,
          avgCost: x.avgCost === undefined || x.avgCost === null ? null : num(x.avgCost),
          lotNo: x.lotNo || '',
        };
      });
    }
    var kw = String(S.form.invKeyword || '').trim().toLowerCase();
    if (kw) {
      rows = rows.filter(function (x) {
        return String(x.productName || x.name || '').toLowerCase().indexOf(kw) >= 0 ||
               String(x.productCode || x.code || '').toLowerCase().indexOf(kw) >= 0;
      });
    }
    S.data.invRows = rows;
    S.data.invTotal = kw ? rows.length : num(r.data && r.data.total);
    render();
  }

  function inventoryHtml() {
    var rows = S.data.invRows;
    var whs = S.data.warehouses;
    return '<div class="card">' +
      '<div class="toolbar">' +
        '<select id="sel-inv-wh" class="toolbar-select"><option value="">全部仓库</option>' +
          whs.map(function (w) { return '<option value="' + esc(w.id) + '"' + (String(S.form.invWarehouseId) === String(w.id) ? ' selected' : '') + '>' + esc(w.name) + '</option>'; }).join('') +
        '</select>' +
        '<input id="inp-inv-kw" class="toolbar-input" placeholder="商品编码 / 名称" value="' + esc(S.form.invKeyword || '') + '" />' +
        '<button class="btn primary" data-action="inv-search">查询</button>' +
        '<span class="hint" style="margin-left:auto">共 ' + esc(S.data.invTotal) + ' 条 · 第 ' + esc(S.data.invPage) + ' 页</span>' +
      '</div>' +
      (rows.length
        ? '<div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>商品</th><th>编码</th><th>仓库</th><th>结存</th><th>锁定</th><th>可用</th><th>均价</th></tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr><td>' + esc(r.productName || r.name || '—') + '</td><td class="mono">' + esc(r.productCode || r.code || '') + '</td>' +
              '<td>' + esc(r.warehouseName || '') + '</td><td class="mono">' + esc(num(r.onHand)) + '</td>' +
              '<td class="mono">' + esc(num(r.locked)) + '</td><td class="mono">' + esc(num(r.available)) + '</td>' +
              '<td class="mono">' + esc(r.avgCost === null || r.avgCost === undefined ? '—' : num(r.avgCost)) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="pager"><button class="btn sm ghost" data-action="inv-prev"' + (S.data.invPage <= 1 ? ' disabled' : '') + '>上一页</button>' +
          '<button class="btn sm ghost" data-action="inv-next">下一页</button></div>'
        : '<div class="empty">没有查到库存，换个关键词或仓库试试</div>') +
    '</div>';
  }

  // ---------------- 单据记录 ----------------
  async function loadOrders(type, page) {
    S.data.ordersType = type || S.data.ordersType;
    S.data.ordersPage = page || 1;
    if (isEnt()) {
      // 企业版平台还没有单据 REST 接口（/api/app/stock-in 等返回「未实现的接口」），
      // 这里不假装能查，直接把原因摆出来。
      S.data.orders = []; S.data.ordersTotal = 0; S.orders.selected = {};
      S.orders.msg = '企业版平台暂未开放单据接口（入库/出库/调拨/盘点），这一步需要服务端补 REST 端点后再接入。';
      S.orders.msgOk = false;
      render();
      return;
    }
    var o = S.orders;
    var query = { type: S.data.ordersType, page: S.data.ordersPage, pageSize: 50 };
    if (o.from) query.from = new Date(o.from + 'T00:00:00').toISOString();
    if (o.to) query.to = new Date(o.to + 'T23:59:59').toISOString();
    var r = await api.api.call({ path: apiPath('/orders'), method: 'GET', query: query });
    if (!apiOk(r)) return;
    if (!r.ok) { S.data.orders = []; toast(r.error || '单据加载失败', true); render(); return; }
    S.data.orders = (r.data && r.data.items) || [];
    S.data.ordersTotal = num(r.data && r.data.total);
    S.orders.selected = {};
    render();
  }

  var ORDER_TYPES = [['inbound', '入库单'], ['outbound', '出库单'], ['transfer', '调拨单'], ['stocktake', '盘点单']];
  var ORDER_STATUS = [
    ['', '全部状态'], ['DRAFT', '草稿'], ['APPROVED', '已审批'], ['POSTED', '已过账'],
    ['SENT', '已发运'], ['RECEIVED', '已收货'], ['ADJUSTED', '已调整'], ['SETTLED', '已结算'], ['CANCELLED', '已取消']
  ];

  /** 服务端已按下发条件过滤，界面只补状态与单号关键词，不额外打请求 */
  function visibleOrders() {
    var rows = S.data.orders || [];
    var st = String(S.orders.status || '').toUpperCase();
    var kw = String(S.orders.keyword || '').trim().toLowerCase();
    return rows.filter(function (r) {
      if (st && String(r.status || '').toUpperCase() !== st) return false;
      if (kw) {
        var hay = (String(r.orderNo || '') + ' ' + String(r.id || '') + ' ' + String(r.remark || '')).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  function selectedOrderIds() {
    return Object.keys(S.orders.selected || {}).filter(function (k) { return S.orders.selected[k]; });
  }

  function orderEndpoint(kind) { return kind === 'inbound' ? 'stock-in' : (kind === 'outbound' ? 'stock-out' : kind); }

  async function batchPostOrders() {
    if (S.orders.busy) return;
    var ids = selectedOrderIds();
    if (!ids.length) return toast('先勾选要过账的单据', true);
    var kind = S.data.ordersType;
    if (kind !== 'inbound' && kind !== 'outbound') return toast('只有入库单、出库单可以批量过账', true);
    var postable = kind === 'outbound' ? ['APPROVED', 'LOCKED'] : ['DRAFT'];
    var targets = visibleOrders().filter(function (r) {
      return ids.indexOf(String(r.id)) >= 0 && postable.indexOf(String(r.status || '').toUpperCase()) >= 0;
    });
    if (!targets.length) {
      return toast(kind === 'outbound'
        ? '勾选的出库单不是已审核状态：服务端只允许 APPROVED / LOCKED 过账，草稿要先在 Web 端审核'
        : '勾选的单据里没有草稿状态（只有草稿能过账）', true);
    }
    if (!confirm('确认过账 ' + targets.length + ' 张单据？过账后库存立即变动，不能撤销。')) return;
    S.orders.busy = true;
    var ok = 0, fail = [];
    for (var i = 0; i < targets.length; i++) {
      var id = targets[i].id;
      var r = await api.api.call({ path: apiPath('/' + orderEndpoint(kind) + '/' + encodeURIComponent(id) + '/post'), method: 'POST', body: {} });
      if (r && r.ok) ok++;
      else fail.push((targets[i].orderNo || id) + '：' + ((r && r.error) || '失败'));
      S.orders.msg = '正在过账 ' + (i + 1) + '/' + targets.length + '…';
      render();
    }
    S.orders.busy = false;
    S.orders.msg = '批量过账完成：成功 ' + ok + ' 张' + (fail.length ? '，失败 ' + fail.length + ' 张（' + fail.slice(0, 3).join('；') + (fail.length > 3 ? '…' : '') + '）' : '');
    S.orders.msgOk = fail.length === 0;
    toast(S.orders.msg, fail.length > 0);
    loadOrders(kind, S.data.ordersPage);
  }

  function exportOrders() {
    var rows = visibleOrders();
    if (!rows.length) return toast('当前筛选下没有单据', true);
    var kind = S.data.ordersType;
    var data = rows.map(function (r) {
      return {
        单号: r.orderNo || r.id || '',
        仓库: r.warehouseName || (r.warehouse && (r.warehouse.name || r.warehouse.code)) || (r.fromWhId ? ('仓 ' + r.fromWhId + ' → ' + r.toWhId) : ''),
        状态: String(r.status || '').toUpperCase(),
        创建时间: r.createdAt || r.created_at || '',
        备注: r.remark || '',
      };
    });
    api.file.saveTable({ name: '单据-' + kind + '-' + new Date().toISOString().slice(0, 10) + '.xlsx', headers: ['单号', '仓库', '状态', '创建时间', '备注'], rows: data }).then(function (r) {
      if (r && r.ok) toast('已导出 ' + r.rows + ' 张单据');
      else if (r && !r.canceled) toast(r.error || '导出失败', true);
    });
  }

  function ordersHtml() {
    var rows = visibleOrders();
    var kind = S.data.ordersType;
    var sel = selectedOrderIds();
    var detailOk = capReady('GET', '/api/v1/open/orders/:id');
    var postPath = kind === 'inbound' ? '/api/v1/open/stock-in/:id/post' : '/api/v1/open/stock-out/:id/post';
    var postOk = capReady('POST', postPath);
    var sendOk = capReady('POST', '/api/v1/open/transfer/:id/send');
    var recvOk = capReady('POST', '/api/v1/open/transfer/:id/receive');
    var countOk = capReady('GET', '/api/v1/open/stocktake/:id');
    var capNote = function (ok, label) { return ok ? '' : ' title="' + esc(capGate('GET', '/api/v1/open/orders/:id', label)) + '"'; };
    return '<div class="card">' +
      '<div class="seg">' + ORDER_TYPES.map(function (t) {
        return '<button class="seg-item' + (kind === t[0] ? ' active' : '') + '" data-action="orders-tab" data-type="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="toolbar" style="margin-top:12px">' +
        '<select id="sel-order-status" class="toolbar-select">' + ORDER_STATUS.map(function (s) {
          return '<option value="' + esc(s[0]) + '"' + (S.orders.status === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>';
        }).join('') + '</select>' +
        '<input id="inp-order-from" type="date" class="toolbar-input" style="max-width:150px" value="' + esc(S.orders.from) + '" />' +
        '<span class="hint">至</span>' +
        '<input id="inp-order-to" type="date" class="toolbar-input" style="max-width:150px" value="' + esc(S.orders.to) + '" />' +
        '<input id="inp-order-kw" class="toolbar-input" placeholder="单号 / 备注" value="' + esc(S.orders.keyword) + '" />' +
        '<button class="btn" data-action="orders-search">查询</button>' +
        '<button class="btn ghost" data-action="orders-reset">重置</button>' +
        '<span style="flex:1"></span>' +
        '<span class="hint">共 ' + esc(S.data.ordersTotal || rows.length) + ' 张 · 第 ' + esc(S.data.ordersPage) + ' 页</span>' +
      '</div>' +
      (S.orders.msg ? '<div class="banner ' + (S.orders.msgOk ? 'info' : 'warn') + '" style="margin-top:12px"><div>' + esc(S.orders.msg) + '</div></div>' : '') +
      (rows.length
        ? '<div class="table-wrap" style="margin-top:14px"><table><thead><tr>' +
            '<th style="width:34px"><input type="checkbox" id="chk-order-all" /></th>' +
            '<th>单号</th><th>仓库</th><th>状态</th><th>创建时间</th><th style="width:240px">操作</th></tr></thead><tbody>' +
          rows.map(function (r) {
            var st = String(r.status || '').toUpperCase();
            var checked = !!S.orders.selected[String(r.id)];
            var ops = '<button class="btn sm ghost" data-action="order-view" data-id="' + esc(r.id) + '"' + (detailOk ? '' : ' disabled' + capNote(detailOk, '单据详情')) + '>查看</button>';
            if (kind === 'inbound' && st === 'DRAFT') ops += ' <button class="btn sm" data-action="order-post" data-kind="inbound" data-id="' + esc(r.id) + '"' + (postOk ? '' : ' disabled' + capNote(postOk, '入库过账')) + '>过账</button>';
            if (kind === 'outbound' && (st === 'APPROVED' || st === 'LOCKED')) ops += ' <button class="btn sm" data-action="order-post" data-kind="outbound" data-id="' + esc(r.id) + '"' + (postOk ? '' : ' disabled' + capNote(postOk, '出库过账')) + '>过账</button>';
            // 出库单在服务端只有 APPROVED / LOCKED 能过账；DRAFT 必须先审核（Web 端），这里不放假按钮
            if (kind === 'outbound' && st === 'DRAFT') ops += ' <span class="chip dim" title="服务端只允许已审核（APPROVED）的出库单过账">待审核</span>';
            if (kind === 'transfer' && st === 'DRAFT') ops += ' <button class="btn sm" data-action="order-send" data-id="' + esc(r.id) + '"' + (sendOk ? '' : ' disabled') + '>发运</button>';
            if (kind === 'transfer' && st === 'SENT') ops += ' <button class="btn sm" data-action="order-receive" data-id="' + esc(r.id) + '"' + (recvOk ? '' : ' disabled') + '>收货</button>';
            if (kind === 'stocktake') ops += ' <button class="btn sm" data-action="order-count" data-id="' + esc(r.id) + '"' + (countOk ? '' : ' disabled') + '>录入实盘</button>';
            return '<tr><td><input type="checkbox" class="chk-order" data-id="' + esc(r.id) + '"' + (checked ? ' checked' : '') + ' /></td>' +
              '<td class="mono">' + esc(r.orderNo || r.id || '—') + '</td>' +
              '<td>' + esc(r.warehouseName || (r.warehouse && (r.warehouse.name || r.warehouse.code)) || (r.fromWarehouseName ? (r.fromWarehouseName + ' → ' + (r.toWarehouseName || '')) : (r.fromWhId ? ('仓 ' + r.fromWhId + ' → ' + r.toWhId) : '—'))) + '</td>' +
              '<td>' + statusChip(r.status) + '</td><td>' + esc(fmtTime(r.createdAt || r.created_at)) + '</td><td>' + ops + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="run-bar">' +
            '<button class="btn primary" data-action="orders-batch-post"' + (S.orders.busy || !postOk ? ' disabled' : '') + '>' + (S.orders.busy ? '处理中…' : '批量过账' + (sel.length ? '（' + sel.length + '）' : '')) + '</button>' +
            '<button class="btn ghost" data-action="orders-clear-sel"' + (sel.length ? '' : ' disabled') + '>清除选择</button>' +
            '<button class="btn ghost" data-action="orders-export">导出当前筛选</button>' +
            '<span class="hint">过账只对草稿生效；库存不足会整单失败并保持草稿</span>' +
          '</div>' +
          '<div class="pager"><button class="btn sm ghost" data-action="orders-prev"' + (S.data.ordersPage <= 1 ? ' disabled' : '') + '>上一页</button>' +
          '<button class="btn sm ghost" data-action="orders-next">下一页</button></div>'
        : '<div class="empty">这个条件下没有单据</div>') +
    '</div>';
  }

  // ---------------- 单据操作：查看 / 打印 / 过账 / 调拨后续 ----------------
  async function orderDetail(id, kind) {
    var r = await api.api.call({ path: apiPath('/orders/' + encodeURIComponent(id)), method: 'GET', query: { type: kind } });
    if (!r.ok) { toast(r.error || '单据读取失败', true); return null; }
    return r.data || null;
  }

  function orderLines(d) {
    var items = (d && (d.items || d.inboundItems || d.outboundItems || d.transferItems || d.countItems)) || [];
    return items.map(function (it) {
      var qty = num(it.quantity !== undefined ? it.quantity : it.countQty);
      var cost = it.costPrice !== undefined && it.costPrice !== null ? num(it.costPrice)
        : (it.price !== undefined && it.price !== null ? num(it.price) : (it.unitPrice !== undefined && it.unitPrice !== null ? num(it.unitPrice) : null));
      return {
        code: (it.product && it.product.code) || it.productCode || '',
        name: (it.product && it.product.name) || it.productName || '',
        unit: (it.product && it.product.unit) || it.unit || '',
        qty: qty,
        cost: cost,
        amount: cost === null ? null : Math.round(qty * cost * 100) / 100,
      };
    });
  }

  /**
   * 打印页统一模板：抬头 / 单据信息 / 明细 / 合计 / 签字栏 / 页脚。
   * 抬头与落款取自设置页的本机偏好，改一次以后每张单都带。
   */
  function printDoc(opts) {
    var o = opts || {};
    var pr = S.prefs || {};
    var head = pr.printHeader || '云仓';
    var foot = pr.printFooter || '云仓 · 开源仓储管理系统';
    var cols = o.columns || [];
    var rows = o.rows || [];
    var meta = o.meta || [];
    var totals = o.totals || '';
    var signers = o.signers || ['制单', '复核', '仓管员'];
    var th = cols.map(function (c) { return '<th' + (c.align === 'right' ? ' class="r"' : '') + '>' + esc(c.label) + '</th>'; }).join('');
    var body = rows.map(function (row) {
      return '<tr>' + cols.map(function (c) {
        return '<td' + (c.align === 'right' ? ' class="r"' : '') + '>' + esc(row[c.key] === undefined || row[c.key] === null ? '' : row[c.key]) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>' +
      esc(o.title) + ' ' + esc(o.no || '') + '</title><style>' +
      '@page{size:A4;margin:14mm}' +
      'body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#0F172A;padding:22px}' +
      '.head{text-align:center;margin-bottom:6px}.head .org{font-size:22px;font-weight:700;letter-spacing:1px}' +
      '.head .ttl{font-size:16px;color:#334155;margin-top:4px;letter-spacing:4px}' +
      '.rule{height:2px;background:#0F172A;margin:10px 0 12px}' +
      '.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;font-size:12px;color:#334155;margin-bottom:12px}' +
      '.meta b{font-weight:600;color:#0F172A}' +
      'table{width:100%;border-collapse:collapse;font-size:12.5px}' +
      'th,td{border:1px solid #CBD5E1;padding:7px 8px;text-align:left;vertical-align:top}' +
      'th{background:#F1F5F9;font-weight:600}.r{text-align:right}.mono{font-variant-numeric:tabular-nums}' +
      '.totals{margin-top:8px;font-size:12.5px;text-align:right}.totals b{font-size:13px}' +
      '.sign{display:grid;grid-template-columns:repeat(' + signers.length + ',1fr);gap:24px;margin-top:38px;font-size:12.5px}' +
      '.sign .line{border-top:1px solid #94A3B8;padding-top:6px;color:#334155}' +
      '.foot{margin-top:26px;font-size:11px;color:#64748B;text-align:center;border-top:1px dashed #CBD5E1;padding-top:8px}' +
      '.no-print{position:fixed;right:22px;top:18px;padding:8px 18px;border:0;border-radius:8px;background:#2563EB;color:#fff;cursor:pointer}' +
      '@media print{.no-print{display:none}body{padding:0}}' +
      '</style></head><body>' +
      '<button class="no-print" onclick="window.print()">打印</button>' +
      '<div class="head"><div class="org">' + esc(head) + '</div><div class="ttl">' + esc(o.title) + '</div></div>' +
      '<div class="rule"></div>' +
      '<div class="meta">' + meta.map(function (m) { return '<div><b>' + esc(m[0]) + '：</b>' + esc(m[1] === undefined || m[1] === null || m[1] === '' ? '—' : m[1]) + '</div>'; }).join('') + '</div>' +
      '<table><thead><tr>' + th + '</tr></thead><tbody>' + (body || '<tr><td colspan="' + cols.length + '" style="text-align:center;color:#94A3B8">没有明细</td></tr>') + '</tbody></table>' +
      (totals ? '<div class="totals">' + totals + '</div>' : '') +
      '<div class="sign">' + signers.map(function (s) { return '<div class="line">' + esc(s) + '（签字）：</div>'; }).join('') + '</div>' +
      '<div class="foot">' + esc(foot) + '　打印时间：' + esc(new Date().toLocaleString('zh-CN')) + '</div>' +
      '</body></html>';
    var w = window.open('', '_blank');
    if (!w) { toast('打印窗口被拦截，请允许弹窗', true); return; }
    w.document.write(html);
    w.document.close();
    return true;
  }

  function printOrder(d, kind) {
    var lines = orderLines(d);
    var title = ({ inbound: '入库单', outbound: '出库单', transfer: '调拨单', stocktake: '盘点表' })[kind] || '单据';
    var hasAmount = lines.some(function (l) { return l.amount !== null; });
    var qtySum = lines.reduce(function (s, l) { return s + num(l.qty); }, 0);
    var amountSum = lines.reduce(function (s, l) { return s + (l.amount === null ? 0 : num(l.amount)); }, 0);
    var cols = [{ key: 'idx', label: '#' }, { key: 'code', label: '商品编码' }, { key: 'name', label: '名称' }, { key: 'unit', label: '单位' }, { key: 'qty', label: '数量', align: 'right' }];
    if (hasAmount) { cols.push({ key: 'cost', label: '单价', align: 'right' }); cols.push({ key: 'amount', label: '金额', align: 'right' }); }
    var rows = lines.map(function (l, i) {
      return { idx: i + 1, code: l.code, name: l.name, unit: l.unit, qty: l.qty, cost: l.cost === null ? '' : l.cost.toFixed(2), amount: l.amount === null ? '' : l.amount.toFixed(2) };
    });
    var meta = [
      ['单号', d.orderNo || d.id],
      ['状态', d.status || ''],
      ['仓库', d.warehouseName || (d.warehouse && d.warehouse.name) || (d.fromWarehouseName ? (d.fromWarehouseName + ' → ' + (d.toWarehouseName || '')) : (d.fromWhId ? ('仓 ' + d.fromWhId + ' → ' + d.toWhId) : ''))],
      ['日期', fmtTime(d.createdAt || d.created_at)],
      ['制单人', (S.prefs && S.prefs.operator) || (S.me && S.me.name) || ''],
      ['备注', d.remark || ''],
    ];
    printDoc({
      title: title,
      no: d.orderNo || d.id,
      meta: meta,
      columns: cols,
      rows: rows,
      totals: '合计数量 <b>' + qtySum + '</b>' + (hasAmount ? '　合计金额 <b>' + amountSum.toFixed(2) + '</b>' : ''),
      signers: ['制单', '复核', '仓管员'],
    });
  }

  async function viewOrder(id, kind) {
    var d = await orderDetail(id, kind);
    if (!d) return;
    var lines = orderLines(d);
    var html = '<div class="panel-head"><h3 style="margin:0;font-size:14px">' + esc(d.orderNo || id) + '</h3><span class="chip">' + esc(d.status || '') + '</span></div>' +
      '<div class="kv"><div class="k">仓库</div><div class="v">' + esc(d.warehouseName || (d.warehouse && d.warehouse.name) || '—') + '</div>' +
      '<div class="k">时间</div><div class="v">' + esc(fmtTime(d.createdAt || d.created_at)) + '</div></div>' +
      '<div class="table-wrap" style="margin-top:12px;max-height:320px"><table><thead><tr><th>编码</th><th>名称</th><th>单位</th><th>数量</th></tr></thead><tbody>' +
      lines.map(function (l) { return '<tr><td class="mono">' + esc(l.code) + '</td><td>' + esc(l.name) + '</td><td>' + esc(l.unit) + '</td><td class="mono">' + esc(l.qty) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="run-bar"><button class="btn" data-action="order-print" data-id="' + esc(id) + '" data-kind="' + esc(kind) + '">打印</button></div>';
    showDialog('单据详情', html);
    S.data.viewingOrder = { id: id, kind: kind, data: d };
  }

  async function postOrder(kind, id) {
    var r = await api.api.call({ path: apiPath('/' + kind + '/' + encodeURIComponent(id) + '/post'), method: 'POST', body: {} });
    if (!r.ok) { toast(r.error || '过账失败', true); return; }
    toast('已过账');
    loadOrders(S.data.ordersType, S.data.ordersPage);
  }

  async function transferAction(action, id) {
    var r = await api.api.call({ path: apiPath('/transfer/' + encodeURIComponent(id) + '/' + action), method: 'POST', body: {} });
    if (!r.ok) { toast(r.error || (action === 'send' ? '发运失败' : '收货失败'), true); return; }
    toast(action === 'send' ? '已发运' : '已收货');
    loadOrders('transfer', S.data.ordersPage);
  }

  function showDialog(title, bodyHtml) {
    var mask = document.getElementById('dialog-mask');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'dialog-mask';
      mask.className = 'dialog-mask';
      mask.innerHTML = '<div class="dialog"><div class="dialog-head"><b id="dialog-title"></b><button class="dialog-x" id="dialog-close">✕</button></div><div class="dialog-body" id="dialog-body"></div></div>';
      document.body.appendChild(mask);
      mask.addEventListener('click', function (e) {
        if (e.target === mask || e.target.id === 'dialog-close') mask.classList.remove('show');
      });
    }
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-body').innerHTML = bodyHtml;
    mask.classList.add('show');
  }

  // ---------------- 设置 ----------------
  function settingsHtml() {
    var st = S.settings;
    var status = S.status || {};
    if (isEnt()) return settingsEntHtml(status);
    var okBox = st.tested ? '<div class="test-ok">连接成功：' + esc((st.tested.me && st.tested.me.name) || '') + ' · ' + esc(st.tested.profileName || '') + '</div>' : '';
    return '<div class="settings-wrap">' +
      '<div class="settings-bar">' +
        '<span class="hint">改动要点「保存并连接」才生效</span>' +
        '<button class="btn primary" data-action="settings-save"' + (st.saving ? ' disabled' : '') + '>保存并连接</button>' +
        '<button class="btn ghost" data-action="goto-enterprise">登录企业版</button>' +
        '<button class="btn ghost" data-action="check-update">检查更新</button>' +
        '<button class="btn danger" data-action="uninstall">卸载云仓</button>' +
      '</div>' +
      (S.invalid ? '<div class="banner danger"><div><b>密钥已失效。</b>' + esc(S.invalid) + ' 在下面填一把新的，保存后立即生效。</div></div>' : '') +
      '<div class="card"><div class="section-head"><h3>连接配置</h3><span class="hint">改完点保存，立即生效</span></div>' +
      '<div class="field"><label>服务器地址</label><input id="set-url" placeholder="https://yc.example.com" value="' + esc(st.baseUrl || status.baseUrl || '') + '" /></div>' +
      '<div class="field"><label>API 密钥</label><input id="set-token" type="password" placeholder="留空表示不修改当前密钥" />' +
      '<div class="hi">当前密钥：' + esc(status.tokenMasked || '未配置') + '（' + (status.encrypted ? '已加密存储' : '未加密存储') + '）</div></div>' +
      (st.error ? '<div class="err-inline">' + esc(st.error) + '</div>' : '') + okBox +
      '<div class="row-actions">' +
      '<button class="btn primary" data-action="settings-save"' + (st.saving ? ' disabled' : '') + '>' + (st.saving ? '保存中…' : '保存并连接') + '</button>' +
      '<button class="btn ghost" data-action="settings-test">测试连接</button>' +
      '<button class="btn ghost" data-action="settings-clear">清除本机配置</button>' +
      '</div></div>' +
      '<div class="card"><div class="section-head"><h3>当前状态</h3></div>' +
      '<div class="kv">' +
      '<div class="k">连接</div><div class="v">' + (S.session && S.session.ok ? '已连接' : '未连接') + '</div>' +
      '<div class="k">服务器</div><div class="v">' + esc(status.baseUrl || '—') + '</div>' +
      '<div class="k">密钥</div><div class="v">' + esc(status.tokenMasked || '—') + '</div>' +
      '<div class="k">可作业</div><div class="v">' + esc(scopes().map(scopeLabel).join('、') || '—') + '</div>' +
      '<div class="k">配置文件</div><div class="v">' + esc(status.configFile || '—') + '</div>' +
      '</div>' +
      '<div class="row-actions"><button class="btn ghost sm" data-action="reveal">在文件夹中显示</button></div>' +
      '<div class="note">密钥用 Electron safeStorage 加密（Windows 走 DPAPI），只有当前 Windows 账号能解开。</div>' +
      '</div>' +
      diagnosticsHtml() +
      prefsHtml() +
      updateBlockHtml() +
      '<div class="danger-zone"><h3>卸载云仓</h3>' +
      '<p>卸载会删除程序本体、本机配置（地址与密钥）、缓存和快捷方式；卸载后重装需要重新配置。</p>' +
      '<button class="btn danger" data-action="uninstall">卸载并清除本机数据</button></div>' +
      '</div>' +
      '</div>';
  }

  // ---------------- 服务端诊断 ----------------
  function diagnosticsHtml() {
    var cat = S.catalog || {};
    var keys = cat.keys || {};
    var missing = missingCaps();
    var avail = (keys.available || []).length;
    var locked = (keys.locked || []).length;
    var src = cat.source === 'server' ? '服务端自描述清单（/api/v1/open）' : (cat.warning ? '内置兜底清单（服务端清单没读到）' : '未探测');
    var ok = !missing.length && avail > 0;
    var html = '<div class="card" style="margin-top:16px"><div class="section-head"><h3>服务端诊断</h3>' +
      '<span class="hint">' + (ok ? '能力齐全，0.5.9 的功能都能用' : (avail ? '有 ' + missing.length + ' 项能力缺失' : '未连接或清单没取到')) + '</span></div>' +
      '<div class="kv">' +
      '<div class="k">接口档位</div><div class="v">' + esc((S.profile && S.profile.name) || '—') + '</div>' +
      '<div class="k">清单来源</div><div class="v">' + esc(src) + '</div>' +
      '<div class="k">可用接口</div><div class="v">' + esc(avail) + ' 个（另有 ' + esc(locked) + ' 个缺权限）</div>' +
      '<div class="k">待重放草稿</div><div class="v">' + esc(S.drafts.items.length) + ' 单</div>' +
      '<div class="k">客户端版本</div><div class="v">v' + esc((S.status && S.status.version) || '') + ((S.status && S.status.sdkVersion) ? ' · SDK ' + esc(S.status.sdkVersion) : '') + ' · ' + esc(S.status && S.status.source ? S.status.source : '') + '</div>' +
      '</div>';
    if (avail && missing.length) {
      html += '<div class="banner warn" style="margin-top:12px"><div><b>服务端缺这些开放接口，对应功能已置灰：</b>' +
        missing.map(function (m) { return '<div class="hint" style="margin-top:4px">' + esc(m.method + ' ' + m.path + '（' + m.feature + '）') + '</div>'; }).join('') +
        '<div class="hint" style="margin-top:6px">升级云仓服务端到 1.4.7 及以上后，点「重新探测」即可恢复。</div></div></div>';
    }
    html += '<div class="row-actions"><button class="btn ghost" data-action="diag-refresh">重新探测</button>' +
      '<button class="btn ghost" data-action="diag-copy">复制诊断信息</button></div>' +
      '<div class="note">诊断信息只含地址、权限与接口名，不含密钥。</div></div>';
    return html;
  }

  function diagText() {
    var cat = S.catalog || {};
    var lines = [
      '云仓桌面端 v' + ((S.status && S.status.version) || ''),
      '地址：' + ((S.status && S.status.baseUrl) || ''),
      '接口档位：' + ((S.profile && S.profile.name) || '—'),
      '密钥：' + ((S.status && S.status.tokenMasked) || '—'),
      '权限：' + (scopes().join(',') || '—'),
      '可用接口：' + (((cat.keys || {}).available || []).length),
      '能力缺口：' + (missingCaps().map(function (m) { return m.method + ' ' + m.path; }).join(' | ') || '无'),
      '草稿：' + S.drafts.items.length + ' 单',
    ];
    return lines.join('\n');
  }

  function prefsHtml() {
    var pr = S.prefs || {};
    return '<div class="card" style="margin-top:16px"><div class="section-head"><h3>打印设置</h3>' +
      '<span class="hint">改一次，之后所有单据打印都带这套抬头</span></div>' +
      '<div class="form-grid">' +
        '<div class="field"><label>打印抬头</label><input id="pref-header" value="' + esc(pr.printHeader || '') + '" placeholder="公司 / 门店名，默认「云仓」" /></div>' +
        '<div class="field"><label>页脚落款</label><input id="pref-footer" value="' + esc(pr.printFooter || '') + '" placeholder="默认「云仓 · 开源仓储管理系统」" /></div>' +
        '<div class="field"><label>制单人</label><input id="pref-operator" value="' + esc(pr.operator || '') + '" placeholder="打印时签到单据上，留空用密钥名" /></div>' +
      '</div>' +
      '<div class="row-actions"><button class="btn primary" data-action="prefs-save">保存打印设置</button>' +
      '<button class="btn ghost" data-action="prefs-print-demo">打印一张样张</button></div></div>';
  }

  async function loadPrefs() {
    try {
      var p = await api.prefs.get();
      if (p) S.prefs = { printHeader: p.printHeader || '云仓', printFooter: p.printFooter || '云仓 · 开源仓储管理系统', operator: p.operator || '' };
    } catch (e) {}
    return S.prefs;
  }

  async function savePrefs() {
    var payload = {
      printHeader: (q('#pref-header') || {}).value || '',
      printFooter: (q('#pref-footer') || {}).value || '',
      operator: (q('#pref-operator') || {}).value || '',
    };
    S.prefs = { printHeader: payload.printHeader || '云仓', printFooter: payload.printFooter || '云仓 · 开源仓储管理系统', operator: payload.operator || '' };
    try {
      var r = await api.prefs.save(payload);
      if (r && r.ok) toast('打印设置已保存');
      else toast((r && r.error) || '保存失败', true);
    } catch (e) {
      toast('保存失败：' + (e.message || e), true);
    }
    render();
  }

  // ---------------- 部署模式 ----------------
  function modeTabsHtml() {
    return '<div class="seg" style="margin-bottom:16px">' +
      '<button class="seg-item' + (S.mode === 'private' ? ' active' : '') + '" data-action="mode-tab" data-mode="private">私有化部署</button>' +
      '<button class="seg-item' + (S.mode === 'enterprise' ? ' active' : '') + '" data-action="mode-tab" data-mode="enterprise">企业版（账号登录）</button>' +
      '</div>';
  }

  async function loadEntCaptcha() {
    var r = await api.ent.captcha({ platformUrl: S.ent.platformUrl });
    if (r && r.ok) { S.ent.captchaToken = r.token; S.ent.captchaImage = r.image; S.ent.answer = ''; }
    else S.ent.error = (r && r.error) || '取验证码失败';
    render();
    return r;
  }

  async function doEntLogin() {
    var e = S.ent;
    if (e.busy) return;
    e.error = '';
    if (!e.account || !e.password) { e.error = '账号与密码都要填'; render(); return; }
    if (!e.answer) { e.error = '请输入图形验证码'; render(); return; }
    e.busy = true; render();
    var r = await api.ent.login({ platformUrl: e.platformUrl, account: e.account, password: e.password, captchaToken: e.captchaToken, captchaAnswer: e.answer });
    e.busy = false;
    if (!r.ok) {
      e.error = r.code === 'CAPTCHA_INVALID' ? '验证码不正确，已换一张，请重填' : (r.error || '登录失败');
      await loadEntCaptcha();
      return;
    }
    e.error = '';
    e.tenant = r.bootstrap && r.bootstrap.tenant ? r.bootstrap.tenant : null;
    toast('企业版登录成功');
    await connect();
  }

  function enterpriseFormHtml() {
    var e = S.ent;
    return '<div class="field"><label>平台地址</label><input id="ent-url" value="' + esc(e.platformUrl) + '" placeholder="http://119.45.146.101" />' +
      '<div class="hi">企业版平台地址；SaaS 演示环境默认已填好</div></div>' +
      '<div class="field"><label>账号</label><input id="ent-account" value="' + esc(e.account) + '" placeholder="手机号 / 账号" autocomplete="username" /></div>' +
      '<div class="field"><label>密码</label><input id="ent-password" type="password" value="' + esc(e.password) + '" placeholder="登录密码" autocomplete="current-password" /></div>' +
      '<div class="field"><label>图形验证码</label>' +
        '<div style="display:flex;gap:10px;align-items:center">' +
          '<input id="ent-answer" value="' + esc(e.answer) + '" placeholder="填写右侧 4 位字符" style="flex:1" />' +
          (e.captchaImage ? '<img id="ent-captcha" data-action="ent-captcha" src="' + esc(e.captchaImage) + '" alt="验证码" title="点击换一张" style="height:44px;border-radius:8px;border:1px solid var(--line);cursor:pointer" />' : '<button class="btn ghost" data-action="ent-captcha">加载验证码</button>') +
        '</div>' +
        '<div class="hi">平台登录强制图形验证码；看不清就点图片换一张</div></div>' +
      (e.error ? '<div class="err-inline">' + esc(e.error) + '</div>' : '') +
      '<div class="wizard-actions">' +
        '<button class="btn primary" data-action="ent-login"' + (e.busy ? ' disabled' : '') + '>' + (e.busy ? '登录中…' : '登录企业版') + '</button>' +
      '</div>' +
      '<div class="wizard-foot">企业版用账号密码登录平台，数据仍通过云仓 SDK 走平台接口。</div>' +
      '<div class="row-actions" style="justify-content:center;margin-top:12px">' +
        '<button class="btn ghost" data-action="goto-private">返回私有化部署</button>' +
      '</div>';
  }

  /** 企业版设置页：只读展示平台身份 + 退出登录；没有服务器地址/密钥可填 */
  function settingsEntHtml(status) {
    var t = (S.ent && S.ent.tenant) || status.tenant || {};
    var me = S.me || {};
    var mb = me.member || {};
    return '<div class="settings-wrap">' +
      '<div class="settings-bar"><span class="hint">企业版：账号密码登录，数据经云仓 SDK 走平台接口</span>' +
        '<button class="btn ghost" data-action="reload">刷新</button>' +
        '<button class="btn danger" data-action="ent-logout">退出企业版</button></div>' +
      '<div class="card"><div class="section-head"><h3>企业版身份</h3><span class="hint">会话 2 小时，过期要重新登录</span></div>' +
        '<div class="kv">' +
        '<div class="k">平台</div><div class="v">' + esc(status.platformUrl || (S.ent && S.ent.platformUrl) || '—') + '</div>' +
        '<div class="k">企业</div><div class="v">' + esc((t.name || '—') + (t.code ? '（' + t.code + '）' : '')) + '</div>' +
        '<div class="k">账号</div><div class="v">' + esc(status.account || mb.phone || '—') + '</div>' +
        '<div class="k">成员</div><div class="v">' + esc((mb.name || me.name || '—') + (mb.roleLabel ? ' · ' + mb.roleLabel : '')) + '</div>' +
        '<div class="k">能力</div><div class="v">' + esc((me.capabilities || []).length + ' 项') + '</div>' +
        '</div>' +
        '<div class="note">企业版当前开放：商品、仓库、库存、往来单位、BOM、预警、日志等查询与商品建档；' +
        '入库/出库/调拨/盘点的平台接口还没上线（服务端返回「未实现的接口」），相关入口已置灰。</div>' +
      '</div>' +
      prefsHtml() + updateBlockHtml() + '</div>';
  }

  // ---------------- 首次配置 ----------------
  function setupHtml() {
    var st = S.setup;
    var step = st.tested ? 3 : (st.token ? 2 : 1);
    var dots = '';
    for (var i = 1; i <= 3; i++) dots += '<div class="step-dot' + (i <= step ? ' on' : '') + '"></div>';
    if (S.mode === 'enterprise') {
      return '<div class="boot"><div class="wizard"><div class="wizard-card">' + logoHero() +
        '<h1>企业版登录</h1>' +
        '<p class="lead">企业版只需要账号密码：登录平台后，数据仍通过云仓 SDK 走平台接口。</p>' +
        modeTabsHtml() +
        enterpriseFormHtml() +
        '</div></div></div>';
    }
    return '<div class="boot"><div class="wizard"><div class="wizard-card">' + logoHero() +
      '<h1>连接你的云仓</h1>' +
      '<p class="lead">私有化部署（默认）：填服务器地址与 API 密钥，配置加密保存在本机。</p>' +
      modeTabsHtml() +
      '<div class="steps">' + dots + '</div>' +
      '<div class="field"><label>云仓服务器地址</label>' +
      '<input id="setup-url" autofocus placeholder="https://yc.example.com 或 192.168.1.20:9958" value="' + esc(st.baseUrl) + '" />' +
      '<div class="hi">内网部署填 IP:端口；有域名就填域名。</div></div>' +
      '<div class="field"><label>API 密钥</label>' +
      '<input id="setup-token" type="password" placeholder="yc_live_…（云仓后台「设置 → API 管理」创建）" value="' + esc(st.token) + '" />' +
      '<div class="hi">密钥决定你能做哪些作业：入库、出库、调拨、盘点按权限出现。</div></div>' +
      (st.error ? '<div class="err-inline">' + esc(st.error) + '</div>' : '') +
      (st.tested ? '<div class="test-ok">连接成功，可以开始作业了</div>' : '') +
      '<div class="wizard-actions">' +
      '<button class="btn primary" data-action="setup-save"' + (st.testing ? ' disabled' : '') + '>' + (st.testing ? '正在连接…' : '连接并开始') + '</button>' +
      '<button class="btn ghost" data-action="setup-test"' + (st.testing ? ' disabled' : '') + '>仅测试</button>' +
      '</div>' +
      '<div class="wizard-foot">也可以把 <code>.env</code> 放在程序目录做批量预置（CW_BASE_URL / CW_API_KEY），预置只在没有本机配置时生效。</div>' +
      '<div class="row-actions" style="justify-content:center;margin-top:12px">' +
        '<button class="btn ghost" data-action="goto-enterprise">已有企业版账号？登录企业版</button>' +
      '</div>' +
      '</div></div></div>';
  }



  // ---------------- 盘点：建单 → 录实盘 → 结算 ----------------
  async function loadCountOrder(orderId) {
    var r = await api.api.call({ path: apiPath('/stocktake/' + encodeURIComponent(orderId)), method: 'GET' });
    if (!r.ok) { toast(r.error || '盘点单读取失败', true); S.count = null; render(); return; }
    var d = r.data || {};
    S.count = {
      id: d.id,
      orderNo: d.orderNo || '',
      status: d.status || 'DRAFT',
      warehouseName: d.warehouseName || '',
      rows: (d.items || []).map(function (it) {
        return { itemId: it.id, code: it.code, name: it.name, unit: it.unit, book: num(it.bookQty), actual: it.countQty === null || it.countQty === undefined ? '' : String(it.countQty), diff: it.diffQty === null || it.diffQty === undefined ? '' : String(it.diffQty) };
      }),
    };
    render();
  }

  /** 盘点表顶部两个计数随打字实时更新，不用整页重绘 */
  function updateCountChips() {
    var c = S.count;
    if (!c) return;
    var rows = c.rows || [];
    var filled = rows.filter(function (r) { return String(r.actual).trim() !== ''; }).length;
    var diffs = rows.filter(function (r) { return String(r.diff).trim() !== '' && Number(r.diff) !== 0; }).length;
    var f = document.getElementById('count-filled');
    var d = document.getElementById('count-diffs');
    if (f) f.textContent = '已盘 ' + filled + '/' + rows.length;
    if (d) { d.textContent = '差异 ' + diffs; d.className = 'chip ' + (diffs ? 'warn' : 'dim'); }
  }

  function recountDiff(row) {
    if (String(row.actual).trim() === '') { row.diff = ''; return; }
    row.diff = String(num(row.actual) - num(row.book));
  }

  async function buildCountSheet(warehouseId, order) {
    // 建单成功后直接用服务端明细，账面/差异都来自服务端
    var id = (order && (order.id || order.orderId)) || '';
    if (id) { await loadCountOrder(id); return; }
    S.count = null; render();
  }

  function countSheetHtml() {
    var c = S.count;
    if (!c) return '';
    var rows = c.rows || [];
    var filled = rows.filter(function (r) { return String(r.actual).trim() !== ''; }).length;
    var diffs = rows.filter(function (r) { return String(r.diff).trim() !== '' && Number(r.diff) !== 0; }).length;
    var settled = String(c.status).toUpperCase() === 'ADJUSTED' || String(c.status).toUpperCase() === 'SETTLED';
    return '<div class="card" style="margin-top:16px">' +
      '<div class="panel-head"><h3 style="margin:0;font-size:14px">盘点单' + (c.orderNo ? ' · ' + esc(c.orderNo) : '') + '</h3>' +
        '<div class="row-actions" style="margin:0">' +
          '<span class="chip ' + (settled ? 'ok' : 'dim') + '">' + esc(c.status) + '</span>' +
          '<span class="chip" id="count-filled">已盘 ' + filled + '/' + rows.length + '</span>' +
          '<span class="chip ' + (diffs ? 'warn' : 'dim') + '" id="count-diffs">差异 ' + diffs + '</span>' +
        '</div></div>' +
      '<div class="hint" style="margin-bottom:10px">实盘数边填边算差异；「保存实盘」写回服务端，「结算」按实盘校正库存。可导出 Excel 或打印盘点表。</div>' +
      (rows.length
        ? '<div class="table-wrap" style="max-height:420px"><table><thead><tr><th>商品编码</th><th>名称</th><th>单位</th><th style="width:90px">账面</th><th style="width:120px">实盘</th><th style="width:70px">差异</th></tr></thead><tbody>' +
          rows.map(function (r, i) {
            var d = String(r.diff).trim() === '' ? '—' : r.diff;
            var cls = d === '—' ? '' : (Number(d) > 0 ? 'pos' : (Number(d) < 0 ? 'neg' : ''));
            return '<tr><td class="mono">' + esc(r.code) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.unit || '—') + '</td>' +
              '<td class="mono">' + esc(r.book) + '</td>' +
              '<td><input class="mini-input" data-count="' + i + '" value="' + esc(r.actual) + '" placeholder="实盘"' + (settled ? ' disabled' : '') + ' /></td>' +
              '<td class="mono ' + cls + '" data-diff="' + i + '">' + esc(d) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="run-bar">' +
            '<button class="btn primary" data-action="count-save"' + (settled || !capReady('PATCH', '/api/v1/open/stocktake/:id') ? ' disabled' : '') + '>保存实盘</button>' +
            '<button class="btn" data-action="count-settle"' + (settled || !capReady('POST', '/api/v1/open/stocktake/:id/settle') ? ' disabled' : '') + '>结算</button>' +
            '<button class="btn ghost" data-action="count-export">导出 Excel</button>' +
            '<button class="btn ghost" data-action="count-print">打印盘点表</button>' +
            '<span class="hint">账面来自服务端，差异 = 实盘 - 账面</span>' +
          '</div>'
        : '<div class="empty">盘点单里没有明细</div>') +
      '</div>';
  }

  async function saveCount() {
    var c = S.count;
    if (!c) return;
    var payload = (c.rows || []).filter(function (r) { return String(r.actual).trim() !== ''; })
      .map(function (r) { return { itemId: r.itemId, countQty: num(r.actual) }; });
    if (!payload.length) { toast('还没有填写实盘数', true); return; }
    var r = await api.api.call({ path: apiPath('/stocktake/' + encodeURIComponent(c.id)), method: 'PATCH', body: { items: payload } });
    if (!r.ok) { toast(r.error || '保存失败', true); return; }
    toast('实盘已保存（' + payload.length + ' 行）');
    await loadCountOrder(c.id);
  }

  async function settleCount() {
    var c = S.count;
    if (!c) return;
    var r = await api.api.call({ path: apiPath('/stocktake/' + encodeURIComponent(c.id) + '/settle'), method: 'POST', body: {} });
    if (!r.ok) { toast(r.error || '结算失败', true); return; }
    toast('盘点已结算');
    await loadCountOrder(c.id);
    loadOrders('stocktake', 1);
  }

  function exportCount() {
    var c = S.count;
    if (!c) return;
    var rows = (c.rows || []).map(function (r) {
      return { 编码: r.code, 名称: r.name, 单位: r.unit || '', 账面: r.book, 实盘: r.actual, 差异: r.diff };
    });
    api.file.saveTable({ name: '盘点表-' + (c.orderNo || c.id) + '.xlsx', headers: ['编码', '名称', '单位', '账面', '实盘', '差异'], rows: rows }).then(function (res) {
      if (res && res.ok) toast('已导出 ' + res.rows + ' 行');
      else if (res && !res.canceled) toast(res.error || '导出失败', true);
    });
  }

  function printCount() {
    var c = S.count;
    if (!c) return;
    var rows = (c.rows || []).map(function (r, i) {
      return { idx: i + 1, code: r.code, name: r.name, unit: r.unit || '', book: r.book, actual: r.actual === '' ? '' : r.actual, diff: r.diff === '' ? '' : r.diff };
    });
    var diffs = rows.filter(function (r) { return r.diff !== '' && Number(r.diff) !== 0; }).length;
    printDoc({
      title: '盘点表',
      no: c.orderNo,
      meta: [['单号', c.orderNo], ['仓库', c.warehouseName], ['状态', c.status], ['盘了', rows.filter(function (r) { return r.actual !== ''; }).length + ' / ' + rows.length + ' 行'], ['差异行', diffs], ['制单人', (S.prefs && S.prefs.operator) || (S.me && S.me.name) || '']],
      columns: [
        { key: 'idx', label: '#' }, { key: 'code', label: '商品编码' }, { key: 'name', label: '名称' },
        { key: 'unit', label: '单位' }, { key: 'book', label: '账面', align: 'right' },
        { key: 'actual', label: '实盘', align: 'right' }, { key: 'diff', label: '差异', align: 'right' },
      ],
      rows: rows,
      totals: '差异行 <b>' + diffs + '</b> / 共 <b>' + rows.length + '</b> 行',
      signers: ['盘点人', '复核', '仓管员'],
    });
  }

  // ---------------- 商品管理 ----------------
  async function loadProducts(page) {
    S.data.prodPage = page || 1;
    var r = await api.api.call({
      path: isEnt() ? '/api/app/products' : apiPath('/products'),
      method: 'GET',
      query: { keyword: S.form.prodKeyword || '', page: S.data.prodPage, pageSize: 50 },
    });
    if (!apiOk(r)) return;
    if (!r.ok) { toast(r.error || '商品列表读取失败', true); return; }
    var items = (r.data && r.data.items) || [];
    if (isEnt()) items = items.map(function (x) { return Object.assign({}, x, { code: x.code || x.sku || '' }); });
    S.data.products = items;
    S.data.prodTotal = num(r.data && r.data.total);
    render();
  }

  function productsHtml() {
    var canWrite = can('product:write');
    var rows = S.data.products || [];
    var f = S.prodForm || {};
    return '<div class="card">' +
      '<div class="toolbar">' +
        '<input id="inp-prod-kw" class="toolbar-input" placeholder="商品编码 / 名称 / 条码" value="' + esc(S.form.prodKeyword || '') + '" />' +
        '<button class="btn" data-action="prod-search">查询</button>' +
        '<span style="flex:1"></span>' +
        '<button class="btn" data-action="prod-export">导出 Excel</button>' +
        '<button class="btn ghost" data-action="prod-template">下载导入模板</button>' +
        '<button class="btn ghost" data-action="prod-import"' + (canWrite && !isEnt() ? '' : ' disabled') + '>导入 Excel</button>' +
        '<button class="btn primary" data-action="prod-new"' + (canWrite ? '' : ' disabled') + '>新增商品</button>' +
      '</div>' +
      (canWrite ? '' : '<div class="hint" style="margin-top:10px">当前密钥没有商品写入权限（product:write），只能查看与导出。</div>') +
      (S.prodOpen ? newProductForm(f) : '') +
      (S.prodMsg ? '<div class="banner ' + (S.prodMsgOk ? 'info' : 'warn') + '" style="margin-top:12px"><div>' + esc(S.prodMsg) + '</div></div>' : '') +
      (rows.length
        ? '<div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>编码</th><th>名称</th><th>条码</th><th>单位</th><th>分类</th></tr></thead><tbody>' +
          rows.map(function (p) {
            return '<tr><td class="mono">' + esc(p.code) + '</td><td>' + esc(p.name) + '</td><td class="mono">' + esc(p.barcode || '—') + '</td>' +
              '<td>' + esc(p.unit || '—') + '</td><td>' + esc(p.category || '—') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="pager"><span class="hint" style="margin-right:auto">共 ' + esc(S.data.prodTotal) + ' 条 · 第 ' + esc(S.data.prodPage) + ' 页</span>' +
          '<button class="btn sm ghost" data-action="prod-prev"' + (S.data.prodPage <= 1 ? ' disabled' : '') + '>上一页</button>' +
          '<button class="btn sm ghost" data-action="prod-next">下一页</button></div>'
        : '<div class="empty">没有商品，换个关键词或先新增一条</div>') +
    '</div>';
  }

  function newProductForm(f) {
    return '<div class="card flat" style="margin-top:14px">' +
      '<div class="panel-head"><h3 style="font-size:13px">新增商品</h3><span class="hint">编码与名称必填，单位/分类填名称会自动建档</span></div>' +
      '<div class="form-grid">' +
        field('编码', 'pf-code', f.code) + field('名称', 'pf-name', f.name) + field('条码', 'pf-barcode', f.barcode) +
        field('单位', 'pf-unit', f.unit) + field('分类', 'pf-category', f.category) + field('安全库存', 'pf-safety', f.safetyStock) +
      '</div>' +
      '<div class="row-actions"><button class="btn primary" data-action="prod-save"' + (S.prodBusy ? ' disabled' : '') + '>保存商品</button>' +
      '<button class="btn ghost" data-action="prod-cancel">取消</button></div></div>';
  }
  function field(label, id, value) {
    return '<div class="field"><label>' + esc(label) + '</label><input id="' + id + '" value="' + esc(value || '') + '" /></div>';
  }

  function parseCsv(text) {
    var rows = [];
    var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return rows;
    function split(line) {
      var out = [], cur = '', quote = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (quote) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') quote = false;
          else cur += ch;
        } else if (ch === '"') quote = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    }
    var head = split(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
    var idx = {
      code: head.indexOf('code') >= 0 ? head.indexOf('code') : head.indexOf('编码'),
      name: head.indexOf('name') >= 0 ? head.indexOf('name') : head.indexOf('名称'),
      barcode: head.indexOf('barcode') >= 0 ? head.indexOf('barcode') : head.indexOf('条码'),
      unit: head.indexOf('unit') >= 0 ? head.indexOf('unit') : head.indexOf('单位'),
      category: head.indexOf('category') >= 0 ? head.indexOf('category') : head.indexOf('分类'),
      safetyStock: head.indexOf('safetystock') >= 0 ? head.indexOf('safetystock') : head.indexOf('安全库存'),
    };
    for (var i = 1; i < lines.length; i++) {
      var c = split(lines[i]);
      rows.push({
        code: (c[idx.code] || '').trim(),
        name: (c[idx.name] || '').trim(),
        barcode: idx.barcode >= 0 ? (c[idx.barcode] || '').trim() : '',
        unit: idx.unit >= 0 ? (c[idx.unit] || '').trim() : '',
        category: idx.category >= 0 ? (c[idx.category] || '').trim() : '',
        safetyStock: idx.safetyStock >= 0 ? Number(c[idx.safetyStock] || 0) || undefined : undefined,
      });
    }
    return rows.filter(function (r) { return r.code && r.name; });
  }

  /** 行映射：兼容 Web 模板的中文表头与早期英文表头 */
  function mapRow(obj) {
    var keys = Object.keys(obj || {});
    function pick(names) {
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i].trim().toLowerCase().replace(/\s+/g, '');
        if (names.indexOf(k) >= 0) return String(obj[keys[i]] === undefined || obj[keys[i]] === null ? '' : obj[keys[i]]).trim();
      }
      return '';
    }
    return {
      code: pick(['code', '编码', '商品编码']),
      name: pick(['name', '名称', '商品名称']),
      barcode: pick(['barcode', '条码', '条形码']),
      unit: pick(['unit', '单位']),
      category: pick(['category', '分类', '类别']),
      spec: pick(['spec', '规格']),
      brand: pick(['brand', '品牌']),
      model: pick(['model', '型号']),
      costMethod: pick(['costmethod', '成本方法']),
      costPrice: pick(['costprice', '默认成本']),
      salePrice: pick(['saleprice', '售价']),
      safetyStock: Number(pick(['safetystock', '安全库存']) || 0) || undefined,
      initialQty: pick(['qty', '初始数量']),
      warehouse: pick(['warehouse', '仓库']),
      boxCode: pick(['boxcode', '货位编码']),
      remark: pick(['remark', '备注']),
    };
  }

  /** 模板下拉用的分类/单位（取不到就留空，不影响列结构） */
  async function dictForTemplate() {
    var out = { categories: [], units: [] };
    try {
      var r = isEnt()
        ? await api.api.call({ path: '/api/app/dicts', method: 'GET' })
        : await api.api.call({ path: apiPath('/meta'), method: 'GET' });
      if (r && r.ok && r.data) {
        var items = r.data.items || r.data;
        if (Array.isArray(items)) {
          items.forEach(function (x) {
            var t = String(x.type || x.kind || '').toLowerCase();
            var name = x.name || x.label || x.code || '';
            if (!name) return;
            if (t.indexOf('categor') >= 0 || t === 'category') out.categories.push(name);
            else if (t.indexOf('unit') >= 0 || t === 'unit') out.units.push(name);
          });
        }
        if (Array.isArray(r.data.categories)) out.categories = r.data.categories.map(function (c) { return c.name || c; });
        if (Array.isArray(r.data.units)) out.units = r.data.units.map(function (u) { return u.name || u; });
      }
    } catch (e) {}
    return out;
  }

  /**
   * 下载导入模板：和 Web 端同一套列结构（16 列，系统里有仓库时 18 列）。
   * 企业版优先让服务端实时生成（/api/products/template，能随系统状态变）；
   * 私有化部署没有这个开放接口，客户端按 Web 的列定义本地生成，保证「桌面下载 → Web 导入」表头对得上。
   */
  async function saveTemplate() {
    if (isEnt()) {
      var srv = await api.template.fetch();
      if (srv && srv.ok) return toast('已保存服务端模板（' + Math.round(srv.bytes / 1024) + 'KB）');
      if (srv && srv.canceled) return;
      toast((srv && srv.error) || '下载服务端模板失败', true);
      return;
    }

    var whs = (S.data.warehouses || []).map(function (w) { return w.name; }).filter(Boolean);
    var dict = await dictForTemplate();
    var r2 = await api.template.save({
      hasWarehouse: whs.length > 0,
      warehouses: whs,
      categories: dict.categories,
      units: dict.units,
    });
    if (r2 && r2.ok) {
      toast('模板已保存：' + r2.columns + ' 列 · ' + r2.sheet + '（' + (r2.engine === 'xlsx' ? '带下拉与填写说明' : '内置写入器') + '）');
      return;
    }
    if (r2 && r2.canceled) return;
    toast((r2 && r2.error) || '模板保存失败', true);
  }

  async function importProducts() {
    var picked = await api.file.pickTable();
    if (!picked || !picked.ok) { if (picked && !picked.canceled) toast(picked.error || '读取失败', true); return; }

    // 企业版：直接交给服务端导入（逐行 ok/skip/error，校验规则与 Web 完全一致）
    if (isEnt()) {
      S.prodBusy = true; S.prodMsg = '正在上传到服务端导入…'; S.prodMsgOk = true; render();
      var up = await api.import.upload({ path: picked.path });
      S.prodBusy = false;
      if (!up || !up.ok) {
        S.prodMsg = (up && up.error) || '导入失败'; S.prodMsgOk = false; render(); return;
      }
      var res = up.result || {};
      var bad = (res.failed || []).length;
      S.prodMsg = '服务端导入完成：新增 ' + (res.created || 0) + ' 条，跳过 ' + (res.skipped || 0) + ' 条，失败 ' + bad + ' 条' +
        (bad && res.results ? '（' + res.results.filter(function (x) { return x.status === 'error'; }).slice(0, 3).map(function (x) { return (x.code || '') + '：' + (x.message || x.error || ''); }).join('；') + '）' : '');
      S.prodMsgOk = bad === 0;
      await loadProducts(1);
      return;
    }

    var rawRows = picked.rows || [];
    var heads = rawRows.length ? Object.keys(rawRows[0]) : [];
    // 表头校验：和 Web 一样按文字匹配，缺必填列直接拒绝，避免用户拿旧模板瞎导
    var missing = ['商品编码', '商品名称'].filter(function (h) { return heads.indexOf(h) < 0 && heads.indexOf(h === '商品编码' ? 'code' : 'name') < 0; });
    if (missing.length) {
      S.prodMsg = '表头不匹配，请下载最新模板（缺少：' + missing.join('、') + '）';
      S.prodMsgOk = false;
      render();
      return;
    }
    var rows = rawRows.map(mapRow).filter(function (r) { return r.code && r.name; });
    if (!rows.length) { S.prodMsg = '这个文件里没有可用行（商品编码、商品名称为必填）'; S.prodMsgOk = false; render(); return; }
    S.prodBusy = true; S.prodMsg = '正在导入 ' + rows.length + ' 条…'; S.prodMsgOk = true; render();
    var ok = 0, fail = [], skip = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      // 只把开放接口认识的字段发上去（模板里的规格/品牌/仓库等留给 Web 端导入用）
      var body = {
        code: row.code,
        name: row.name,
        barcode: row.barcode || undefined,
        unit: row.unit || undefined,
        category: row.category || undefined,
        safetyStock: row.safetyStock,
      };
      var r = await api.api.call({ path: apiPath('/products'), method: 'POST', body: body });
      if (r.ok) ok++;
      else if (String(r.error || '').indexOf('已存在') >= 0 || r.status === 409) skip++;
      else fail.push(row.code + '：' + (r.error || '失败'));
      S.prodMsg = '正在导入 ' + (i + 1) + '/' + rows.length + '…';
      render();
    }
    S.prodBusy = false;
    S.prodMsg = '导入完成：新增 ' + ok + ' 条，跳过 ' + skip + ' 条，失败 ' + fail.length + ' 条' + (fail.length ? '（' + fail.slice(0, 3).join('；') + (fail.length > 3 ? '…' : '') + '）' : '') +
      '　提示：私有化部署没有服务端导入接口，逐条走开放接口建商品；规格/品牌/仓库/货位等字段需要在 Web 端导入';
    S.prodMsgOk = fail.length === 0;
    await loadProducts(1);
  }

  async function exportProducts() {
    S.prodMsg = '正在导出…'; S.prodMsgOk = true; render();
    var all = [], page = 1;
    for (;;) {
      var r = await api.api.call({ path: apiPath('/products'), method: 'GET', query: { keyword: S.form.prodKeyword || '', page: page, pageSize: 200 } });
      if (!r.ok) { S.prodMsg = r.error || '导出失败'; S.prodMsgOk = false; render(); return; }
      var items = (r.data && r.data.items) || [];
      all = all.concat(items);
      var total = num(r.data && r.data.total);
      if (!items.length || all.length >= total || page > 50) break;
      page++;
    }
    var saved = await api.file.saveTable({ name: '商品-' + new Date().toISOString().slice(0, 10) + '.xlsx', headers: ['code', 'name', 'barcode', 'unit', 'category'], rows: all });
    if (saved && saved.ok) { S.prodMsg = '已导出 ' + all.length + ' 条到 ' + saved.path; S.prodMsgOk = true; }
    else if (saved && !saved.canceled) { S.prodMsg = saved.error || '保存失败'; S.prodMsgOk = false; }
    render();
  }

  // ---------------- 更新 ----------------
  async function doCheckUpdate() {
    S.update.checking = true; S.update.error = ''; S.update.info = null; render();
    var r = await api.update.check();
    S.update.checking = false;
    if (!r.ok) { S.update.error = r.error || '检查失败'; render(); return; }
    S.update.info = r;
    render();
  }

  async function doInstallUpdate() {
    var info = S.update.info;
    if (!info || !info.sources || !info.sources.length) { toast('没有可用的下载源', true); return; }
    S.update.busy = true; S.update.pct = 0; S.update.error = ''; render();
    var off = api.update.onProgress(function (p) { S.update.pct = p.pct; var bar = q('#up-bar'); if (bar) bar.style.width = p.pct + '%'; var t = q('#up-pct'); if (t) t.textContent = p.pct + '%'; });
    var r = await api.update.install({ url: info.sources[0].url, sha256: info.sha256 });
    if (off) off();
    S.update.busy = false;
    if (!r.ok) { S.update.error = r.error || '更新失败'; render(); return; }
    toast('安装包已下载，正在启动安装程序…');
  }

  function updateBlockHtml() {
    var u = S.update || {};
    var info = u.info;
    var html = '<div class="card" style="margin-top:16px"><div class="section-head"><h3>软件更新</h3>' +
      '<span class="hint">当前版本 v' + esc(((S.status || {}).version) || '') + (((S.status || {}).sdkVersion) ? ' · SDK ' + esc(S.status.sdkVersion) : '') + '</span></div>';
    html += '<div class="row-actions" style="margin-top:0">' +
      '<button class="btn" data-action="check-update"' + (u.checking ? ' disabled' : '') + '>' + (u.checking ? '正在检查…' : '检查更新') + '</button>' +
      (info && info.hasUpdate ? '<button class="btn primary" data-action="install-update"' + (u.busy ? ' disabled' : '') + '>' + (u.busy ? '下载中…' : '下载并安装 v' + esc(info.latest)) + '</button>' : '') +
      '</div>';
    if (u.error) html += '<div class="err-inline">' + esc(u.error) + '</div>';
    if (info) {
      html += '<div class="kv" style="margin-top:12px">' +
        '<div class="k">最新版本</div><div class="v">v' + esc(info.latest) + (info.hasUpdate ? '（有新版本）' : '（已是最新）') + '</div>' +
        '<div class="k">清单来源</div><div class="v">' + esc(info.sourceUsed || '—') + ' · ' + esc(info.latencyMs) + 'ms</div>' +
        (info.sha256 ? '<div class="k">SHA256</div><div class="v">' + esc(String(info.sha256).slice(0, 24)) + '…</div>' : '') +
        (info.notes ? '<div class="k">更新说明</div><div class="v" style="white-space:pre-wrap">' + esc(info.notes) + '</div>' : '') +
        '</div>';
      if (info.sources && info.sources.length) {
        html += '<div class="hint" style="margin-top:10px">下载源（已按测速排序，取最快的）：</div><div class="kv">' +
          info.sources.map(function (s, i) { return '<div class="k">' + (i === 0 ? '最快' : '源 ' + (i + 1)) + '</div><div class="v">' + esc(s.ms + 'ms · ' + s.url) + '</div>'; }).join('') + '</div>';
      }
    }
    if (u.busy || u.pct) {
      html += '<div style="margin-top:12px;height:6px;border-radius:999px;background:#EEF2F8;overflow:hidden"><div id="up-bar" style="height:100%;width:' + esc(u.pct || 0) + '%;background:linear-gradient(90deg,#2563EB,#60A5FA);transition:width .2s"></div></div>' +
        '<div class="hint" style="margin-top:6px" id="up-pct">' + esc(u.pct || 0) + '%</div>';
    }
    html += '</div>';
    return html;
  }
  // ---------------- 渲染 ----------------
  function render() {
    document.body.setAttribute('data-view', S.view);
    var app = q('#app');
    if (S.view === 'boot') { app.innerHTML = loadingHtml(); return; }
    if (S.view === 'setup') { app.innerHTML = setupHtml(); return; }
    var content;
    if (S.view === 'workbench') content = workbenchHtml();
    else if (S.view === 'settings') content = settingsHtml();
    else if (S.view === 'inventory') content = inventoryHtml();
    else if (S.view === 'orders') content = ordersHtml();
    else if (S.view === 'products') content = productsHtml();
    else content = jobHtml(S.view);
    app.innerHTML = shellHtml(content);
  }

  function go(view) {
    S.view = view;
    S.submit.result = null;
    S.submit.error = '';
    if (JOBS[view]) { S.form.lines = []; S.form.remark = ''; S.form.type = (JOBS[view].types[0] || {}).v || ''; S.submit.idemKey = ''; S.form.autoPost = true; }
    if (view === 'inventory') { ensureWarehouses().then(function () { loadInventory(1); }); }
    if (view === 'orders') { loadOrders(S.data.ordersType, 1); }
    if (view === 'products') { S.prodMsg = ''; loadProducts(1); }
    if (view === 'workbench') { refreshRecent(); }
    render();
  }

  async function refreshRecent() {
    if (isEnt()) { S.data.orders = []; return; }
    try {
      var r = await api.api.call({ path: apiPath('/orders'), method: 'GET', query: { type: 'inbound', page: 1, pageSize: 5 } });
      if (!apiOk(r)) { S.data.ordersError = (r && r.error) || '单据读取失败'; return; }
      S.data.ordersError = '';
      S.data.orders = (r.data && r.data.items) || [];
      if (S.view === 'workbench') render();
    } catch (e) {}
  }

  function currentWarehouseId() { return S.form.warehouseId || (S.data.warehouses[0] && S.data.warehouses[0].id) || ''; }

  function autoLot() {
    var d = new Date();
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return 'B' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  async function addLine(p) {
    var line = { key: Date.now() + '-' + Math.random().toString(16).slice(2, 6), productId: p.id, code: p.code, name: p.name, unit: p.unit, qty: 1, lot: S.view === 'inbound' ? autoLot() : '', available: null };
    S.form.lines.push(line);
    render();
    // 出库：加进来就查这条商品在所选仓库的可用量
    if (S.view === 'outbound') {
      var wh = currentWarehouseId();
      if (wh) {
        try {
          var r = await api.api.call({ path: apiPath('/inventory'), method: 'GET', query: { warehouseId: wh, productId: p.id, page: 1, pageSize: 50 } });
          if (r && r.ok) {
            var rows = (r.data && r.data.items) || [];
            line.available = rows.reduce(function (s, x) { return s + num(x.available !== undefined ? x.available : x.onHand); }, 0);
            render();
          }
        } catch (e) {}
      }
    }
    var input = q('#inp-picker');
    if (input) { input.value = ''; input.focus(); }
  }

  async function submitJob() {
    if (S.submit.busy) return;
    var kind = S.view;
    var JOB = JOBS[kind];
    if (!JOB) return;
    var wh = currentWarehouseId();
    if (!wh) return toast('先选仓库', true);
    if (kind === 'transfer') {
      if (!S.form.toWarehouseId) return toast('选调入仓库', true);
      if (String(S.form.toWarehouseId) === String(wh)) return toast('调出与调入不能是同一个仓', true);
    }
    var lines = S.form.lines.filter(function (l) { return num(l.qty) > 0; });
    if (kind !== 'stocktake' && !lines.length) return toast('至少加一条商品', true);
    if (kind === 'inbound') {
      var badBox = lines.filter(function (l) {
        if (l.boxId) return false;
        var code = String(l.boxCode || '').trim();
        return !/^[A-Za-z0-9]+-\d+-\d+-\d+$/.test(code);
      });
      if (badBox.length) {
        return toast('第 ' + (lines.indexOf(badBox[0]) + 1) + ' 行没填合法的四段货位（示例 A-01-01-01）', true);
      }
    }
    if (kind === 'outbound') {
      var over = lines.filter(function (l) { return l.available !== null && l.available !== undefined && num(l.qty) > num(l.available); });
      if (over.length) {
        return toast('可用量不足：' + over.map(function (l) { return l.name + '（可用 ' + l.available + '）'; }).join('、'), true);
      }
    }

    var body;
    if (kind === 'inbound') {
      body = {
        warehouseId: Number(wh), type: S.form.type || 'PURCHASE', autoPost: !!S.form.autoPost, remark: S.form.remark || '',
        items: lines.map(function (l) {
          return {
            productId: Number(l.productId), quantity: num(l.qty), lotNumber: l.lot || undefined,
            boxId: l.boxId ? Number(l.boxId) : undefined,
            boxCode: l.boxCode || undefined,
          };
        }),
      };
    } else if (kind === 'outbound') {
      body = { warehouseId: Number(wh), type: S.form.type || 'SALE', autoPost: !!S.form.autoPost, remark: S.form.remark || '', items: lines.map(function (l) { return { productId: Number(l.productId), quantity: num(l.qty) }; }) };
    } else if (kind === 'transfer') {
      body = { fromWhId: Number(wh), toWhId: Number(S.form.toWarehouseId), remark: S.form.remark || '', items: lines.map(function (l) { return { productId: Number(l.productId), quantity: num(l.qty) }; }) };
    } else {
      body = { warehouseId: Number(wh), remark: S.form.remark || '' };
    }

    if (!S.submit.idemKey) S.submit.idemKey = 'yc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    S.submit.busy = true; S.submit.error = ''; S.submit.result = null;
    render();
    var r = await api.api.call({ path: apiPath('/' + JOB.endpoint), method: 'POST', body: body, idempotencyKey: S.submit.idemKey });
    S.submit.busy = false;
    if (!r.ok) {
      S.submit.error = r.error || '提交失败';
      if (r.code === 'KEY_INVALID') { S.invalid = r.error || '密钥已失效'; S.view = 'settings'; }
      // 网络类失败先把这一单存进草稿箱：用户不用重填，重放也不会重复入账
      var retryable = ['NETWORK', 'TIMEOUT', 'SERVER_ERROR', 'RATE_LIMITED'].indexOf(String(r.code || '')) >= 0;
      if (retryable) {
        try {
          await api.drafts.add({
            kind: kind,
            label: (JOBS[kind] && JOBS[kind].title) || kind,
            path: apiPath('/' + JOB.endpoint),
            method: 'POST',
            body: body,
            idempotencyKey: S.submit.idemKey,
            lastError: S.submit.error,
          });
          await loadDrafts();
          S.submit.error = S.submit.error + '（已存入草稿箱，可在工作台重放）';
        } catch (e) {}
      }
      render();
      toast(S.submit.error, true);
      return;
    }
    S.submit.result = r.data || {};
    S.submit.idemKey = ''; // 这一单已落库，下次提交换新键
    if (kind === 'stocktake') { await buildCountSheet(wh, S.submit.result); }
    toast('提交成功' + (S.submit.result.orderNo ? '：' + S.submit.result.orderNo : ''));
    loadWarehouses(true);
    render();
  }

  // ---------------- 商品搜索 ----------------
  var pickTimer = null;
  function onPickerInput(value) {
    clearTimeout(pickTimer);
    var box = q('#picker-list');
    if (!box) return;
    if (!value) { box.innerHTML = ''; box.style.display = 'none'; return; }
    pickTimer = setTimeout(async function () {
      box.style.display = 'block';
      box.innerHTML = '<div class="picker-empty">搜索中…</div>';
      var list = await searchProducts(value);
      if (!list.length) { box.innerHTML = '<div class="picker-empty">没有匹配的商品</div>'; return; }
      box.innerHTML = list.map(function (p, i) {
        return '<button class="picker-item" data-action="pick" data-index="' + i + '" data-id="' + esc(p.id) + '" data-code="' + esc(p.code) + '" data-name="' + esc(p.name) + '" data-unit="' + esc(p.unit) + '">' +
          '<span class="pi-name">' + esc(p.name) + '</span>' +
          '<span class="pi-meta mono">' + esc(p.code) + (p.unit ? ' · ' + esc(p.unit) : '') + '</span></button>';
      }).join('');
    }, 260);
  }

  // ---------------- 事件 ----------------
  document.addEventListener('click', function (e) {
    var locked = e.target.closest ? e.target.closest('[data-locked]') : null;
    if (locked) {
      toast('当前密钥没有开通「' + locked.getAttribute('data-locked') + '」，让管理员在云仓后台给这把密钥加权限即可', true);
      return;
    }
    var nav = e.target.closest ? e.target.closest('[data-nav]') : null;
    if (nav) {
      var v = nav.getAttribute('data-nav');
      if (v === 'settings') S.settings.baseUrl = (S.status && S.status.baseUrl) || S.settings.baseUrl;
      go(v);
      return;
    }
    var act = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!act) { var list = q('#picker-list'); if (list && !e.target.closest('.picker')) { list.style.display = 'none'; } return; }
    var a = act.getAttribute('data-action');

    if (a === 'pick') {
      addLine({ id: act.getAttribute('data-id'), code: act.getAttribute('data-code'), name: act.getAttribute('data-name'), unit: act.getAttribute('data-unit') });
    } else if (a === 'remove-line') {
      S.form.lines.splice(Number(act.getAttribute('data-index')), 1);
      render();
    } else if (a === 'order-view') {
      viewOrder(act.getAttribute('data-id'), S.data.ordersType);
    } else if (a === 'order-print') {
      var vo = S.data.viewingOrder;
      if (vo && vo.data) printOrder(vo.data, vo.kind);
    } else if (a === 'order-post') {
      postOrder(act.getAttribute('data-kind'), act.getAttribute('data-id'));
    } else if (a === 'order-send') {
      transferAction('send', act.getAttribute('data-id'));
    } else if (a === 'order-receive') {
      transferAction('receive', act.getAttribute('data-id'));
    } else if (a === 'order-count') {
      S.view = 'stocktake';
      loadCountOrder(act.getAttribute('data-id'));
      render();
    } else if (a === 'count-save') {
      saveCount();
    } else if (a === 'count-settle') {
      settleCount();
    } else if (a === 'count-export') {
      exportCount();
    } else if (a === 'count-print') {
      printCount();
    } else if (a === 'prod-template') {
      saveTemplate();
    } else if (a === 'submit') {
      submitJob();
    } else if (a === 'reset-form') {
      S.form.lines = []; S.form.remark = ''; S.submit.result = null; S.submit.error = ''; S.submit.idemKey = '';
      render();
    } else if (a === 'reload') {
      connect().then(function () { toast('已刷新'); });
    } else if (a === 'inv-search') {
      S.form.invKeyword = (q('#inp-inv-kw') || {}).value || '';
      S.form.invWarehouseId = (q('#sel-inv-wh') || {}).value || '';
      loadInventory(1);
    } else if (a === 'inv-prev') { loadInventory(Math.max(1, S.data.invPage - 1)); }
    else if (a === 'inv-next') { loadInventory(S.data.invPage + 1); }
    else if (a === 'orders-tab') { loadOrders(act.getAttribute('data-type'), 1); render(); }
    else if (a === 'prod-search') { S.form.prodKeyword = (q('#inp-prod-kw') || {}).value || ''; loadProducts(1); }
    else if (a === 'prod-prev') { loadProducts(Math.max(1, S.data.prodPage - 1)); }
    else if (a === 'prod-next') { loadProducts(S.data.prodPage + 1); }
    else if (a === 'prod-new') { S.prodOpen = true; S.prodForm = {}; S.prodMsg = ''; render(); }
    else if (a === 'prod-cancel') { S.prodOpen = false; S.prodForm = {}; render(); }
    else if (a === 'prod-save') {
      var pf = {
        code: (q('#pf-code') || {}).value || '',
        name: (q('#pf-name') || {}).value || '',
        barcode: (q('#pf-barcode') || {}).value || '',
        unit: (q('#pf-unit') || {}).value || '',
        category: (q('#pf-category') || {}).value || '',
        safetyStock: Number((q('#pf-safety') || {}).value || 0) || undefined,
      };
      if (!pf.code.trim() || !pf.name.trim()) return toast('编码与名称必填', true);
      S.prodBusy = true; render();
      var createPath = isEnt() ? '/api/app/products' : apiPath('/products');
      var createBody = isEnt() ? { sku: pf.code, name: pf.name, barcode: pf.barcode || undefined, safetyStock: pf.safetyStock } : pf;
      api.api.call({ path: createPath, method: 'POST', body: createBody }).then(function (r) {
        S.prodBusy = false;
        if (!r.ok) { S.prodMsg = (r.error || '保存失败'); S.prodMsgOk = false; render(); return; }
        S.prodOpen = false; S.prodForm = {}; S.prodMsg = '已新增商品 ' + pf.code + ' / ' + pf.name; S.prodMsgOk = true;
        loadProducts(1);
      });
    }
    else if (a === 'prod-import') { importProducts(); }
    else if (a === 'prod-export') { exportProducts(); }
    else if (a === 'check-update') { doCheckUpdate(); }
    else if (a === 'install-update') { doInstallUpdate(); }
    else if (a === 'orders-search') {
      S.orders.status = (q('#sel-order-status') || {}).value || '';
      S.orders.from = (q('#inp-order-from') || {}).value || '';
      S.orders.to = (q('#inp-order-to') || {}).value || '';
      S.orders.keyword = (q('#inp-order-kw') || {}).value || '';
      loadOrders(S.data.ordersType, 1);
    }
    else if (a === 'orders-reset') {
      S.orders.status = ''; S.orders.from = ''; S.orders.to = ''; S.orders.keyword = ''; S.orders.msg = '';
      loadOrders(S.data.ordersType, 1);
    }
    else if (a === 'orders-batch-post') { batchPostOrders(); }
    else if (a === 'orders-clear-sel') { S.orders.selected = {}; render(); }
    else if (a === 'orders-export') { exportOrders(); }
    else if (a === 'draft-replay') { replayDraft(act.getAttribute('data-id')); }
    else if (a === 'draft-replay-all') { replayAllDrafts(); }
    else if (a === 'draft-drop') {
      api.drafts.remove(act.getAttribute('data-id')).then(function () { return loadDrafts(); }).then(function () { toast('草稿已删除'); render(); });
    }
    else if (a === 'draft-clear') {
      if (!confirm('清空草稿箱？没提交成功的作业会丢。')) return;
      api.drafts.clear().then(function () { return loadDrafts(); }).then(function () { toast('草稿箱已清空'); render(); });
    }
    else if (a === 'prefs-save') { savePrefs(); }
    else if (a === 'prefs-print-demo') {
      printDoc({
        title: '入库单（样张）',
        no: 'IN-DEMO-0001',
        meta: [['单号', 'IN-DEMO-0001'], ['状态', 'POSTED'], ['仓库', '上海一号仓'], ['日期', fmtTime(new Date().toISOString())], ['制单人', (S.prefs && S.prefs.operator) || (S.me && S.me.name) || '—'], ['备注', '打印样张，可关掉']],
        columns: [{ key: 'idx', label: '#' }, { key: 'code', label: '商品编码' }, { key: 'name', label: '名称' }, { key: 'unit', label: '单位' }, { key: 'qty', label: '数量', align: 'right' }],
        rows: [{ idx: 1, code: 'SKU-1001', name: '丁腈手套 M', unit: '箱', qty: 12 }, { idx: 2, code: 'SKU-2087', name: '医用棉签 10cm', unit: '包', qty: 40 }],
        totals: '合计数量 <b>52</b>',
        signers: ['制单', '复核', '仓管员'],
      });
    }
    else if (a === 'mode-tab') {
      var m = act.getAttribute('data-mode');
      if (m === S.mode) return;
      S.mode = m;
      S.settings.error = '';
      render();
      if (m === 'enterprise' && !S.ent.captchaImage) loadEntCaptcha();
    }
    else if (a === 'goto-enterprise') {
      S.mode = 'enterprise';
      S.view = 'setup';
      S.ent.error = '';
      render();
      loadEntCaptcha();
    }
    else if (a === 'goto-private') {
      S.mode = 'private';
      S.view = 'setup';
      S.setup.error = '';
      render();
    }
    else if (a === 'ent-captcha') { loadEntCaptcha(); }
    else if (a === 'ent-login') { doEntLogin(); }
    else if (a === 'ent-logout') {
      if (!confirm('退出企业版登录？退出后需要重新输入账号密码与验证码。')) return;
      api.ent.logout().then(function () { S.session = null; S.me = null; S.mode = 'private'; toast('已退出企业版'); connect(); });
    }
    else if (a === 'diag-refresh') { connect().then(function () { toast('已重新探测服务端能力'); }); }
    else if (a === 'diag-copy') {
      var text = diagText();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('诊断信息已复制'); }, function () { toast('复制失败，请手动截图', true); });
      } else {
        toast('当前环境不支持复制，请手动截图', true);
      }
    }
    else if (a === 'orders-prev') { loadOrders(S.data.ordersType, Math.max(1, S.data.ordersPage - 1)); }
    else if (a === 'orders-next') { loadOrders(S.data.ordersType, S.data.ordersPage + 1); }
    else if (a === 'setup-test') doTest('setup');
    else if (a === 'setup-save') doSave('setup');
    else if (a === 'settings-test') doTest('settings');
    else if (a === 'settings-save') doSave('settings');
    else if (a === 'settings-clear') {
      if (!confirm('清除本机保存的地址与密钥？清除后需要重新配置。')) return;
      api.config.clear().then(function () { S.status = null; S.session = null; S.me = null; toast('本机配置已清除'); connect(); });
    } else if (a === 'reveal') {
      api.config.reveal().then(function (r) { toast(r && r.copied ? '配置文件还没生成，路径已复制' : '已在文件夹中定位'); });
    } else if (a === 'uninstall') {
      if (!confirm('确定卸载云仓？\\n\\n将删除程序本体、本机配置（服务器地址与密钥）、缓存和快捷方式。')) return;
      api.app.uninstall().then(function (r) { toast(r && r.ok ? '正在启动卸载程序…' : ((r && r.error) || '未找到卸载程序'), !(r && r.ok)); });
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    // 只处理本界面认识的输入：有 id / 行号（作业表单）/ data-count（盘点实盘）
    if (!t || (!t.id && !t.getAttribute('data-line') && !t.getAttribute('data-count'))) return;
    if (t.id === 'inp-picker') return onPickerInput(t.value);
    if (t.id === 'inp-remark') { S.form.remark = t.value; return; }
    if (t.id === 'inp-inv-kw') { S.form.invKeyword = t.value; return; }
    if (t.id === 'inp-prod-kw') { S.form.prodKeyword = t.value; return; }
    var ci = t.getAttribute ? t.getAttribute('data-count') : null;
    if (ci !== null && ci !== undefined && ci !== '' && S.count) {
      var row = S.count.rows[Number(ci)];
      if (row) {
        row.actual = t.value;
        recountDiff(row);
        var tr = t.closest('tr');
        var cell = tr ? tr.querySelector('[data-diff]') : null;
        if (cell) {
          cell.textContent = row.diff === '' ? '—' : String(row.diff);
          cell.className = 'mono ' + (row.diff === '' ? '' : (Number(row.diff) > 0 ? 'pos' : (Number(row.diff) < 0 ? 'neg' : '')));
        }
        updateCountChips();
      }
      return;
    }
    if (t.id && t.id.indexOf('pf-') === 0) { S.prodForm = S.prodForm || {}; S.prodForm[t.id.slice(3)] = t.value; return; }
    if (t.id === 'ent-url') { S.ent.platformUrl = t.value; return; }
    if (t.id === 'ent-account') { S.ent.account = t.value; return; }
    if (t.id === 'ent-password') { S.ent.password = t.value; return; }
    if (t.id === 'ent-answer') { S.ent.answer = t.value; return; }
    if (t.id === 'pref-header') { S.prefs.printHeader = t.value; return; }
    if (t.id === 'pref-footer') { S.prefs.printFooter = t.value; return; }
    if (t.id === 'pref-operator') { S.prefs.operator = t.value; return; }
    if (t.id === 'inp-order-kw') { S.orders.keyword = t.value; return; }
    if (t.id === 'setup-url') { S.setup.baseUrl = t.value; return; }
    if (t.id === 'setup-token') { S.setup.token = t.value; return; }
    if (t.id === 'set-url') { S.settings.baseUrl = t.value; return; }
    if (t.id === 'set-token') { S.settings.token = t.value; return; }
    var idx = t.getAttribute('data-line');
    if (idx !== null && idx !== undefined && idx !== '') {
      var line = S.form.lines[Number(idx)];
      if (!line) return;
      var f = t.getAttribute('data-field');
      if (f === 'qty') line.qty = t.value;
      if (f === 'lot') line.lot = t.value;
      if (f === 'boxCode') { line.boxCode = String(t.value || '').trim().toUpperCase(); return; }
      if (f === 'boxId') {
      line.boxId = t.value;
      var opt = t.options && t.selectedIndex >= 0 ? t.options[t.selectedIndex] : null;
      line.boxCode = opt ? (opt.getAttribute('data-code') || '') : '';
    }
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t) return;
    var lineIdx = t.getAttribute ? t.getAttribute('data-line') : null;
    if (lineIdx !== null && lineIdx !== undefined && lineIdx !== '') {
      var ln = S.form.lines[Number(lineIdx)];
      if (ln && t.getAttribute('data-field') === 'boxId') {
        ln.boxId = t.value;
        var o2 = t.options && t.selectedIndex >= 0 ? t.options[t.selectedIndex] : null;
        ln.boxCode = o2 ? (o2.getAttribute('data-code') || '') : '';
      }
      return;
    }
    if (t.id === 'sel-warehouse') { S.form.warehouseId = t.value; S.form.lines.forEach(function (l) { l.boxId = ''; l.boxCode = ''; }); render(); }
    else if (t.id === 'sel-to-warehouse') S.form.toWarehouseId = t.value;
    else if (t.id === 'sel-type') S.form.type = t.value;
    else if (t.id === 'sel-autopost') S.form.autoPost = !!t.checked;
    else if (t.id === 'sel-inv-wh') { S.form.invWarehouseId = t.value; loadInventory(1); }
    else if (t.id === 'sel-order-status') { S.orders.status = t.value; render(); }
    else if (t.id === 'inp-order-from') { S.orders.from = t.value; }
    else if (t.id === 'inp-order-to') { S.orders.to = t.value; }
    else if (t.id === 'chk-order-all') {
      var rows = visibleOrders();
      if (t.checked) rows.forEach(function (r) { S.orders.selected[String(r.id)] = true; });
      else S.orders.selected = {};
      render();
    }
    else if (t.className && String(t.className).indexOf('chk-order') >= 0 && t.getAttribute('data-id')) {
      S.orders.selected[t.getAttribute('data-id')] = !!t.checked;
      render();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.target.id === 'inp-picker')) {
      e.preventDefault();
      var first = q('.picker-item');
      if (first) first.click();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && JOBS[S.view]) submitJob();
  });

  // ---------------- 配置流程 ----------------
  async function connect() {
    S.view = 'boot'; render();
    S.status = await api.config.status();
    S.mode = (S.status && S.status.mode) || 'private';
    S.settings.baseUrl = S.status.baseUrl || '';
    if (S.mode === 'enterprise') {
      S.ent.platformUrl = S.status.platformUrl || S.ent.platformUrl;
      S.ent.account = S.status.account || S.ent.account;
    }
    if (!S.status.configured) {
      S.view = 'setup'; render();
      if (S.mode === 'enterprise' && !S.ent.captchaImage) loadEntCaptcha();
      return;
    }
    var s = await api.session.connect();
    S.session = s;
    if (!s.ok) {
      S.me = null;
      if (S.mode === 'enterprise') {
        // 会话过期（JWT 2 小时）→ 回登录页重新拿验证码
        S.view = 'setup';
        S.ent.error = s.error || '企业版会话已过期，请重新登录';
        render();
        if (!S.ent.captchaImage) loadEntCaptcha();
        return;
      }
      if (s.code === 'KEY_INVALID' || s.code === 'SCOPE_DENIED') { S.invalid = s.error || '密钥已失效'; S.view = 'settings'; }
      else { S.invalid = ''; S.view = 'settings'; S.settings.error = s.error || '连接失败'; }
      render(); return;
    }
    if (s.mode === 'enterprise') {
      S.mode = 'enterprise';
      S.ent.tenant = s.tenant || null;
    }
    S.invalid = '';
    S.settings.error = '';
    S.profile = s.profile || null;
    S.me = s.me || null;
    S.catalog = s.catalog || null;
    S.view = 'workbench';
    render();
    await Promise.all([ensureWarehouses(true), loadPrefs(), loadDrafts()]);
    await refreshRecent();
    render();
  }

  async function ensureWarehouses(force) {
    var list = await loadWarehouses(force);
    if (!S.form.warehouseId && list.length) S.form.warehouseId = String(list[0].id);
    if (S.view === 'workbench' || JOBS[S.view] || S.view === 'inventory') render();
    return list;
  }

  async function doTest(which) {
    var box = which === 'settings' ? S.settings : S.setup;
    var url = (q(which === 'settings' ? '#set-url' : '#setup-url') || {}).value || box.baseUrl;
    var token = (q(which === 'settings' ? '#set-token' : '#setup-token') || {}).value || box.token;
    box.baseUrl = url; box.token = token;
    if (which === 'settings' && !token) { box.error = '请填写新密钥再测试'; render(); return; }
    box.testing = true; box.error = ''; box.tested = null; render();
    var r = await api.config.test({ baseUrl: url, token: token });
    box.testing = false;
    if (!r.ok) box.error = (r.code === 'KEY_INVALID' ? '密钥无效或已过期：' : '') + (r.error || '连接失败');
    else box.tested = r;
    render();
  }

  async function doSave(which) {
    var box = which === 'settings' ? S.settings : S.setup;
    var url = (q(which === 'settings' ? '#set-url' : '#setup-url') || {}).value || box.baseUrl;
    var token = (q(which === 'settings' ? '#set-token' : '#setup-token') || {}).value || box.token;
    box.baseUrl = url; box.token = token;
    if (!url) { box.error = '请填写服务器地址'; render(); return; }
    if (which === 'setup' && !token) { box.error = '请填写密钥'; render(); return; }
    box.saving = true; box.testing = true; box.error = ''; box.tested = null; render();
    var r = await api.config.save({ baseUrl: url, token: token });
    box.saving = false; box.testing = false;
    if (!r.ok) { box.error = (r.code === 'KEY_INVALID' ? '密钥无效或已过期：' : '') + (r.error || '保存失败'); render(); return; }
    toast('配置已保存');
    await connect();
  }

  connect();
})();
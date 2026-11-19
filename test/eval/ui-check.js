// 渲染层点击链路自检（0.5.9）：不依赖网络，打 mock 服务
(async function () {
  var out = { errors: [], steps: {} };
  window.addEventListener('error', function (e) { out.errors.push(String((e && e.message) || e)); });
  window.addEventListener('unhandledrejection', function (e) { out.errors.push('unhandled: ' + String((e && e.reason && e.reason.message) || e.reason)); });
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function click(sel) { var el = document.querySelector(sel); if (!el) return false; el.click(); return true; }
  function txt(sel) { var el = document.querySelector(sel); return el ? String(el.textContent || '').trim() : ''; }

  // 1) 工作台：能力齐全时不应该出现「服务端版本偏旧」
  await wait(200);
  out.steps.view = document.body.getAttribute('data-view');
  out.steps.oldServerBanner = document.body.innerHTML.indexOf('服务端版本偏旧') >= 0;
  out.steps.draftBanner = document.body.innerHTML.indexOf('草稿箱里还有') >= 0;

  // 2) 单据记录：切过去 → 应有表格行
  click('[data-nav="orders"]');
  await wait(700);
  out.steps.orderRows = document.querySelectorAll('tbody tr').length;
  out.steps.orderToolbar = !!document.querySelector('#sel-order-status') && !!document.querySelector('#inp-order-from');
  out.steps.postDisabled = (function () { var b = document.querySelector('[data-action="orders-batch-post"]'); return b ? b.disabled : null; })();

  // 3) 查看明细：0.5.8 这里点了会抛 t is not defined
  out.steps.viewClicked = click('[data-action="order-view"]');
  await wait(700);
  out.steps.dialogTitle = txt('#dialog-title');
  out.steps.dialogRows = document.querySelectorAll('#dialog-body tbody tr').length;
  click('#dialog-close');
  await wait(200);

  // 4) 单张过账（草稿行）→ 应有 toast
  var postBtn = document.querySelector('[data-action="order-post"]');
  out.steps.postBtn = !!postBtn;
  if (postBtn) { postBtn.click(); await wait(900); }
  out.steps.toast = txt('#toast');

  // 5) 勾选 + 批量过账按钮状态
  var chk = document.querySelector('.chk-order');
  if (chk) { chk.click(); await wait(300); }
  out.steps.selectedCount = document.querySelectorAll('.chk-order:checked').length;

  // 6) 设置页：诊断 + 打印设置
  click('[data-nav="settings"]');
  await wait(500);
  var html = document.body.innerHTML;
  out.steps.diagCard = html.indexOf('服务端诊断') >= 0;
  out.steps.diagCapNote = html.indexOf('能力齐全') >= 0;
  out.steps.prefsCard = html.indexOf('打印设置') >= 0 && !!document.querySelector('#pref-header');
  out.steps.version = txt('.foot-version');
  // 7) 复核 0.5.8 发版说明里的 7 条：逐条给出证据
  function opts(sel) { var el = document.querySelector(sel); return el ? Array.prototype.map.call(el.options, function (o) { return o.textContent.trim() + '=' + o.value; }) : []; }

  // (1) 六种入库类型
  click('[data-nav="inbound"]');
  await wait(800);
  out.steps.inboundTypes = opts('#sel-type');
  out.steps.inboundTypeCount = out.steps.inboundTypes.length;

  // (2) 四段货位下拉：搜一个商品加进单据，货位下拉必须是四段
  var picker = document.querySelector('#inp-picker');
  if (picker) {
    picker.value = 'SKU';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(700);
    var item = document.querySelector('.picker-item');
    out.steps.pickerItem = !!item;
    if (item) { item.click(); await wait(700); }
  }
  out.steps.boxSelects = document.querySelectorAll('select[data-field="boxId"]').length;
  out.steps.boxOptions = (function () {
    var sel = document.querySelector('select[data-field="boxId"]');
    if (!sel) return [];
    return Array.prototype.map.call(sel.options, function (o) { return String(o.value) + '|' + String(o.getAttribute('data-code') || ''); });
  })();
  out.steps.boxFourSeg = out.steps.boxOptions.some(function (v) { return /-[0-9]+-[0-9]+-[0-9]+\|/.test(v); });
  // (3) 小窗口滚动：内容区 overflow 可滚
  var content = document.querySelector('.content');
  out.steps.contentOverflow = content ? getComputedStyle(content).overflowY : '';

  // (4) 调拨：发运按钮可点
  click('[data-nav="orders"]');
  await wait(600);
  click('[data-action="orders-tab"][data-type="transfer"]');
  await wait(600);
  out.steps.transferSendBtn = !!document.querySelector('[data-action="order-send"]');
  if (document.querySelector('[data-action="order-send"]')) { document.querySelector('[data-action="order-send"]').click(); await wait(800); }
  out.steps.transferToast = txt('#toast');

  // (5) 盘点：录入实盘能拉出明细
  click('[data-action="orders-tab"][data-type="stocktake"]');
  await wait(600);
  var countBtn = document.querySelector('[data-action="order-count"]');
  out.steps.countBtn = !!countBtn;
  if (countBtn) { countBtn.click(); await wait(900); }
  out.steps.countRows = document.querySelectorAll('input[data-count]').length;
  out.steps.countSettleBtn = !!document.querySelector('[data-action="count-settle"]');

  // (6) 打印：拦截 window.open 看抬头与签字栏
  click('[data-nav="orders"]');
  await wait(600);
  click('[data-action="orders-tab"][data-type="inbound"]');
  await wait(600);
  click('[data-action="order-view"]');
  await wait(700);
  out.steps.printCapture = (function () {
    var captured = '';
    var orig = window.open;
    window.open = function () { return { document: { write: function (h) { captured += h; }, close: function () {} } }; };
    var btn = document.querySelector('[data-action="order-print"]');
    if (btn) btn.click();
    window.open = orig;
    return { len: captured.length, hasHeader: captured.indexOf('云仓测试抬头') >= 0, hasSign: captured.indexOf('仓管员') >= 0, hasTotal: captured.indexOf('合计数量') >= 0 };
  })();
  return out;
})()

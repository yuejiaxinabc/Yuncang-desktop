(async function () {
  var out = { size: [window.innerWidth, window.innerHeight], errors: [] };
  window.addEventListener('error', function (e) { out.errors.push(String((e && e.message) || e)); });
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function click(sel) { var el = document.querySelector(sel); if (el) el.click(); return !!el; }
  await wait(300);

  function scrollProbe(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var before = el.scrollTop;
    el.scrollTop = 999999;
    var after = el.scrollTop;
    el.scrollTop = before;
    var cs = getComputedStyle(el);
    return { overflowY: cs.overflowY, clientH: el.clientHeight, scrollH: el.scrollHeight, moved: after > before, maxScroll: after };
  }

  out.workbench = scrollProbe('.content');

  // 单据记录：长表格
  click('[data-nav="orders"]');
  await wait(700);
  out.orders = scrollProbe('.content');

  // 设置页：长表单
  click('[data-nav="settings"]');
  await wait(600);
  out.settings = scrollProbe('.content');

  // 弹窗内部滚动：打开单据详情
  click('[data-nav="orders"]');
  await wait(700);
  click('[data-action="order-view"]');
  await wait(800);
  out.dialog = scrollProbe('#dialog-body');
  out.dialogMask = scrollProbe('.dialog');
  return out;
})()
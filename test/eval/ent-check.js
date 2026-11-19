(async function () {
  function wait(ms){return new Promise(r=>setTimeout(r,ms));}
  function click(sel){var el=document.querySelector(sel);if(el)el.click();return !!el;}
  function txt(sel){var el=document.querySelector(sel);return el?String(el.textContent||'').trim():'';}
  function setv(sel,v){var el=document.querySelector(sel);if(!el)return false;el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));return true;}
  var out={steps:{},errors:[]};
  window.addEventListener('error',function(e){out.errors.push(String((e&&e.message)||e));});
  await wait(300);
  out.steps.startView=document.body.getAttribute('data-view');
  // 切到企业版
  click('[data-action="mode-tab"][data-mode="enterprise"]');
  await wait(700);
  out.steps.entForm=!!document.querySelector('#ent-account');
  setv('#ent-url','@@PLATFORM@@');
  // 切到企业版时会先去默认平台取验证码；这里改成 mock 后再取一次
  click('[data-action="ent-captcha"]');
  await wait(900);
  out.steps.captchaImg=!!document.querySelector('img#ent-captcha');
  setv('#ent-account','13800000000');
  setv('#ent-password','Yc@Demo2026');
  setv('#ent-answer','abcd');
  click('[data-action="ent-login"]');
  await wait(2200);
  out.steps.viewAfterLogin=document.body.getAttribute('data-view');
  out.steps.errInline=(document.querySelector('.err-inline')||{}).textContent||'';
  out.steps.toastNow=(document.querySelector('#toast')||{}).textContent||'';
  out.steps.tenantBanner=document.body.innerHTML.indexOf('云仓演示企业')>=0;
  out.steps.jobsLocked=document.body.innerHTML.indexOf('企业版未开放')>=0;
  // 库存
  click('[data-nav="inventory"]');
  await wait(1200);
  out.steps.invRows=Array.prototype.map.call(document.querySelectorAll('tbody tr'),function(tr){
    return Array.prototype.map.call(tr.children,function(td){return String(td.textContent||'').trim();});
  }).slice(0,2);
  // 商品
  click('[data-nav="products"]');
  await wait(1200);
  out.steps.prodRows=document.querySelectorAll('tbody tr').length;
  // 设置页
  click('[data-nav="settings"]');
  await wait(700);
  out.steps.settingsEnt=document.body.innerHTML.indexOf('企业版身份')>=0;
  out.steps.footer=txt('.foot-version');
  return out;
})()
(async function () {
  function wait(ms){return new Promise(r=>setTimeout(r,ms));}
  function click(sel){var el=document.querySelector(sel);if(el)el.click();return !!el;}
  var out={steps:{},errors:[]};
  window.addEventListener('error',function(e){out.errors.push(String((e&&e.message)||e));});
  await wait(300);
  click('[data-nav="inbound"]');
  await wait(800);
  // 手动填四段货位（服务端不下发 boxes 时的兜底）
  var picker=document.querySelector('#inp-picker');
  picker.value='SKU'; picker.dispatchEvent(new Event('input',{bubbles:true}));
  await wait(700);
  var item=document.querySelector('.picker-item'); if(item){item.click(); await wait(600);}
  var boxInput=document.querySelector('input[data-field="boxCode"]');
  out.steps.hasManualBox=!!boxInput;
  out.steps.hint=boxInput?boxInput.getAttribute('title'):'';
  if(boxInput){boxInput.value='A-01-02-03';boxInput.dispatchEvent(new Event('input',{bubbles:true}));}
  click('[data-action="submit"]');
  await wait(1200);
  out.steps.toast=(document.querySelector('#toast')||{}).textContent||'';
  return out;
})()
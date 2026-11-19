(async function () {
  function wait(ms){return new Promise(r=>setTimeout(r,ms));}
  function click(sel){var el=document.querySelector(sel);if(el)el.click();return !!el;}
  function txt(sel){var el=document.querySelector(sel);return el?String(el.textContent||'').trim():'';}
  var out={steps:{},errors:[]};
  window.addEventListener('error',function(e){out.errors.push(String((e&&e.message)||e));});
  await wait(300);
  click('[data-nav="orders"]');
  await wait(600);
  click('[data-action="orders-tab"][data-type="stocktake"]');
  await wait(600);
  click('[data-action="order-count"]');
  await wait(1000);
  var inputs=document.querySelectorAll('input[data-count]');
  out.steps.inputs=inputs.length;
  if(inputs[0]){inputs[0].value='1250';inputs[0].dispatchEvent(new Event('input',{bubbles:true}));await wait(200);}
  out.steps.diff0=(document.querySelector('[data-diff="0"]')||{}).textContent||'';
  out.steps.chipFilled=txt('#count-filled');
  out.steps.chipDiffs=txt('#count-diffs');
  if(inputs[1]){inputs[1].value='86';inputs[1].dispatchEvent(new Event('input',{bubbles:true}));await wait(200);}
  out.steps.diff1=(document.querySelector('[data-diff="1"]')||{}).textContent||'';
  out.steps.chipFilled2=txt('#count-filled');
  out.steps.chipDiffs2=txt('#count-diffs');
  click('[data-action="count-save"]');
  await wait(1000);
  out.steps.toast=txt('#toast');
  return out;
})()
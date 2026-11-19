(async function () {
  function wait(ms){return new Promise(r=>setTimeout(r,ms));}
  await wait(400);
  var shell=document.querySelector('.shell'), c=document.querySelector('.content');
  return {
    inner:[window.innerWidth,window.innerHeight],
    dpr: window.devicePixelRatio,
    docClientH: document.documentElement.clientHeight,
    bodyH: document.body.getBoundingClientRect().height,
    shellH: shell? shell.getBoundingClientRect().height : null,
    shellStyleH: shell? getComputedStyle(shell).height : null,
    contentH: c? c.getBoundingClientRect().height : null,
    vh100: getComputedStyle(document.documentElement).getPropertyValue('--vh') || '',
    zoom: (window.require? 'n/a' : 'n/a')
  };
})()
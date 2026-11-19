'use strict';
/**
 * 盘点录实盘：填了数字必须立刻算出差异，保存时要真的把 items[{itemId,countQty}] 发出去。
 * 0.5.10 之前的 bug：input 监听器第一行只放行 id / data-line 的输入，
 * 盘点框只有 data-count，于是 early return —— 打了数字，差异不动、保存空提交。
 */
const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const {start}=require('./mock-server');
const ROOT=path.resolve(__dirname,'..');
const PORT=Number(25000+Math.floor(Math.random()*3000));
(async()=>{
  const {server,seen}=await start(PORT);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-count-'));
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({version:1,baseUrl:'http://127.0.0.1:'+PORT,token:'yc_live_goodkey_1234567890',enc:'plain',apiProfile:'desktop'}));
  const env=Object.assign({},process.env); delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),['.','--smoke-ui','--user-data-dir='+dir,'--size=1280x832','--eval-file='+path.join(__dirname,'eval','count-check.js')],{cwd:ROOT,env});
  let out=''; child.stdout.on('data',c=>out+=c); child.stderr.on('data',c=>out+=c);
  await new Promise(r=>child.on('exit',r));
  server.close();
  const line=out.split('\n').find(l=>l.startsWith('SMOKE_EVAL '));
  if(!line){ console.error('FAIL 没有结果\n'+out.slice(-1200)); process.exit(1); }
  const r=JSON.parse(line.slice(11));
  const patch=seen.find(x=>x.method==='PATCH'&&/\/stocktake\//.test(x.path)&&x.body);
  const body=patch?JSON.parse(patch.body):null;
  const checks=[
    ['渲染层无异常',r.errors.length===0,JSON.stringify(r.errors)],
    ['盘点明细加载出 2 行',Number(r.steps.inputs)===2,String(r.steps.inputs)],
    ['填 1250（账面 1240）差异显示 +10',String(r.steps.diff0).trim()==='10',String(r.steps.diff0)],
    ['已盘计数实时更新',/已盘 1\/2/.test(String(r.steps.chipFilled)),String(r.steps.chipFilled)],
    ['差异计数实时更新',/差异 1/.test(String(r.steps.chipDiffs)),String(r.steps.chipDiffs)],
    ['填 86（账面 86）差异为 0',String(r.steps.diff1).trim()==='0',String(r.steps.diff1)],
    ['两行都填后 已盘 2/2、差异 1',/已盘 2\/2/.test(String(r.steps.chipFilled2))&&/差异 1/.test(String(r.steps.chipDiffs2)),JSON.stringify([r.steps.chipFilled2,r.steps.chipDiffs2])],
    ['保存实盘发出了 PATCH 且带 2 行 itemId/countQty',!!body&&Array.isArray(body.items)&&body.items.length===2&&body.items[0].itemId===91&&body.items[0].countQty===1250,JSON.stringify(body)],
    ['保存后有成功提示',/已保存|保存成功|实盘已保存/.test(String(r.steps.toast)),String(r.steps.toast)],
  ];
  let bad=0;
  for(const [n,ok,d] of checks){ if(ok)console.log('PASS '+n); else {bad++;console.log('FAIL '+n+' :: '+d);} }
  console.log(bad?'COUNT_CHECK_FAILED':'COUNT_CHECK_OK');
  if(bad)process.exit(1);
})();
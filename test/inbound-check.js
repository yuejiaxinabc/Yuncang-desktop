'use strict';
// 服务端不下发小货位（真实情况：/open/warehouses 只给 zones.locations）时，
// 入库必须还能靠手填四段编码走通，且请求体里只带 boxCode、不带 boxId。
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const PORT=Number(24000+Math.floor(Math.random()*3000));
const seen=[];
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  let body='';
  req.on('data',c=>body+=c);
  req.on('end',()=>{
    seen.push({method:req.method,path:url.pathname,body});
    const json=(s,o)=>{res.writeHead(s,{'content-type':'application/json'});res.end(JSON.stringify(o));};
    const ok=(d)=>json(200,{success:true,data:d});
    if(url.pathname==='/api/v1/desktop/me')return ok({name:'无货位测试',scopes:['product:read','warehouse:read','stock:write','order:read'],warehouseIds:[1]});
    if(url.pathname==='/api/v1/desktop/catalog')return ok({endpoints:[],lockedEndpoints:[]});
    if(url.pathname==='/api/v1/desktop/warehouses')return ok({items:[{id:'1',code:'SH01',name:'上海一号仓',zones:[{id:1,code:'A',name:'A区',locations:[{id:11,code:'01-02',name:'一排二位'}]}]}],total:1});
    if(url.pathname==='/api/v1/desktop/products')return ok({items:[{id:'38',code:'SKU-1001',name:'丁腈手套 M',unit:'箱'}],total:1});
    if(url.pathname==='/api/v1/desktop/stock-in'&&req.method==='POST')return ok({orderNo:'IN-X-1',status:'POSTED'});
    return json(404,{success:false,error:'not found'});
  });
});
(async()=>{
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-inbound-'));
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({version:1,baseUrl:'http://127.0.0.1:'+PORT,token:'yc_live_goodkey_1234567890',enc:'plain',apiProfile:'desktop'}));
  const env=Object.assign({},process.env); delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),['.','--smoke-ui','--user-data-dir='+dir,'--size=1280x832','--eval-file='+path.join(__dirname,'eval','inbound-check.js')],{cwd:ROOT,env});
  let out=''; child.stdout.on('data',c=>out+=c); child.stderr.on('data',c=>out+=c);
  await new Promise(r=>child.on('exit',r));
  server.close();
  const line=out.split('\n').find(l=>l.startsWith('SMOKE_EVAL '));
  if(!line){ console.error('FAIL 没有结果\n'+out.slice(-1500)); process.exit(1); }
  const r=JSON.parse(line.slice(11));
  const sub=seen.find(x=>x.path==='/api/v1/desktop/stock-in'&&x.method==='POST');
  const body=sub?JSON.parse(sub.body||'{}'):null;
  const checks=[
    ['渲染层无异常',r.errors.length===0,JSON.stringify(r.errors)],
    ['无 boxes 时出现手填四段货位输入框',r.steps.hasManualBox===true,String(r.steps.hasManualBox)],
    ['提示说明服务端没下发 boxes',/boxes|小货位/.test(String(r.steps.hint)),String(r.steps.hint).slice(0,80)],
    ['提交请求带 boxCode 且不带 boxId',!!body&&body.items&&body.items[0]&&body.items[0].boxCode==='A-01-02-03'&&body.items[0].boxId===undefined,JSON.stringify(body&&body.items)],
    ['提交成功提示',/提交成功/.test(String(r.steps.toast)),String(r.steps.toast)],
  ];
  let bad=0;
  for(const [n,ok,d] of checks){ if(ok)console.log('PASS '+n); else {bad++;console.log('FAIL '+n+' :: '+d);} }
  console.log(bad?'INBOUND_CHECK_FAILED':'INBOUND_CHECK_OK');
  if(bad)process.exit(1);
})();
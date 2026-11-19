'use strict';
// 企业版登录 + 数据链路自检（对着 mock 平台，不碰真实 SaaS）
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const PORT=Number(26000+Math.floor(Math.random()*2000));
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const seen=[];
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  let body='';
  req.on('data',d=>body+=d);
  req.on('end',()=>{
    seen.push({method:req.method,path:url.pathname,body,cookie:req.headers.cookie||''});
    const json=(s,o,h)=>{res.writeHead(s,Object.assign({'content-type':'application/json'},h||{}));res.end(JSON.stringify(o));};
    const ok=(d)=>json(200,{success:true,data:d});
    if(url.pathname==='/api/auth/captcha') return ok({token:'cap-token-1',image:PNG});
    if(url.pathname==='/api/auth/platform/login'){
      const b=JSON.parse(body||'{}');
      if(String(b.captchaAnswer)!=='abcd') return json(200,{success:false,code:'CAPTCHA_INVALID',message:'验证码不正确'});
      return json(200,{success:true,data:{ok:true}},{'set-cookie':'yc_sess=tok-abc; Path=/; HttpOnly'});
    }
    if(req.headers.cookie && String(req.headers.cookie).indexOf('yc_sess=tok-abc')<0) return json(401,{success:false,code:'UNAUTHENTICATED',message:'未登录或会话已失效'});
    if(url.pathname==='/api/app/bootstrap') return ok({tenant:{id:'t1',code:'542121353',name:'云仓演示企业'},plan:{code:'usage',name:'按量付费'},member:{id:'m1',roleLabel:'管理员',name:'演示管理员',phone:'13800000000'},capabilities:['inventory.read','product.read','product.create','stock.in','stock.out','order.read'],menu:[]});
    if(url.pathname==='/api/app/warehouses') return ok({items:[{id:'w1',code:'WH01',name:'一号主仓',status:'active'}]});
    if(url.pathname==='/api/app/products') return ok({items:[{id:'p1',sku:'001',name:'304 不锈钢六角螺栓 M8',barcode:null,status:'active'}]});
    if(url.pathname==='/api/app/inventory') return ok({items:[{id:'i1',sku:'004',productName:'丁腈手套 M 码',warehouseCode:'WH01',warehouseName:'一号主仓',qty:800,lockedQty:0,avgCost:0.8}]});
    return json(404,{success:false,code:'NOT_FOUND',message:'未实现的接口'});
  });
});
(async()=>{
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-ent-'));
  // 平台地址要指向 mock：把端口写进一份临时脚本里（eval 文件是静态的，注不进去）
  const evSrc = fs.readFileSync(path.join(__dirname,'eval','ent-check.js'),'utf8').replace('@@PLATFORM@@', 'http://127.0.0.1:' + PORT);
  const evPath = path.join(dir, 'ent-eval.js');
  fs.writeFileSync(evPath, evSrc);
  const env=Object.assign({},process.env); delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),['.','--smoke-ui','--user-data-dir='+dir,'--size=1280x832','--eval-file='+evPath],{cwd:ROOT,env});
  let out=''; child.stdout.on('data',c=>out+=c); child.stderr.on('data',c=>out+=c);
  await new Promise(r=>child.on('exit',r));
  server.close();
  const line=out.split('\n').find(l=>l.startsWith('SMOKE_EVAL '));
  if(!line){ console.error('FAIL 没有结果\n'+out.slice(-1500)); process.exit(1); }
  const r=JSON.parse(line.slice(11));
  console.log('STEPS ' + JSON.stringify(r.steps));
  console.log('SEEN ' + JSON.stringify(seen.filter(x=>x.path.indexOf('/auth/')>=0).map(x=>({p:x.path,b:x.body}))).slice(0,900));
  const checks=[
    ['首次进来是私有化配置页',r.steps.startView==='setup',String(r.steps.startView)],
    ['切到企业版后出现账号/密码/验证码',r.steps.entForm===true&&r.steps.captchaImg===true,JSON.stringify([r.steps.entForm,r.steps.captchaImg])],
    ['登录后进工作台',r.steps.viewAfterLogin==='workbench',String(r.steps.viewAfterLogin)],
    ['显示企业名称',r.steps.tenantBanner===true,String(r.steps.tenantBanner)],
    ['作业入口标注「企业版未开放」',r.steps.jobsLocked===true,String(r.steps.jobsLocked)],
    ['库存按企业版字段映射（sku/名称/仓/结存/可用）',Array.isArray(r.steps.invRows)&&r.steps.invRows.length>0&&String(r.steps.invRows[0].join('|')).indexOf('004')>=0&&String(r.steps.invRows[0].join('|')).indexOf('800')>=0,JSON.stringify(r.steps.invRows)],
    ['商品列表能读到（sku 映射成编码）',Number(r.steps.prodRows)>0,String(r.steps.prodRows)],
    ['设置页显示企业版身份',r.steps.settingsEnt===true,String(r.steps.settingsEnt)],
    ['渲染层无异常',r.errors.length===0,JSON.stringify(r.errors)],
  ];
  let bad=0;
  for(const [n,ok,d] of checks){ if(ok)console.log('PASS '+n); else {bad++;console.log('FAIL '+n+' :: '+d);} }
  console.log(bad?'ENT_CHECK_FAILED':'ENT_CHECK_OK');
  if(bad)process.exit(1);
})();

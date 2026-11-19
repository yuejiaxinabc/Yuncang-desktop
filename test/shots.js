const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const {start}=require('./mock-server');
const ROOT=process.cwd();
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-shot-'));
  const PORT=21987;
  const {server}=await start(PORT);
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({version:1,baseUrl:'http://127.0.0.1:'+PORT,token:'yc_live_goodkey_1234567890',enc:'plain',apiProfile:'desktop',savedAt:new Date().toISOString()}));
  fs.writeFileSync(path.join(dir,'prefs.json'),JSON.stringify({version:1,printHeader:'上海云仓供应链有限公司',printFooter:'云仓 · 开源仓储管理系统',operator:'张三'}));
  async function shot(name, clickSel){
    const args=['.','--smoke-ui','--user-data-dir='+dir,'--shot='+path.join(ROOT,'test','shots',name+'.png')];
    if(clickSel) args.push('--click='+clickSel);
    const env=Object.assign({},process.env); delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(require('electron'),args,{cwd:ROOT,env});
    let out=''; child.stdout.on('data',c=>out+=c); child.stderr.on('data',c=>out+=c);
    await new Promise(r=>child.on('exit',r));
    console.log(name, out.split('\n').find(l=>l.startsWith('SMOKE_'))||'');
  }
  fs.mkdirSync(path.join(ROOT,'test','shots'),{recursive:true});
  await shot('workbench');
  await shot('orders','[data-nav="orders"]');
  await shot('settings','[data-nav="settings"]');
  server.close();
})();
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const {start}=require('./mock-server');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
  const PORT=Number(20000+Math.floor(Math.random()*8000));
  const {server}=await start(PORT);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-scroll-'));
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({version:1,baseUrl:'http://127.0.0.1:'+PORT,token:'yc_live_goodkey_1234567890',enc:'plain',apiProfile:'desktop'}));
  const sizes=process.env.SIZES||'1040x680,1280x832,1600x1000';
  for (const size of sizes.split(',')) {
    const env=Object.assign({},process.env); delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(require('electron'),['.','--smoke-ui','--user-data-dir='+dir,'--size='+size,'--eval-file='+path.join(__dirname,'eval','scroll-check.js')],{cwd:ROOT,env});
    let out=''; child.stdout.on('data',c=>out+=c); child.stderr.on('data',c=>out+=c);
    await new Promise(r=>child.on('exit',r));
    const line=out.split('\n').find(l=>l.startsWith('SMOKE_EVAL '));
    if(!line){ console.log(size,'NO_RESULT'); continue; }
    const r=JSON.parse(line.slice(11));
    const bad=[];
    ['workbench','orders','settings','dialog'].forEach(k=>{
      const p=r[k];
      if(!p){bad.push(k+':missing');return;}
      const scrollable = p.scrollH<=p.clientH+2 || (p.moved && p.maxScroll>0) || /(auto|scroll)/.test(p.overflowY);
      if(!scrollable) bad.push(k+':'+JSON.stringify(p));
    });
    console.log(size, bad.length?'FAIL':'OK', JSON.stringify(r.workbench), JSON.stringify(r.dialog), r.errors.length?('errs='+r.errors.join('|')):'');
  }
  server.close();
})();
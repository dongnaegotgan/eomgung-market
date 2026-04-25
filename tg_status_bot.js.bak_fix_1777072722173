'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const https     = require('https');
const puppeteer = require('puppeteer');

var TG_TOKEN = process.env.TG_TOKEN || '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
var TG_CHAT  = process.env.TG_CHAT  || '6097520392';
var ADMIN_URL  = 'https://dongnaegotgan.adminplus.co.kr/admin/';
var ADMIN_LOGIN= 'https://dongnaegotgan.adminplus.co.kr/admin/login.html';
var ADMIN_ID   = process.env.ADMIN_ID || 'dongnaegotgan';
var ADMIN_PW   = process.env.ADMIN_PW || 'rhtrks12!@';
var FG_URL   = 'https://dongnaegotgan.flexgate.co.kr';
var FG_LOGIN = 'https://intro.flexgate.co.kr/Mypage/Login';
var FG_ID    = process.env.FG_ID || 'dongnaegotgan';
var FG_PW    = process.env.FG_PW || 'rhtrks12!@';

function log(m){ console.log('[' + new Date().toLocaleTimeString('ko-KR') + '] ' + m); }
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

function tgPost(p, b){
  return new Promise(function(res,rej){
    var buf=Buffer.from(JSON.stringify(b));
    var req=https.request({hostname:'api.telegram.org',path:'/bot'+TG_TOKEN+p,method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':buf.length}},
      function(r){var d='';r.on('data',function(c){d+=c;});r.on('end',function(){try{res(JSON.parse(d));}catch(e){res({});}});});
    req.on('error',rej);req.write(buf);req.end();
  });
}
function tgSend(msg,chatId){ return tgPost('/sendMessage',{chat_id:chatId||TG_CHAT,text:msg,parse_mode:'HTML'}).catch(function(e){log('tgSend:'+e.message);}); }
function tgSendId(msg,chatId){ return tgPost('/sendMessage',{chat_id:chatId||TG_CHAT,text:msg,parse_mode:'HTML'}).then(function(r){return r.result&&r.result.message_id?r.result.message_id:null;}).catch(function(){return null;}); }
function tgEdit(chatId,mid,text){ return tgPost('/editMessageText',{chat_id:chatId,message_id:mid,text:text,parse_mode:'HTML'}).catch(function(){}); }
function tgGetUpdates(offset){
  return new Promise(function(res){
    var req=https.request({hostname:'api.telegram.org',path:'/bot'+TG_TOKEN+'/getUpdates?offset='+offset+'&timeout=20&limit=10',method:'GET'},
      function(r){var d='';r.on('data',function(c){d+=c;});r.on('end',function(){try{var j=JSON.parse(d);res(j.ok?j.result:[]);}catch(e){res([]);}});});
    req.on('error',function(){res([]);});req.end();
  });
}

/* ---- ADMIN ---- */
var adminBrowser=null,adminPage=null,adminLoginTime=0;

async function ensureAdminBrowser(){
  if(adminBrowser&&adminBrowser.isConnected()) return;
  log('  [admin] browser start');
  adminBrowser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'],defaultViewport:{width:1280,height:900},ignoreHTTPSErrors:true});
  adminPage=await adminBrowser.newPage();
  adminPage.on('dialog',function(d){d.accept().catch(function(){});});
  await adminPage.evaluateOnNewDocument(function(){Object.defineProperty(navigator,'webdriver',{get:function(){return false;}});window.chrome={runtime:{}};});
  await adminPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
}

async function adminLogin(){
  await ensureAdminBrowser();
  log('  [admin] login start');
  await adminPage.goto(ADMIN_LOGIN,{waitUntil:'domcontentloaded',timeout:20000});
  await sleep(1500);
  var info=await adminPage.evaluate(function(id,pw){
    var f=document.querySelector('form');
    if(!f) return 'no form';
    f.querySelectorAll('input[name="idtype"]').forEach(function(r){r.checked=(r.value==='1');});
    var a=f.querySelector('input[name="admid"]'),p=f.querySelector('input[name="admpwd"]');
    if(a){a.value=id;a.dispatchEvent(new Event('input',{bubbles:true}));}
    if(p){p.value=pw;p.dispatchEvent(new Event('input',{bubbles:true}));}
    return (a?'admid:'+a.value.slice(0,5):'no admid')+' '+(p?'pw:ok':'no pw');
  },ADMIN_ID,ADMIN_PW);
  log('  [admin] form: '+info);
  await adminPage.evaluate(function(){var f=document.querySelector('form');if(f)f.submit();});
  await sleep(3000);  // iframe 처리 대기 (waitForNavigation 불가)
  await adminPage.goto(ADMIN_URL,{waitUntil:'networkidle2',timeout:15000}).catch(function(){});
  await sleep(300);
  var url=adminPage.url();
  var ck=await adminPage.cookies();
  log('  [admin] URL: '+url);
  log('  [admin] cookies: '+ck.map(function(c){return c.name;}).join(', '));
  if(url.includes('login')){log('  [admin] FAILED');adminLoginTime=0;return false;}
  log('  [admin] OK');
  adminLoginTime=Date.now();
  return true;
}

async function ensureAdminLogin(){
  if(Date.now()-adminLoginTime<20*60*1000&&adminBrowser&&adminBrowser.isConnected()) return true;
  return await adminLogin();
}

async function getAdminOrders(){
  var orderCount=0,prodMap={},totalAmount=0;
  if(adminBrowser&&adminBrowser.isConnected()&&adminPage){
    try{
      var sr=await adminPage.evaluate(async function(){
        var r=await fetch('/admin/xml/real.stats.json.php',{method:'POST',credentials:'include',headers:{'X-Requested-With':'XMLHttpRequest'},body:''});
        return await r.json();
      });
      orderCount=parseInt(sr.spnNew5)||0;
      log('  [admin stats] new='+sr.spnNew5+' today='+sr.spnNew8);
    }catch(e){log('  [admin stats err] '+e.message);}
  }
  var ok=await ensureAdminLogin();
  if(!ok) return {orderCount,prodMap,totalAmount};
  try{
    // 오늘 포함 7일 범위
    var kst=new Date(Date.now()+9*60*60*1000);
    var end=kst.toISOString().slice(0,10);
    var start7=new Date(kst.getTime()-7*24*60*60*1000).toISOString().slice(0,10);
    var sdate=encodeURIComponent(JSON.stringify({start:start7,end:end}));
    // status=3 (신규주문/주문건수) — 브라우저에서 직접 확인
    var apiUrl='/admin/order/json/od.list.bd.php?proc=json&mod=order&actpage=od.list.bd&status=3&datefld=b.regdate&sdate='+sdate+'&bizgrp=all&searchtype=all&searchval=&_search=false&rows=500&page=1&sidx=regdate&sord=desc';
    var data=await adminPage.evaluate(async function(url){
      try{var r=await fetch(url,{credentials:'include',headers:{'X-Requested-With':'XMLHttpRequest'}});return await r.json();}
      catch(e){return{rows:[],records:0,err:e.message};}
    },apiUrl);
    var rows=data.rows||[];
    log('  [admin] records='+(data.records||0)+' rows='+rows.length+(data.err?' err='+data.err:''));
    if(!orderCount) orderCount=parseInt(data.records)||rows.length;
    rows.forEach(function(row){
      var cell=Array.isArray(row.cell)?row.cell:[];
      // cell[6] = "상품명 N개", cell[15] = 금액
      var prodCell=(cell[6]||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
      var amt=parseInt((cell[15]||'').toString().replace(/[^\d]/g,''))||0;
      if(prodCell){
        // "산딸기 500g 1개" 형식 파싱
        var qm=prodCell.match(/(\d+)\uAC1C$/);
        if(qm){
          var qty=parseInt(qm[1]);
          var name=prodCell.slice(0,prodCell.lastIndexOf(qm[0])).trim();
          if(name.length>=2&&qty>0&&qty<1000){
            if(!prodMap[name]) prodMap[name]={qty:0,amt:0};
            prodMap[name].qty+=qty; prodMap[name].amt+=amt;
          }
        }
      }
      totalAmount+=amt;
    });
    log('  [admin] prod='+Object.keys(prodMap).length+' total='+totalAmount);
  }catch(e){
    log('  [admin err] '+e.message);
    try{await adminBrowser.close();}catch(_){}
    adminBrowser=null;adminPage=null;adminLoginTime=0;
  }
  return{orderCount,prodMap,totalAmount};
}

/* ---- GOTGAN ---- */
var fgBrowser=null,fgPage=null,fgLoginTime=0;
async function ensureFgBrowser(){
  if(fgBrowser&&fgBrowser.isConnected()) return;
  log('  [gotgan] browser start');
  fgBrowser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--lang=ko-KR','--disable-blink-features=AutomationControlled'],defaultViewport:{width:1440,height:900},ignoreHTTPSErrors:true});
  fgPage=await fgBrowser.newPage();
  fgPage.on('dialog',function(d){d.accept().catch(function(){});});
  await fgPage.evaluateOnNewDocument(function(){Object.defineProperty(navigator,'webdriver',{get:function(){return false;}});window.chrome={runtime:{}};Object.defineProperty(navigator,'plugins',{get:function(){return[1,2,3];}});Object.defineProperty(navigator,'languages',{get:function(){return['ko-KR','ko','en-US'];}});});
  await fgPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
}
async function fgLogin(){
  await ensureFgBrowser();
  log('  [gotgan] login start');
  await fgPage.goto(FG_LOGIN,{waitUntil:'networkidle2',timeout:20000});
  try{await fgPage.waitForSelector('input[name="userId"]',{timeout:5000});}catch(e){}
  var ie=await fgPage.$('input[name="userId"]'),pe=await fgPage.$('input[name="password"]');
  if(ie&&pe){await ie.click({clickCount:3});await fgPage.keyboard.type(FG_ID);await pe.click({clickCount:3});await fgPage.keyboard.type(FG_PW);}
  await sleep(300);
  var btn=await fgPage.$('button[type="submit"],input[type="submit"]').catch(function(){return null;});
  if(btn){await Promise.all([fgPage.waitForNavigation({waitUntil:'networkidle2',timeout:15000}).catch(function(){}),btn.click()]);}
  else if(pe){log('  [gotgan] Enter');await Promise.all([fgPage.waitForNavigation({waitUntil:'networkidle2',timeout:15000}).catch(function(){}),pe.press('Enter')]);}
  for(var i=0;i<8;i++){await sleep(1000);if(!fgPage.url().includes('Login'))break;}
  log('  [gotgan] URL: '+fgPage.url());fgLoginTime=Date.now();
}
async function ensureFgLogin(){ if(Date.now()-fgLoginTime<25*60*1000&&fgBrowser&&fgBrowser.isConnected()) return; await fgLogin(); }
async function getGotganOrders(){
  await ensureFgLogin();
  try{
    await fgPage.goto(FG_URL+'/NewOrder/deal01?order_status=20&formtype=C&pagesize=1000',{waitUntil:'networkidle2',timeout:15000});
    await sleep(1500);
    if(fgPage.url().includes('Login')){fgLoginTime=0;await fgLogin();await fgPage.goto(FG_URL+'/NewOrder/deal01?order_status=20&formtype=C&pagesize=1000',{waitUntil:'networkidle2',timeout:15000});await sleep(1500);}
    var html=await fgPage.content();
    var nums=new Set(),m,re=/PJM[A-Z0-9-]+/g;
    while((m=re.exec(html))!==null) nums.add(m[0]);
    log('  [gotgan] PJM '+nums.size);
    var res=await fgPage.evaluate(function(){
      var map={},total=0;
      document.querySelectorAll('table tbody tr').forEach(function(row){
        var cells=Array.from(row.querySelectorAll('td')).map(function(td){return(td.innerText||td.textContent||'').replace(/\s+/g,' ').trim();});
        if(cells.length<6) return;
        var parts=(cells[5]||'').split('/');
        if(parts.length<2) return;
        var name=parts[0].trim(),qm=parts[1].match(/(\d+)/);
        if(!qm) return;
        var qty=parseInt(qm[1]);
        name=name.replace(/\s*\([^)]{15,}\)\s*/g,' ').trim();
        name=name.replace(/^[\d\s\[\]()·,]+/,'').trim();
        if(name.length<2||qty<=0||qty>=1000) return;
        var amt=0,ns=(cells[6]||'').replace(/,/g,'').match(/\d{4,8}/g);
        if(ns) ns.forEach(function(n){var v=parseInt(n);if(v>amt&&v<10000000)amt=v;});
        if(!map[name]) map[name]={qty:0,amt:0};
        map[name].qty+=qty;map[name].amt+=amt;total+=amt;
      });
      var fr=document.querySelector('table tbody tr');
      var dbg=fr?Array.from(fr.querySelectorAll('td')).map(function(td,i){return i+':"'+((td.innerText||'').replace(/\s+/g,' ').trim().slice(0,50))+'"';}).slice(0,6).join(' | '):'';
      return{map,total,dbg};
    });
    log('  [gotgan] prod='+Object.keys(res.map).length+' total='+res.total);
    if(res.dbg) log('  [gotgan cells] '+res.dbg);
    return{orderCount:nums.size,prodMap:res.map,totalAmount:res.total};
  }catch(e){
    log('  [gotgan err] '+e.message);
    try{await fgBrowser.close();}catch(_){}
    fgBrowser=null;fgPage=null;fgLoginTime=0;
    return{orderCount:0,prodMap:{},totalAmount:0};
  }
}

function fmt(title,data){
  var oc=data.orderCount,pm=data.prodMap,ta=data.totalAmount;
  var entries=Object.keys(pm).map(function(n){var v=typeof pm[n]==='object'?pm[n]:{qty:pm[n],amt:0};return[n,v];})
    .filter(function(e){return e[1].qty>0;}).sort(function(a,b){return b[1].qty-a[1].qty;});
  var tot=ta||entries.reduce(function(s,e){return s+(e[1].amt||0);},0);
  var ts=tot>0?'  [\uCD1D\uC561] <b>'+tot.toLocaleString()+'\uC6D0</b>\n':'';
  var msg=title+'\n\uCD1D \uC8FC\uBB38: <b>'+oc+'\uAC74</b>\n'+ts;
  if(entries.length>0){msg+='\n[\uC0C1\uD488\uBCC4 \uC218\uB7C9]\n';entries.slice(0,15).forEach(function(e){var a=e[1].amt>0?' ('+e[1].amt.toLocaleString()+'\uC6D0)':'';msg+='  - '+e[0]+' <b>'+e[1].qty+'\uAC1C</b>'+a+'\n';});}
  else{msg+='  (\uC0C1\uD488 \uC815\uBCF4 \uC5C6\uC74C)\n';}
  return msg;
}

var busy=false;
function handleCommand(cmd,chatId){
  log('cmd: '+cmd);
  if(cmd==='/'+'\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8'||cmd==='\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8'){tgSend('[\uB3D9\uB124\uACE3\uAC04] /\uC8FC\uBB38\uAC74\uD655\uC778 /\uC8FC\uBB38\uCD9C\uB825 /\uC2B9\uC778\uC0C1\uD0DC /\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8',chatId);return;}
  if(cmd==='/'+'\uC2B9\uC778\uC0C1\uD0DC'||cmd==='\uC2B9\uC778\uC0C1\uD0DC'){tgSend('gotgan-approve: 30\uCD08\uB9C8\uB2E4 \uC790\uB3D9\uC2B9\uC778 \uC2E4\uD589 \uC911',chatId);return;}
  if(cmd==='/'+'\uC8FC\uBB38\uCD9C\uB825'||cmd==='\uC8FC\uBB38\uCD9C\uB825'){
    tgSend('\uACE3\uAC04 \uC5D1\uC140 \uCD9C\uB825 \uC2DC\uC791...',chatId);
    (async function(){
      var dlBr=null;try{
        var os2=require('os'),DLPATH=require('path').join(os2.homedir(),'Downloads');
        var FB='https://dongnaegotgan.flexgate.co.kr',FI='https://intro.flexgate.co.kr';
        dlBr=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:900}});
        var dlPage=await dlBr.newPage();dlPage.on('dialog',function(d){d.accept().catch(function(){});});
        var cdp=await dlPage.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:DLPATH});
        await dlPage.evaluateOnNewDocument(function(){Object.defineProperty(navigator,'webdriver',{get:function(){return false;}});});
        await dlPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await dlPage.goto(FI+'/Mypage/Login',{waitUntil:'domcontentloaded',timeout:20000});await sleep(1500);
        var ie=await dlPage.$('input[name="userId"]'),pe=await dlPage.$('input[name="password"]');
        if(ie){await ie.click({clickCount:3});await ie.type(FG_ID);}if(pe){await pe.click({clickCount:3});await pe.type(FG_PW);}
        await sleep(500);await Promise.all([dlPage.waitForNavigation({waitUntil:'networkidle2',timeout:15000}).catch(function(){}),pe?pe.press('Enter'):Promise.resolve()]);await sleep(2000);
        if(!dlPage.url().includes('dongnaegotgan.flexgate.co.kr')){await dlBr.close();await tgSend('\uACE3\uAC04 \uB85C\uADF8\uC778 \uC2E4\uD328',chatId);return;}
        await dlPage.goto(FB+'/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000',{waitUntil:'networkidle2',timeout:30000});await sleep(2000);
        await dlPage.waitForFunction(function(){return document.querySelectorAll('input[name="chk"]').length>0;},{timeout:15000,polling:500}).catch(function(){});
        var cnt=await dlPage.evaluate(function(){return document.querySelectorAll('input[name="chk"]').length;});
        if(cnt===0){await dlBr.close();await tgSend('\uBC30\uC1A1\uC900\uBE44 \uC8FC\uBB38 \uC5C6\uC74C',chatId);return;}
        await dlPage.evaluate(function(){document.getElementById('chkCheckDataAll').click();document.getElementById('customexcelFrm').value='94';});await sleep(500);
        var cp=dlPage.waitForResponse(function(r){return r.url().includes('CreateExcelIfile');},{timeout:30000}).catch(function(){return null;});
        await dlPage.evaluate(function(){orderExcelDownload(3);});
        var fn=null,rr=await cp;if(rr){var tx=await rr.text().catch(function(){return'';});var mx=tx.match(/order_\d+\.xlsx/);if(mx)fn=mx[0];else{try{fn=JSON.parse(tx).fileName||'';}catch(e){}}}
        if(!fn){await dlBr.close();await tgSend('\uD30C\uC77C \uC0DD\uC131 \uC2E4\uD328',chatId);return;}
        await sleep(2000);await dlPage.goto(FB+'/NewOrder/ExcelDownload?fileName='+encodeURIComponent(fn),{waitUntil:'domcontentloaded',timeout:20000}).catch(function(){});await sleep(5000);
        await dlBr.close();await tgSend('\uC5D1\uC140 \uB2E4\uC6B4\uB85C\uB4DC \uC644\uB8CC ('+cnt+'\uAC74)',chatId);
      }catch(e){if(dlBr)await dlBr.close().catch(function(){});await tgSend('\uC624\uB958: '+e.message,chatId);}
    })();return;
  }
  if(cmd==='/'+'\uC8FC\uBB38\uAC74\uD655\uC778'||cmd==='\uC8FC\uBB38\uAC74\uD655\uC778'){
    if(busy){tgSend('\uC870\uD68C \uC911...',chatId);return;}busy=true;
    var now=new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
    tgSendId('[\uC8FC\uBB38\uD604\uD669 \uC870\uD68C \uC911...]\n\uC5B4\uB4DC\uBBFC \uB3C4\uB9E4\uBAB0 \uC870\uD68C \uC911\n\uB3D9\uB124\uACE3\uAC04 \uC870\uD68C \uC911\n\uC7A0\uC2DC\uB9CC \uAE30\uB2E4\uB824 \uC8FC\uC138\uC694',chatId).then(function(mid){
      Promise.allSettled([getAdminOrders(),getGotganOrders()]).then(function(results){
        var aD=results[0].status==='fulfilled'?results[0].value:null;
        var fD=results[1].status==='fulfilled'?results[1].value:null;
        var msg='<b>[\uC8FC\uBB38\uD604\uD669]</b>  '+now+'\n'+'\u2500'.repeat(18)+'\n\n';
        msg+=aD?fmt('<b>[\uC5B4\uB4DC\uBBFC] \uB3C4\uB9E4\uBAB0</b>',aD):'\uC5B4\uB4DC\uBBFC \uC870\uD68C \uC2E4\uD328\n';
        msg+='\n';
        msg+=fD?fmt('<b>[\uACE3\uAC04] \uB3D9\uB124\uACE3\uAC04</b>',fD):'\uACE3\uAC04 \uC870\uD68C \uC2E4\uD328\n';
        var at=(aD&&aD.totalAmount)?aD.totalAmount:0,ft=(fD&&fD.totalAmount)?fD.totalAmount:0;
        if(at+ft>0){msg+='\n'+'\u2500'.repeat(18)+'\n<b>[\uD569\uC0B0 \uCD1D\uC561: '+(at+ft).toLocaleString()+'\uC6D0]</b>\n';if(at>0)msg+='  \uB3C4\uB9E4\uBAB0: '+at.toLocaleString()+'\uC6D0\n';if(ft>0)msg+='  \uB3D9\uB124\uACE3\uAC04: '+ft.toLocaleString()+'\uC6D0\n';}
        return mid?tgEdit(chatId,mid,msg):tgSend(msg,chatId);
      }).then(function(){log('send ok');busy=false;}).catch(function(e){log('err:'+e.message);tgSend('\uC624\uB958: '+e.message,chatId);busy=false;});
    });return;
  }
}

var lastUpdateId=0,polling=false;
var CMDS=['/\uC8FC\uBB38\uAC74\uD655\uC778','\uC8FC\uBB38\uAC74\uD655\uC778','/\uC8FC\uBB38\uCD9C\uB825','\uC8FC\uBB38\uCD9C\uB825','/\uC2B9\uC778\uC0C1\uD0DC','\uC2B9\uC778\uC0C1\uD0DC','/\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8','\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8'];
function poll(){
  if(polling) return;polling=true;
  tgGetUpdates(lastUpdateId).then(function(updates){
    updates.forEach(function(u){
      lastUpdateId=u.update_id+1;
      var msg2=u.message||u.edited_message;if(!msg2||!msg2.text) return;
      var text=msg2.text.trim().split(' ')[0],chatId=String(msg2.chat.id);
      if(chatId!==TG_CHAT) return;
      log('recv: "'+text+'"');
      if(CMDS.indexOf(text)>=0) handleCommand(text,chatId);
    });
  }).catch(function(e){log('poll:'+e.message);}).then(function(){polling=false;});
}

log('[v20] \uC2E4\uC99D \uAE30\uBC18 - idtype=1, status=3, sdate\uBC94\uC704');
log('  /\uC8FC\uBB38\uAC74\uD655\uC778  /\uC8FC\uBB38\uCD9C\uB825  /\uC2B9\uC778\uC0C1\uD0DC  /\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8');
setInterval(poll,3000);poll();
process.on('SIGINT',function(){if(adminBrowser)adminBrowser.close();if(fgBrowser)fgBrowser.close();process.exit(0);});
process.on('SIGTERM',function(){if(adminBrowser)adminBrowser.close();if(fgBrowser)fgBrowser.close();process.exit(0);});

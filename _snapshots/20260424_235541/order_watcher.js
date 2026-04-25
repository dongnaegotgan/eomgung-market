// WATCH: v2
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs=require('fs'),path=require('path'),{exec}=require('child_process');
const DOWNLOADS=path.join(process.env.USERPROFILE||'C:/Users/moapi','Downloads');
const OUT_DIR=path.join(__dirname,'order_output');
const TG_TOKEN='8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT='6097520392';
const EGG_KEYWORDS=['\ud2b9\ub780','\uc655\ub780'];

function log(m){console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${m}`);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function maskPhone(p){return String(p||'').replace(/(\d{3})-(\d{4})-(\d{4})/,'$1-xxxx-$3');}
function isEco(addr){return String(addr).includes('\uc5d0\ucf54\ub378\ud0c0')||String(addr).includes('\uc5d0\ucf54\ub300\ub85c');}
function isEgg(name){return EGG_KEYWORDS.some(k=>String(name).includes(k));}

function cleanNames(raw){
  if(!raw)return[];
  return String(raw).split('\u25b6').filter(p=>p.trim()).map(p=>{
    const qm=p.match(/\((\d+)\uac1c\)/);
    const qty=qm?parseInt(qm[1]):1;
    const nm=p.match(/^\s*(.+?)\s*,\s*([^,]*)\(\d+\uac1c\)/);
    let name='',code='';
    if(nm){name=nm[1].trim();code=nm[2].trim();}
    else{const ci=p.indexOf(',');name=ci>0?p.slice(0,ci).trim():p.trim();}
    return name&&name.length>1?{name,qty,code}:null;
  }).filter(Boolean);
}

async function tg(msg){
  try{
    const body=JSON.stringify({chat_id:TG_CHAT,text:msg,parse_mode:'HTML'});
    await new Promise(r=>{
      const req=require('https').request({hostname:'api.telegram.org',
        path:`/bot${TG_TOKEN}/sendMessage`,method:'POST',
        headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
      },res=>{res.on('data',()=>{});res.on('end',r);});
      req.on('error',r);req.write(body);req.end();
    });
  }catch(e){}
}

async function readExcel(filePath){
  const ExcelJS=require('exceljs');
  const wb=new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws=wb.worksheets[0];
  const headers=[],rows=[];
  ws.eachRow((row,i)=>{
    const vals=row.values.slice(1);
    if(i===1){vals.forEach(v=>headers.push(String(v||'').trim()));return;}
    if(!vals.some(v=>v))return;
    const obj={};headers.forEach((h,j)=>{if(h)obj[h]=vals[j]!==undefined?vals[j]:'';});
    rows.push(obj);
  });
  return rows;
}

// 1장: 소분작업용 - 전체 품목 집계
async function createSobun(rows,outPath){
  const ExcelJS=require('exceljs');
  const prodMap={};
  rows.forEach(row=>{
    const raw=String(row['\uc0c1\ud488\uba85(\ud0c0\uc785\uc81c\uac70)']||row['\uc0c1\ud488\uba85']||'');
    cleanNames(raw).forEach(({name,qty})=>{prodMap[name]=(prodMap[name]||0)+qty;});
  });
  const sorted=Object.entries(prodMap).sort((a,b)=>b[1]-a[1]);
  const today=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
  const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('\uc18c\ubd84\uc791\uc5c5');
  ws.mergeCells('A1:C1');const t=ws.getCell('A1');
  t.value=`\uc18c\ubd84 \uc791\uc5c5 \ubaa9\ub85d  -  ${today}`;
  t.font={name:'\ub9d1\uc740 \uace0\ub515',bold:true,size:14,color:{argb:'FFFFFFFF'}};
  t.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2E7D32'}};
  t.alignment={horizontal:'center',vertical:'middle'};ws.getRow(1).height=32;
  ws.addRow([]);
  ws.addRow(['\ubc88\ud638','\uc0c1\ud488\uba85','\uc218\ub7c9']);
  const hr=ws.lastRow;hr.height=24;
  hr.eachCell(c=>{c.font={name:'\ub9d1\uc740 \uace0\ub515',bold:true,size:12};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFC8E6C9'}};c.alignment={horizontal:'center',vertical:'middle'};c.border={top:{style:'medium'},bottom:{style:'medium'},left:{style:'medium'},right:{style:'medium'}};});
  sorted.forEach(([name,qty],i)=>{
    ws.addRow([i+1,name,qty]);const r=ws.lastRow;r.height=22;
    r.eachCell((c,col)=>{c.font={name:'\ub9d1\uc740 \uace0\ub515',size:11};c.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}};c.alignment={vertical:'middle',horizontal:col===2?'left':'center'};if(i%2===1)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F8E9'}};});
  });
  const total=sorted.reduce((s,[,q])=>s+q,0);
  ws.addRow(['',`\ucd1d ${sorted.length}\uc885`,`\ucd1d ${total}\uac1c`]);
  const tr=ws.lastRow;tr.height=22;
  tr.eachCell(c=>{c.font={name:'\ub9d1\uc740 \uace0\ub515',bold:true,size:11};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF176'}};c.border={top:{style:'medium'},bottom:{style:'medium'},left:{style:'medium'},right:{style:'medium'}};c.alignment={horizontal:'center',vertical:'middle'};});
  ws.getColumn(1).width=8;ws.getColumn(2).width=46;ws.getColumn(3).width=10;
  ws.pageSetup={orientation:'portrait',fitToPage:true,fitToWidth:1};
  await wb.xlsx.writeFile(outPath);
  log(`OK \uc18c\ubd84\uc791\uc5c5: ${path.basename(outPath)} (${sorted.length}\uc885/${total}\uac1c)`);
}

// 2장: 소분팀 패킹용 - 전체 주소+품목 (에코+그외 합쳐서)
async function createPacking(rows,outPath){
  const ExcelJS=require('exceljs');
  const custMap={};
  rows.forEach(row=>{
    const addr=String(row['\uc8fc\uc18c']||'').trim();
    const name=String(row['\uc218\ub839\uc778\uba85']||row['\uc218\ub839\uc778']||'').trim();
    const phone=maskPhone(String(row['\uc218\ub839\uc778\uc5f0\ub77d\ucc98']||row['\uc5f0\ub77d\ucc98']||''));
    const raw=String(row['\uc0c1\ud488\uba85(\ud0c0\uc785\uc81c\uac70)']||row['\uc0c1\ud488\uba85']||'').trim();
    if(!addr)return;
    if(!custMap[addr])custMap[addr]={addr,name,phone,prods:[]};
    cleanNames(raw).forEach(({name:pname,qty,code})=>custMap[addr].prods.push({name:pname,qty,code}));
  });
  const customers=Object.values(custMap).sort((a,b)=>a.addr.localeCompare(b.addr,'ko'));
  const today=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
  const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('\ud328\ud0b9\uc6a9');
  ws.getColumn(1).width=5;ws.getColumn(2).width=52;ws.getColumn(3).width=10;ws.getColumn(4).width=16;
  ws.mergeCells('A1:D1');const t=ws.getCell('A1');
  t.value=`\uc18c\ubd84\ud300 \ud328\ud0b9\uc6a9 \ubc30\uc1a1\uc8fc\uc18c\uc9c0  ${today}`;
  t.font={name:'\ub9d1\uc740 \uace0\ub515',bold:true,size:13,color:{argb:'FFFFFFFF'}};
  t.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2E7D32'}};
  t.alignment={horizontal:'center',vertical:'middle'};ws.getRow(1).height=30;
  ws.addRow([]);
  customers.forEach((cust,num)=>{
    ws.addRow([num+1,cust.addr,cust.name,cust.phone]);
    const ar=ws.lastRow;ar.height=36;
    [1,2,3,4].forEach(col=>{
      const c=ar.getCell(col);
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD8EFD8'}};
      c.font={name:'\ub9d1\uc740 \uace0\ub515',bold:col<=2,size:10};
      c.border={top:{style:'medium'},bottom:{style:'thin'},left:{style:col===1?'medium':'thin'},right:{style:col===4?'medium':'thin'}};
      c.alignment={vertical:'middle',wrapText:col===2};
    });
    cust.prods.forEach(({name:pn,qty,code})=>{
      const pDisplay=code?`    ${pn}  (${code})`:`    ${pn}`;
      ws.addRow(['',pDisplay,`${qty}\uac1c`,'']);
      const pr=ws.lastRow;pr.height=20;
      [1,2,3,4].forEach(col=>{
        const c=pr.getCell(col);
        c.font={name:'\ub9d1\uc740 \uace0\ub515',size:10,bold:col===3};
        c.border={top:{style:'hair'},bottom:{style:'hair'},left:{style:col===1?'medium':'thin'},right:{style:col===4?'medium':'thin'}};
        c.alignment={vertical:'middle',horizontal:col===3?'center':'left',wrapText:col===2};
      });
    });
    ws.addRow([]);
  });
  ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,
    margins:{left:0.3,right:0.3,top:0.5,bottom:0.5,header:0.2,footer:0.2}};
  await wb.xlsx.writeFile(outPath);
  log(`OK \ud328\ud0b9\uc6a9: ${path.basename(outPath)} (${customers.length}\uac74)`);
  return outPath;
}

// 3,4장: 배송담당자용 - 주소 + 계란(특란/왕란) 있는 집만 표기
async function createDelivery(rows,outPath,regionType){
  const ExcelJS=require('exceljs');
  const custMap={};
  rows.forEach(row=>{
    const addr=String(row['\uc8fc\uc18c']||'').trim();
    const name=String(row['\uc218\ub839\uc778\uba85']||row['\uc218\ub839\uc778']||'').trim();
    const phone=maskPhone(String(row['\uc218\ub839\uc778\uc5f0\ub77d\ucc98']||row['\uc5f0\ub77d\ucc98']||''));
    const raw=String(row['\uc0c1\ud488\uba85(\ud0c0\uc785\uc81c\uac70)']||row['\uc0c1\ud488\uba85']||'').trim();
    if(!addr)return;
    const eco=isEco(addr);
    if(regionType==='eco'&&!eco)return;
    if(regionType==='other'&&eco)return;
    if(!custMap[addr])custMap[addr]={addr,name,phone,eggs:[]};
    cleanNames(raw).forEach(({name:pname,qty})=>{
      if(isEgg(pname))custMap[addr].eggs.push({name:pname,qty});
    });
  });
  const customers=Object.values(custMap).sort((a,b)=>a.addr.localeCompare(b.addr,'ko'));
  if(customers.length===0){log(`-- ${regionType==='eco'?'\uc5d0\ucf54\ub378\ud0c0':'\uadf8\uc678\uc9c0\uc5ed'}: 0\uac74`);return null;}
  const isEcoType=regionType==='eco';
  const title=isEcoType?'\uBC30\uC1A1\uB2F4\ub2f9\uc790\uc6a9  \uc5d0\ucf54\ub378\ud0c0':'\uBC30\uC1A1\uB2F4\ub2f9\uc790\uc6a9  \uADF8\uc678\uc9c0\uc5ed';
  const headerColor=isEcoType?'FF1565C0':'FF6A1B9A';
  const today=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
  const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('\ubc30\uc1a1\ub2f4\ub2f9');
  ws.getColumn(1).width=5;ws.getColumn(2).width=52;ws.getColumn(3).width=12;ws.getColumn(4).width=16;
  ws.mergeCells('A1:D1');const t=ws.getCell('A1');
  t.value=`${title}  ${today}`;
  t.font={name:'\ub9d1\uc740 \uace0\ub515',bold:true,size:13,color:{argb:'FFFFFFFF'}};
  t.fill={type:'pattern',pattern:'solid',fgColor:{argb:headerColor}};
  t.alignment={horizontal:'center',vertical:'middle'};ws.getRow(1).height=30;
  ws.addRow([]);
  customers.forEach((cust,num)=>{
    ws.addRow([num+1,cust.addr,cust.name,cust.phone]);
    const ar=ws.lastRow;
    const hasEgg=cust.eggs.length>0;
    ar.height=hasEgg?52:32;
    [1,2,3,4].forEach(col=>{
      const c=ar.getCell(col);
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:hasEgg?'FFFFF9C4':'FFF5F5F5'}};
      c.font={name:'\ub9d1\uc740 \uace0\ub515',bold:col<=2,size:10};
      c.border={top:{style:'medium'},bottom:{style:'medium'},left:{style:col===1?'medium':'thin'},right:{style:col===4?'medium':'thin'}};
      c.alignment={vertical:'middle',wrapText:col===2};
    });
    if(hasEgg){
      const eggCell=ar.getCell(2);
      const eggText=cust.eggs.map(e=>`  \ud83e\udd5a ${e.name} ${e.qty}\ud310`).join('  ');
      eggCell.value=`${cust.addr}\n${eggText}`;
      eggCell.font={name:'\ub9d1\uc740 \uace0\ub515',bold:true,size:10};
      eggCell.alignment={vertical:'middle',wrapText:true};
    }
  });
  ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,
    margins:{left:0.3,right:0.3,top:0.5,bottom:0.5,header:0.2,footer:0.2}};
  await wb.xlsx.writeFile(outPath);
  log(`OK \ubc30\uc1a1\ub2f4\ub2f9 ${isEcoType?'\uc5d0\ucf54':'\uadf8\uc678'}: ${path.basename(outPath)} (${customers.length}\uac74, \uacc4\ub780\uc788\ub294\uc9d1:${customers.filter(c=>c.eggs.length>0).length})`);
  return outPath;
}

async function printFile(filePath){
  const tmp=path.join(require('os').tmpdir(),`print_${Date.now()}_${path.basename(filePath)}`);
  fs.copyFileSync(filePath,tmp);
  const abs=tmp.replace(/\//g,'\\');
  log(`PRINT ${path.basename(filePath)}...`);
  await new Promise(r=>exec(`powershell -Command "Start-Process -FilePath '${abs}' -Verb Print -WindowStyle Hidden"`,{windowsHide:true},r));
  await sleep(8000);
  try{fs.unlinkSync(tmp);}catch(e){}
}

async function processFile(srcPath){
  fs.mkdirSync(OUT_DIR,{recursive:true});
  const destName=path.basename(srcPath);
  const dest=path.join(OUT_DIR,destName);
  if(srcPath!==dest){fs.copyFileSync(srcPath,dest);log(`COPY: ${destName}`);}
  log('READ...');
  const rows=await readExcel(dest);
  log(`  ${rows.length}rows`);
  if(rows.length===0){log('NO DATA');return;}

  const now=new Date().toLocaleString('ko-KR');
  await tg(`<b>[\ub3d9\ub124\uacf3\uac04] \uc8fc\ubb38 \ucc98\ub9ac \uc2dc\uc791</b>\n${now}\n\n\uc8fc\ubb38 ${rows.length}\uac74 \ucc98\ub9ac \uc911...`);

  const today=new Date().toISOString().slice(0,10);
  const sobunPath=path.join(OUT_DIR,`\uc18c\ubd84\uc791\uc5c5_${today}.xlsx`);
  const packingPath=path.join(OUT_DIR,`\ud328\ud0b9\uc6a9_${today}.xlsx`);
  const ecoDelivPath=path.join(OUT_DIR,`\ubc30\uc1a1\ub2f4\ub2f9_\uc5d0\ucf54_${today}.xlsx`);
  const otherDelivPath=path.join(OUT_DIR,`\ubc30\uc1a1\ub2f4\ub2f9_\uadf8\uc678_${today}.xlsx`);

  await createSobun(rows,sobunPath);
  await createPacking(rows,packingPath);
  await createDelivery(rows,ecoDelivPath,'eco');
  await createDelivery(rows,otherDelivPath,'other');

  log('PRINT START...');
  await printFile(sobunPath);
  await sleep(2000);
  await printFile(packingPath);
  await sleep(2000);
  await printFile(ecoDelivPath);
  await sleep(2000);
  await printFile(otherDelivPath);

  const fin=new Date().toLocaleString('ko-KR');
  await tg(`<b>[\ub3d9\ub124\uacf3\uac04] \ucd9c\ub825 \uc644\ub8cc!</b>\n${fin}\n\n${rows.length}\uac74 \ucc98\ub9ac\n\ucc3d1: \uc18c\ubd84\uc791\uc5c5\n\ucc3d2: \ud328\ud0b9\uc6a9(\uc804\uccb4)\n\ucc3d3: \ubc30\uc1a1\ub2f4\ub2f9 \uc5d0\ucf54\ub378\ud0c0\n\ucc3d4: \ubc30\uc1a1\ub2f4\ub2f9 \uadf8\uc678\uc9c0\uc5ed`);
  log('DONE!');
}

let processing=false,lastFile='',lastTime=0;
log(`WATCH: ${DOWNLOADS}`);
fs.watch(DOWNLOADS,(event,filename)=>{
  if(!filename||!filename.match(/^order_\d+.*\.xlsx$/))return;
  if(processing)return;
  const now=Date.now();
  if(filename===lastFile&&now-lastTime<20000)return;
  const fp=path.join(DOWNLOADS,filename);
  setTimeout(async()=>{
    try{
      if(!fs.existsSync(fp))return;
      const stat=fs.statSync(fp);
      if(stat.size<1000)return;
      if(filename===lastFile&&Date.now()-lastTime<20000)return;
      lastFile=filename;lastTime=Date.now();processing=true;
      log(`NEW: ${filename} (${(stat.size/1024).toFixed(0)}KB)`);
      try{await processFile(fp);}catch(e){
        log(`ERR: ${e.message}`);
        await tg(`<b>[\ub3d9\ub124\uacf3\uac04] \uc624\ub958</b>\n${e.message}`);
      }
    }finally{processing=false;}
  },2000);
});

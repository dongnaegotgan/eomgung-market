const fs = require('fs'), path = require('path');

const watcher = `// WATCH: v2
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs=require('fs'),path=require('path'),{exec}=require('child_process');
const DOWNLOADS=path.join(process.env.USERPROFILE||'C:/Users/moapi','Downloads');
const OUT_DIR=path.join(__dirname,'order_output');
const TG_TOKEN='8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT='6097520392';
const EGG_KEYWORDS=['\uD2B9\uB780','\uC655\uB780'];

function log(m){console.log(\`[\${new Date().toLocaleTimeString('ko-KR')}] \${m}\`);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function maskPhone(p){return String(p||'').replace(/(\d{3})-(\d{4})-(\d{4})/,'\$1-xxxx-\$3');}
function isEco(addr){return String(addr).includes('\uC5D0\uCF54\uB378\uD0C0')||String(addr).includes('\uC5D0\uCF54\uB300\uB85C');}
function isEgg(name){return EGG_KEYWORDS.some(k=>String(name).includes(k));}

function cleanNames(raw){
  if(!raw)return[];
  return String(raw).split('\u25B6').filter(p=>p.trim()).map(p=>{
    const qm=p.match(/\((\d+)\uAC1C\)/);
    const qty=qm?parseInt(qm[1]):1;
    const nm=p.match(/^\s*(.+?)\s*,\s*([^,]*)\(\d+\uAC1C\)/);
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
        path:\`/bot\${TG_TOKEN}/sendMessage\`,method:'POST',
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

async function createSobun(rows,outPath){
  const ExcelJS=require('exceljs');
  const prodMap={};
  rows.forEach(row=>{
    const raw=String(row['\uC0C1\uD488\uBA85(\uD0C0\uC785\uC81C\uAC70)']||row['\uC0C1\uD488\uBA85']||'');
    cleanNames(raw).forEach(({name,qty})=>{prodMap[name]=(prodMap[name]||0)+qty;});
  });
  const sorted=Object.entries(prodMap).sort((a,b)=>b[1]-a[1]);
  const today=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
  const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('\uC18C\uBD84\uC791\uC5C5');
  ws.mergeCells('A1:C1');const t=ws.getCell('A1');
  t.value=\`\uC18C\uBD84 \uC791\uC5C5 \uBAA9\uB85D  -  \${today}\`;
  t.font={name:'\uB9D1\uC740 \uACE0\uB515',bold:true,size:14,color:{argb:'FFFFFFFF'}};
  t.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2E7D32'}};
  t.alignment={horizontal:'center',vertical:'middle'};ws.getRow(1).height=32;
  ws.addRow([]);
  ws.addRow(['\uBC88\uD638','\uC0C1\uD488\uBA85','\uC218\uB7C9']);
  const hr=ws.lastRow;hr.height=24;
  hr.eachCell(c=>{c.font={name:'\uB9D1\uC740 \uACE0\uB515',bold:true,size:12};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFC8E6C9'}};c.alignment={horizontal:'center',vertical:'middle'};c.border={top:{style:'medium'},bottom:{style:'medium'},left:{style:'medium'},right:{style:'medium'}};});
  sorted.forEach(([name,qty],i)=>{
    ws.addRow([i+1,name,qty]);const r=ws.lastRow;r.height=22;
    r.eachCell((c,col)=>{c.font={name:'\uB9D1\uC740 \uACE0\uB515',size:11};c.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}};c.alignment={vertical:'middle',horizontal:col===2?'left':'center'};if(i%2===1)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F8E9'}};});
  });
  const total=sorted.reduce((s,[,q])=>s+q,0);
  ws.addRow(['',\`\uCD1D \${sorted.length}\uC885\`,\`\uCD1D \${total}\uAC1C\`]);
  const tr=ws.lastRow;tr.height=22;
  tr.eachCell(c=>{c.font={name:'\uB9D1\uC740 \uACE0\uB515',bold:true,size:11};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF176'}};c.border={top:{style:'medium'},bottom:{style:'medium'},left:{style:'medium'},right:{style:'medium'}};c.alignment={horizontal:'center',vertical:'middle'};});
  ws.getColumn(1).width=8;ws.getColumn(2).width=46;ws.getColumn(3).width=10;
  ws.pageSetup={orientation:'portrait',fitToPage:true,fitToWidth:1};
  await wb.xlsx.writeFile(outPath);
  log(\`OK \uC18C\uBD84\uC791\uC5C5: \${path.basename(outPath)} (\${sorted.length}\uC885/\${total}\uAC1C)\`);
}

async function createPacking(rows,outPath){
  const ExcelJS=require('exceljs');
  const custMap={};
  rows.forEach(row=>{
    const addr=String(row['\uC8FC\uC18C']||'').trim();
    const name=String(row['\uC218\uB839\uC778\uBA85']||row['\uC218\uB839\uC778']||'').trim();
    const phone=maskPhone(String(row['\uC218\uB839\uC778\uC5F0\uB77D\uCC98']||row['\uC5F0\uB77D\uCC98']||''));
    const raw=String(row['\uC0C1\uD488\uBA85(\uD0C0\uC785\uC81C\uAC70)']||row['\uC0C1\uD488\uBA85']||'').trim();
    if(!addr)return;
    if(!custMap[addr])custMap[addr]={addr,name,phone,prods:[]};
    cleanNames(raw).forEach(({name:pname,qty,code})=>custMap[addr].prods.push({name:pname,qty,code}));
  });
  const customers=Object.values(custMap).sort((a,b)=>a.addr.localeCompare(b.addr,'ko'));
  const today=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
  const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('\uD328\uD0B9\uC6A9');
  ws.getColumn(1).width=5;ws.getColumn(2).width=52;ws.getColumn(3).width=10;ws.getColumn(4).width=16;
  ws.mergeCells('A1:D1');const t=ws.getCell('A1');
  t.value=\`\uC18C\uBD84\uD300 \uD328\uD0B9\uC6A9 \uBC30\uC1A1\uC8FC\uC18C\uC9C0  \${today}\`;
  t.font={name:'\uB9D1\uC740 \uACE0\uB515',bold:true,size:13,color:{argb:'FFFFFFFF'}};
  t.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2E7D32'}};
  t.alignment={horizontal:'center',vertical:'middle'};ws.getRow(1).height=30;
  ws.addRow([]);
  customers.forEach((cust,num)=>{
    ws.addRow([num+1,cust.addr,cust.name,cust.phone]);
    const ar=ws.lastRow;ar.height=36;
    [1,2,3,4].forEach(col=>{
      const c=ar.getCell(col);
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD8EFD8'}};
      c.font={name:'\uB9D1\uC740 \uACE0\uB515',bold:col<=2,size:10};
      c.border={top:{style:'medium'},bottom:{style:'thin'},left:{style:col===1?'medium':'thin'},right:{style:col===4?'medium':'thin'}};
      c.alignment={vertical:'middle',wrapText:col===2};
    });
    cust.prods.forEach(({name:pn,qty,code})=>{
      const pDisplay=code?\`    \${pn}  (\${code})\`:\`    \${pn}\`;
      ws.addRow(['',pDisplay,\`\${qty}\uAC1C\`,'']);
      const pr=ws.lastRow;pr.height=20;
      [1,2,3,4].forEach(col=>{
        const c=pr.getCell(col);
        c.font={name:'\uB9D1\uC740 \uACE0\uB515',size:10,bold:col===3};
        c.border={top:{style:'hair'},bottom:{style:'hair'},left:{style:col===1?'medium':'thin'},right:{style:col===4?'medium':'thin'}};
        c.alignment={vertical:'middle',horizontal:col===3?'center':'left',wrapText:col===2};
      });
    });
    ws.addRow([]);
  });
  ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,
    margins:{left:0.3,right:0.3,top:0.5,bottom:0.5,header:0.2,footer:0.2}};
  await wb.xlsx.writeFile(outPath);
  log(\`OK \uD328\uD0B9\uC6A9: \${path.basename(outPath)} (\${customers.length}\uAC74)\`);
  return outPath;
}

async function createDelivery(rows,outPath,regionType){
  const ExcelJS=require('exceljs');
  const custMap={};
  rows.forEach(row=>{
    const addr=String(row['\uC8FC\uC18C']||'').trim();
    const name=String(row['\uC218\uB839\uC778\uBA85']||row['\uC218\uB839\uC778']||'').trim();
    const phone=maskPhone(String(row['\uC218\uB839\uC778\uC5F0\uB77D\uCC98']||row['\uC5F0\uB77D\uCC98']||''));
    const raw=String(row['\uC0C1\uD488\uBA85(\uD0C0\uC785\uC81C\uAC70)']||row['\uC0C1\uD488\uBA85']||'').trim();
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
  if(customers.length===0){log(\`-- \${regionType==='eco'?'\uC5D0\uCF54\uB378\uD0C0':'\uADF8\uC678\uC9C0\uC5ED'}: 0\uAC74\`);return null;}
  const isEcoType=regionType==='eco';
  const title=isEcoType?'\uBC30\uC1A1\uB2F4\uB2F9\uC790\uC6A9  \uC5D0\uCF54\uB378\uD0C0':'\uBC30\uC1A1\uB2F4\uB2F9\uC790\uC6A9  \uADF8\uC678\uC9C0\uC5ED';
  const headerColor=isEcoType?'FF1565C0':'FF6A1B9A';
  const today=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
  const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('\uBC30\uC1A1\uB2F4\uB2F9');
  ws.getColumn(1).width=5;ws.getColumn(2).width=52;ws.getColumn(3).width=12;ws.getColumn(4).width=16;
  ws.mergeCells('A1:D1');const t=ws.getCell('A1');
  t.value=\`\${title}  \${today}\`;
  t.font={name:'\uB9D1\uC740 \uACE0\uB515',bold:true,size:13,color:{argb:'FFFFFFFF'}};
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
      c.font={name:'\uB9D1\uC740 \uACE0\uB515',bold:col<=2,size:10};
      c.border={top:{style:'medium'},bottom:{style:'medium'},left:{style:col===1?'medium':'thin'},right:{style:col===4?'medium':'thin'}};
      c.alignment={vertical:'middle',wrapText:col===2};
    });
    if(hasEgg){
      const eggCell=ar.getCell(2);
      const eggText=cust.eggs.map(e=>\`  \uD83E\uDD5A \${e.name} \${e.qty}\uD310\`).join('  ');
      eggCell.value=\`\${cust.addr}\\n\${eggText}\`;
      eggCell.font={name:'\uB9D1\uC740 \uACE0\uB515',bold:true,size:10};
      eggCell.alignment={vertical:'middle',wrapText:true};
    }
  });
  ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,
    margins:{left:0.3,right:0.3,top:0.5,bottom:0.5,header:0.2,footer:0.2}};
  await wb.xlsx.writeFile(outPath);
  log(\`OK \uBC30\uC1A1\uB2F4\uB2F9 \${isEcoType?'\uC5D0\uCF54':'\uADF8\uC678'}: \${path.basename(outPath)} (\${customers.length}\uAC74, \uACC4\uB780\uC788\uB294\uC9D1:\${customers.filter(c=>c.eggs.length>0).length})\`);
  return outPath;
}

async function printFile(filePath){
  const tmp=path.join(require('os').tmpdir(),\`print_\${Date.now()}_\${path.basename(filePath)}\`);
  fs.copyFileSync(filePath,tmp);
  const abs=tmp.replace(/\//g,'\\\\');
  log(\`PRINT \${path.basename(filePath)}...\`);
  await new Promise(r=>exec(\`powershell -Command "Start-Process -FilePath '\${abs}' -Verb Print -WindowStyle Hidden"\`,{windowsHide:true},r));
  await sleep(8000);
  try{fs.unlinkSync(tmp);}catch(e){}
}

async function processFile(srcPath){
  fs.mkdirSync(OUT_DIR,{recursive:true});
  const destName=path.basename(srcPath);
  const dest=path.join(OUT_DIR,destName);
  if(srcPath!==dest){fs.copyFileSync(srcPath,dest);log(\`COPY: \${destName}\`);}
  log('READ...');
  const rows=await readExcel(dest);
  log(\`  \${rows.length}rows\`);
  if(rows.length===0){log('NO DATA');return;}

  const now=new Date().toLocaleString('ko-KR');
  await tg(\`\uD83D\uDCE6 <b>[\uACF3\uAC04] \uC8FC\uBB38 \uCC98\uB9AC \uC2DC\uC791</b>\\n\${now}\\n\\n\uC8FC\uBB38 \${rows.length}\uAC74 \uC5D4\uC140 \uCC98\uB9AC \uC911...\`);

  const today=new Date().toISOString().slice(0,10);
  const sobunPath=path.join(OUT_DIR,\`\uC18C\uBD84\uC791\uC5C5_\${today}.xlsx\`);
  const packingPath=path.join(OUT_DIR,\`\uD328\uD0B9\uC6A9_\${today}.xlsx\`);
  const ecoDelivPath=path.join(OUT_DIR,\`\uBC30\uC1A1\uB2F4\uB2F9_\uC5D0\uCF54_\${today}.xlsx\`);
  const otherDelivPath=path.join(OUT_DIR,\`\uBC30\uC1A1\uB2F4\uB2F9_\uADF8\uC678_\${today}.xlsx\`);

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
  await tg(\`\u2705 <b>[\uACF3\uAC04] \uCD9C\uB825 \uC644\uB8CC!</b>\\n\${fin}\\n\\n\uD83D\uDCCA \${rows.length}\uAC74 \uCC98\uB9AC\\n\\n\uD83D\uDDA8\uFE0F 1\uC7A5: \uC18C\uBD84\uC791\uC5C5\\n\uD83D\uDDA8\uFE0F 2\uC7A5: \uD328\uD0B9\uC6A9(\uC804\uCCB4)\\n\uD83D\uDDA8\uFE0F 3\uC7A5: \uBC30\uC1A1\uB2F4\uB2F9 \uC5D0\uCF54\uB378\uD0C0\\n\uD83D\uDDA8\uFE0F 4\uC7A5: \uBC30\uC1A1\uB2F4\uB2F9 \uADF8\uC678\uC9C0\uC5ED\`);
  log('DONE!');
}

let processing=false,lastFile='',lastTime=0;
log(\`WATCH: \${DOWNLOADS}\`);
fs.watch(DOWNLOADS,(event,filename)=>{
  if(!filename||!filename.match(/^order_\\d+.*\\.xlsx$/))return;
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
      log(\`NEW: \${filename} (\${(stat.size/1024).toFixed(0)}KB)\`);
      try{await processFile(fp);}catch(e){
        log(\`ERR: \${e.message}\`);
        await tg(\`\u26A0\uFE0F <b>[\uACF3\uAC04] \uC624\uB958</b>\\n\${new Date().toLocaleString('ko-KR')}\\n\\n\${e.message}\`);
      }
    }finally{processing=false;}
  },2000);
});
`;

const dest = path.join(__dirname, 'order_watcher.js');
fs.writeFileSync(dest, watcher, 'utf8');
console.log('설치완료! ' + dest);
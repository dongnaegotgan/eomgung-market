/**
 * order_process.js — 배송준비 주문 처리
 * Python 없이 Node.js + exceljs로 완전 처리
 * 
 * 실행: node order_process.js --local            (Downloads/order_output에서 엑셀 찾기)
 *      node order_process.js --local --no-print  (프린트 없이)
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const fs   = require('fs');
const { exec } = require('child_process');

const NO_PRINT = process.argv.includes('--no-print');
const OUT_DIR  = path.join(__dirname, 'order_output');

function log(msg) { console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 상품명 정리 ──────────────────────────────────────────────────
function cleanNames(raw) {
  if (!raw) return [];
  const parts = String(raw).split('▶').filter(p => p.trim());
  return parts.map(p => {
    const qm = p.match(/\((\d+)개\)/);
    const qty = qm ? parseInt(qm[1]) : 1;
    const nm  = p.match(/^\s*(.+?)\s*,\s*[^,]*\(\d+개\)/);
    let name = nm ? nm[1].trim() : (p.includes(',') ? p.slice(0, p.indexOf(',')).trim() : p.trim());
    return name && name.length > 1 ? { name, qty } : null;
  }).filter(Boolean);
}

function isEco(addr) {
  return String(addr).includes('에코델타') || String(addr).includes('에코대로');
}

// ── 엑셀 읽기 ────────────────────────────────────────────────────
async function readExcel(filePath) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const headers = [];
  const rows = [];
  ws.eachRow((row, i) => {
    const vals = row.values.slice(1);
    if (i === 1) { vals.forEach(v => headers.push(String(v||'').trim())); return; }
    if (!vals.some(v => v)) return;
    const obj = {};
    headers.forEach((h, j) => { if (h) obj[h] = vals[j] !== undefined ? vals[j] : ''; });
    rows.push(obj);
  });
  return rows;
}

// ── 소분작업 엑셀 ────────────────────────────────────────────────
async function createSobun(rows, outPath) {
  const ExcelJS = require('exceljs');
  
  // 상품 집계
  const prodMap = {};
  rows.forEach(row => {
    const raw = String(row['상품명(타입제거)'] || row['상품명'] || '');
    const base = parseInt(row['주문수량'] || row['수량'] || 1) || 1;
    const items = cleanNames(raw);
    if (!items.length) return;
    items.forEach(({ name, qty }) => { prodMap[name] = (prodMap[name] || 0) + qty; });
  });
  const sorted = Object.entries(prodMap).sort((a,b) => b[1]-a[1]);
  
  const today = new Date().toLocaleDateString('ko-KR', {year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
  
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('소분작업');
  
  // 제목
  ws.mergeCells('A1:C1');
  const t = ws.getCell('A1');
  t.value = `소분 작업 목록  ─  ${today}`;
  t.font = { name:'맑은 고딕', bold:true, size:14, color:{argb:'FFFFFFFF'} };
  t.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF2E7D32'} };
  t.alignment = { horizontal:'center', vertical:'middle' };
  ws.getRow(1).height = 32;
  ws.addRow([]);
  
  // 헤더
  ws.addRow(['번호','상품명','수량']);
  const hr = ws.lastRow;
  hr.height = 24;
  hr.eachCell(c => {
    c.font = { name:'맑은 고딕', bold:true, size:12 };
    c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFC8E6C9'} };
    c.alignment = { horizontal:'center', vertical:'middle' };
    c.border = { top:{style:'medium'}, bottom:{style:'medium'}, left:{style:'medium'}, right:{style:'medium'} };
  });
  
  // 데이터
  sorted.forEach(([name, qty], i) => {
    ws.addRow([i+1, name, qty]);
    const r = ws.lastRow;
    r.height = 22;
    r.eachCell((c, col) => {
      c.font = { name:'맑은 고딕', size:11 };
      c.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
      c.alignment = { vertical:'middle', horizontal: col===2 ? 'left' : 'center' };
      if (i%2===1) c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF1F8E9'} };
    });
  });
  
  // 합계
  ws.addRow(['', `총 ${sorted.length}종`, `총 ${sorted.reduce((s,[,q])=>s+q,0)}개`]);
  const tr = ws.lastRow;
  tr.height = 22;
  tr.eachCell(c => {
    c.font = { name:'맑은 고딕', bold:true, size:11 };
    c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFF176'} };
    c.border = { top:{style:'medium'}, bottom:{style:'medium'}, left:{style:'medium'}, right:{style:'medium'} };
    c.alignment = { horizontal:'center', vertical:'middle' };
  });
  
  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 46;
  ws.getColumn(3).width = 10;
  ws.pageSetup = { orientation:'portrait', fitToPage:true, fitToWidth:1 };
  
  await wb.xlsx.writeFile(outPath);
  log(`✅ 소분작업 엑셀: ${path.basename(outPath)} (${sorted.length}종 / 총 ${sorted.reduce((s,[,q])=>s+q,0)}개)`);
}

// ── 배송주소지 엑셀 ──────────────────────────────────────────────
async function createDelivery(rows, outPath) {
  const ExcelJS = require('exceljs');
  
  // 고객 묶기
  const custMap = {};
  rows.forEach(row => {
    const addr  = String(row['주소'] || '').trim();
    const name  = String(row['수령인명'] || row['수령인'] || '').trim();
    const phone = String(row['수령인연락처'] || row['연락처'] || '').trim();
    const raw   = String(row['상품명(타입제거)'] || row['상품명'] || '').trim();
    const base  = parseInt(row['주문수량'] || row['수량'] || 1) || 1;
    if (!addr) return;
    if (!custMap[addr]) custMap[addr] = { addr, name, phone, prods:[], eco:isEco(addr) };
    const items = cleanNames(raw);
    if (!items.length) return;
    items.forEach(({ name: pname, qty }) => custMap[addr].prods.push({ name: pname, qty }));
  });
  
  const eco   = Object.values(custMap).filter(c=>c.eco ).sort((a,b)=>a.addr.localeCompare(b.addr,'ko'));
  const other = Object.values(custMap).filter(c=>!c.eco).sort((a,b)=>a.addr.localeCompare(b.addr,'ko'));
  
  const today = new Date().toLocaleDateString('ko-KR', {year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
  
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('배송주소지');
  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 50;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 12;
  
  // 제목
  ws.mergeCells('A1:D1');
  const t = ws.getCell('A1');
  t.value = `배송 주소지  ─  ${today}`;
  t.font = { name:'맑은 고딕', bold:true, size:14, color:{argb:'FFFFFFFF'} };
  t.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1565C0'} };
  t.alignment = { horizontal:'center', vertical:'middle' };
  ws.getRow(1).height = 32;
  ws.addRow([]);
  
  const addSection = (title, colorHex, customers) => {
    ws.addRow([title]);
    const sr = ws.lastRow;
    ws.mergeCells(`A${sr.number}:D${sr.number}`);
    const sc = ws.getCell(`A${sr.number}`);
    sc.value = title;
    sc.font = { name:'맑은 고딕', bold:true, size:12, color:{argb:'FFFFFFFF'} };
    sc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:colorHex} };
    sc.alignment = { horizontal:'left', vertical:'middle' };
    sc.border = { top:{style:'medium'}, bottom:{style:'medium'}, left:{style:'medium'}, right:{style:'medium'} };
    sr.height = 26;
    
    const fc = colorHex === 'FF1E88E5' ? 'FFDEEDF8' : 'FFD8EFD8';
    customers.forEach((cust, num) => {
      ws.addRow([num+1, cust.addr, cust.name, cust.phone]);
      const ar = ws.lastRow; ar.height = 22;
      [1,2,3,4].forEach(col => {
        const c = ar.getCell(col);
        c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:fc} };
        c.font = { name:'맑은 고딕', bold:col<=2, size:10 };
        c.border = { top:{style:'medium'}, bottom:{style:'thin'}, left:{style:col===1?'medium':'thin'}, right:{style:col===4?'medium':'thin'} };
        c.alignment = { vertical:'middle', wrapText:col===2 };
      });
      
      cust.prods.forEach(({ name: pn, qty }) => {
        ws.addRow(['', `    ${pn}`, `${qty}개`, '']);
        const pr = ws.lastRow; pr.height = 20;
        [1,2,3,4].forEach(col => {
          const c = pr.getCell(col);
          c.font = { name:'맑은 고딕', size:10, bold:col===3 };
          c.border = { top:{style:'hair'}, bottom:{style:'hair'}, left:{style:col===1?'medium':'thin'}, right:{style:col===4?'medium':'thin'} };
          c.alignment = { vertical:'middle', horizontal:col===3?'center':'left', wrapText:col===2 };
        });
      });
      ws.addRow([]);
    });
  };
  
  addSection(`  ★ 에코델타 지역  (${eco.length}건)`, 'FF1E88E5', eco);
  ws.addRow([]); ws.addRow([]);
  addSection(`  ★ 그외 지역  (${other.length}건)`, 'FF388E3C', other);
  
  ws.pageSetup = { orientation:'portrait', fitToPage:true, fitToWidth:1 };
  await wb.xlsx.writeFile(outPath);
  log(`✅ 배송주소지 엑셀: ${path.basename(outPath)} (에코델타 ${eco.length}건 / 그외 ${other.length}건)`);
}

// ── Windows 프린트 ───────────────────────────────────────────────
async function printFile(filePath, copies) {
  const abs = path.resolve(filePath).replace(/\//g,'\\');
  log(`🖨️  ${path.basename(filePath)} × ${copies}장...`);
  for (let i = 0; i < copies; i++) {
    await new Promise(r => {
      const cmd = `powershell -Command "Start-Process -FilePath '${abs}' -Verb Print -WindowStyle Hidden"`;
      exec(cmd, { windowsHide:true }, r);
    });
    if (i < copies-1) await sleep(4000);
  }
}

// ── 메인 ─────────────────────────────────────────────────────────
async function run() {
  log('🚀 주문 처리 시작');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive:true });

  // exceljs 확인
  let ExcelJS;
  try { ExcelJS = require('exceljs'); }
  catch(e) {
    log('exceljs 설치 중...');
    await new Promise((res,rej) => exec('npm install exceljs', { cwd:__dirname, windowsHide:true }, (err) => err ? rej(err) : res()));
    log('✅ exceljs 설치 완료');
  }

  // 파일 찾기 (order_output + Downloads 폴더)
  const searchDirs = [
    OUT_DIR,
    path.join(process.env.USERPROFILE||'C:/Users/moapi', 'Downloads'),
  ];
  let allFiles = [];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    fs.readdirSync(dir)
      .filter(f => (f.endsWith('.xlsx')||f.endsWith('.xls')) && !f.includes('소분') && !f.includes('배송주소') && !f.startsWith('_'))
      .forEach(f => {
        const fp = path.join(dir, f);
        allFiles.push({ name:f, dir, fullPath:fp, time:fs.statSync(fp).mtimeMs });
      });
  }
  allFiles.sort((a,b) => b.time-a.time);
  const target = allFiles.find(f => Date.now()-f.time < 7200000) || allFiles[0];

  if (!target) {
    log('❌ 처리할 엑셀 파일이 없습니다');
    log('   flexgate → 배송준비 → 명지일일배송 ↓ 다운로드 후 재실행');
    return;
  }

  let inputPath = target.fullPath;
  if (target.dir !== OUT_DIR) {
    const dest = path.join(OUT_DIR, target.name);
    fs.copyFileSync(target.fullPath, dest);
    log(`📥 Downloads → order_output 복사: ${target.name}`);
    inputPath = dest;
  }
  log(`📂 파일: ${target.name} (${Math.round((Date.now()-target.time)/60000)}분 전)`);

  // 엑셀 읽기
  log('\n📊 데이터 읽는 중...');
  const rows = await readExcel(inputPath);
  log(`  ${rows.length}행 로드`);

  const today = new Date().toISOString().slice(0,10);
  const sobunPath    = path.join(OUT_DIR, `소분작업_${today}.xlsx`);
  const deliveryPath = path.join(OUT_DIR, `배송주소지_${today}.xlsx`);

  log('\n📄 소분작업 엑셀 생성...');
  await createSobun(rows, sobunPath);

  log('\n📄 배송주소지 엑셀 생성...');
  await createDelivery(rows, deliveryPath);

  if (NO_PRINT) {
    log('\n⏭  --no-print: 프린트 건너뜀');
  } else {
    log('\n🖨️  프린트 시작...');
    await printFile(sobunPath, 1);
    await sleep(3000);
    await printFile(deliveryPath, 2);
  }

  log('\n✅ 완료!');
  log(`  📄 소분작업:   ${sobunPath}`);
  log(`  📄 배송주소지: ${deliveryPath}`);
}

run().catch(e => { log(`❌ 오류: ${e.message}`); console.error(e); });
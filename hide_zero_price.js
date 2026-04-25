require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const puppeteer = require('puppeteer');
const path = require('path');
const fs   = require('fs');
const XLSX = require('xlsx');

const ADMIN_URL = 'https://dongnaegotgan.adminplus.co.kr';
const ADMIN_ID  = (process.env.ADMIN_ID || 'dongnaegotgan').trim();
const ADMIN_PW  = (process.env.ADMIN_PW || 'rhtrks12!@').trim();
const DL_DIR    = path.join(__dirname, 'admin_downloads');
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR);

async function run() {
  console.log('\n🙈 공급가 0원 전체 미노출 처리 시작\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--lang=ko-KR'],
    defaultViewport: { width:1400, height:900 },
    protocolTimeout: 60000,
  });

  try {
    const page = await browser.newPage();
    const client = await page.target().createCDPSession();
    const absDir = path.resolve(DL_DIR);
    await client.send('Page.setDownloadBehavior', { behavior:'allow', downloadPath:absDir });

    // 로그인
    console.log('🔑 로그인 중...');
    await page.goto(`${ADMIN_URL}/admin/`, { waitUntil:'networkidle2', timeout:30000 });
    await page.waitForSelector('input[type="password"]', { timeout:10000 });
    const idEl = await page.$('input[name="id"]') || await page.$('input[type="text"]');
    if (idEl) { await idEl.click({clickCount:3}); await idEl.type(ADMIN_ID); }
    const pwEl = await page.$('input[type="password"]');
    if (pwEl) { await pwEl.click({clickCount:3}); await pwEl.type(ADMIN_PW); }
    await Promise.all([
      page.waitForNavigation({waitUntil:'networkidle2',timeout:15000}).catch(()=>{}),
      page.keyboard.press('Enter'),
    ]);
    console.log('  ✅ 로그인 완료\n');
    await new Promise(r=>setTimeout(r,2000));

    // 상품 리스트 이동
    await page.evaluate(()=>{
      const els=[...document.querySelectorAll('a,li,span,div,button')];
      const m=els.find(el=>el.textContent.trim()==='상품 관리'||el.textContent.trim()==='상품관리');
      if(m) m.click();
    });
    await new Promise(r=>setTimeout(r,800));
    await page.evaluate(()=>{
      const els=[...document.querySelectorAll('a,li,span,div,button')];
      const m=els.find(el=>el.textContent.trim()==='상품 리스트'||el.textContent.trim()==='상품리스트');
      if(m) m.click();
    });
    await new Promise(r=>setTimeout(r,4000));

    // 기존 엑셀 삭제 후 다운로드
    fs.readdirSync(absDir).filter(f=>f.match(/\.(xlsx|xls)$/i))
      .forEach(f=>{ try{fs.unlinkSync(path.join(absDir,f));}catch(e){} });

    await page.evaluate(()=>{
      const all=[...document.querySelectorAll('button,a,input[type=button]')];
      const btn=all.find(b=>(b.textContent||b.value||'').includes('상품변경엑셀')&&(b.textContent||b.value||'').includes('다운'));
      if(btn) btn.click();
    });

    let dlFile = null;
    for(let i=0;i<40;i++){
      await new Promise(r=>setTimeout(r,500));
      const files=fs.readdirSync(absDir).filter(f=>f.match(/\.(xlsx|xls)$/i));
      if(files.length>0){ dlFile=path.join(absDir,files[0]); await new Promise(r=>setTimeout(r,1500)); break; }
    }
    if(!dlFile) throw new Error('엑셀 다운로드 실패');
    console.log('  ✅ 다운로드:', path.basename(dlFile));

    // 엑셀 파싱
    const wb   = XLSX.readFile(dlFile);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, {header:1});

    let hRow=-1, codeCol=-1, priceCol=-1, statusCol=1, nameCol=2;
    for(let r=0;r<Math.min(5,data.length);r++){
      let tc=-1, tp=-1;
      for(let c=0;c<(data[r]||[]).length;c++){
        const v=String(data[r][c]||'');
        if(v.includes('상품코드')) tc=c;
        if(v.includes('기본공급가')) tp=c;
        if(v.includes('사용여부')) statusCol=c;
        if(v.trim()==='상품명') nameCol=c;
      }
      if(tc>=0&&tp>=0){ hRow=r; codeCol=tc; priceCol=tp; break; }
    }

    // 0원 상품 미노출 처리
    const hideList = [];
    for(let r=hRow+1;r<data.length;r++){
      const code  = String(data[r][codeCol]||'').replace('.0','').trim();
      const price = Number(data[r][priceCol]||0);
      const name  = String(data[r][nameCol]||'').trim();
      const status= String(data[r][statusCol]||'').trim();
      if(!code) continue;
      if(price===0 && status==='사용'){
        data[r][statusCol] = '미사용';
        hideList.push(name||code);
      }
    }

    if(hideList.length===0){
      console.log('✅ 미노출 처리할 0원 상품 없음');
      return;
    }

    console.log(`\n🙈 미노출 처리 대상 (${hideList.length}개):`);
    hideList.forEach((n,i)=>console.log(`  ${i+1}. ${n}`));

    // 수정된 엑셀 저장
    const newWs = XLSX.utils.aoa_to_sheet(data);
    wb.Sheets[wb.SheetNames[0]] = newWs;
    const uploadFile = path.join(absDir, `upload_hide_${Date.now()}.xlsx`);
    XLSX.writeFile(wb, uploadFile);

    // 업로드
    console.log('\n📤 어드민 업로드 중...');
    const targetInput = await page.$('form[action*="sprice.prt.excel.upload.proc"] input[type="file"]')
                     || await page.$('input[type="file"]');
    if(!targetInput) throw new Error('파일 input 없음');

    page.on('dialog', async d=>{ console.log('  💬', d.message()); await d.accept(); });
    await targetInput.uploadFile(uploadFile);
    await new Promise(r=>setTimeout(r,1000));

    await page.evaluate(()=>{
      const forms=[...document.querySelectorAll('form')];
      const f=forms.find(f=>f.action&&f.action.includes('sprice.prt.excel.upload.proc'));
      if(f) f.submit();
    });

    await Promise.race([
      page.waitForNavigation({waitUntil:'networkidle2',timeout:8000}).catch(()=>{}),
      new Promise(r=>setTimeout(r,6000)),
    ]);

    console.log(`\n✅ 완료! ${hideList.length}개 상품 미노출 처리됨`);

  } finally {
    await browser.close();
  }
}

run().catch(console.error);
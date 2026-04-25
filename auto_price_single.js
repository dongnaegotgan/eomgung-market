/**
 * auto_price_single.js — 텔레그램 명령으로 특정 상품 단가 즉시 변경
 *
 * 사용법 (텔레그램):
 *   산딸기 1kg 30000원으로 변경
 *   가시오이 1kg 2500
 *   애호박 1개 1800원
 */
require('dotenv').config();
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const ADMIN_URL = 'https://dongnaegotgan.adminplus.co.kr';
const ADMIN_ID  = (process.env.ADMIN_ID || 'dongnaegotgan').trim();
const ADMIN_PW  = (process.env.ADMIN_PW || 'rhtrks12!@').trim();
const DL_DIR    = path.join(__dirname, 'admin_downloads');
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR);

// 상품명 키워드 → 상품코드 매핑 (역방향)
const NAME_TO_CODES = {
  '산딸기 500g':   ['10000957'],
  '산딸기 1kg':    ['10000956'],
  '산딸기':        ['10000957', '10000956'],
  '로메인 2kg':    ['10000838'],
  '로메인 100g':   ['10000016'],
  '꽃상추 100g':   ['10000087'],
  '케일 2kg':      ['10000837'],
  '케일 100g':     ['10000032'],
  '깻잎 2속':      ['10000689'],
  '청경채 4kg':    ['10000830'],
  '청경채 3알':    ['10000037'],
  '애호박 박스':   ['10000192'],  // 실제는 삭제됨
  '애호박 1개':    ['10000192'],
  '가시오이 10kg': ['10000822'],
  '가시오이 1kg':  ['10000456'],
  '가시오이':      ['10000822', '10000456'],
  '백다다기 1kg':  ['10000457'],
  '알배추 1포기':  ['10000454'],
  '가지 1kg':      ['10000171'],
  '방울토마토':    ['10000400'],
  '완숙토마토 1kg':['10000589'],
  '팽이버섯 박스': ['10000825'],
  '팽이버섯 8개':  ['10000585'],
  '팽이버섯 7개':  ['10000584'],
  '팽이버섯 6개':  ['10000583'],
  '팽이버섯 5개':  ['10000582'],
  '팽이버섯 4개':  ['10000581'],
  '팽이버섯 3개':  ['10000320'],
  '팽이버섯 1개':  ['10000682', '10000764'],
  '팽이버섯':      ['10000825','10000585','10000584','10000583','10000582','10000581','10000320','10000682','10000764'],
  '느타리버섯':    ['10000527'],
  '새송이버섯':    ['10000528', '10000529'],
  '만가닥버섯':    ['10000530'],
  '표고버섯':      ['10000526'],
  '쌈배추 100g':   ['10000116'],
  '치커리 100g':   ['10000027'],
  '양상추 1알':    ['10000074'],
  '양배추 1통':    ['10000069'],
  '적채 1통':      ['10000141'],
  '대파 1단':      ['10000048'],
  '쪽파 1단':      ['10000414'],
  '깐쪽파 1단':    ['10000079'],
  '부추 1단':      ['10000060'],
  '흙당근 1kg':    ['10000704'],
  '고구마 1kg':    ['10000700'],
  '양파 1kg':      ['10000343'],
  '쥬키니호박 1kg':['10000202'],
  '단호박 1알':    ['10000245'],
  '제주단호박':    ['10000734'],
  '청양고추 800g': ['10000568'],
  '청양고추 700g': ['10000567'],
  '청양고추 600g': ['10000566'],
  '청양고추 500g': ['10000565'],
  '청양고추 400g': ['10000563'],
  '청양고추 300g': ['10000564'],
  '꽈리고추 100g': ['10000575'],
  '오이고추 800g': ['10000631'],
  '오이고추 700g': ['10000630'],
  '오이고추 600g': ['10000629'],
  '오이고추 500g': ['10000628'],
  '오이고추 400g': ['10000627'],
  '오이고추 300g': ['10000626'],
  '모닝풋고추 200g':['10000201'],
  '청피망 300g':   ['10000222'],
  '파프리카 홍':   ['10000224'],
  '파프리카 노':   ['10000231'],
  '무 1개':        ['10000252'],
  '무순':          ['10000150'],
  '적근대 300g':   ['10000446'],
};

// 상품명 매칭 (유사 검색)
// 정확한 단일 상품 매핑 (중복 방지)
const EXACT_MATCH_MAP = {};
Object.entries(NAME_TO_CODES).forEach(([name, codes]) => {
  if (codes.length === 1) EXACT_MATCH_MAP[name] = true;
});

function findCodes(productName) {
  const name = productName.trim();
  // 정확히 일치
  if (NAME_TO_CODES[name]) return NAME_TO_CODES[name];
  // 포함 검색 - key가 검색어를 포함할 때만 매칭 (역방향 제거)
  // 예: 검색어 "양배추" → "양배추 1통" 매칭 O
  //     검색어 "깐양배추" → "양배추 1통" 매칭 X (오매칭 방지)
  const matched = new Set();
  for (const [key, codes] of Object.entries(NAME_TO_CODES)) {
    if (key.includes(name)) {
      codes.forEach(c => matched.add(c));
    }
  }
  // 매칭 없으면 null 반환 (오매칭 방지)
  return matched.size > 0 ? [...matched] : null;
}

// 미노출 전용 실행 함수
async function runHide(productName) {
  return run(productName, null, true);
}

async function run(productName, newPrice, hideMode=false) {
  if (hideMode) {
    console.log(`\n🙈 미노출 처리: ${productName}`);
  } else {
    console.log(`\n💱 단가 즉시 변경: ${productName} → ${newPrice.toLocaleString()}원`);
  }
  const absDir = require('path').resolve(DL_DIR);
  if (!require('fs').existsSync(absDir)) require('fs').mkdirSync(absDir, {recursive:true});

  // NAME_TO_CODES는 보조 수단 — 실제 매칭은 엑셀 다운로드 후 처리
  // (어드민의 모든 상품 변경 가능)
  const preCheck = findCodes(productName);
  // preCheck 결과는 나중에 엑셀과 합산하여 사용

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ko-KR'],
    defaultViewport: { width: 1400, height: 900 },
    protocolTimeout: 60000,
  });

  try {
    const page = await browser.newPage();
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });

    // 로그인
    await page.goto(`${ADMIN_URL}/admin/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    const idEl = await page.$('input[name="id"]') || await page.$('input[type="text"]');
    if (idEl) { await idEl.click({ clickCount: 3 }); await idEl.type(ADMIN_ID); }
    const pwEl = await page.$('input[type="password"]');
    if (pwEl) { await pwEl.click({ clickCount: 3 }); await pwEl.type(ADMIN_PW); }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ]);

    // 상품 리스트로 이동
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(() => {
      const els = [...document.querySelectorAll('a,li,span,div,button')];
      const m = els.find(el => el.textContent.trim() === '상품 관리' || el.textContent.trim() === '상품관리');
      if (m) m.click();
    });
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => {
      const els = [...document.querySelectorAll('a,li,span,div,button')];
      const m = els.find(el => el.textContent.trim() === '상품 리스트' || el.textContent.trim() === '상품리스트');
      if (m) m.click();
    });
    await new Promise(r => setTimeout(r, 4000));

    // 기존 엑셀 파일 삭제 후 다운로드 (감지 오류 방지)
    fs.readdirSync(DL_DIR).filter(f => f.match(/\.(xlsx|xls)$/i))
      .forEach(f => { try { fs.unlinkSync(path.join(DL_DIR, f)); } catch(e){} });

    const btnClicked = await page.evaluate(() => {
      const all = [...document.querySelectorAll('button,a,input[type=button]')];
      const btn = all.find(b => (b.textContent || b.value || '').includes('상품변경엑셀') && (b.textContent || b.value || '').includes('다운'));
      if (btn) { btn.click(); return btn.textContent?.trim() || '클릭됨'; }
      return null;
    });
    console.log('  버튼 클릭:', btnClicked || '❌ 버튼 없음');

    // 새 파일 나타날 때까지 최대 25초 대기
    let dlFile = null;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 500));
      const files = fs.readdirSync(absDir).filter(f => f.match(/\.(xlsx|xls)$/i) && !f.startsWith('upload_'));
      if (files.length > 0) {
        dlFile = path.join(absDir, files[0]);
        await new Promise(r => setTimeout(r, 1500));
        console.log('  ✅ 다운로드 완료:', files[0]);
        break;
      }
      if (i === 20) console.log('  ⏳ 다운로드 대기 중... (10초)');
    }
    if (!dlFile) {
      // 버튼이 없는 경우 페이지 URL 확인
      console.log('  현재 URL:', page.url());
      const btns = await page.evaluate(()=>
        [...document.querySelectorAll('button,a')].map(b=>b.textContent?.trim()).filter(t=>t&&t.length<30)
      );
      console.log('  페이지 버튼:', btns.slice(0,10));
      throw new Error('엑셀 다운로드 실패 (25초 타임아웃)');
    }

    // 엑셀 수정
    const wb = XLSX.readFile(dlFile);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // 코드 + 가격 컬럼 둘 다 있는 행을 헤더로 (안내문 행 제외)
    let hRow = -1, codeCol = -1, priceCol = -1, nameCol = -1;
    for (let r = 0; r < Math.min(5, data.length); r++) {
      let tc = -1, tp = -1, tn = -1;
      for (let c = 0; c < (data[r] || []).length; c++) {
        const v = String(data[r][c] || '');
        if (v.includes('상품코드')) tc = c;
        if (v.includes('기본공급가')) tp = c;
        if (v.trim() === '상품명') tn = c;
      }
      if (tc >= 0 && tp >= 0) {
        hRow = r; codeCol = tc; priceCol = tp; nameCol = tn >= 0 ? tn : 2;
        break;
      }
    }

    // 엑셀에서 상품명으로 직접 검색 (NAME_TO_CODES 불필요)
    const keyword = productName.trim().toLowerCase();
    const matchedRows = [];
    for (let r = hRow + 1; r < data.length; r++) {
      const code = String(data[r][codeCol] || '').replace('.0', '').trim();
      const name = String(data[r][2] || '').trim(); // col2 = 상품명
      if (!code || !name) continue;
      if (name.toLowerCase().includes(keyword) || keyword.includes(name.toLowerCase().replace(/새벽경매\s*/,''))) {
        matchedRows.push({ r, code, name, price: Number(data[r][priceCol] || 0) });
      }
    }

    // 여러 개 매칭 시 재요청
    if (matchedRows.length > 1) {
      const list = matchedRows.map((m,i) => `${i+1}. ${m.name} (${m.price.toLocaleString()}원)`).join('\n');
      return {
        success: false,
        needsSelection: true,
        items: matchedRows.map(m=>({code:m.code, name:m.name})),
        message: `"${productName}" 검색 결과가 여러 개입니다.\n정확한 상품명으로 다시 입력해주세요:\n\n${list}`
      };
    }
    if (matchedRows.length === 0) {
      return { success: false, message: `"${productName}" 상품을 찾을 수 없습니다.\n상품명 일부만 입력해도 됩니다.\n예) 적근대 / 양배추 / 산딸기` };
    }

    let oldPrice = null;
    let updatedNames = [];
    // 사용여부 컬럼 찾기 (col 1)
    let statusCol = 1; // 기본값
    for (let c = 0; c < (data[hRow]||[]).length; c++) {
      if (String(data[hRow][c]||'').includes('사용여부')) { statusCol = c; break; }
    }

    for (const { r, name } of matchedRows) {
      oldPrice = Number(data[r][priceCol] ?? 0);
      updatedNames.push(name);
      if (hideMode) {
        // 미노출: 사용여부 → 미사용
        data[r][statusCol] = '미사용';
      } else {
        data[r][priceCol] = newPrice;
      }
    }
    if (oldPrice === null) return { success: false, message: '현재 공급가를 읽을 수 없습니다.' };

    // 수정된 엑셀 저장
    const newWs = XLSX.utils.aoa_to_sheet(data);
    wb.Sheets[wb.SheetNames[0]] = newWs;
    const uploadFile = path.join(absDir, `upload_single_${Date.now()}.xlsx`);
    XLSX.writeFile(wb, uploadFile);

    // 업로드 버튼 클릭 후 모달 HTML 확인
    await page.evaluate(() => {
      const all = [...document.querySelectorAll('button,a,input[type=button]')];
      const btn = all.find(b => (b.textContent||b.value||'').includes('상품변경엑셀') && (b.textContent||b.value||'').includes('업로드'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // 모달/팝업 HTML 구조 확인
    const modalInfo = await page.evaluate(() => {
      // 팝업창, 모달, 레이어 찾기
      const selectors = ['.modal', '.popup', '.layer', '#modal', '#popup', '[class*="modal"]', '[class*="popup"]', '[class*="layer"]', '[id*="modal"]', '[id*="popup"]'];
      let modalHtml = '';
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0) {
          modalHtml = el.innerHTML.slice(0, 500);
          break;
        }
      }
      // input[type=file] 부모 구조 확인
      const fi = document.querySelector('input[type="file"]');
      const fiParent = fi ? fi.closest('form,div,section')?.innerHTML?.slice(0,500) : null;
      // 모든 폼 확인
      const forms = [...document.querySelectorAll('form')].map(f => ({
        action: f.action, method: f.method, html: f.innerHTML.slice(0,200)
      }));
      return { modalHtml, fiParent, forms };
    });
    console.log('  📋 모달 HTML:', modalInfo.modalHtml?.slice(0,200) || '없음');
    console.log('  📋 파일input 부모:', modalInfo.fiParent?.slice(0,200) || '없음');
    console.log('  📋 폼 수:', modalInfo.forms?.length, modalInfo.forms?.map(f=>f.action+'/'+f.method).join(', '));

    // 상품변경엑셀 폼 안의 파일 input을 정확히 찾아서 업로드
    const fileInput = await page.$('form[action*="sprice.prt.excel.upload.proc"] input[type="file"]');
    if (!fileInput) {
      // 폴백: 첫 번째 file input
      const fallback = await page.$('input[type="file"]');
      if (!fallback) throw new Error('파일 input 없음');
      console.log('  ⚠️ 폴백 file input 사용');
    }
    const targetInput = fileInput || await page.$('input[type="file"]');
    console.log('  📂 타겟 input:', fileInput ? '정확한 폼 내부 input' : '폴백 input');

    page.on('dialog', async d => { console.log('  💬 알림:', d.message()); await d.accept(); });
    page.on('request', req => { if (req.method()==='POST') console.log('  🌐 POST:', req.url().split('actpage=')[1]||req.url()); });
    page.on('response', res => { if (res.request().method()==='POST') console.log('  📡', res.status()); });

    await targetInput.uploadFile(uploadFile);
    console.log('  📎 파일 첨부 완료');
    await new Promise(r => setTimeout(r, 1000));

    // 같은 폼의 submit 버튼 클릭 (form.submit() 대신)
    const submitted = await page.evaluate(() => {
      const forms = [...document.querySelectorAll('form')];
      const targetForm = forms.find(f => f.action && f.action.includes('sprice.prt.excel.upload.proc'));
      if (targetForm) {
        // 폼 안의 submit 버튼 클릭
        const btn = targetForm.querySelector('button[type=submit], input[type=submit], button.btn-upload, button');
        if (btn) { btn.click(); return 'submit버튼 클릭: ' + (btn.textContent||btn.value||'').trim(); }
        // 버튼 없으면 form.submit()
        targetForm.submit();
        return 'form.submit()';
      }
      return '폼 없음';
    });
    console.log('  🖱 제출:', submitted);

    await Promise.race([
      page.waitForNavigation({waitUntil:'networkidle2',timeout:8000}).catch(()=>{}),
      new Promise(r=>setTimeout(r,6000))
    ]);
    const resultText = await page.evaluate(()=>document.body.innerText.replace(/\n+/g,' ').slice(0,200)).catch(()=>'');
    console.log('  📄 결과:', resultText.slice(0,150));
    console.log(`  ✅ 업로드 완료: ${updatedNames.join(', ')} → ${newPrice.toLocaleString()}원`);
    return { success: true, oldPrice, updatedNames };

  } finally {
    await browser.close();
  }
}

module.exports = { run, runHide };

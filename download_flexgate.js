/**
 * download_flexgate.js
 * 
 * 로그인 창이 열리면 → 로그인 버튼만 클릭하세요 (자동완성으로 채워짐)
 * 로그인 후 자동으로 배송준비 엑셀 다운로드
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const puppeteer = require('puppeteer');
const readline  = require('readline');
const fs   = require('fs');
const path = require('path');

const BASE    = 'https://dongnaegotgan.flexgate.co.kr';
const INTRO   = 'https://intro.flexgate.co.kr';
const OUT_DIR = process.argv[2] || '.';

function log(m) { process.stdout.write(`[${new Date().toLocaleTimeString('ko-KR')}] ${m}\n`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = (await browser.pages())[0] || await browser.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));

  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(OUT_DIR) });

  try {
    // ── 로그인 ──────────────────────────────────────────────────
    log('로그인 페이지 열기...');
    await page.goto(`${INTRO}/Mypage/Login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1500);

    log('');
    log('================================================================');
    log('  브라우저 창에서 로그인 버튼을 클릭해주세요!');
    log('  (아이디/비번은 자동완성으로 이미 채워져 있어요)');
    log('================================================================');
    log('');

    // 로그인 완료 대기 (URL이 dongnaegotgan.flexgate.co.kr로 바뀔 때까지)
    try {
      await page.waitForFunction(
        () => location.hostname === 'dongnaegotgan.flexgate.co.kr',
        { timeout: 300000, polling: 500 } // 5분 대기
      );
    } catch(e) {
      log('❌ 5분 내 로그인 안 됨');
      await browser.close();
      process.exit(1);
    }
    log('✅ 로그인 완료');

    // ── 배송준비 페이지 이동 ────────────────────────────────────
    log('배송준비 페이지 이동...');
    await page.goto(
      `${BASE}/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000`,
      { waitUntil: 'networkidle2', timeout: 30000 }
    );
    await sleep(2000);

    // 주문 로드 대기
    await page.evaluate(() => {
      if (typeof loadedFunc === 'function') loadedFunc();
    }).catch(() => {});
    await page.waitForFunction(
      () => document.querySelectorAll('input[name="chk"]').length > 0,
      { timeout: 20000, polling: 500 }
    ).catch(() => {});
    await sleep(1000);

    const cnt = await page.evaluate(() => document.querySelectorAll('input[name="chk"]').length);
    log(`주문 ${cnt}건 로드됨`);

    if (cnt === 0) {
      log('❌ 주문 없음');
      await browser.close();
      process.exit(1);
    }

    // ── 전체선택 + 명지일일배송 + 다운로드 ─────────────────────
    log('전체선택 + 명지일일배송 선택...');
    await page.evaluate(() => {
      document.getElementById('chkCheckDataAll').click();
      document.getElementById('customexcelFrm').value = '94';
    });
    await sleep(500);

    // CreateExcelIfile 응답 캡처
    const createPromise = page.waitForResponse(
      r => r.url().includes('CreateExcelIfile'), { timeout: 30000 }
    );
    await page.evaluate(() => orderExcelDownload(3));

    let fileName = null;
    try {
      const res  = await createPromise;
      const text = await res.text();
      log(`서버 응답: ${text.slice(0, 100)}`);
      const m = text.match(/order_\d+\.xlsx/);
      if (m) fileName = m[0];
      else { try { fileName = JSON.parse(text).fileName || ''; } catch(e) {} }
    } catch(e) { log(`응답 캡처: ${e.message}`); }

    if (!fileName) { log('❌ 파일명 없음'); await browser.close(); process.exit(1); }
    log(`파일명: ${fileName}`);

    // ── 다운로드 ─────────────────────────────────────────────────
    log('다운로드 중...');
    await sleep(3000);
    const dlUrl = `${BASE}/NewOrder/ExcelDownload?fileName=${encodeURIComponent(fileName)}`;
    await page.goto(dlUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await sleep(5000);

    // 파일 확인
    const files = fs.readdirSync(OUT_DIR)
      .filter(f => f.endsWith('.xlsx') && !f.includes('소분') && !f.includes('배송주소'))
      .map(f => ({ name: f, t: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);

    if (files.length > 0 && Date.now() - files[0].t < 60000) {
      const out = path.join(OUT_DIR, files[0].name);
      log(`✅ 다운로드 완료: ${files[0].name}`);
      await browser.close();
      console.log(`DOWNLOAD_OK:${out}`);
    } else {
      log('❌ 파일 없음');
      await browser.close();
      process.exit(1);
    }

  } catch(e) {
    log(`❌ 오류: ${e.message}`);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

run();
/**
 * tg_status_bot.js v8 - 버그수정판
 *
 * 수정사항:
 *   1. 어드민 status='0'(전체) + 오늘 날짜 필터 적용
 *   2. 곳간 orderNums를 Set으로 올바르게 처리 (PJM 패턴)
 *   3. 곳간 상품 파싱 개선 (HTML + DOM 이중 파싱)
 *   4. 어드민 상품 파싱 개선 (셀 구조 직접 탐색)
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const https = require('https');
const http  = require('http');
const puppeteer = require('puppeteer');

const TG_TOKEN = process.env.TG_TOKEN || '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT  = process.env.TG_CHAT  || '6097520392';
const ADMIN_HOST = 'dongnaegotgan.adminplus.co.kr';
const ADMIN_URL  = `https://${ADMIN_HOST}/admin/`;
const ADMIN_ID   = process.env.ADMIN_ID || 'dongnaegotgan';
const ADMIN_PW   = process.env.ADMIN_PW || 'rhtrks12!@';
const FG_URL     = 'https://dongnaegotgan.flexgate.co.kr';
const FG_LOGIN   = 'https://intro.flexgate.co.kr/Mypage/Login';
const FG_ID      = process.env.FG_ID  || 'dongnaegotgan';
const FG_PW      = process.env.FG_PW  || 'rhtrks12!@';

function log(m) { console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${m}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── HTTP 요청 ──────────────────────────────────────────────────────────
function req(options, body = null) {
  return new Promise((resolve, reject) => {
    const mod = options.hostname === 'localhost' ? http : https;
    const r = mod.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
function parseCookies(arr) {
  const c = {};
  (arr||[]).forEach(s => {
    const [kv] = s.split(';'); const [k,v] = kv.split('=');
    if(k) c[k.trim()]=(v||'').trim();
  });
  return c;
}
function cookieStr(c) { return Object.entries(c).map(([k,v])=>`${k}=${v}`).join('; '); }

// ── 텔레그램 ─────────────────────────────────────────────────────────
async function tgSend(msg, chatId = TG_CHAT) {
  const body = JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' });
  await req({ hostname: 'api.telegram.org', path: `/bot${TG_TOKEN}/sendMessage`,
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body).catch(e => log(`tgSend 오류: ${e.message}`));
}
async function tgGetUpdates(offset) {
  const res = await req({ hostname: 'api.telegram.org',
    path: `/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=20&limit=10`, method: 'GET'
  }).catch(()=>null);
  if (!res) return [];
  try { const d = JSON.parse(res.body); return d.ok ? d.result : []; } catch { return []; }
}

// ── 어드민플러스 (HTTP) ────────────────────────────────────────────────
let adminCookies = {}, adminLoginTime = 0;

async function adminLogin() {
  const body = new URLSearchParams({ id: ADMIN_ID, pw: ADMIN_PW, mode: 'login' }).toString();
  const res = await req({ hostname: ADMIN_HOST, path: '/admin/login.php', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body), 'Referer': ADMIN_URL, 'User-Agent': 'Mozilla/5.0' }
  }, body);
  let c = parseCookies(res.headers['set-cookie']);
  if (!Object.keys(c).length && res.headers['location']) {
    const r2 = await req({ hostname: ADMIN_HOST, path: res.headers['location'],
      method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
    c = parseCookies(r2.headers['set-cookie']);
  }
  adminCookies = c;
  adminLoginTime = Date.now();
  log(`  [어드민] 로그인 완료, 쿠키 ${Object.keys(c).length}개`);
}

async function ensureAdmin() {
  if (Date.now() - adminLoginTime < 20*60*1000 && Object.keys(adminCookies).length) return;
  await adminLogin();
}

async function getAdminOrders() {
  await ensureAdmin();

  // ▼▼▼ 수정 1: 오늘 날짜 + status='0'(전체 신규주문) ▼▼▼
  const today = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'
  }).replace(/\. /g,'-').replace('.',  ''); // "2026-04-24" 형식
  // ISO 형식으로 다시
  const todayISO = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0,10);

  // stats API로 신규주문 카운트
  let newOrderCount = 0;
  try {
    const sr = await req({ hostname: ADMIN_HOST, path: '/admin/xml/real.stats.json.php', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': 0,
        'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
        'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' }
    }, '');
    const stats = JSON.parse(sr.body);
    // spnNew5 = 신규주문, spnPay = 결제완료 등 여러 상태 합산
    newOrderCount = parseInt(stats.spnNew5) || 0;
    log(`  [어드민 stats] 신규주문=${newOrderCount}, 전체stats=${JSON.stringify(stats).slice(0,100)}`);
  } catch(e) {
    log(`  [어드민 stats] 오류: ${e.message}`);
  }

  // 주문 목록 조회 - status='' (전체), 오늘 날짜 필터
  // ▼▼▼ 수정: status 비우거나 '0'으로, 오늘 날짜 적용 ▼▼▼
  const params = new URLSearchParams({
    proc: 'json', mod: 'order', actpage: 'od.list.bd',
    status: '',           // 전체 상태 조회 (빈 값 = 전체)
    datefld: 'b.regdate',
    sdate: JSON.stringify({ start: todayISO, end: todayISO }),  // 오늘만
    bizgrp: 'all', searchtype: 'all', searchval: '',
    _search: 'false', rows: '500', page: '1', sidx: 'regdate', sord: 'desc'
  });

  const prodMap = {};
  let listCount = 0;
  try {
    const res = await req({ hostname: ADMIN_HOST,
      path: `/admin/order/json/od.list.bd.php?${params}`, method: 'GET',
      headers: { 'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
        'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' }
    });

    let data;
    try { data = JSON.parse(res.body); }
    catch(e) {
      log(`  [어드민] JSON 파싱 실패 (세션만료 가능성): ${res.body.slice(0,100)}`);
      // 세션 만료 시 재로그인
      adminLoginTime = 0;
      await adminLogin();
      const res2 = await req({ hostname: ADMIN_HOST,
        path: `/admin/order/json/od.list.bd.php?${params}`, method: 'GET',
        headers: { 'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
          'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' }
      });
      data = JSON.parse(res2.body);
    }

    const rows = data.rows || [];
    listCount = parseInt(data.records) || rows.length;
    log(`  [어드민] 오늘주문=${listCount}건, rows=${rows.length}`);

    rows.forEach(row => {
      const cell = Array.isArray(row.cell) ? row.cell : [];
      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const text = c.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();

        // 패턴 1: "상품명 N개" 형태
        const m1 = text.match(/^(.{2,30}?)\s+(\d+)개/);
        if (m1) {
          const name = m1[1].trim(); const qty = parseInt(m1[2]);
          if (qty > 0 && qty < 1000 && name.length >= 2)
            prodMap[name] = (prodMap[name]||0) + qty;
          return;
        }
        // 패턴 2: "상품명 / N개" 형태
        const m2 = text.match(/^(.{2,30}?)\s*\/\s*(\d+)\s*개/);
        if (m2) {
          const name = m2[1].trim(); const qty = parseInt(m2[2]);
          if (qty > 0 && qty < 1000 && name.length >= 2)
            prodMap[name] = (prodMap[name]||0) + qty;
        }
      });
    });
  } catch(e) {
    log(`  [어드민] 목록 조회 오류: ${e.message}`);
  }

  // orderCount: stats의 신규주문 수가 있으면 사용, 없으면 리스트 수 사용
  const orderCount = newOrderCount || listCount;
  return { orderCount, prodMap, newOrderCount, listCount };
}

// ── 곳간 Puppeteer ────────────────────────────────────────────────────
let fgBrowser = null, fgPage = null, fgLoginTime = 0;

async function ensureFgBrowser() {
  if (fgBrowser && fgBrowser.isConnected()) return;
  log('  [곳간] 새 브라우저 시작...');
  fgBrowser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--lang=ko-KR',
      '--disable-blink-features=AutomationControlled', '--disable-web-security',
    ],
    defaultViewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  fgPage = await fgBrowser.newPage();
  fgPage.on('dialog', async d => await d.accept().catch(()=>{}));
  await fgPage.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR','ko','en-US'] });
  });
  await fgPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
}

async function fgLogin() {
  await ensureFgBrowser();
  log('  [곳간] 브라우저 로그인 시작...');
  await fgPage.goto(FG_LOGIN, { waitUntil: 'networkidle2', timeout: 20000 });

  try { await fgPage.waitForSelector('input[name="userId"]', { timeout: 5000 }); }
  catch(e) {
    const fi = await fgPage.evaluate(() =>
      [...document.querySelectorAll('input')].map(i=>`${i.name}/${i.type}`)
    );
    log(`  [곳간] userId 셀렉터 없음, inputs: ${JSON.stringify(fi)}`);
  }

  await fgPage.evaluate(() => {
    const u = document.querySelector('input[name="userId"]');
    const p = document.querySelector('input[name="password"]');
    if (u) u.value = '';
    if (p) p.value = '';
  });

  const idEl = await fgPage.$('input[name="userId"]');
  const pwEl = await fgPage.$('input[name="password"]');

  if (idEl && pwEl) {
    await idEl.click({ clickCount: 3 }); await fgPage.keyboard.type(FG_ID);
    await pwEl.click({ clickCount: 3 }); await fgPage.keyboard.type(FG_PW);
    log(`  [곳간] userId/password 입력 완료`);
  } else {
    log(`  [곳간] 입력 필드 없음 - userId:${!!idEl} password:${!!pwEl}`);
  }

  await sleep(300);

  const loginBtn = await fgPage.$('button[type="submit"], input[type="submit"], button.btn-login').catch(()=>null);
  if (loginBtn) {
    await Promise.all([
      fgPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
      loginBtn.click(),
    ]);
  } else {
    log('  [곳간] 버튼 못찾음 → Enter 키 전송');
    if (pwEl) {
      await Promise.all([
        fgPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
        pwEl.press('Enter'),
      ]);
    }
  }

  // 로그인 완료 대기 (최대 8초)
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    if (!fgPage.url().includes('Login')) break;
  }
  log(`  [곳간] 로그인 후 URL: ${fgPage.url()}`);

  const pgCookies = await fgPage.cookies();
  log(`  [곳간] 브라우저 쿠키 ${pgCookies.length}개: ${pgCookies.map(c=>c.name).join(', ')}`);

  fgLoginTime = Date.now();
}

async function ensureFgLogin() {
  if (Date.now() - fgLoginTime < 25*60*1000 && fgBrowser?.isConnected()) return;
  await fgLogin();
}

async function getGotganOrders() {
  await ensureFgLogin();

  try {
    // 주문 페이지 이동
    await fgPage.goto(`${FG_URL}/NewOrder/deal01?order_status=10&formtype=A&pagesize=1000`,
      { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(800);

    const url = fgPage.url();
    log(`  [곳간] 주문 페이지 URL: ${url}`);

    // 세션 만료 감지 → 재로그인
    if (url.includes('Login') || url.includes('login')) {
      log('  [곳간] 세션 만료, 재로그인...');
      fgLoginTime = 0;
      await fgLogin();
      const afterUrl = fgPage.url();
      log(`  [곳간] 재로그인 후 URL: ${afterUrl}`);
      if (!afterUrl.includes('Login')) {
        await fgPage.goto(`${FG_URL}/NewOrder/deal01?order_status=10&formtype=A&pagesize=1000`,
          { waitUntil: 'networkidle2', timeout: 15000 });
        await sleep(800);
      }
    }

    const html = await fgPage.content();
    const snippet = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,300);
    log(`  [곳간 status=10 HTML] ${snippet}`);

    // ▼▼▼ 수정 2: orderNums를 Set으로 올바르게 처리 ▼▼▼
    const orderNums = new Set();
    for (const m of html.matchAll(/PJM[A-Z0-9]+/g)) orderNums.add(m[0]);
    log(`  [곳간 status=10] 주문번호=${orderNums.size}개, len=${html.length}`);

    // status=10에 주문 없으면 status=20 시도
    if (orderNums.size === 0) {
      await fgPage.goto(`${FG_URL}/NewOrder/deal01?order_status=20&formtype=A&pagesize=1000`,
        { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(800);
      const html2 = await fgPage.content();
      for (const m of html2.matchAll(/PJM[A-Z0-9]+/g)) orderNums.add(m[0]);
      log(`  [곳간 status=20] PJM=${orderNums.size}개`);
    }

    // ▼▼▼ 수정 3: 상품 파싱 개선 (DOM + HTML 이중 파싱) ▼▼▼
    const prodMap = await fgPage.evaluate(() => {
      const map = {};

      // 방법 A: tbody tr에서 셀 직접 읽기
      document.querySelectorAll('table tbody tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')].map(td =>
          td.innerText.replace(/\s+/g,' ').trim()
        );
        if (cells.length < 3) return;

        // 각 셀에서 "상품명 / N개" 또는 "상품명\nN개" 패턴 탐색
        cells.forEach(cell => {
          // 패턴: 텍스트 / 숫자
          const m1 = cell.match(/^([^\n\/]{2,30}?)\s*\/\s*(\d+)\s*개?/);
          if (m1) {
            const name = m1[1].trim(); const qty = parseInt(m1[2]);
            if (name.length >= 2 && qty > 0 && qty < 9999 &&
                !/배송|주소|전화|연락|결제|금액|합계|취소|삭제/.test(name))
              map[name] = (map[name]||0) + qty;
          }
        });
      });

      // 방법 B: 텍스트 전체에서 "상품명 N개" 패턴 (방법A 보완)
      if (Object.keys(map).length === 0) {
        const allText = document.body.innerText;
        const lines = allText.split('\n');
        lines.forEach(line => {
          const m = line.trim().match(/^([^\t\/]{2,30}?)\s+(\d+)\s*개/);
          if (m) {
            const name = m[1].trim(); const qty = parseInt(m[2]);
            if (name.length >= 2 && qty > 0 && qty < 9999 &&
                !/배송|주소|전화|연락|결제|금액|합계|취소|삭제|원$/.test(name))
              map[name] = (map[name]||0) + qty;
          }
        });
      }

      return map;
    });

    log(`  [곳간] 상품종류=${Object.keys(prodMap).length}개`);
    return { orderCount: orderNums.size, prodMap };

  } catch(e) {
    log(`  [곳간] 오류: ${e.message}`);
    try { await fgBrowser?.close(); } catch(_) {}
    fgBrowser = null; fgPage = null; fgLoginTime = 0;
    return { orderCount: 0, prodMap: {} };
  }
}

// ── 메시지 포맷 ───────────────────────────────────────────────────────
function formatSection(title, data) {
  const { orderCount, prodMap } = data;
  const entries = Object.entries(prodMap).filter(([,q])=>q>0).sort((a,b)=>b[1]-a[1]);
  let msg = `${title}\n총 주문: <b>${orderCount}건</b>\n`;
  if (entries.length > 0) {
    msg += `\n📦 상품별 수량\n`;
    entries.slice(0,15).forEach(([n,q]) => { msg += `  • ${n} <b>${q}개</b>\n`; });
  } else {
    msg += `  (상품 정보 없음)\n`;
  }
  return msg;
}

// ── 명령 처리 ─────────────────────────────────────────────────────────
let busy = false;

async function handleCommand(cmd, chatId) {
  log(`처리: ${cmd}`);

  if (cmd === '/도움말' || cmd === '도움말') {
    await tgSend(
      `📋 <b>명령어</b>\n` +
      `/현황 — 어드민+곳간 통합\n` +
      `/어드민 — 어드민플러스만\n` +
      `/곳간 — flexgate만\n` +
      `/알림 — 자동승인 상태\n` +
      `/곳간출력 — 주문 엑셀 출력`,
      chatId
    );
    return;
  }

  if (cmd === '/알림' || cmd === '알림') {
    await tgSend('🔔 gotgan-approve: 30초 간격 인증대기 자동 승인 실행 중', chatId);
    return;
  }

  if (cmd === '/곳간출력' || cmd === '곳간출력') {
    await tgSend('📥 곳간 출력 시작... (약 30초 소요)', chatId);
    (async () => {
      let dlBrowser = null;
      try {
        const path = require('path');
        const os = require('os');
        const DOWNLOADS = path.join(os.homedir(), 'Downloads');
        const FG_BASE = 'https://dongnaegotgan.flexgate.co.kr';
        const FG_INTRO = 'https://intro.flexgate.co.kr';

        dlBrowser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'],
          defaultViewport: { width: 1440, height: 900 },
        });
        const dlPage = await dlBrowser.newPage();
        dlPage.on('dialog', d => d.accept().catch(()=>{}));
        const cdp = await dlPage.createCDPSession();
        await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
        await dlPage.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        await dlPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await dlPage.goto(`${FG_INTRO}/Mypage/Login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(1500);
        const idEl = await dlPage.$('#userId, input[name="userId"]');
        const pwEl = await dlPage.$('#password, input[name="password"]');
        if (idEl) { await idEl.click({clickCount:3}); await idEl.type(FG_ID); }
        if (pwEl) { await pwEl.click({clickCount:3}); await pwEl.type(FG_PW); }
        await sleep(500);
        await Promise.all([
          dlPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
          pwEl ? pwEl.press('Enter') : Promise.resolve(),
        ]);
        await sleep(2000);

        const afterUrl = dlPage.url();
        if (!afterUrl.includes('dongnaegotgan.flexgate.co.kr')) {
          await dlBrowser.close();
          await tgSend('❌ 곳간 로그인 실패. 직접 확인 필요.', chatId);
          return;
        }

        await dlPage.goto(`${FG_BASE}/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000`,
          { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(2000);
        await dlPage.waitForFunction(
          () => document.querySelectorAll('input[name="chk"]').length > 0,
          { timeout: 15000, polling: 500 }
        ).catch(()=>{});

        const cnt = await dlPage.evaluate(() => document.querySelectorAll('input[name="chk"]').length);
        if (cnt === 0) {
          await dlBrowser.close();
          await tgSend('📭 배송준비중 주문이 없습니다.', chatId);
          return;
        }

        await dlPage.evaluate(() => {
          document.getElementById('chkCheckDataAll').click();
          document.getElementById('customexcelFrm').value = '94';
        });
        await sleep(500);

        const createPromise = dlPage.waitForResponse(r => r.url().includes('CreateExcelIfile'),
          { timeout: 30000 }).catch(()=>null);
        await dlPage.evaluate(() => orderExcelDownload(3));

        let fileName = null;
        const res = await createPromise;
        if (res) {
          const text = await res.text().catch(()=>'');
          const m = text.match(/order_\d+\.xlsx/);
          if (m) fileName = m[0];
          else { try { fileName = JSON.parse(text).fileName || ''; } catch(e){} }
        }

        if (!fileName) {
          await dlBrowser.close();
          await tgSend('❌ 파일 생성 실패.', chatId);
          return;
        }

        await sleep(2000);
        await dlPage.goto(`${FG_BASE}/NewOrder/ExcelDownload?fileName=${encodeURIComponent(fileName)}`,
          { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
        await sleep(5000);
        await dlBrowser.close();
        await tgSend(`✅ 곳간 엑셀 다운로드 완료! (${cnt}건)\n자동 출력 처리 중..`, chatId);

      } catch(e) {
        if (dlBrowser) await dlBrowser.close().catch(()=>{});
        await tgSend(`❌ 곳간 출력 오류: ${e.message}`, chatId);
      }
    })();
    return;
  }

  if (busy) { await tgSend('⏳ 조회 중입니다...', chatId); return; }
  busy = true;

  try {
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    if (cmd === '/현황' || cmd === '현황') {
      log('통합 현황 조회...');
      await tgSend('🔍 조회 중..', chatId);
      const [aR, fR] = await Promise.allSettled([getAdminOrders(), getGotganOrders()]);
      const aD = aR.status==='fulfilled' ? aR.value : null;
      const fD = fR.status==='fulfilled' ? fR.value : null;

      let msg = `📊 <b>주문현황</b>  ${now}\n${'─'.repeat(20)}\n\n`;
      if (aD) {
        msg += formatSection('🏪 <b>[어드민] 상품쇼핑몰</b>', aD);
        if (aD.newOrderCount > 0 && aD.listCount !== aD.newOrderCount) {
          msg += `  ※ stats 신규=${aD.newOrderCount}건 / 오늘목록=${aD.listCount}건\n`;
        }
      } else {
        msg += '🏪 어드민 조회 실패\n';
      }
      msg += '\n';
      msg += fD ? formatSection('🛒 <b>[곳간] flexgate</b>', fD) : '🛒 곳간 조회 실패\n';
      await tgSend(msg, chatId);
      log('발송 완료');

    } else if (cmd === '/어드민' || cmd === '어드민') {
      await tgSend('🔍 어드민 조회...', chatId);
      const d = await getAdminOrders();
      await tgSend(`📊 <b>어드민</b>  ${now}\n\n` + formatSection('🏪', d), chatId);

    } else if (cmd === '/곳간' || cmd === '곳간') {
      fgLoginTime = 0; // 강제 재로그인
      await tgSend('🔍 곳간 조회...', chatId);
      const d = await getGotganOrders();
      await tgSend(`📊 <b>곳간</b>  ${now}\n\n` + formatSection('🛒', d), chatId);
    }

  } catch(e) {
    log(`오류: ${e.message}`);
    await tgSend(`❌ 오류: ${e.message}`, chatId);
  } finally {
    busy = false;
  }
}

// ── 폴링 ─────────────────────────────────────────────────────────────
let lastUpdateId = 0, polling = false;
const CMDS = [
  '/현황','현황',
  '/어드민','어드민',
  '/곳간','곳간',
  '/도움말','도움말',
  '/알림','알림',
  '/곳간출력','곳간출력'
];

async function poll() {
  if (polling) return; polling = true;
  try {
    const updates = await tgGetUpdates(lastUpdateId);
    for (const u of updates) {
      lastUpdateId = u.update_id + 1;
      const msg = u.message || u.edited_message;
      if (!msg?.text) continue;
      const text = msg.text.trim().split(' ')[0];
      const chatId = String(msg.chat.id);
      if (chatId !== TG_CHAT) continue;
      log(`수신: "${text}"`);
      if (CMDS.includes(text)) handleCommand(text, chatId);
    }
  } catch(e) { log(`poll 오류: ${e.message}`); }
  finally { polling = false; }
}

log(`🤖 주문현황 봇 v8 (버그수정판)`);
log(`   명령어: /현황, /어드민, /곳간, /도움말, /알림, /곳간출력`);
setInterval(poll, 3000);
poll();
process.on('SIGINT',  () => { if(fgBrowser) fgBrowser.close(); process.exit(0); });
process.on('SIGTERM', () => { if(fgBrowser) fgBrowser.close(); process.exit(0); });
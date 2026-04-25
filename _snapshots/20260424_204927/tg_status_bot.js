/**
 * tg_status_bot.js v7 - Puppeteer 기반 곳간 로그인
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const https = require('https');
const http  = require('http');
const puppeteer = require('puppeteer');

const TG_TOKEN = '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT  = '6097520392';
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

// ── HTTP 유틸 (어드민용) ─────────────────────────────────
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

// ── 텔레그램 ─────────────────────────────────────────────
async function tgSend(msg, chatId = TG_CHAT) {
  const body = JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' });
  await req({ hostname: 'api.telegram.org', path: `/bot${TG_TOKEN}/sendMessage`,
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body).catch(()=>{});
}
async function tgGetUpdates(offset) {
  const res = await req({ hostname: 'api.telegram.org',
    path: `/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=20&limit=10`, method: 'GET'
  }).catch(()=>null);
  if (!res) return [];
  try { const d = JSON.parse(res.body); return d.ok ? d.result : []; } catch { return []; }
}

// ── 어드민 (HTTP) ─────────────────────────────────────────
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
  adminCookies = c; adminLoginTime = Date.now();
}
async function ensureAdmin() {
  if (Date.now() - adminLoginTime < 20*60*1000 && Object.keys(adminCookies).length) return;
  await adminLogin();
}

async function getAdminOrders() {
  await ensureAdmin();
  const today = new Date().toISOString().slice(0, 10);

  let orderCount = 0;
  try {
    const sr = await req({ hostname: ADMIN_HOST, path: '/admin/xml/real.stats.json.php', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': 0,
        'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
        'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' }
    }, '');
    const stats = JSON.parse(sr.body);
    orderCount = parseInt(stats.spnNew5) || 0;
  } catch(e) {}

  const params = new URLSearchParams({
    proc: 'json', mod: 'order', actpage: 'od.list.bd',
    status: '3', datefld: 'b.regdate',
    sdate: JSON.stringify({ start: '', end: '' }),
    bizgrp: 'all', searchtype: 'all', searchval: '',
    _search: 'false', rows: '500', page: '1', sidx: 'regdate', sord: 'desc'
  });

  const prodMap = {};
  try {
    const res = await req({ hostname: ADMIN_HOST,
      path: `/admin/order/json/od.list.bd.php?${params}`, method: 'GET',
      headers: { 'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
        'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' }
    });
    const data = JSON.parse(res.body);
    const rows = data.rows || [];
    log(`  [어드민 status=3] ${data.records}건, rows=${rows.length}`);

    rows.forEach(row => {
      const cell = Array.isArray(row.cell) ? row.cell : [];
      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const text = c.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
        const m = text.match(/^(.{2,30}?)\s+(\d+)개$/);
        if (m) {
          const name = m[1].trim(); const qty = parseInt(m[2]);
          if (qty > 0 && qty < 500 && name.length >= 2)
            prodMap[name] = (prodMap[name]||0) + qty;
        }
      });
    });
  } catch(e) { log(`  어드민 리스트 오류: ${e.message}`); }

  return { orderCount, prodMap };
}

// ── 곳간 Puppeteer ────────────────────────────────────────
let fgBrowser = null, fgPage = null, fgLoginTime = 0;

async function ensureFgBrowser() {
  if (fgBrowser && fgBrowser.isConnected()) return;
  fgBrowser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--lang=ko-KR',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
    ],
    defaultViewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  fgPage = await fgBrowser.newPage();
  fgPage.on('dialog', async d => await d.accept());

  // 봇 감지 우회
  await fgPage.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US'] });
  });
  await fgPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
}

async function fgLogin() {
  await ensureFgBrowser();
  log('  [곳간] 브라우저 로그인 시작...');
  await fgPage.goto(FG_LOGIN, { waitUntil: 'networkidle2', timeout: 20000 });

  // Puppeteer type() 방식으로 입력 (flexgate: userId / password)
  try {
    await fgPage.waitForSelector('input[name="userId"]', { timeout: 5000 });
  } catch(e) {
    // 선택자 대기 실패시 폼 목록 로그
    const fi = await fgPage.evaluate(() => [...document.querySelectorAll('input')].map(i=>`${i.name}/${i.type}`));
    log(`  [곳간] 선택자 대기실패, inputs: ${JSON.stringify(fi)}`);
  }

  // 기존 값 초기화 후 입력
  await fgPage.evaluate(() => {
    const u = document.querySelector('input[name="userId"]');
    const p = document.querySelector('input[name="password"]');
    if (u) u.value = '';
    if (p) p.value = '';
  });

  const idEl = await fgPage.$('input[name="userId"]');
  const pwEl = await fgPage.$('input[name="password"]');

  if (idEl && pwEl) {
    await idEl.click({ clickCount: 3 });
    await fgPage.keyboard.type(FG_ID);
    await pwEl.click({ clickCount: 3 });
    await fgPage.keyboard.type(FG_PW);
    log(`  [곳간] userId/password 입력 완료`);
  } else {
    log(`  [곳간] 필드 못 찾음 - userId:${!!idEl} password:${!!pwEl}`);
  }

  await sleep(300);

  // encKey, action 확인
  const formInfo = await fgPage.evaluate(() => {
    const encKey = document.querySelector('input[name="encKey"]');
    const userId = document.querySelector('input[name="userId"]');
    const form = document.querySelector('form');
    return {
      encKey: encKey ? encKey.value.slice(0,30) : 'none',
      userIdVal: userId ? userId.value : 'empty',
      action: form ? form.action : 'noform',
    };
  });
  log(`  [곳간] 폼 정보: userId="${formInfo.userIdVal}", encKey="${formInfo.encKey}", action="${formInfo.action}"`);

  // 로그인 버튼 클릭 - Puppeteer 직접 click (encKey 암호화 JS 이벤트 포함)
  const loginBtnHandle = await fgPage.$('button[type="submit"], input[type="submit"], button.btn-login, a.btn-login')
    .catch(() => null);

  if (loginBtnHandle) {
    log('  [곳간] 로그인 버튼 직접 클릭');
    await Promise.all([
      fgPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
      loginBtnHandle.click(),
    ]);
  } else {
    // 버튼 못 찾으면 Enter 키
    log('  [곳간] 버튼 못찾음 → Enter 키 전송');
    if (pwEl) {
      await Promise.all([
        fgPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
        pwEl.press('Enter'),
      ]);
    }
  }

  // 로그인 후 최대 8초 기다리며 URL 변화 감지
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    const u = fgPage.url();
    if (!u.includes('Login')) {
      log(`  [곳간] 로그인 성공! URL: ${u}`);
      break;
    }
  }
  const url = fgPage.url();
  log(`  [곳간] 로그인 후 URL: ${url}`);

  // 쿠키 추출 (Puppeteer 브라우저 쿠키)
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

  // 주문 페이지로 이동
  try {
    await fgPage.goto(`${FG_URL}/NewOrder/deal01?order_status=10&formtype=A&pagesize=1000`,
      { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(1000);

    const url = fgPage.url();
    log(`  [곳간] 주문 페이지 URL: ${url}`);

    // 로그인 페이지로 리다이렉트됐으면 재로그인
    if (url.includes('Login') || url.includes('login')) {
      log('  [곳간] 세션 만료, 재로그인...');
      fgLoginTime = 0;
      await fgLogin();
      // 로그인 후 URL 다시 확인
      const loginUrl = fgPage.url();
      log(`  [곳간] 재로그인 후 URL: ${loginUrl}`);
      if (!loginUrl.includes('Login')) {
        // 로그인 성공, 주문 페이지로 이동
        await fgPage.goto(`${FG_URL}/NewOrder/deal01?order_status=10&formtype=A&pagesize=1000`,
          { waitUntil: 'networkidle2', timeout: 15000 });
        await sleep(1000);
      }
    }

    const html = await fgPage.content();
    // HTML 첫 500자 및 주문번호 패턴 디버그
    const htmlSnippet = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500);
    log(`  [곳간 status=10 HTML] ${htmlSnippet}`);
    // 다양한 주문번호 패턴 시도
    // DOM에서 주문 행 수 직접 세기
    const orderCount10 = await fgPage.evaluate(() => {
      // 다양한 선택자 시도
      const selectors = [
        'table.table tbody tr',
        '#orderListTable tbody tr',
        'tbody tr[data-order]',
        '.order-row',
        'table tbody tr:not(.empty-row)',
      ];
      for (const sel of selectors) {
        const rows = document.querySelectorAll(sel);
        if (rows.length > 0) return { count: rows.length, sel };
      }
      // fallback: 모든 tbody tr
      const all = document.querySelectorAll('tbody tr');
      return { count: all.length, sel: 'tbody tr (fallback)' };
    });
    log(`  [곳간 status=10] DOM rows=${orderCount10.count} (${orderCount10.sel}), len=${html.length}`);
    const orderNums = { size: orderCount10.count };

    // status=10 없으면 20 시도
    if (orderNums.size === 0) {
      await fgPage.goto(`${FG_URL}/NewOrder/deal01?order_status=20&formtype=A&pagesize=1000`,
        { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(1000);
      const html2 = await fgPage.content();
      for (const m of html2.matchAll(/PJM\w+/g)) orderNums.add(m[0]);
      log(`  [곳간 status=20] PJM=${orderNums.size}`);
    }

    // 상품 파싱 (테이블에서)
    const prodMap = await fgPage.evaluate(() => {
      const map = {};
      const rows = document.querySelectorAll('table tr, .order-item, .product-item');
      rows.forEach(row => {
        const text = row.innerText || '';
        // "상품명 / 수량 개" 패턴
        const m = text.match(/([^\n\/]{2,30})\s*\/\s*(\d+)\s*개/);
        if (m) {
          const name = m[1].trim(); const qty = parseInt(m[2]);
          if (name.length >= 2 && qty > 0 && !/소계|합계|결제|배송|선택/.test(name))
            map[name] = (map[name]||0) + qty;
        }
      });
      return map;
    });

    return { orderCount: orderNums.size, prodMap };

  } catch(e) {
    log(`  [곳간] 오류: ${e.message}`);
    try { await fgBrowser?.close(); } catch(_) {}
    fgBrowser = null; fgPage = null; fgLoginTime = 0;
    return { orderCount: 0, prodMap: {} };
  }
}

// ── 포맷 ─────────────────────────────────────────────────
function formatSection(title, data) {
  const { orderCount, prodMap } = data;
  const entries = Object.entries(prodMap).filter(([,q])=>q>0).sort((a,b)=>b[1]-a[1]);
  let msg = `${title}\n📦 주문: <b>${orderCount}건</b>\n`;
  if (entries.length > 0)
    entries.slice(0,15).forEach(([n,q]) => { msg += `  • ${n} <b>${q}개</b>\n`; });
  else
    msg += `  (품목 정보 없음)\n`;
  return msg;
}

// ── 명령어 ───────────────────────────────────────────────
let busy = false;
async function handleCommand(cmd, chatId) {
  log(`처리: ${cmd}`);
  if (cmd === '/도움말' || cmd === '도움말') {
    await tgSend(`📋 <b>명령어</b>\n/현황 — 어드민+곳간 통합\n/어드민 — 어드민만\n/곳간 — 곳간만\n/알림 — 자동승인 상태\n/곳간출력 — 주문 엑셀 출력`, chatId); return;
  }
  if (cmd === '/알림' || cmd === '알림') {
    await tgSend('🔔 gotgan-approve: 30초마다 인증대기 자동 체크 중', chatId); return;
  }

  if (cmd === '/곳간출력' || cmd === '곳간출력') {
    await tgSend('🚀 곳간 출력 시작... (약 30초 소요)', chatId);
    (async () => {
      let dlBrowser = null;
      try {
        const path = require('path');
        const fs = require('fs');
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

        // CDP 다운로드 경로 설정
        const cdp = await dlPage.createCDPSession();
        await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });

        // 봇 감지 우회
        await dlPage.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        await dlPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 로그인
        await dlPage.goto(`${FG_INTRO}/Mypage/Login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await new Promise(r => setTimeout(r, 1500));
        const idEl = await dlPage.$('#userId, input[name="userId"], input[type="text"]');
        const pwEl = await dlPage.$('#password, input[name="password"], input[type="password"]');
        if (idEl) { await idEl.click({clickCount:3}); await idEl.type('dongnaegotgan'); }
        if (pwEl) { await pwEl.click({clickCount:3}); await pwEl.type('rhtrks12!@'); }
        await new Promise(r => setTimeout(r, 500));
        await Promise.all([
          dlPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
          pwEl ? pwEl.press('Enter') : Promise.resolve(),
        ]);
        await new Promise(r => setTimeout(r, 2000));

        const afterUrl = dlPage.url();
        if (!afterUrl.includes('dongnaegotgan.flexgate.co.kr')) {
          await dlBrowser.close();
          await tgSend('❌ 곳간 로그인 실패. 직접 확인 필요.', chatId);
          return;
        }

        // 배송준비(order_status=30) 페이지 이동
        await dlPage.goto(`${FG_BASE}/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000`, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));

        // 주문 확인
        await dlPage.waitForFunction(() => document.querySelectorAll('input[name="chk"]').length > 0, { timeout: 15000, polling: 500 }).catch(()=>{});
        const cnt = await dlPage.evaluate(() => document.querySelectorAll('input[name="chk"]').length);

        if (cnt === 0) {
          await dlBrowser.close();
          await tgSend('ℹ️ 배송준비 주문이 없습니다.', chatId);
          return;
        }

        // 전체선택 + 명지일일배송(94) 선택
        await dlPage.evaluate(() => {
          document.getElementById('chkCheckDataAll').click();
          document.getElementById('customexcelFrm').value = '94';
        });
        await new Promise(r => setTimeout(r, 500));

        // 엑셀 생성 요청
        const createPromise = dlPage.waitForResponse(r => r.url().includes('CreateExcelIfile'), { timeout: 30000 }).catch(()=>null);
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
          await tgSend('❌ 엑셀 생성 실패.', chatId);
          return;
        }

        // 다운로드
        await new Promise(r => setTimeout(r, 2000));
        await dlPage.goto(`${FG_BASE}/NewOrder/ExcelDownload?fileName=${encodeURIComponent(fileName)}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
        await new Promise(r => setTimeout(r, 5000));

        await dlBrowser.close();
        await tgSend(`✅ 곳간 엑셀 다운로드 완료! (${cnt}건)\n자동 출력 처리 중...`, chatId);

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
      await tgSend('🔍 조회 중...', chatId);
      const [aR, fR] = await Promise.allSettled([getAdminOrders(), getGotganOrders()]);
      const aD = aR.status==='fulfilled' ? aR.value : null;
      const fD = fR.status==='fulfilled' ? fR.value : null;
      let msg = `📊 <b>주문현황</b>  ${now}\n${'─'.repeat(22)}\n\n`;
      msg += aD ? formatSection('🏪 <b>[어드민] 위탁쇼핑몰</b>', aD) : '🏪 어드민 조회 실패\n';
      msg += '\n';
      msg += fD ? formatSection('🏬 <b>[곳간] flexgate</b>', fD) : '🏬 곳간 조회 실패\n';
      await tgSend(msg, chatId);
      log('발송 완료');
    } else if (cmd === '/어드민' || cmd === '어드민') {
      await tgSend('🔍 어드민 조회...', chatId);
      const d = await getAdminOrders();
      await tgSend(`📊 <b>어드민</b>  ${now}\n\n`+formatSection('🏪',d), chatId);
    } else if (cmd === '/곳간' || cmd === '곳간') {
      fgLoginTime = 0;
      await tgSend('🔍 곳간 조회...', chatId);
      const d = await getGotganOrders();
      await tgSend(`📊 <b>곳간</b>  ${now}\n\n`+formatSection('🏬',d), chatId);
    }
  } catch(e) { log(`오류: ${e.message}`); await tgSend(`❌ 오류: ${e.message}`, chatId); }
  finally { busy = false; }
}

// ── 폴링 ─────────────────────────────────────────────────
let lastUpdateId = 0, polling = false;
const CMDS = ['/현황','현황','/어드민','어드민','/곳간','곳간','/도움말','도움말','/알림','알림','/곳간출력','곳간출력'];
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

log(`🤖 주문현황 봇 v7 (Puppeteer 곳간)`);
log(`   명령어: /현황, /어드민, /곳간, /도움말, /알림, /곳간출력`);
setInterval(poll, 3000);
poll();
process.on('SIGINT', () => { if(fgBrowser) fgBrowser.close(); process.exit(0); });
process.on('SIGTERM', () => { if(fgBrowser) fgBrowser.close(); process.exit(0); });

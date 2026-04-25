/**
 * tg_status_bot.js v16
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const https = require('https');
const http  = require('http');
const puppeteer = require('puppeteer');

const TG_TOKEN   = process.env.TG_TOKEN || '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT    = process.env.TG_CHAT  || '6097520392';
const ADMIN_HOST = 'dongnaegotgan.adminplus.co.kr';
const ADMIN_URL  = `https://${ADMIN_HOST}/admin/`;
const ADMIN_ID   = process.env.ADMIN_ID || 'dongnaegotgan';
const ADMIN_PW   = process.env.ADMIN_PW || 'rhtrks12!@';
const FG_URL     = 'https://dongnaegotgan.flexgate.co.kr';
const FG_LOGIN   = 'https://intro.flexgate.co.kr/Mypage/Login';
const FG_ID      = process.env.FG_ID || 'dongnaegotgan';
const FG_PW      = process.env.FG_PW || 'rhtrks12!@';

function log(m) { console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${m}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function tgSend(msg, chatId = TG_CHAT) {
  const body = JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' });
  for (let i = 0; i < 3; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.telegram.org', path: `/bot${TG_TOKEN}/sendMessage`,
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => { res.on('data',()=>{}); res.on('end', resolve); });
        req.on('error', reject);
        req.write(body); req.end();
      });
      return;
    } catch(e) {
      log(`tgSend 오류[${i+1}]: ${e.message}`);
      if (i < 2) await sleep(2000);
    }
  }
}

async function tgGetUpdates(offset) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=20&limit=10`, method: 'GET'
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { const d = JSON.parse(data); resolve(d.ok ? d.result : []); } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

let sharedBrowser = null;
let adminPage = null, adminLoginTime = 0;
let fgPage    = null, fgLoginTime    = 0;

async function ensureSharedBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) return;
  log('브라우저 시작...');
  sharedBrowser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--lang=ko-KR',
           '--disable-blink-features=AutomationControlled','--disable-web-security'],
    defaultViewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const stealth = async (page) => {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3] });
      Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR','ko','en-US'] });
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  };
  const pages = await sharedBrowser.pages();
  adminPage = pages[0] || await sharedBrowser.newPage();
  adminPage.on('dialog', d => d.accept().catch(()=>{}));
  await stealth(adminPage);
  fgPage = await sharedBrowser.newPage();
  fgPage.on('dialog', d => d.accept().catch(()=>{}));
  await stealth(fgPage);
  adminLoginTime = 0; fgLoginTime = 0;
}

// ── 어드민 로그인 (form.target=_self → waitForNavigation) ────────────────────
async function adminLogin() {
  await ensureSharedBrowser();
  log('  [어드민] 로그인 시작...');
  await adminPage.goto(`https://${ADMIN_HOST}/admin/login.html`, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(500);

  const inputs = await adminPage.evaluate(() =>
    [...document.querySelectorAll('input')].map(i => `${i.name}/${i.type}`)
  );
  log(`  [어드민] 폼 필드: ${JSON.stringify(inputs)}`);

  // ① admid/admpwd 입력
  await adminPage.evaluate((uid, upw) => {
    document.querySelectorAll('input').forEach(el => {
      const n = (el.name || '').toLowerCase();
      if (n === 'admid' || n === 'id') {
        el.value = uid;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (n === 'admpwd' || n === 'pw' || n === 'password') {
        el.value = upw;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }, ADMIN_ID, ADMIN_PW);
  log('  [어드민] admid/admpwd 입력 완료');
  await sleep(300);

  // ② ★ form target = _self, onsubmit 제거 → navigate 감지 가능
  await adminPage.evaluate(() => {
    const form = document.querySelector('form#signup')
               || document.querySelector('form[name="signup"]')
               || document.querySelector('form');
    if (form) {
      form.target = '_self';
      form.removeAttribute('onsubmit');
    }
  });
  log('  [어드민] form.target=_self 설정 완료');

  // ③ 버튼 클릭 + navigate 대기
  const submitBtn = await adminPage.$('button[type="submit"], input[type="submit"], .btn-login, button.btn').catch(()=>null);
  try {
    if (submitBtn) {
      log('  [어드민] 버튼 클릭 + navigate 대기');
      await Promise.all([
        adminPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 12000 }),
        submitBtn.click(),
      ]);
    } else {
      log('  [어드민] form.submit() + navigate 대기');
      await Promise.all([
        adminPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 12000 }),
        adminPage.evaluate(() => {
          const f = document.querySelector('form#signup') || document.querySelector('form[name="signup"]') || document.querySelector('form');
          if (f) f.submit();
        }),
      ]);
    }
  } catch(e) {
    log(`  [어드민] navigate 타임아웃 (계속진행): ${e.message.slice(0,50)}`);
  }
  await sleep(500);

  const finalUrl = adminPage.url();
  const cookies  = await adminPage.cookies();
  log(`  [어드민] 최종 URL: ${finalUrl.slice(0,80)}`);
  log(`  [어드민] 쿠키 ${cookies.length}개: ${cookies.map(c=>c.name).join(', ')}`);

  if (finalUrl.includes('login')) {
    log('  [어드민] ❌ 로그인 실패 - login 페이지 잔류');
    adminLoginTime = 0;
    return false;
  }
  log('  [어드민] ✅ 로그인 성공!');
  adminLoginTime = Date.now();
  return true;
}

async function ensureAdmin() {
  if (Date.now() - adminLoginTime < 20*60*1000 && sharedBrowser?.isConnected() && adminPage) return;
  await adminLogin();
}

function httpReq(options, body = null) {
  return new Promise((resolve, reject) => {
    const mod = options.hostname === 'localhost' ? http : https;
    const r = mod.request(options, res => {
      let data = ''; res.on('data', d => data += d); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function getAdminOrders() {
  await ensureAdmin();
  let orderCount = 0, totalAmount = 0;
  const prodMap = {};

  try {
    const cookies   = await adminPage.cookies();
    const cookieStr = cookies.map(c=>`${c.name}=${c.value}`).join('; ');
    const sr = await httpReq({
      hostname: ADMIN_HOST, path: '/admin/xml/real.stats.json.php', method: 'POST',
      headers: { 'Content-Type':'application/x-www-form-urlencoded','Content-Length':0,
        'Cookie':cookieStr,'Referer':ADMIN_URL,'User-Agent':'Mozilla/5.0','X-Requested-With':'XMLHttpRequest' }
    }, '');
    const stats = JSON.parse(sr.body);
    orderCount = parseInt(stats.spnNew5) || 0;
    log(`  [어드민 stats] 신규=${stats.spnNew5}, 오늘전체=${stats.spnNew8}`);
  } catch(e) { log(`  [어드민 stats 오류] ${e.message}`); }

  try {
    const todayKST = new Date(Date.now() + 9*60*60*1000).toISOString().slice(0,10);
    const params   = new URLSearchParams({
      proc:'json', mod:'order', actpage:'od.list.bd', status:'10', datefld:'b.regdate',
      sdate: JSON.stringify({ start: todayKST, end: todayKST }),
      bizgrp:'all', searchtype:'all', searchval:'',
      _search:'false', rows:'500', page:'1', sidx:'regdate', sord:'desc'
    });
    const cookies   = await adminPage.cookies();
    const cookieStr = cookies.map(c=>`${c.name}=${c.value}`).join('; ');
    const lr = await httpReq({
      hostname: ADMIN_HOST, path: `/admin/order/json/od.list.bd.php?${params}`, method: 'GET',
      headers: { 'Cookie':cookieStr,'Referer':ADMIN_URL,'User-Agent':'Mozilla/5.0','X-Requested-With':'XMLHttpRequest' }
    });
    const data = JSON.parse(lr.body);
    const rows = data.rows || [];
    const listCount = parseInt(data.records) || rows.length;
    log(`  [어드민] 신규주문 ${listCount}건, rows=${rows.length}`);
    if (!orderCount) orderCount = listCount;
    rows.forEach((row, ri) => {
      const cell = Array.isArray(row.cell) ? row.cell : [];
      if (ri === 0) log(`  [어드민 cell샘플] ${JSON.stringify(cell).slice(0,150)}`);
      let rowAmt = 0;
      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const clean = c.replace(/<[^>]+>/g,'').replace(/,/g,'').trim();
        const m = clean.match(/(\d{4,8})\s*원$/);
        if (m) { const v = parseInt(m[1]); if (v >= 1000 && v > rowAmt) rowAmt = v; }
      });
      totalAmount += rowAmt;
      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const text = c.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
        const main = text.split('·')[0].trim();
        const m1   = main.match(/^(.{2,50}?)\s*\/\s*(\d+)\s*개/);
        if (m1) {
          const name = m1[1].replace(/\([^)]*\)/g,'').trim();
          const qty  = parseInt(m1[2]);
          if (name.length>=2 && name.length<=40 && qty>0 && qty<1000 &&
              !/반품취소|취소|PJM|배송|주문/.test(name)) {
            if (!prodMap[name]) prodMap[name] = { qty:0, amt:0 };
            prodMap[name].qty += qty; prodMap[name].amt += rowAmt;
          }
        }
      });
    });
  } catch(e) { log(`  [어드민 목록 오류] ${e.message}`); }
  return { orderCount, prodMap, totalAmount };
}

async function fgLogin() {
  await ensureSharedBrowser();
  log('  [곳간] 로그인 시작...');
  await fgPage.goto(FG_LOGIN, { waitUntil: 'networkidle2', timeout: 20000 });
  try { await fgPage.waitForSelector('input[name="userId"]', { timeout: 5000 }); } catch(e) {}
  await fgPage.evaluate(() => {
    const u = document.querySelector('input[name="userId"]');
    const p = document.querySelector('input[name="password"]');
    if (u) u.value = ''; if (p) p.value = '';
  });
  const idEl = await fgPage.$('input[name="userId"]');
  const pwEl = await fgPage.$('input[name="password"]');
  if (idEl && pwEl) {
    await idEl.click({ clickCount: 3 }); await fgPage.keyboard.type(FG_ID);
    await pwEl.click({ clickCount: 3 }); await fgPage.keyboard.type(FG_PW);
  }
  await sleep(300);
  const loginBtn = await fgPage.$('button[type="submit"], input[type="submit"]').catch(()=>null);
  if (loginBtn) {
    await Promise.all([
      fgPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
      loginBtn.click(),
    ]);
  } else if (pwEl) {
    log('  [곳간] 버튼 못찾음 → Enter');
    await Promise.all([
      fgPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
      pwEl.press('Enter'),
    ]);
  }
  for (let i = 0; i < 8; i++) { await sleep(1000); if (!fgPage.url().includes('Login')) break; }
  log(`  [곳간] 로그인 URL: ${fgPage.url()}`);
  fgLoginTime = Date.now();
}

async function ensureFgLogin() {
  if (Date.now() - fgLoginTime < 25*60*1000 && sharedBrowser?.isConnected()) return;
  await fgLogin();
}

async function getGotganOrders() {
  await ensureFgLogin();
  try {
    await fgPage.goto(`${FG_URL}/NewOrder/deal01?order_status=20&formtype=C&pagesize=1000`,
      { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(1500);
    if (fgPage.url().includes('Login')) {
      fgLoginTime = 0; await fgLogin();
      await fgPage.goto(`${FG_URL}/NewOrder/deal01?order_status=20&formtype=C&pagesize=1000`,
        { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(1500);
    }
    const html = await fgPage.content();
    const orderNums = new Set();
    for (const m of html.matchAll(/PJM[A-Z0-9-]+/g)) orderNums.add(m[0]);
    log(`  [곳간] PJM 주문번호 ${orderNums.size}개`);
    if (orderNums.size === 0) {
      await fgPage.goto(`${FG_URL}/NewOrder/deal01?order_status=20&formtype=A&pagesize=1000`,
        { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(800);
      const html2 = await fgPage.content();
      for (const m of html2.matchAll(/PJM[A-Z0-9-]+/g)) orderNums.add(m[0]);
    }
    const result = await fgPage.evaluate(() => {
      const map = {}; let total = 0;
      const rows = document.querySelectorAll('table tbody tr');
      rows.forEach(row => {
        const cells = [...row.querySelectorAll('td')]
          .map(td => (td.innerText || td.textContent || '').replace(/\s+/g,' ').trim());
        if (cells.length < 6) return;
        const prodCell = cells[5] || '';
        if (!prodCell) return;
        const parts = prodCell.split('/');
        if (parts.length < 2) return;
        let name = parts[0].trim();
        const qtyMatch = parts[1].match(/(\d+)/);
        if (!qtyMatch) return;
        const qty = parseInt(qtyMatch[1]);
        name = name.replace(/\s*\([^)]{15,}\)\s*/g,' ').trim();
        name = name.replace(/^[\d\s\[\]\(\)·,]+/,'').trim();
        if (name.length < 2 || qty <= 0 || qty >= 1000) return;
        if (/반품취소|취소|배송중|배송완료|배송준비/.test(name)) return;
        const amtCell = cells[6] || '';
        let amt = 0;
        const amtMs = amtCell.match(/(\d{1,3}(?:,\d{3})+|\d{4,8})\s*원/g);
        if (amtMs) amtMs.forEach(a => { const v = parseInt(a.replace(/[,원]/g,'')); if (v>amt && v<10000000) amt=v; });
        if (!map[name]) map[name] = { qty:0, amt:0 };
        map[name].qty += qty; map[name].amt += amt; total += amt;
      });
      const firstRow = document.querySelector('table tbody tr');
      const debugCells = firstRow
        ? [...firstRow.querySelectorAll('td')].map((td,i)=>i+': "'+(td.innerText||'').replace(/\s+/g,' ').trim().slice(0,60)+'"')
        : ['행없음'];
      return { map, total, debugCells, rowCount: rows.length };
    });
    log(`  [곳간] tbody tr 수: ${result.rowCount}`);
    log(`  [곳간 cells] ${result.debugCells.slice(0,7).join(' | ')}`);
    log(`  [곳간] 상품 ${Object.keys(result.map).length}종, 총액 ${result.total.toLocaleString()}원`);
    return { orderCount: orderNums.size, prodMap: result.map, totalAmount: result.total };
  } catch(e) {
    log(`  [곳간 오류] ${e.message}`);
    try { await sharedBrowser?.close(); } catch(_) {}
    sharedBrowser = null; adminPage = null; fgPage = null;
    adminLoginTime = 0; fgLoginTime = 0;
    return { orderCount: 0, prodMap: {}, totalAmount: 0 };
  }
}

function formatSection(title, data) {
  const { orderCount, prodMap, totalAmount } = data;
  const entries = Object.entries(prodMap)
    .map(([n,v]) => [n, typeof v==='object' ? v : { qty:v, amt:0 }])
    .filter(([,v]) => v.qty > 0)
    .sort((a,b) => b[1].qty - a[1].qty);
  const total    = totalAmount || entries.reduce((s,[,v]) => s+(v.amt||0), 0);
  const totalStr = total > 0 ? `  💰 총액: <b>${total.toLocaleString()}원</b>\n` : '';
  let msg = `${title}\n총 주문: <b>${orderCount}건</b>\n${totalStr}`;
  if (entries.length > 0) {
    msg += `\n📦 상품별 수량\n`;
    entries.slice(0,15).forEach(([n,v]) => {
      const amtStr = v.amt > 0 ? ` (${v.amt.toLocaleString()}원)` : '';
      msg += `  • ${n} <b>${v.qty}개</b>${amtStr}\n`;
    });
  } else {
    msg += `  (상품 정보 없음)\n`;
  }
  return msg;
}

let busy = false;

async function handleCommand(cmd, chatId) {
  log(`처리: ${cmd}`);

  if (cmd === '/명령어리스트' || cmd === '명령어리스트') {
    await tgSend(
      `📋 <b>동네곳간 주문현황봇 명령어</b>\n` +
      `──────────────────────\n` +
      `/주문건확인  → 어드민 도매몰 + 동네곳간 통합 조회\n` +
      `/주문출력   → 동네곳간 엑셀 출력\n` +
      `/승인상태   → 자동승인 프로세스 상태\n` +
      `/명령어리스트 → 이 목록\n` +
      `──────────────────────\n` +
      `슬래시(/) 없이도 가능`,
      chatId
    );
    return;
  }

  if (cmd === '/승인상태' || cmd === '승인상태') {
    await tgSend('🔄 gotgan-approve: 30초마다 자동승인 실행 중', chatId);
    return;
  }

  if (cmd === '/주문출력' || cmd === '주문출력') {
    await tgSend('📥 동네곳간 주문출력 시작... (약 30초 소요)', chatId);
    (async () => {
      let dlBrowser = null;
      try {
        const os = require('os');
        const DOWNLOADS = require('path').join(os.homedir(), 'Downloads');
        const FG_BASE  = 'https://dongnaegotgan.flexgate.co.kr';
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
        await dlPage.evaluateOnNewDocument(() => { Object.defineProperty(navigator,'webdriver',{get:()=>false}); });
        await dlPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await dlPage.goto(`${FG_INTRO}/Mypage/Login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(1500);
        const idEl = await dlPage.$('input[name="userId"]');
        const pwEl = await dlPage.$('input[name="password"]');
        if (idEl) { await idEl.click({clickCount:3}); await idEl.type(FG_ID); }
        if (pwEl) { await pwEl.click({clickCount:3}); await pwEl.type(FG_PW); }
        await sleep(500);
        await Promise.all([
          dlPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
          pwEl ? pwEl.press('Enter') : Promise.resolve(),
        ]);
        await sleep(2000);
        if (!dlPage.url().includes('dongnaegotgan.flexgate.co.kr')) {
          await dlBrowser.close(); await tgSend('❌ 동네곳간 로그인 실패.', chatId); return;
        }
        await dlPage.goto(`${FG_BASE}/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000`,
          { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(2000);
        await dlPage.waitForFunction(() => document.querySelectorAll('input[name="chk"]').length > 0,
          { timeout: 15000, polling: 500 }).catch(()=>{});
        const cnt = await dlPage.evaluate(() => document.querySelectorAll('input[name="chk"]').length);
        if (cnt === 0) { await dlBrowser.close(); await tgSend('📭 배송준비 주문 없음.', chatId); return; }
        await dlPage.evaluate(() => {
          document.getElementById('chkCheckDataAll').click();
          document.getElementById('customexcelFrm').value = '94';
        });
        await sleep(500);
        const createPromise = dlPage.waitForResponse(r => r.url().includes('CreateExcelIfile'), { timeout: 30000 }).catch(()=>null);
        await dlPage.evaluate(() => orderExcelDownload(3));
        let fileName = null;
        const res = await createPromise;
        if (res) {
          const text = await res.text().catch(()=>'');
          const m = text.match(/order_\d+\.xlsx/);
          if (m) fileName = m[0];
          else { try { fileName = JSON.parse(text).fileName || ''; } catch(e) {} }
        }
        if (!fileName) { await dlBrowser.close(); await tgSend('❌ 파일 생성 실패.', chatId); return; }
        await sleep(2000);
        await dlPage.goto(`${FG_BASE}/NewOrder/ExcelDownload?fileName=${encodeURIComponent(fileName)}`,
          { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
        await sleep(5000);
        await dlBrowser.close();
        await tgSend(`✅ 주문 엑셀 다운로드 완료! (${cnt}건)\n자동 출력 처리 이후..`, chatId);
      } catch(e) {
        if (dlBrowser) await dlBrowser.close().catch(()=>{});
        await tgSend(`❌ 주문출력 오류: ${e.message}`, chatId);
      }
    })();
    return;
  }

  if (cmd === '/주문건확인' || cmd === '주문건확인') {
    if (busy) { await tgSend('⏳ 조회 중입니다... 잠시만 기다려주세요.', chatId); return; }
    busy = true;
    try {
      const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      log('통합 주문건 조회...');

      // ★ 개선된 상태 메시지
      await tgSend(
        `🔄 <b>주문 현황 조회 중...</b>\n` +
        `🏪 어드민 도매몰 조회 중\n` +
        `🛒 동네곳간 조회 중\n` +
        `잠시만 기다려 주세요 ⏳`,
        chatId
      );

      const [aR, fR] = await Promise.allSettled([getAdminOrders(), getGotganOrders()]);
      const aD = aR.status === 'fulfilled' ? aR.value : null;
      const fD = fR.status === 'fulfilled' ? fR.value : null;

      let msg = `📊 <b>주문현황</b>  ${now}\n──────────────────────\n\n`;
      msg += aD ? formatSection('🏪 <b>[어드민] 도매몰</b>', aD) : '🏪 어드민 조회 실패\n';
      msg += '\n';
      msg += fD ? formatSection('🛒 <b>[곳간] 동네곳간</b>', fD) : '🛒 동네곳간 조회 실패\n';

      const grandTotal = (aD?.totalAmount||0) + (fD?.totalAmount||0);
      if (grandTotal > 0) {
        msg += `\n──────────────────────\n💎 <b>합산 총액: ${grandTotal.toLocaleString()}원</b>\n`;
        if (aD?.totalAmount > 0) msg += `   도매몰: ${aD.totalAmount.toLocaleString()}원\n`;
        if (fD?.totalAmount > 0) msg += `   동네곳간: ${fD.totalAmount.toLocaleString()}원\n`;
      }

      await tgSend(msg, chatId);
      log('발송 완료');
    } catch(e) {
      log(`오류: ${e.message}`);
      await tgSend(`❌ 오류: ${e.message}`, chatId);
    } finally {
      busy = false;
    }
    return;
  }
}

let lastUpdateId = 0, polling = false;
const CMDS = [
  '/주문건확인','주문건확인',
  '/주문출력',  '주문출력',
  '/승인상태',  '승인상태',
  '/명령어리스트','명령어리스트'
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

log('🤖 주문현황 봇 v16');
log('   /주문건확인  /주문출력  /승인상태  /명령어리스트');
setInterval(poll, 3000);
poll();
process.on('SIGINT',  () => { if (sharedBrowser) sharedBrowser.close(); process.exit(0); });
process.on('SIGTERM', () => { if (sharedBrowser) sharedBrowser.close(); process.exit(0); });

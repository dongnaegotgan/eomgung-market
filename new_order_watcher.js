'use strict';
/**
 * new_order_watcher.js — 신규주문 감시봇 v2
 * - 어드민(주문접수): Puppeteer 지속 브라우저로 10초마다 체크
 * - 곳간(신규주문): HTTP+쿠키로 10초마다 체크
 * - 신규주문 감지 시 TG 알림 + 주문건확인 자동실행
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const puppeteer = require('puppeteer');
const https     = require('https');

// ── 설정 ─────────────────────────────────────────────────────────────────
const TG_TOKEN = process.env.TG_TOKEN || '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT  = process.env.TG_CHAT  || '6097520392';
const ADMIN_ID = process.env.ADMIN_ID || 'dongnaegotgan';
const ADMIN_PW = process.env.ADMIN_PW || 'rhtrks12!@';
const FG_ID    = process.env.FG_ID    || 'dongnaegotgan';
const FG_PW    = process.env.FG_PW    || 'rhtrks12!@';
const INTERVAL = 10000;   // 10초
const COOLDOWN = 60000;   // 주문건확인 후 1분 쿨다운

// ── 상태 ─────────────────────────────────────────────────────────────────
// 어드민 — Puppeteer 지속 브라우저
let adminBrowser = null;
let adminPage    = null;
// 곳간 — HTTP 쿠키
let fgCookies    = '';
// 카운트
let lastAdminCnt = -1;
let lastFgCnt    = -1;
let lastAlertTime = 0;
let busy = false;

function log(m) { console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${m}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── TG 전송 ───────────────────────────────────────────────────────────────
function tgSend(msg) {
  return new Promise(resolve => {
    const body = JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

// ── 어드민: Puppeteer 지속 브라우저 로그인 ───────────────────────────────
async function ensureAdminPage() {
  // 페이지 살아있는지 확인
  if (adminBrowser && adminPage) {
    try { await adminPage.evaluate(() => document.readyState); return; }
    catch (e) { adminPage = null; }
  }

  // 브라우저 없으면 새로 시작
  if (!adminBrowser) {
    adminBrowser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: { width: 1280, height: 800 }
    });
    log('[admin] 브라우저 시작');
  }

  adminPage = await adminBrowser.newPage();
  adminPage.on('dialog', d => d.accept().catch(() => {}));

  // 로그인
  await adminPage.goto('https://dongnaegotgan.adminplus.co.kr/admin/login.html',
    { waitUntil: 'domcontentloaded', timeout: 15000 });
  await adminPage.evaluate((id, pw) => {
    document.querySelectorAll('input').forEach(el => {
      const n = (el.name || '').toLowerCase();
      if (n === 'admid' || n === 'id') el.value = id;
      if (n === 'admpwd' || n === 'pw' || n === 'password') el.value = pw;
    });
  }, ADMIN_ID, ADMIN_PW);
  await Promise.all([
    adminPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
    adminPage.keyboard.press('Enter')
  ]);
  log('[admin] 로그인 완료');
}

// ── 어드민 주문접수 카운트 (Puppeteer navigate) ───────────────────────────
async function getAdminCount() {
  await ensureAdminPage();

  try {
    await adminPage.goto(
      'https://dongnaegotgan.adminplus.co.kr/admin/?mod=order&actpage=od.list.bd&status=3&page=1&rownum=100',
      { waitUntil: 'networkidle2', timeout: 15000 }
    );

    const count = await adminPage.evaluate(() => {
      const text = document.body.innerText;
      // "보기 1 - 5 / 5" 패턴
      const m = text.match(/보기\s*\d+\s*[-~]\s*\d+\s*\/\s*(\d+)/);
      if (m) return parseInt(m[1]);
      // fallback: 상단 바 "주문접수 : 5"
      const m2 = text.match(/주문접수\s*[：:]\s*(\d+)/);
      return m2 ? parseInt(m2[1]) : 0;
    });

    return count;
  } catch (e) {
    log('[admin] navigate 오류: ' + e.message);
    // 페이지 재생성
    try { await adminPage.close(); } catch (_) {}
    adminPage = null;
    return null;
  }
}

// ── 곳간: HTTP 쿠키 방식 ──────────────────────────────────────────────────
function httpGet(url, cookieStr, hop) {
  hop = hop || 0;
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.get(url, {
      headers: {
        Cookie: cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
        Referer: `https://${parsedUrl.hostname}/`
      },
      timeout: 8000
    }, res => {
      const loc = res.headers.location || '';
      if (res.statusCode === 301 || res.statusCode === 302) {
        if (loc.includes('login') || loc.includes('Login')) {
          res.resume();
          return resolve({ redirected: true, toLogin: true });
        }
        if (hop < 3) {
          res.resume();
          const next = loc.startsWith('http') ? loc : `https://${parsedUrl.hostname}${loc}`;
          return resolve(httpGet(next, cookieStr, hop + 1));
        }
      }
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ html: data, status: res.statusCode }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function loginFg() {
  log('[곳간] 로그인 중...');
  const br = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 }
  });
  const page = await br.newPage();
  try {
    await page.goto('https://intro.flexgate.co.kr/Mypage/Login',
      { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1000);
    const idEl = await page.$('input[name="userId"]');
    const pwEl = await page.$('input[name="password"]');
    if (idEl) { await idEl.click({ clickCount: 3 }); await idEl.type(FG_ID); }
    if (pwEl) { await pwEl.click({ clickCount: 3 }); await pwEl.type(FG_PW); }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
      pwEl ? pwEl.press('Enter') : Promise.resolve()
    ]);
    await sleep(1500);
    await page.goto('https://dongnaegotgan.flexgate.co.kr/Main/Index',
      { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    const cookies = await page.cookies();
    const str = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    log('[곳간] 로그인 완료');
    return str;
  } finally { await br.close(); }
}

async function getFgCount() {
  if (!fgCookies) fgCookies = await loginFg();

  const res = await httpGet(
    'https://dongnaegotgan.flexgate.co.kr/NewOrder/deal01?order_status=20&formtype=C',
    fgCookies
  );

  if (!res.html || (res.redirected && res.toLogin)) {
    log('[곳간] 세션 만료 - 재로그인');
    fgCookies = '';
    return null;
  }

  const orderIds = new Set((res.html.match(/PJM\d+/g) || []));
  return orderIds.size;
}

// ── 주문건확인 실행 ────────────────────────────────────────────────────────
async function runOrderCheck() {
  log('[주문건확인] 실행 중...');
  let br = null;
  try {
    br = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: { width: 1440, height: 900 }
    });

    // ── 어드민 조회 (기존 adminPage 재사용) ──
    const adminResult = await (async () => {
      try {
        // 이미 로그인된 adminPage 활용
        await ensureAdminPage();
        await adminPage.goto(
          'https://dongnaegotgan.adminplus.co.kr/admin/?mod=order&actpage=od.list.bd&status=3&page=1&rownum=100',
          { waitUntil: 'networkidle2', timeout: 20000 }
        );
        return await adminPage.evaluate(() => {
          const text = document.body.innerText;
          const totalM = text.match(/보기\s*\d+\s*[-~]\s*\d+\s*\/\s*(\d+)/);
          const totalOrders = totalM ? parseInt(totalM[1]) : 0;
          // 금액 합산
          let total = 0;
          const rows = document.querySelectorAll('table tbody tr');
          const products = {};
          rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 5) return;
            const product = (cells[5]?.innerText || '').trim().split('\n')[0];
            const priceText = cells[12]?.innerText || '0';
            const price = parseInt(priceText.replace(/[^\d]/g, '')) || 0;
            if (product && price > 0) {
              total += price;
              if (!products[product]) products[product] = { qty: 0, price };
              products[product].qty++;
            }
          });
          return { totalOrders, total, products, success: true };
        });
      } catch (e) {
        return { success: false, error: e.message };
      }
    })();

    // ── 곳간 조회 ──
    const fgResult = await (async () => {
      const page = await br.newPage();
      page.on('dialog', d => d.accept().catch(() => {}));
      try {
        await page.goto('https://intro.flexgate.co.kr/Mypage/Login',
          { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(1000);
        const idEl = await page.$('input[name="userId"]');
        const pwEl = await page.$('input[name="password"]');
        if (idEl) { await idEl.click({ clickCount: 3 }); await idEl.type(FG_ID); }
        if (pwEl) { await pwEl.click({ clickCount: 3 }); await pwEl.type(FG_PW); }
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
          pwEl ? pwEl.press('Enter') : Promise.resolve()
        ]);
        await sleep(2000);
        await page.goto(
          'https://dongnaegotgan.flexgate.co.kr/NewOrder/deal01?order_status=20&formtype=C',
          { waitUntil: 'networkidle2', timeout: 20000 }
        );
        const data = await page.evaluate(() => {
          const ids = new Set((document.documentElement.innerHTML.match(/PJM\d+/g) || []));
          const text = document.body.innerText;
          const priceM = text.match(/합계금액[^0-9]*([0-9,]+)/);
          const total = priceM ? parseInt(priceM[1].replace(/,/g, '')) : 0;
          return { totalOrders: ids.size, total, success: true };
        });
        await page.close();
        return data;
      } catch (e) {
        await page.close().catch(() => {});
        return { success: false, error: e.message };
      }
    })();

    await br.close(); br = null;

    // ── 메시지 조합 ──
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    let msg = `<b>[주문현황]</b>  ${now}\n${'─'.repeat(18)}\n\n`;

    if (adminResult.success) {
      msg += `<b>[곳간 위탁도매]</b>\n총 주문: ${adminResult.totalOrders}건`;
      if (adminResult.total) msg += `\n  [총액] ${adminResult.total.toLocaleString()}원`;
      const prods = Object.entries(adminResult.products || {});
      if (prods.length) {
        msg += `\n[상품별]\n`;
        prods.forEach(([name, info]) => {
          msg += `  ${name} ${info.qty}개 (${info.price.toLocaleString()}원)\n`;
        });
      }
    } else {
      msg += `곳간 위탁도매 조회 실패\n`;
    }

    msg += '\n';

    if (fgResult.success) {
      msg += `<b>[동네곳간]</b>\n총 주문: ${fgResult.totalOrders}건`;
      if (fgResult.total) msg += `\n  [총액] ${fgResult.total.toLocaleString()}원`;
    } else {
      msg += `동네곳간 조회 실패\n`;
    }

    const totalAmt = (adminResult.total || 0) + (fgResult.total || 0);
    if (totalAmt > 0) {
      msg += `\n\n${'─'.repeat(18)}\n<b>[합산: ${totalAmt.toLocaleString()}원]</b>\n`;
      if (adminResult.total) msg += `  곳간 위탁도매: ${adminResult.total.toLocaleString()}원\n`;
      if (fgResult.total)    msg += `  동네곳간: ${fgResult.total.toLocaleString()}원\n`;
    }

    await tgSend(msg);
    log('[주문건확인] 전송 완료');

  } catch (e) {
    if (br) await br.close().catch(() => {});
    log('[주문건확인] 오류: ' + e.message);
    await tgSend(`⚠️ 주문건확인 오류: ${e.message}`);
  }
}

// ── 메인 체크 루프 ────────────────────────────────────────────────────────
async function check() {
  if (busy) return;
  busy = true;
  try {
    let adminCnt = null;
    try { adminCnt = await getAdminCount(); }
    catch (e) {
      log('[admin] 오류: ' + e.message);
      // 브라우저 완전 재시작
      try { if (adminBrowser) await adminBrowser.close(); } catch (_) {}
      adminBrowser = null; adminPage = null;
    }

    let fgCnt = null;
    try { fgCnt = await getFgCount(); }
    catch (e) { log('[곳간] 오류: ' + e.message); fgCookies = ''; }

    log(`[체크] 곳간위탁도매: ${adminCnt ?? '?'} / 동네곳간: ${fgCnt ?? '?'}  (이전: ${lastAdminCnt}/${lastFgCnt})`);

    const newAdmin = lastAdminCnt >= 0 && adminCnt !== null && adminCnt > lastAdminCnt;
    const newFg    = lastFgCnt    >= 0 && fgCnt    !== null && fgCnt    > lastFgCnt;

    if (newAdmin || newFg) {
      let alertMsg = '🔔 <b>신규주문 알림!</b>\n';
      if (newAdmin) alertMsg += `📦 곳간 위탁도매: ${lastAdminCnt}건 → <b>${adminCnt}건</b> (+${adminCnt - lastAdminCnt})\n`;
      if (newFg)    alertMsg += `🛒 동네곳간: ${lastFgCnt}건 → <b>${fgCnt}건</b> (+${fgCnt - lastFgCnt})\n`;

      await tgSend(alertMsg);
      log('[알림] 신규주문 발송');

      if (Date.now() - lastAlertTime > COOLDOWN) {
        lastAlertTime = Date.now();
        setImmediate(() => runOrderCheck());
      }
    }

    if (adminCnt !== null) lastAdminCnt = adminCnt;
    if (fgCnt    !== null) lastFgCnt    = fgCnt;

  } finally {
    busy = false;
  }
}

// ── 시작 ─────────────────────────────────────────────────────────────────
async function main() {
  log('[v2] 신규주문 감시 시작');
  log(`  곳간위탁도매(Puppeteer) + 동네곳간(HTTP) — ${INTERVAL/1000}초 간격`);

  log('[초기화] 현재 주문 수 확인 중...');
  try {
    const [ac, fc] = await Promise.allSettled([getAdminCount(), getFgCount()]);
    lastAdminCnt = ac.status === 'fulfilled' && ac.value !== null ? ac.value : 0;
    lastFgCnt    = fc.status === 'fulfilled' && fc.value !== null ? fc.value : 0;
    log(`[초기화] 완료 — 곳간위탁도매: ${lastAdminCnt} / 동네곳간: ${lastFgCnt}`);
  } catch (e) {
    log('[초기화 오류] ' + e.message);
  }

  setInterval(check, INTERVAL);
}

// 종료 시 브라우저 정리
process.on('SIGINT',  () => { if (adminBrowser) adminBrowser.close(); process.exit(0); });
process.on('SIGTERM', () => { if (adminBrowser) adminBrowser.close(); process.exit(0); });

main().catch(e => { log('[치명적 오류] ' + e.message); process.exit(1); });
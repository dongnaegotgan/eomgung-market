/**
 * write_new_bot.js
 * tg_status_bot.js를 완전히 새로 작성
 * node write_new_bot.js 실행 후 pm2 restart gotgan-status
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'tg_status_bot.js');

// 백업
const bak = TARGET.replace('.js', `.final_bak_${Date.now()}.js`);
if (fs.existsSync(TARGET)) {
  fs.copyFileSync(TARGET, bak);
  console.log(`백업: ${path.basename(bak)}`);
}

const newContent = `/**
 * tg_status_bot.js v9 - 최종 완성본
 * 어드민+곳간 주문현황 + 상품별 수량 + 금액 + 합계
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const https = require('https');
const http  = require('http');
const puppeteer = require('puppeteer');

const TG_TOKEN = process.env.TG_TOKEN || '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT  = process.env.TG_CHAT  || '6097520392';
const ADMIN_HOST = 'dongnaegotgan.adminplus.co.kr';
const ADMIN_URL  = \`https://\${ADMIN_HOST}/admin/\`;
const ADMIN_ID   = process.env.ADMIN_ID || 'dongnaegotgan';
const ADMIN_PW   = process.env.ADMIN_PW || 'rhtrks12!@';
const FG_URL     = 'https://dongnaegotgan.flexgate.co.kr';
const FG_LOGIN   = 'https://intro.flexgate.co.kr/Mypage/Login';
const FG_ID      = process.env.FG_ID  || 'dongnaegotgan';
const FG_PW      = process.env.FG_PW  || 'rhtrks12!@';

function log(m) { console.log(\`[\${new Date().toLocaleTimeString('ko-KR')}] \${m}\`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── HTTP 요청 ──────────────────────────────────────────────────────────
function req(options, body = null) {
  return new Promise((resolve, reject) => {
    const mod = (options.protocol === 'http:' || options.hostname === 'localhost') ? http : https;
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
function cookieStr(c) { return Object.entries(c).map(([k,v])=>\`\${k}=\${v}\`).join('; '); }

// ── 텔레그램 ─────────────────────────────────────────────────────────
async function tgSend(msg, chatId = TG_CHAT) {
  const body = JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' });
  await req({ hostname: 'api.telegram.org', path: \`/bot\${TG_TOKEN}/sendMessage\`,
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body).catch(e => log(\`tgSend 오류: \${e.message}\`));
}
async function tgGetUpdates(offset) {
  const res = await req({ hostname: 'api.telegram.org',
    path: \`/bot\${TG_TOKEN}/getUpdates?offset=\${offset}&timeout=20&limit=10\`, method: 'GET'
  }).catch(()=>null);
  if (!res) return [];
  try { const d = JSON.parse(res.body); return d.ok ? d.result : []; } catch { return []; }
}

// ── 어드민플러스 ───────────────────────────────────────────────────────
let adminCookies = {}, adminLoginTime = 0;

async function adminLogin() {
  const loginBody = new URLSearchParams({ id: ADMIN_ID, pw: ADMIN_PW, mode: 'login' }).toString();
  let cookies = {};
  let nextOptions = {
    hostname: ADMIN_HOST, path: '/admin/login.php', method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(loginBody),
      'Referer': ADMIN_URL, 'User-Agent': 'Mozilla/5.0',
    }
  };
  let nextBody = loginBody;

  for (let hop = 0; hop < 6; hop++) {
    const res = await req(nextOptions, nextBody);
    Object.assign(cookies, parseCookies(res.headers['set-cookie']));
    const loc = res.headers['location'];
    if (!loc) break;

    let nextHostname = ADMIN_HOST, nextPath = loc;
    if (loc.startsWith('http')) {
      try { const u = new URL(loc); nextHostname = u.hostname; nextPath = u.pathname + u.search; } catch(e) {}
    }
    nextOptions = {
      hostname: nextHostname, path: nextPath, method: 'GET',
      headers: { 'Cookie': cookieStr(cookies), 'User-Agent': 'Mozilla/5.0', 'Referer': ADMIN_URL }
    };
    nextBody = null;
  }

  adminCookies = cookies;
  adminLoginTime = Date.now();
  log(\`  [어드민] 로그인 완료, 쿠키: \${Object.keys(cookies).join(', ') || '없음'}\`);
}

async function ensureAdmin() {
  if (Date.now() - adminLoginTime < 20*60*1000 && Object.keys(adminCookies).length) return;
  await adminLogin();
}

async function getAdminOrders() {
  await ensureAdmin();
  const todayKST = new Date(Date.now() + 9*60*60*1000).toISOString().slice(0,10);

  // stats API로 실시간 주문 카운트
  let orderCount = 0;
  try {
    const sr = await req({
      hostname: ADMIN_HOST, path: '/admin/xml/real.stats.json.php', method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': 0,
        'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
        'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest'
      }
    }, '');
    const stats = JSON.parse(sr.body);
    // spnNew8 = 오늘 전체상태, spnNew5 = 신규주문
    orderCount = parseInt(stats.spnNew8) || parseInt(stats.spnNew5) || 0;
    log(\`  [어드민 stats] 오늘=\${stats.spnNew8}, 신규=\${stats.spnNew5}\`);
  } catch(e) { log(\`  [어드민 stats 오류] \${e.message}\`); }

  // 주문 목록 (오늘, 전체 상태)
  const params = new URLSearchParams({
    proc: 'json', mod: 'order', actpage: 'od.list.bd',
    status: '', datefld: 'b.regdate',
    sdate: JSON.stringify({ start: todayKST, end: todayKST }),
    bizgrp: 'all', searchtype: 'all', searchval: '',
    _search: 'false', rows: '500', page: '1', sidx: 'regdate', sord: 'desc'
  });

  const prodMap = {};
  let totalAmount = 0;
  try {
    const listRes = await req({
      hostname: ADMIN_HOST,
      path: \`/admin/order/json/od.list.bd.php?\${params}\`, method: 'GET',
      headers: {
        'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
        'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest'
      }
    });

    let data;
    try { data = JSON.parse(listRes.body); }
    catch(e) {
      log('  [어드민] 세션 만료, 재로그인');
      adminLoginTime = 0; await adminLogin();
      const listRes2 = await req({
        hostname: ADMIN_HOST,
        path: \`/admin/order/json/od.list.bd.php?\${params}\`, method: 'GET',
        headers: {
          'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
          'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest'
        }
      });
      data = JSON.parse(listRes2.body);
    }

    const rows = data.rows || [];
    const listCount = parseInt(data.records) || rows.length;
    log(\`  [어드민] 오늘(\${todayKST}) \${listCount}건 rows=\${rows.length}\`);
    if (!orderCount) orderCount = listCount;

    rows.forEach((row, ri) => {
      const cell = Array.isArray(row.cell) ? row.cell : [];
      if (ri === 0) log(\`  [어드민 cell0샘플] \${JSON.stringify(cell).slice(0,150)}\`);

      // 금액 추출
      let rowAmt = 0;
      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const clean = c.replace(/<[^>]+>/g,'').replace(/,/g,'').trim();
        const m = clean.match(/(\\d{4,8})\\s*원?$/);
        if (m) { const v = parseInt(m[1]); if (v >= 1000 && v > rowAmt) rowAmt = v; }
      });
      totalAmount += rowAmt;

      // 상품+수량 파싱
      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const text = c.replace(/<[^>]+>/g,'').replace(/\\s+/g,' ').trim();
        const main = text.split('·')[0].trim();

        // "상품명 / N 개" 패턴
        const m1 = main.match(/^(.{2,50}?)\\s*\\/\\s*(\\d+)\\s*개?/);
        if (m1) {
          const name = m1[1].replace(/\\([^)]*\\)/g,'').trim();
          const qty = parseInt(m1[2]);
          if (name.length >= 2 && name.length <= 40 && qty > 0 && qty < 1000 &&
              !/배송비|배송|PJM|입금|원$|주문/.test(name)) {
            if (!prodMap[name]) prodMap[name] = { qty: 0, amt: 0 };
            prodMap[name].qty += qty;
            prodMap[name].amt += rowAmt;
          }
          return;
        }
        // "상품명 N개" 패턴
        const m2 = text.match(/^(.{2,40}?)\\s+(\\d+)개/);
        if (m2) {
          const name = m2[1].trim(); const qty = parseInt(m2[2]);
          if (name.length >= 2 && qty > 0 && qty < 1000 && !/배송비|배송|PJM/.test(name)) {
            if (!prodMap[name]) prodMap[name] = { qty: 0, amt: 0 };
            prodMap[name].qty += qty;
          }
        }
      });
    });
  } catch(e) { log(\`  [어드민 목록 오류] \${e.message}\`); }

  return { orderCount, prodMap, totalAmount };
}

// ── 곳간 Puppeteer ────────────────────────────────────────────────────
let fgBrowser = null, fgPage = null, fgLoginTime = 0;

async function ensureFgBrowser() {
  if (fgBrowser && fgBrowser.isConnected()) return;
  log('  [곳간] 새 브라우저 시작...');
  fgBrowser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--lang=ko-KR',
           '--disable-blink-features=AutomationControlled','--disable-web-security'],
    defaultViewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  fgPage = await fgBrowser.newPage();
  fgPage.on('dialog', d => d.accept().catch(()=>{}));
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
  catch(e) { log('  [곳간] userId 셀렉터 없음'); }

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
    log('  [곳간] userId/password 입력 완료');
  }

  await sleep(300);
  const loginBtn = await fgPage.$('button[type="submit"], input[type="submit"]').catch(()=>null);
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

  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    if (!fgPage.url().includes('Login')) break;
  }
  log(\`  [곳간] 로그인 후 URL: \${fgPage.url()}\`);
  const cookies = await fgPage.cookies();
  log(\`  [곳간] 쿠키 \${cookies.length}개: \${cookies.map(c=>c.name).join(', ')}\`);
  fgLoginTime = Date.now();
}

async function ensureFgLogin() {
  if (Date.now() - fgLoginTime < 25*60*1000 && fgBrowser?.isConnected()) return;
  await fgLogin();
}

async function getGotganOrders() {
  await ensureFgLogin();
  try {
    await fgPage.goto(\`\${FG_URL}/NewOrder/deal01?order_status=10&formtype=A&pagesize=1000\`,
      { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(1000);

    const url = fgPage.url();
    log(\`  [곳간] 주문 페이지 URL: \${url}\`);

    if (url.includes('Login') || url.includes('login')) {
      log('  [곳간] 세션 만료, 재로그인...');
      fgLoginTime = 0; await fgLogin();
      if (!fgPage.url().includes('Login')) {
        await fgPage.goto(\`\${FG_URL}/NewOrder/deal01?order_status=10&formtype=A&pagesize=1000\`,
          { waitUntil: 'networkidle2', timeout: 15000 });
        await sleep(1000);
      }
    }

    const html = await fgPage.content();
    const snippet = html.replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').slice(0,300);
    log(\`  [곳간 HTML] \${snippet}\`);

    // 주문번호 카운트 (PJM 패턴)
    const orderNums = new Set();
    for (const m of html.matchAll(/PJM[A-Z0-9-]+/g)) orderNums.add(m[0]);
    log(\`  [곳간] PJM 주문번호 \${orderNums.size}개\`);

    if (orderNums.size === 0) {
      await fgPage.goto(\`\${FG_URL}/NewOrder/deal01?order_status=20&formtype=A&pagesize=1000\`,
        { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(800);
      const html2 = await fgPage.content();
      for (const m of html2.matchAll(/PJM[A-Z0-9-]+/g)) orderNums.add(m[0]);
      log(\`  [곳간 status=20] PJM \${orderNums.size}개\`);
    }

    // 상품 파싱: 셀[5] = "상품명 / N 개 · 선택:옵션..."
    const amountData = await fgPage.evaluate(() => {
      const map = {};
      let total = 0;

      document.querySelectorAll('table tbody tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')].map(td =>
          (td.innerText || td.textContent || '').replace(/\\s+/g, ' ').trim()
        );
        if (cells.length < 6) return;

        const prodCell = cells[5] || '';
        if (!prodCell || !prodCell.includes(' / ')) return;

        const slashIdx = prodCell.indexOf(' / ');
        const namePart = prodCell.slice(0, slashIdx).trim();
        const afterSlash = prodCell.slice(slashIdx + 3).trim();

        const qtyM = afterSlash.match(/^(\\d+)\\s*개/);
        if (!qtyM) return;

        const qty = parseInt(qtyM[1]);
        // 긴 괄호 설명 제거
        let name = namePart.replace(/\\s*\\([^)]{15,}\\)\\s*/g, ' ').replace(/\\s+/g, ' ').trim();
        if (name.length < 2 || qty <= 0 || qty >= 1000) return;
        if (/배송비|배송|주소|취소|결제/.test(name)) return;

        // 금액 (셀[6])
        const amtCell = cells[6] || '';
        let amt = 0;
        const amtMs = amtCell.match(/(\\d{1,3}(?:,\\d{3})+|\\d{4,8})\\s*원/g);
        if (amtMs) amtMs.forEach(m => {
          const v = parseInt(m.replace(/[,원]/g,''));
          if (v > amt && v < 10000000) amt = v;
        });

        if (!map[name]) map[name] = { qty: 0, amt: 0 };
        map[name].qty += qty;
        map[name].amt += amt;
        total += amt;
      });

      return { map, total };
    });

    log(\`  [곳간] 상품 \${Object.keys(amountData.map).length}종, 총액 \${amountData.total.toLocaleString()}원\`);
    return { orderCount: orderNums.size, prodMap: amountData.map, totalAmount: amountData.total };

  } catch(e) {
    log(\`  [곳간 오류] \${e.message}\`);
    try { await fgBrowser?.close(); } catch(_) {}
    fgBrowser = null; fgPage = null; fgLoginTime = 0;
    return { orderCount: 0, prodMap: {}, totalAmount: 0 };
  }
}

// ── 메시지 포맷 ───────────────────────────────────────────────────────
function formatSection(title, data) {
  const { orderCount, prodMap, totalAmount } = data;
  const entries = Object.entries(prodMap)
    .map(([n, v]) => [n, typeof v === 'object' ? v : { qty: v, amt: 0 }])
    .filter(([,v]) => v.qty > 0)
    .sort((a,b) => b[1].qty - a[1].qty);

  const total = totalAmount || entries.reduce((s,[,v])=>s+(v.amt||0), 0);
  const totalStr = total > 0 ? \`  💰 소계: <b>\${total.toLocaleString()}원</b>\\n\` : '';

  let msg = \`\${title}\\n총 주문: <b>\${orderCount}건</b>\\n\${totalStr}\`;
  if (entries.length > 0) {
    msg += \`\\n📦 상품별 수량\\n\`;
    entries.slice(0,15).forEach(([n,v]) => {
      const amtStr = v.amt > 0 ? \` (\${v.amt.toLocaleString()}원)\` : '';
      msg += \`  • \${n} <b>\${v.qty}개</b>\${amtStr}\\n\`;
    });
  } else {
    msg += \`  (상품 정보 없음)\\n\`;
  }
  return msg;
}

// ── 명령 처리 ─────────────────────────────────────────────────────────
let busy = false;
async function handleCommand(cmd, chatId) {
  log(\`처리: \${cmd}\`);

  if (cmd === '/도움말' || cmd === '도움말') {
    await tgSend(
      \`📋 <b>명령어</b>\\n\` +
      \`/현황 — 어드민+곳간 통합\\n\` +
      \`/어드민 — 어드민플러스만\\n\` +
      \`/곳간 — flexgate만\\n\` +
      \`/알림 — 자동승인 상태\\n\` +
      \`/곳간출력 — 주문 엑셀 출력\`,
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
        const os = require('os');
        const DOWNLOADS = require('path').join(os.homedir(), 'Downloads');
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
        await dlPage.evaluateOnNewDocument(() => { Object.defineProperty(navigator,'webdriver',{get:()=>false}); });
        await dlPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await dlPage.goto(\`\${FG_INTRO}/Mypage/Login\`, { waitUntil: 'domcontentloaded', timeout: 20000 });
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
          await dlBrowser.close();
          await tgSend('❌ 곳간 로그인 실패.', chatId);
          return;
        }

        await dlPage.goto(\`\${FG_BASE}/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000\`,
          { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(2000);
        await dlPage.waitForFunction(() => document.querySelectorAll('input[name="chk"]').length > 0,
          { timeout: 15000, polling: 500 }).catch(()=>{});
        const cnt = await dlPage.evaluate(() => document.querySelectorAll('input[name="chk"]').length);

        if (cnt === 0) {
          await dlBrowser.close();
          await tgSend('📭 배송준비중 주문 없음.', chatId);
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
          const m = text.match(/order_\\d+\\.xlsx/);
          if (m) fileName = m[0];
          else { try { fileName = JSON.parse(text).fileName || ''; } catch(e){} }
        }

        if (!fileName) { await dlBrowser.close(); await tgSend('❌ 파일 생성 실패.', chatId); return; }

        await sleep(2000);
        await dlPage.goto(\`\${FG_BASE}/NewOrder/ExcelDownload?fileName=\${encodeURIComponent(fileName)}\`,
          { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
        await sleep(5000);
        await dlBrowser.close();
        await tgSend(\`✅ 곳간 엑셀 다운로드 완료! (\${cnt}건)\\n자동 출력 처리 중..\`, chatId);

      } catch(e) {
        if (dlBrowser) await dlBrowser.close().catch(()=>{});
        await tgSend(\`❌ 곳간 출력 오류: \${e.message}\`, chatId);
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

      let msg = \`📊 <b>주문현황</b>  \${now}\\n\${'─'.repeat(20)}\\n\\n\`;
      msg += aD ? formatSection('🏪 <b>[어드민] 상품쇼핑몰</b>', aD) : '🏪 어드민 조회 실패\\n';
      msg += '\\n';
      msg += fD ? formatSection('🛒 <b>[곳간] flexgate</b>', fD) : '🛒 곳간 조회 실패\\n';

      // 합산 총액
      const adminTotal = aD?.totalAmount || 0;
      const gotganTotal = fD?.totalAmount || 0;
      const grandTotal = adminTotal + gotganTotal;
      if (grandTotal > 0) {
        msg += \`\\n\${'─'.repeat(20)}\\n💵 <b>합산 총액: \${grandTotal.toLocaleString()}원</b>\\n\`;
        if (adminTotal > 0) msg += \`   어드민: \${adminTotal.toLocaleString()}원\\n\`;
        if (gotganTotal > 0) msg += \`   곳간: \${gotganTotal.toLocaleString()}원\\n\`;
      }

      await tgSend(msg, chatId);
      log('발송 완료');

    } else if (cmd === '/어드민' || cmd === '어드민') {
      await tgSend('🔍 어드민 조회...', chatId);
      const d = await getAdminOrders();
      await tgSend(\`📊 <b>어드민</b>  \${now}\\n\\n\` + formatSection('🏪', d), chatId);

    } else if (cmd === '/곳간' || cmd === '곳간') {
      fgLoginTime = 0;
      await tgSend('🔍 곳간 조회...', chatId);
      const d = await getGotganOrders();
      await tgSend(\`📊 <b>곳간</b>  \${now}\\n\\n\` + formatSection('🛒', d), chatId);
    }

  } catch(e) {
    log(\`오류: \${e.message}\`);
    await tgSend(\`❌ 오류: \${e.message}\`, chatId);
  } finally {
    busy = false;
  }
}

// ── 폴링 ─────────────────────────────────────────────────────────────
let lastUpdateId = 0, polling = false;
const CMDS = [
  '/현황','현황','/어드민','어드민','/곳간','곳간',
  '/도움말','도움말','/알림','알림','/곳간출력','곳간출력'
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
      log(\`수신: "\${text}"\`);
      if (CMDS.includes(text)) handleCommand(text, chatId);
    }
  } catch(e) { log(\`poll 오류: \${e.message}\`); }
  finally { polling = false; }
}

log('🤖 주문현황 봇 v9 (최종완성판)');
log('   명령어: /현황, /어드민, /곳간, /도움말, /알림, /곳간출력');
setInterval(poll, 3000);
poll();
process.on('SIGINT',  () => { if(fgBrowser) fgBrowser.close(); process.exit(0); });
process.on('SIGTERM', () => { if(fgBrowser) fgBrowser.close(); process.exit(0); });
`;

fs.writeFileSync(TARGET, newContent, 'utf8');
console.log('✅ tg_status_bot.js v9 작성 완료!');
console.log('\n실행:');
console.log('   pm2 restart gotgan-status');
console.log('   pm2 logs gotgan-status --lines 15 --nostream');
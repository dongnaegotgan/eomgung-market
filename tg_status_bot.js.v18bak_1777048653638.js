'use strict';
/**
 * tg_status_bot.js v18
 * 어드민: 주문 페이지 navigate + waitForResponse XHR 인터셉트
 * 곳간:   Puppeteer DOM 파싱 (기존 정상)
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const https     = require('https');
const puppeteer = require('puppeteer');

const TG_TOKEN   = process.env.TG_TOKEN || '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT    = process.env.TG_CHAT  || '6097520392';
const ADMIN_HOST = 'dongnaegotgan.adminplus.co.kr';
const ADMIN_URL  = 'https://' + ADMIN_HOST + '/admin/';
const ADMIN_LOGIN= ADMIN_URL + 'login.html?rtnurl=%2Fadmin%2F';
const ADMIN_ID   = process.env.ADMIN_ID || 'dongnaegotgan';
const ADMIN_PW   = process.env.ADMIN_PW || 'rhtrks12!@';
const FG_URL     = 'https://dongnaegotgan.flexgate.co.kr';
const FG_LOGIN   = 'https://intro.flexgate.co.kr/Mypage/Login';
const FG_ID      = process.env.FG_ID || 'dongnaegotgan';
const FG_PW      = process.env.FG_PW || 'rhtrks12!@';

function log(m) { console.log('[' + new Date().toLocaleTimeString('ko-KR') + '] ' + m); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 텔레그램 ──────────────────────────────────────────────────────────────
function tgReq(path2, body) {
  return new Promise((res, rej) => {
    const buf = Buffer.from(JSON.stringify(body));
    const r = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + TG_TOKEN + path2,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length }
    }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { res(JSON.parse(d)); } catch { res({}); } }); });
    r.on('error', rej);
    r.write(buf); r.end();
  });
}

async function tgSend(msg, chatId, retry) {
  chatId = chatId || TG_CHAT;
  retry  = retry  || 3;
  for (let i = 0; i < retry; i++) {
    try { await tgReq('/sendMessage', { chat_id: chatId, text: msg, parse_mode: 'HTML' }); return; }
    catch(e) { log('tgSend 오류[' + i + ']: ' + e.message); if (i < retry-1) await sleep(2000); }
  }
}

async function tgSendId(msg, chatId) {
  try {
    const r = await tgReq('/sendMessage', { chat_id: chatId || TG_CHAT, text: msg, parse_mode: 'HTML' });
    return r.result && r.result.message_id ? r.result.message_id : null;
  } catch { return null; }
}

async function tgEdit(chatId, msgId, text) {
  try { await tgReq('/editMessageText', { chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML' }); }
  catch(e) { log('tgEdit 오류: ' + e.message); }
}

async function tgGetUpdates(offset) {
  return new Promise(res => {
    const r = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + TG_TOKEN + '/getUpdates?offset=' + offset + '&timeout=20&limit=10',
      method: 'GET'
    }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { const j = JSON.parse(d); res(j.ok ? j.result : []); } catch { res([]); } }); });
    r.on('error', () => res([]));
    r.end();
  });
}

// ── 어드민 Puppeteer ──────────────────────────────────────────────────────
let adminBrowser = null, adminPage = null, adminLoginTime = 0;

async function ensureAdminBrowser() {
  if (adminBrowser && adminBrowser.isConnected()) return;
  log('  [어드민] 브라우저 시작');
  adminBrowser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });
  adminPage = await adminBrowser.newPage();
  adminPage.on('dialog', d => d.accept().catch(() => {}));
  await adminPage.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });
  await adminPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
}

async function adminLogin() {
  await ensureAdminBrowser();
  log('  [어드민] 로그인 시작');
  await adminPage.goto(ADMIN_LOGIN, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(1500);

  // idtype 라디오 + admid/admpwd + form.submit()
  await adminPage.evaluate(function(id, pw) {
    var radios = document.querySelectorAll('input[name="idtype"]');
    if (radios && radios[0]) { radios[0].checked = true; radios[0].click(); }
    var f1 = document.querySelector('input[name="admid"]');
    var f2 = document.querySelector('input[name="admpwd"]');
    if (f1) { f1.value = id;  f1.dispatchEvent(new Event('input', { bubbles: true })); }
    if (f2) { f2.value = pw;  f2.dispatchEvent(new Event('input', { bubbles: true })); }
    var frm = document.querySelector('form');
    if (frm) { frm.onsubmit = null; frm.submit(); }
  }, ADMIN_ID, ADMIN_PW);

  // iframe 응답 대기 (hiddenFrm에 응답이 오면 세션 쿠키 발급됨)
  await sleep(3000);

  // /admin/ 직접 접근
  await adminPage.goto(ADMIN_URL, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await sleep(500);

  const url     = adminPage.url();
  const cookies = await adminPage.cookies();
  const phpSess = cookies.find(c => c.name === 'PHPSESSID');
  log('  [어드민] URL: ' + url);
  log('  [어드민] 쿠키: ' + cookies.map(c => c.name).join(', '));

  const loggedIn = !url.includes('login') && !!phpSess;
  if (!loggedIn) {
    log('  [어드민] ❌ 로그인 실패');
    adminLoginTime = 0;
    return false;
  }
  log('  [어드민] ✅ 로그인 성공');
  adminLoginTime = Date.now();
  return true;
}

async function ensureAdminLogin() {
  if (Date.now() - adminLoginTime < 20*60*1000 && adminBrowser && adminBrowser.isConnected()) return true;
  return await adminLogin();
}

async function getAdminOrders() {
  const ok = await ensureAdminLogin();

  // stats (인증 없이도 동작)
  let orderCount = 0;
  try {
    const sr = await adminPage.evaluate(async function() {
      var r = await fetch('/admin/xml/real.stats.json.php', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: '' });
      return await r.json();
    });
    orderCount = parseInt(sr.spnNew5) || 0;
    log('  [어드민 stats] 신규=' + sr.spnNew5 + ', 오늘=' + sr.spnNew8);
  } catch(e) { log('  [어드민 stats 오류] ' + e.message); }

  if (!ok) {
    log('  [어드민] 로그인 실패 → 건수만 반환');
    return { orderCount, prodMap: {}, totalAmount: 0 };
  }

  const todayKST = new Date(Date.now() + 9*60*60*1000).toISOString().slice(0, 10);

  // ★ 핵심: 주문 목록 페이지로 navigate → XHR 응답 waitForResponse로 인터셉트
  try {
    const orderPageUrl = 'https://' + ADMIN_HOST + '/admin/order/?order_status=10';

    // XHR 응답 대기 설정 (navigate 전에 먼저)
    const xhrPromise = adminPage.waitForResponse(
      resp => resp.url().includes('od.list.bd.php'),
      { timeout: 20000 }
    ).catch(() => null);

    await adminPage.goto(orderPageUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(1000);

    const xhrResp = await xhrPromise;
    let rows = [];

    if (xhrResp) {
      try {
        const json = await xhrResp.json();
        rows = json.rows || [];
        log('  [어드민] XHR 인터셉트 성공, rows=' + rows.length);
      } catch(e) {
        log('  [어드민] XHR JSON 파싱 오류: ' + e.message);
      }
    } else {
      // fallback: evaluate fetch 방식
      log('  [어드민] XHR 인터셉트 실패 → evaluate fetch 시도');
      const params = new URLSearchParams({
        proc: 'json', mod: 'order', actpage: 'od.list.bd',
        status: '10', datefld: 'b.regdate',
        sdate: JSON.stringify({ start: todayKST, end: todayKST }),
        bizgrp: 'all', searchtype: 'all', searchval: '',
        _search: 'false', rows: '500', page: '1', sidx: 'regdate', sord: 'desc'
      });
      const data = await adminPage.evaluate(async function(qs) {
        try {
          var r = await fetch('/admin/order/json/od.list.bd.php?' + qs, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
          return await r.json();
        } catch(e) { return { rows: [], records: 0, err: e.message }; }
      }, params.toString());
      rows = data.rows || [];
      log('  [어드민] evaluate fetch rows=' + rows.length + (data.err ? ' err=' + data.err : ''));
    }

    if (!orderCount) orderCount = rows.length;

    // 파싱
    const prodMap    = {};
    let   totalAmount = 0;
    rows.forEach(row => {
      const cell = Array.isArray(row.cell) ? row.cell : [];
      let rowAmt = 0;
      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const clean = c.replace(/<[^>]+>/g, '').replace(/,/g, '').trim();
        const m = clean.match(/(d{4,8})s*원$/);
        if (m) { const v = parseInt(m[1]); if (v >= 1000 && v > rowAmt) rowAmt = v; }
      });
      totalAmount += rowAmt;

      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const text  = c.replace(/<[^>]+>/g, '').replace(/s+/g, ' ').trim();
        const parts = text.split('·')[0].trim().split('/');
        if (parts.length < 2) return;
        let name = parts[0].trim();
        const qtyM = parts[1].match(/(d+)/);
        if (!qtyM) return;
        const qty = parseInt(qtyM[1]);
        name = name.replace(/s*([^)]{10,})s*/g, ' ').trim();
        name = name.replace(/^[ds[]()]+/, '').trim();
        if (name.length < 2 || qty <= 0 || qty >= 1000) return;
        if (/후불|납품|PJM|취소|주문|배송/.test(name)) return;
        if (!prodMap[name]) prodMap[name] = { qty: 0, amt: 0 };
        prodMap[name].qty += qty;
        prodMap[name].amt += rowAmt;
      });
    });

    log('  [어드민] 상품=' + Object.keys(prodMap).length + '종, 총액=' + totalAmount.toLocaleString() + '원');
    return { orderCount, prodMap, totalAmount };

  } catch(e) {
    log('  [어드민 오류] ' + e.message);
    try { await adminBrowser.close(); } catch(_) {}
    adminBrowser = null; adminPage = null; adminLoginTime = 0;
    return { orderCount, prodMap: {}, totalAmount: 0 };
  }
}

// ── 곳간 Puppeteer ────────────────────────────────────────────────────────
let fgBrowser = null, fgPage = null, fgLoginTime = 0;

async function ensureFgBrowser() {
  if (fgBrowser && fgBrowser.isConnected()) return;
  log('  [곳간] 새 브라우저 시작');
  fgBrowser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--lang=ko-KR','--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  fgPage = await fgBrowser.newPage();
  fgPage.on('dialog', d => d.accept().catch(() => {}));
  await fgPage.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins',   { get: () => [1,2,3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR','ko','en-US'] });
  });
  await fgPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
}

async function fgLogin() {
  await ensureFgBrowser();
  log('  [곳간] 로그인 시작');
  await fgPage.goto(FG_LOGIN, { waitUntil: 'networkidle2', timeout: 20000 });
  try { await fgPage.waitForSelector('input[name="userId"]', { timeout: 5000 }); } catch(e) {}
  const idEl = await fgPage.$('input[name="userId"]');
  const pwEl = await fgPage.$('input[name="password"]');
  if (idEl && pwEl) {
    await idEl.click({ clickCount: 3 }); await fgPage.keyboard.type(FG_ID);
    await pwEl.click({ clickCount: 3 }); await fgPage.keyboard.type(FG_PW);
  }
  await sleep(300);
  const btn = await fgPage.$('button[type="submit"], input[type="submit"]').catch(() => null);
  if (btn) {
    await Promise.all([fgPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}), btn.click()]);
  } else if (pwEl) {
    log('  [곳간] 버튼 못찾음 → Enter');
    await Promise.all([fgPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}), pwEl.press('Enter')]);
  }
  for (let i = 0; i < 8; i++) { await sleep(1000); if (!fgPage.url().includes('Login')) break; }
  log('  [곳간] 로그인 URL: ' + fgPage.url());
  fgLoginTime = Date.now();
}

async function ensureFgLogin() {
  if (Date.now() - fgLoginTime < 25*60*1000 && fgBrowser && fgBrowser.isConnected()) return;
  await fgLogin();
}

async function getGotganOrders() {
  await ensureFgLogin();
  try {
    await fgPage.goto(FG_URL + '/NewOrder/deal01?order_status=20&formtype=C&pagesize=1000',
      { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(1500);
    if (fgPage.url().includes('Login')) {
      fgLoginTime = 0; await fgLogin();
      await fgPage.goto(FG_URL + '/NewOrder/deal01?order_status=20&formtype=C&pagesize=1000',
        { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(1500);
    }
    const html = await fgPage.content();
    const orderNums = new Set();
    for (const m of html.matchAll(/PJM[A-Z0-9-]+/g)) orderNums.add(m[0]);
    log('  [곳간] PJM ' + orderNums.size + '개');
    const result = await fgPage.evaluate(function() {
      var map = {}; var total = 0;
      var rows = document.querySelectorAll('table tbody tr');
      rows.forEach(function(row) {
        var cells = Array.from(row.querySelectorAll('td'))
          .map(function(td) { return (td.innerText || td.textContent || '').replace(/s+/g, ' ').trim(); });
        if (cells.length < 6) return;
        var prodCell = cells[5] || '';
        var parts = prodCell.split('/');
        if (parts.length < 2) return;
        var name = parts[0].trim();
        var qtyM = parts[1].match(/(d+)/);
        if (!qtyM) return;
        var qty = parseInt(qtyM[1]);
        name = name.replace(/s*([^)]{15,})s*/g, ' ').trim();
        name = name.replace(/^[ds[]()·,]+/, '').trim();
        if (name.length < 2 || qty <= 0 || qty >= 1000) return;
        if (/후불|납품|취소|주문번호/.test(name)) return;
        var amtCell = cells[6] || '';
        var amt = 0;
        var nums = amtCell.replace(/,/g, '').match(/d{4,8}/g);
        if (nums) nums.forEach(function(n) { var v = parseInt(n); if (v > amt && v < 10000000) amt = v; });
        if (!map[name]) map[name] = { qty: 0, amt: 0 };
        map[name].qty += qty;
        map[name].amt += amt;
        total += amt;
      });
      var firstRow = document.querySelector('table tbody tr');
      var debugCells = firstRow ? Array.from(firstRow.querySelectorAll('td')).map(function(td, i) {
        return i + ': "' + (td.innerText || '').replace(/s+/g, ' ').trim().slice(0, 60) + '"';
      }) : ['없음'];
      return { map: map, total: total, debugCells: debugCells, rowCount: rows.length };
    });
    log('  [곳간] 행=' + result.rowCount + ', 상품=' + Object.keys(result.map).length + '종, 총액=' + result.total.toLocaleString() + '원');
    if (result.debugCells) log('  [곳간 cells] ' + result.debugCells.slice(0,6).join(' | '));
    return { orderCount: orderNums.size, prodMap: result.map, totalAmount: result.total };
  } catch(e) {
    log('  [곳간 오류] ' + e.message);
    try { await fgBrowser.close(); } catch(_) {}
    fgBrowser = null; fgPage = null; fgLoginTime = 0;
    return { orderCount: 0, prodMap: {}, totalAmount: 0 };
  }
}

// ── 메시지 포맷 ───────────────────────────────────────────────────────────
function formatSection(title, data) {
  var oc      = data.orderCount;
  var prodMap = data.prodMap;
  var totalAmt= data.totalAmount;
  var entries = Object.entries(prodMap)
    .map(function(e) { return [e[0], typeof e[1] === 'object' ? e[1] : { qty: e[1], amt: 0 }]; })
    .filter(function(e) { return e[1].qty > 0; })
    .sort(function(a,b) { return b[1].qty - a[1].qty; });
  var total   = totalAmt || entries.reduce(function(s,e) { return s + (e[1].amt||0); }, 0);
  var totStr  = total > 0 ? '  💰 총액: <b>' + total.toLocaleString() + '원</b>
' : '';
  var msg     = title + '
총 주문: <b>' + oc + '건</b>
' + totStr;
  if (entries.length > 0) {
    msg += '
📦 상품별 수량
';
    entries.slice(0,15).forEach(function(e) {
      var amtStr = e[1].amt > 0 ? ' (' + e[1].amt.toLocaleString() + '원)' : '';
      msg += '  • ' + e[0] + ' <b>' + e[1].qty + '개</b>' + amtStr + '
';
    });
  } else {
    msg += '  (상품 정보 없음)
';
  }
  return msg;
}

// ── 명령 처리 ─────────────────────────────────────────────────────────────
var busy = false;

async function handleCommand(cmd, chatId) {
  log('처리: ' + cmd);

  if (cmd === '/명령어리스트' || cmd === '명령어리스트') {
    await tgSend(
      '<b>📋 동네곳간 주문현황봇</b>
' +
      '─────────────────────
' +
      '/주문건확인  📊 어드민+곳간 통합
' +
      '/주문출력    🖨 곳간 주문 엑셀 출력
' +
      '/승인상태    ✅ 자동승인 상태
' +
      '/명령어리스트 📋 명령어 안내
' +
      '─────────────────────
' +
      '슬래시(/) 없이도 동작', chatId);
    return;
  }

  if (cmd === '/승인상태' || cmd === '승인상태') {
    await tgSend('✅ gotgan-approve: 30초마다 인증대기 자동 승인 실행 중', chatId);
    return;
  }

  if (cmd === '/주문출력' || cmd === '주문출력') {
    await tgSend('🖨 곳간 주문 엑셀 출력 시작... (약 30초 소요)', chatId);
    (async function() {
      var dlBrowser = null;
      try {
        var os2       = require('os');
        var DOWNLOADS = require('path').join(os2.homedir(), 'Downloads');
        var FG_BASE   = 'https://dongnaegotgan.flexgate.co.kr';
        var FG_INTRO  = 'https://intro.flexgate.co.kr';
        dlBrowser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox','--disable-setuid-sandbox'],
          defaultViewport: { width: 1440, height: 900 },
        });
        var dlPage = await dlBrowser.newPage();
        dlPage.on('dialog', function(d) { d.accept().catch(function(){}); });
        var cdp = await dlPage.createCDPSession();
        await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
        await dlPage.evaluateOnNewDocument(function() { Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } }); });
        await dlPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await dlPage.goto(FG_INTRO + '/Mypage/Login', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(1500);
        var idEl2 = await dlPage.$('input[name="userId"]');
        var pwEl2 = await dlPage.$('input[name="password"]');
        if (idEl2) { await idEl2.click({ clickCount: 3 }); await idEl2.type(FG_ID); }
        if (pwEl2) { await pwEl2.click({ clickCount: 3 }); await pwEl2.type(FG_PW); }
        await sleep(500);
        await Promise.all([
          dlPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(function(){}),
          pwEl2 ? pwEl2.press('Enter') : Promise.resolve(),
        ]);
        await sleep(2000);
        if (!dlPage.url().includes('dongnaegotgan.flexgate.co.kr')) {
          await dlBrowser.close(); await tgSend('❌ 곳간 로그인 실패.', chatId); return;
        }
        await dlPage.goto(FG_BASE + '/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000',
          { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(2000);
        await dlPage.waitForFunction(function() { return document.querySelectorAll('input[name="chk"]').length > 0; },
          { timeout: 15000, polling: 500 }).catch(function(){});
        var cnt = await dlPage.evaluate(function() { return document.querySelectorAll('input[name="chk"]').length; });
        if (cnt === 0) { await dlBrowser.close(); await tgSend('📭 배송준비 주문 없음.', chatId); return; }
        await dlPage.evaluate(function() {
          document.getElementById('chkCheckDataAll').click();
          document.getElementById('customexcelFrm').value = '94';
        });
        await sleep(500);
        var createPromise = dlPage.waitForResponse(function(r) { return r.url().includes('CreateExcelIfile'); }, { timeout: 30000 }).catch(function() { return null; });
        await dlPage.evaluate(function() { orderExcelDownload(3); });
        var fileName = null;
        var respR = await createPromise;
        if (respR) {
          var text2 = await respR.text().catch(function() { return ''; });
          var mm = text2.match(/order_d+.xlsx/);
          if (mm) fileName = mm[0];
          else { try { fileName = JSON.parse(text2).fileName || ''; } catch(e2) {} }
        }
        if (!fileName) { await dlBrowser.close(); await tgSend('❌ 파일 생성 실패.', chatId); return; }
        await sleep(2000);
        await dlPage.goto(FG_BASE + '/NewOrder/ExcelDownload?fileName=' + encodeURIComponent(fileName),
          { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function(){});
        await sleep(5000);
        await dlBrowser.close();
        await tgSend('✅ 주문 엑셀 다운로드 완료! (' + cnt + '건)
자동 출력 처리 중..', chatId);
      } catch(e2) {
        if (dlBrowser) await dlBrowser.close().catch(function(){});
        await tgSend('❌ 주문출력 오류: ' + e2.message, chatId);
      }
    })();
    return;
  }

  if (cmd === '/주문건확인' || cmd === '주문건확인') {
    if (busy) { await tgSend('⏳ 조회 중입니다...', chatId); return; }
    busy = true;
    var now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    var msgId = await tgSendId(
      '🔍 주문 현황 조회 중...
🏪 어드민 도매몰 조회 중
🛒 동네곳간 조회 중
잠시만 기다려 주세요 ⏳',
      chatId
    );
    try {
      log('통합 주문건 조회...');
      var results = await Promise.allSettled([getAdminOrders(), getGotganOrders()]);
      var aD = results[0].status === 'fulfilled' ? results[0].value : null;
      var fD = results[1].status === 'fulfilled' ? results[1].value : null;
      var msg = '<b>📊 주문현황</b>  ' + now + '
' + '─'.repeat(20) + '

';
      msg += aD ? formatSection('🏪 <b>[어드민] 도매몰</b>', aD) : '🏪 어드민 조회 실패
';
      msg += '
';
      msg += fD ? formatSection('🛒 <b>[곳간] 동네곳간</b>', fD) : '🛒 곳간 조회 실패
';
      var adminTotal  = (aD && aD.totalAmount) ? aD.totalAmount : 0;
      var gotganTotal = (fD && fD.totalAmount) ? fD.totalAmount : 0;
      var grandTotal  = adminTotal + gotganTotal;
      if (grandTotal > 0) {
        msg += '
' + '─'.repeat(20) + '
';
        msg += '💎 <b>합산 총액: ' + grandTotal.toLocaleString() + '원</b>
';
        if (adminTotal  > 0) msg += '   도매몰: '   + adminTotal.toLocaleString()  + '원
';
        if (gotganTotal > 0) msg += '   동네곳간: ' + gotganTotal.toLocaleString() + '원
';
      }
      if (msgId) { await tgEdit(chatId, msgId, msg); }
      else        { await tgSend(msg, chatId); }
      log('발송 완료');
    } catch(e) {
      log('오류: ' + e.message);
      await tgSend('❌ 오류: ' + e.message, chatId);
    } finally {
      busy = false;
    }
    return;
  }
}

// ── 폴링 ─────────────────────────────────────────────────────────────────
var lastUpdateId = 0, polling = false;
var CMDS = ['/주문건확인','주문건확인','/주문출력','주문출력','/승인상태','승인상태','/명령어리스트','명령어리스트'];

async function poll() {
  if (polling) return; polling = true;
  try {
    var updates = await tgGetUpdates(lastUpdateId);
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      lastUpdateId = u.update_id + 1;
      var msg2 = u.message || u.edited_message;
      if (!msg2 || !msg2.text) continue;
      var text   = msg2.text.trim().split(' ')[0];
      var chatId = String(msg2.chat.id);
      if (chatId !== TG_CHAT) continue;
      log('수신: "' + text + '"');
      if (CMDS.indexOf(text) >= 0) handleCommand(text, chatId);
    }
  } catch(e) { log('poll 오류: ' + e.message); }
  finally { polling = false; }
}

log('🤖 주문현황 봇 v18');
log('   /주문건확인  /주문출력  /승인상태  /명령어리스트');
setInterval(poll, 3000);
poll();
process.on('SIGINT',  function() { if (adminBrowser) adminBrowser.close(); if (fgBrowser) fgBrowser.close(); process.exit(0); });
process.on('SIGTERM', function() { if (adminBrowser) adminBrowser.close(); if (fgBrowser) fgBrowser.close(); process.exit(0); });

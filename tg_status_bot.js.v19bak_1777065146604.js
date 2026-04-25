'use strict';
/**
 * tg_status_bot.js v19
 * 어드민: evaluate fetch POST to login.chk.php (idtype 값 직접 확인)
 * 곳간:   Puppeteer DOM 파싱
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const https     = require('https');
const puppeteer = require('puppeteer');

const TG_TOKEN   = process.env.TG_TOKEN || '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT    = process.env.TG_CHAT  || '6097520392';
const ADMIN_HOST = 'dongnaegotgan.adminplus.co.kr';
const ADMIN_URL  = 'https://' + ADMIN_HOST + '/admin/';
const ADMIN_LOGIN= 'https://' + ADMIN_HOST + '/admin/login.html?rtnurl=%2Fadmin%2F';
const ADMIN_ID   = process.env.ADMIN_ID || 'dongnaegotgan';
const ADMIN_PW   = process.env.ADMIN_PW || 'rhtrks12!@';
const FG_URL     = 'https://dongnaegotgan.flexgate.co.kr';
const FG_LOGIN   = 'https://intro.flexgate.co.kr/Mypage/Login';
const FG_ID      = process.env.FG_ID || 'dongnaegotgan';
const FG_PW      = process.env.FG_PW || 'rhtrks12!@';

function log(m) { console.log('[' + new Date().toLocaleTimeString('ko-KR') + '] ' + m); }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// TG ----------------------------------------------------------------
function tgPost(p, b) {
  return new Promise(function(res, rej) {
    var buf = Buffer.from(JSON.stringify(b));
    var r = https.request({ hostname: 'api.telegram.org', path: '/bot' + TG_TOKEN + p,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length }
    }, function(resp) { var d = ''; resp.on('data', function(c) { d += c; }); resp.on('end', function() { try { res(JSON.parse(d)); } catch(e) { res({}); } }); });
    r.on('error', rej); r.write(buf); r.end();
  });
}
async function tgSend(msg, chatId, n) {
  chatId = chatId || TG_CHAT; n = n || 3;
  for (var i = 0; i < n; i++) {
    try { await tgPost('/sendMessage', { chat_id: chatId, text: msg, parse_mode: 'HTML' }); return; }
    catch(e) { log('tgSend err[' + i + ']: ' + e.message); if (i < n-1) await sleep(2000); }
  }
}
async function tgSendId(msg, chatId) {
  try { var r = await tgPost('/sendMessage', { chat_id: chatId || TG_CHAT, text: msg, parse_mode: 'HTML' }); return r.result && r.result.message_id ? r.result.message_id : null; }
  catch(e) { return null; }
}
async function tgEdit(chatId, msgId, text) {
  try { await tgPost('/editMessageText', { chat_id: chatId, message_id: msgId, text: text, parse_mode: 'HTML' }); }
  catch(e) { log('tgEdit err: ' + e.message); }
}
async function tgGetUpdates(offset) {
  return new Promise(function(res) {
    var r = https.request({ hostname: 'api.telegram.org',
      path: '/bot' + TG_TOKEN + '/getUpdates?offset=' + offset + '&timeout=20&limit=10', method: 'GET'
    }, function(resp) { var d = ''; resp.on('data', function(c) { d += c; }); resp.on('end', function() { try { var j = JSON.parse(d); res(j.ok ? j.result : []); } catch(e) { res([]); } }); });
    r.on('error', function() { res([]); }); r.end();
  });
}

// ADMIN Puppeteer ---------------------------------------------------
var adminBrowser = null, adminPage = null, adminLoginTime = 0;

async function ensureAdminBrowser() {
  if (adminBrowser && adminBrowser.isConnected()) return;
  log('  [admin] browser start');
  adminBrowser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });
  adminPage = await adminBrowser.newPage();
  adminPage.on('dialog', function(d) { d.accept().catch(function(){}); });
  await adminPage.evaluateOnNewDocument(function() {
    Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } });
    window.chrome = { runtime: {} };
  });
  await adminPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
}

async function adminLogin() {
  await ensureAdminBrowser();
  log('  [admin] login start');

  // 1. 로그인 페이지 로드 (쿠키, 세션 초기화용)
  await adminPage.goto(ADMIN_LOGIN, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(1500);

  // 2. idtype 라디오 실제 값 확인
  var radioInfo = await adminPage.evaluate(function() {
    var radios = document.querySelectorAll('input[name="idtype"]');
    return Array.from(radios).map(function(r) { return { value: r.value, checked: r.checked }; });
  });
  log('  [admin] idtype radios: ' + JSON.stringify(radioInfo));

  // 3. 첫번째 라디오 값으로 fetch POST (브라우저 컨텍스트 - 쿠키 자동 포함)
  var idtypeVal = (radioInfo[0] && radioInfo[0].value) ? radioInfo[0].value : 'M';
  log('  [admin] idtype value: ' + idtypeVal);

  var loginResult = await adminPage.evaluate(async function(id, pw, idtype) {
    try {
      var body = new URLSearchParams({
        rtnurl: '/admin/',
        rejoin: '',
        idtype: idtype,
        admid: id,
        admpwd: pw,
        saveid: 'N'
      });
      var resp = await fetch('/admin/login.chk.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'follow',
        credentials: 'include'
      });
      return { ok: resp.ok, status: resp.status, url: resp.url };
    } catch(e) {
      return { ok: false, err: e.message };
    }
  }, ADMIN_ID, ADMIN_PW, idtypeVal);
  log('  [admin] fetch POST result: ' + JSON.stringify(loginResult));

  // 4. /admin/ 으로 이동해서 로그인 유지 확인
  await adminPage.goto(ADMIN_URL, { waitUntil: 'networkidle2', timeout: 15000 }).catch(function(){});
  await sleep(500);

  var finalUrl = adminPage.url();
  var cookies  = await adminPage.cookies();
  log('  [admin] final URL: ' + finalUrl);
  log('  [admin] cookies: ' + cookies.map(function(c) { return c.name; }).join(', '));

  if (finalUrl.includes('login')) {
    // idtype 두번째 값도 시도
    if (radioInfo[1]) {
      var idtypeVal2 = radioInfo[1].value || 'S';
      log('  [admin] 2nd idtype try: ' + idtypeVal2);
      await adminPage.evaluate(async function(id, pw, idtype) {
        var body = new URLSearchParams({ rtnurl: '/admin/', rejoin: '', idtype: idtype, admid: id, admpwd: pw, saveid: 'N' });
        await fetch('/admin/login.chk.php', { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(), redirect: 'follow', credentials: 'include'
        });
      }, ADMIN_ID, ADMIN_PW, idtypeVal2);
      await adminPage.goto(ADMIN_URL, { waitUntil: 'networkidle2', timeout: 15000 }).catch(function(){});
      await sleep(500);
      finalUrl = adminPage.url();
    }
  }

  if (finalUrl.includes('login')) {
    log('  [admin] LOGIN FAILED');
    adminLoginTime = 0;
    return false;
  }
  log('  [admin] LOGIN OK');
  adminLoginTime = Date.now();
  return true;
}

async function ensureAdminLogin() {
  if (Date.now() - adminLoginTime < 20*60*1000 && adminBrowser && adminBrowser.isConnected()) return true;
  return await adminLogin();
}

async function getAdminOrders() {
  var orderCount = 0;
  var ok = await ensureAdminLogin();

  // stats (로그인 불필요)
  try {
    var sr = await adminPage.evaluate(async function() {
      var r = await fetch('/admin/xml/real.stats.json.php', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: '' });
      return await r.json();
    });
    orderCount = parseInt(sr.spnNew5) || 0;
    log('  [admin stats] new=' + sr.spnNew5 + ' today=' + sr.spnNew8);
  } catch(e) { log('  [admin stats err] ' + e.message); }

  if (!ok) return { orderCount: orderCount, prodMap: {}, totalAmount: 0 };

  var todayKST = new Date(Date.now() + 9*60*60*1000).toISOString().slice(0, 10);

  // waitForResponse: 주문 페이지 navigate하면서 XHR 인터셉트
  try {
    var xhrPromise = adminPage.waitForResponse(
      function(resp) { return resp.url().includes('od.list.bd.php'); },
      { timeout: 20000 }
    ).catch(function() { return null; });

    await adminPage.goto(ADMIN_URL + 'order/?order_status=10', { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(1000);

    var xhrResp = await xhrPromise;
    var rows = [];

    if (xhrResp) {
      try { var json = await xhrResp.json(); rows = json.rows || []; log('  [admin] XHR rows=' + rows.length); }
      catch(e) { log('  [admin] XHR parse err: ' + e.message); }
    }

    if (!rows.length) {
      // fallback: evaluate fetch
      var params = new URLSearchParams({
        proc: 'json', mod: 'order', actpage: 'od.list.bd',
        status: '10', datefld: 'b.regdate',
        sdate: JSON.stringify({ start: todayKST, end: todayKST }),
        bizgrp: 'all', searchtype: 'all', searchval: '',
        _search: 'false', rows: '500', page: '1', sidx: 'regdate', sord: 'desc'
      });
      var fbData = await adminPage.evaluate(async function(qs) {
        try {
          var r = await fetch('/admin/order/json/od.list.bd.php?' + qs, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
          return await r.json();
        } catch(e) { return { rows: [], err: e.message }; }
      }, params.toString());
      rows = fbData.rows || [];
      log('  [admin] fallback fetch rows=' + rows.length + (fbData.err ? ' err=' + fbData.err : ''));
    }

    if (!orderCount) orderCount = rows.length;

    var prodMap = {}, totalAmount = 0;
    rows.forEach(function(row) {
      var cell = Array.isArray(row.cell) ? row.cell : [];
      var rowAmt = 0;
      cell.forEach(function(c) {
        if (typeof c !== 'string') return;
        var clean = c.replace(/<[^>]+>/g, '').replace(/,/g, '').trim();
        var m = clean.match(/(\d{4,8})\s*\uC6D0$/);
        if (m) { var v = parseInt(m[1]); if (v >= 1000 && v > rowAmt) rowAmt = v; }
      });
      totalAmount += rowAmt;
      cell.forEach(function(c) {
        if (typeof c !== 'string') return;
        var text  = c.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        var parts = text.split('\u00B7')[0].trim().split('/');
        if (parts.length < 2) return;
        var name = parts[0].trim();
        var qtyM = parts[1].match(/(\d+)/);
        if (!qtyM) return;
        var qty = parseInt(qtyM[1]);
        name = name.replace(/\s*\([^)]{10,}\)\s*/g, ' ').trim();
        name = name.replace(/^[\d\s\[\]()]+/, '').trim();
        if (name.length < 2 || qty <= 0 || qty >= 1000) return;
        if (/\uD6C4\uBD88|\uB0A9\uD488|PJM|\uCDE8\uC18C|\uBC30\uC1A1/.test(name)) return;
        if (!prodMap[name]) prodMap[name] = { qty: 0, amt: 0 };
        prodMap[name].qty += qty;
        prodMap[name].amt += rowAmt;
      });
    });
    log('  [admin] prod=' + Object.keys(prodMap).length + ' total=' + totalAmount);
    return { orderCount: orderCount, prodMap: prodMap, totalAmount: totalAmount };
  } catch(e) {
    log('  [admin err] ' + e.message);
    try { await adminBrowser.close(); } catch(_) {}
    adminBrowser = null; adminPage = null; adminLoginTime = 0;
    return { orderCount: orderCount, prodMap: {}, totalAmount: 0 };
  }
}

// GOTGAN Puppeteer --------------------------------------------------
var fgBrowser = null, fgPage = null, fgLoginTime = 0;

async function ensureFgBrowser() {
  if (fgBrowser && fgBrowser.isConnected()) return;
  log('  [gotgan] browser start');
  fgBrowser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--lang=ko-KR','--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  fgPage = await fgBrowser.newPage();
  fgPage.on('dialog', function(d) { d.accept().catch(function(){}); });
  await fgPage.evaluateOnNewDocument(function() {
    Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins',   { get: function() { return [1,2,3]; } });
    Object.defineProperty(navigator, 'languages', { get: function() { return ['ko-KR','ko','en-US']; } });
  });
  await fgPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
}

async function fgLogin() {
  await ensureFgBrowser();
  log('  [gotgan] login start');
  await fgPage.goto(FG_LOGIN, { waitUntil: 'networkidle2', timeout: 20000 });
  try { await fgPage.waitForSelector('input[name="userId"]', { timeout: 5000 }); } catch(e) {}
  var idEl = await fgPage.$('input[name="userId"]');
  var pwEl = await fgPage.$('input[name="password"]');
  if (idEl && pwEl) {
    await idEl.click({ clickCount: 3 }); await fgPage.keyboard.type(FG_ID);
    await pwEl.click({ clickCount: 3 }); await fgPage.keyboard.type(FG_PW);
  }
  await sleep(300);
  var btn = await fgPage.$('button[type="submit"],input[type="submit"]').catch(function(){return null;});
  if (btn) {
    await Promise.all([ fgPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(function(){}), btn.click() ]);
  } else if (pwEl) {
    log('  [gotgan] no btn -> Enter');
    await Promise.all([ fgPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(function(){}), pwEl.press('Enter') ]);
  }
  for (var i = 0; i < 8; i++) { await sleep(1000); if (!fgPage.url().includes('Login')) break; }
  log('  [gotgan] login URL: ' + fgPage.url());
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
    var html = await fgPage.content();
    var orderNums = new Set();
    var mm;
    var re = /PJM[A-Z0-9-]+/g;
    while ((mm = re.exec(html)) !== null) orderNums.add(mm[0]);
    log('  [gotgan] PJM ' + orderNums.size);
    var result = await fgPage.evaluate(function() {
      var map = {}; var total = 0;
      var rows = document.querySelectorAll('table tbody tr');
      rows.forEach(function(row) {
        var cells = Array.from(row.querySelectorAll('td')).map(function(td) { return (td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim(); });
        if (cells.length < 6) return;
        var prodCell = cells[5] || '';
        var parts = prodCell.split('/');
        if (parts.length < 2) return;
        var name = parts[0].trim();
        var qtyM = parts[1].match(/(\d+)/);
        if (!qtyM) return;
        var qty = parseInt(qtyM[1]);
        name = name.replace(/\s*\([^)]{15,}\)\s*/g, ' ').trim();
        name = name.replace(/^[\d\s\[\]()\u00B7,]+/, '').trim();
        if (name.length < 2 || qty <= 0 || qty >= 1000) return;
        if (/\uD6C4\uBD88|\uB0A9\uD488|\uCDE8\uC18C/.test(name)) return;
        var amtCell = cells[6] || '';
        var amt = 0;
        var nums = amtCell.replace(/,/g, '').match(/\d{4,8}/g);
        if (nums) nums.forEach(function(n) { var v = parseInt(n); if (v > amt && v < 10000000) amt = v; });
        if (!map[name]) map[name] = { qty: 0, amt: 0 };
        map[name].qty += qty; map[name].amt += amt; total += amt;
      });
      var firstRow = document.querySelector('table tbody tr');
      var dbg = firstRow ? Array.from(firstRow.querySelectorAll('td')).map(function(td, i) {
        return i + ': "' + (td.innerText||'').replace(/\s+/g,' ').trim().slice(0,60) + '"';
      }) : ['none'];
      return { map: map, total: total, dbg: dbg, cnt: rows.length };
    });
    log('  [gotgan] rows=' + result.cnt + ' prod=' + Object.keys(result.map).length + ' total=' + result.total);
    log('  [gotgan cells] ' + result.dbg.slice(0,6).join(' | '));
    return { orderCount: orderNums.size, prodMap: result.map, totalAmount: result.total };
  } catch(e) {
    log('  [gotgan err] ' + e.message);
    try { await fgBrowser.close(); } catch(_) {}
    fgBrowser = null; fgPage = null; fgLoginTime = 0;
    return { orderCount: 0, prodMap: {}, totalAmount: 0 };
  }
}

// FORMAT -----------------------------------------------------------
function fmt(title, data) {
  var oc = data.orderCount, pm = data.prodMap, ta = data.totalAmount;
  var entries = Object.keys(pm).map(function(n) {
    var v = typeof pm[n] === 'object' ? pm[n] : { qty: pm[n], amt: 0 };
    return [n, v];
  }).filter(function(e) { return e[1].qty > 0; })
    .sort(function(a,b) { return b[1].qty - a[1].qty; });
  var total = ta || entries.reduce(function(s,e) { return s + (e[1].amt||0); }, 0);
  var totStr = total > 0 ? '  [총액] <b>' + total.toLocaleString() + '\uC6D0</b>\n' : '';
  var msg = title + '\n\uCD1D \uC8FC\uBB38: <b>' + oc + '\uAC74</b>\n' + totStr;
  if (entries.length > 0) {
    msg += '\n[\uC0C1\uD488\uBCC4 \uC218\uB7C9]\n';
    entries.slice(0,15).forEach(function(e) {
      var amtStr = e[1].amt > 0 ? ' (' + e[1].amt.toLocaleString() + '\uC6D0)' : '';
      msg += '  - ' + e[0] + ' <b>' + e[1].qty + '\uAC1C</b>' + amtStr + '\n';
    });
  } else { msg += '  (\uC0C1\uD488 \uC815\uBCF4 \uC5C6\uC74C)\n'; }
  return msg;
}

// CMD ---------------------------------------------------------------
var busy = false;
async function handleCommand(cmd, chatId) {
  log('cmd: ' + cmd);
  if (cmd === '/\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8' || cmd === '\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8') {
    await tgSend('<b>[\uB3D9\uB124\uACE3\uAC04 \uC8FC\uBB38\uD604\uD669\uBD07]</b>\n' +
      '/\uC8FC\uBB38\uAC74\uD655\uC778  \uC5B4\uB4DC\uBBFC+\uACE3\uAC04 \uD1B5\uD569\n' +
      '/\uC8FC\uBB38\uCD9C\uB825    \uACE3\uAC04 \uC5D1\uC140 \uCD9C\uB825\n' +
      '/\uC2B9\uC778\uC0C1\uD0DC    \uC790\uB3D9\uC2B9\uC778 \uC0C1\uD0DC\n' +
      '/\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8 \uBA85\uB839\uC5B4 \uC548\uB0B4\n' +
      '/\uC5C6\uC774 \uD14D\uC2A4\uD2B8\uB85C\uB3C4 \uB3D9\uC791', chatId);
    return;
  }
  if (cmd === '/\uC2B9\uC778\uC0C1\uD0DC' || cmd === '\uC2B9\uC778\uC0C1\uD0DC') {
    await tgSend('gotgan-approve: 30\uCD08\uB9C8\uB2E4 \uC778\uC99D\uB300\uAE30 \uC790\uB3D9\uC2B9\uC778 \uC2E4\uD589 \uC911', chatId);
    return;
  }
  if (cmd === '/\uC8FC\uBB38\uCD9C\uB825' || cmd === '\uC8FC\uBB38\uCD9C\uB825') {
    await tgSend('\uACE3\uAC04 \uC8FC\uBB38 \uC5D1\uC140 \uCD9C\uB825 \uC2DC\uC791... (\uC57D 30\uCD08 \uC18C\uC694)', chatId);
    (async function() {
      var dlBr = null;
      try {
        var os2 = require('os'), DLPATH = require('path').join(os2.homedir(), 'Downloads');
        var FB = 'https://dongnaegotgan.flexgate.co.kr', FI = 'https://intro.flexgate.co.kr';
        dlBr = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'], defaultViewport: { width: 1440, height: 900 } });
        var dlPage = await dlBr.newPage();
        dlPage.on('dialog', function(d) { d.accept().catch(function(){}); });
        var cdp = await dlPage.createCDPSession();
        await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DLPATH });
        await dlPage.evaluateOnNewDocument(function() { Object.defineProperty(navigator, 'webdriver', { get: function(){ return false; } }); });
        await dlPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await dlPage.goto(FI + '/Mypage/Login', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(1500);
        var ie = await dlPage.$('input[name="userId"]'), pe = await dlPage.$('input[name="password"]');
        if (ie) { await ie.click({clickCount:3}); await ie.type(FG_ID); }
        if (pe) { await pe.click({clickCount:3}); await pe.type(FG_PW); }
        await sleep(500);
        await Promise.all([ dlPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(function(){}), pe ? pe.press('Enter') : Promise.resolve() ]);
        await sleep(2000);
        if (!dlPage.url().includes('dongnaegotgan.flexgate.co.kr')) { await dlBr.close(); await tgSend('\uACE3\uAC04 \uB85C\uADF8\uC778 \uC2E4\uD328', chatId); return; }
        await dlPage.goto(FB + '/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(2000);
        await dlPage.waitForFunction(function() { return document.querySelectorAll('input[name="chk"]').length > 0; }, { timeout: 15000, polling: 500 }).catch(function(){});
        var cnt = await dlPage.evaluate(function() { return document.querySelectorAll('input[name="chk"]').length; });
        if (cnt === 0) { await dlBr.close(); await tgSend('\uBC30\uC1A1\uC900\uBE44 \uC8FC\uBB38 \uC5C6\uC74C', chatId); return; }
        await dlPage.evaluate(function() { document.getElementById('chkCheckDataAll').click(); document.getElementById('customexcelFrm').value = '94'; });
        await sleep(500);
        var cp = dlPage.waitForResponse(function(r) { return r.url().includes('CreateExcelIfile'); }, { timeout: 30000 }).catch(function(){ return null; });
        await dlPage.evaluate(function() { orderExcelDownload(3); });
        var fn = null, respR = await cp;
        if (respR) { var tx = await respR.text().catch(function(){ return ''; }); var mx = tx.match(/order_\d+\.xlsx/); if (mx) fn = mx[0]; else { try { fn = JSON.parse(tx).fileName || ''; } catch(e){} } }
        if (!fn) { await dlBr.close(); await tgSend('\uD30C\uC77C \uC0DD\uC131 \uC2E4\uD328', chatId); return; }
        await sleep(2000);
        await dlPage.goto(FB + '/NewOrder/ExcelDownload?fileName=' + encodeURIComponent(fn), { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function(){});
        await sleep(5000);
        await dlBr.close();
        await tgSend('\uC8FC\uBB38 \uC5D1\uC140 \uB2E4\uC6B4\uB85C\uB4DC \uC644\uB8CC! (' + cnt + '\uAC74)\n\uC790\uB3D9 \uCD9C\uB825 \uCC98\uB9AC \uC911..', chatId);
      } catch(e) { if (dlBr) await dlBr.close().catch(function(){}); await tgSend('\uCD9C\uB825 \uC624\uB958: ' + e.message, chatId); }
    })();
    return;
  }
  if (cmd === '/\uC8FC\uBB38\uAC74\uD655\uC778' || cmd === '\uC8FC\uBB38\uAC74\uD655\uC778') {
    if (busy) { await tgSend('\uC870\uD68C \uC911\uC785\uB2C8\uB2E4...', chatId); return; }
    busy = true;
    var now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    var mid = await tgSendId('[\uC8FC\uBB38\uD604\uD669 \uC870\uD68C \uC911...]\n\uC5B4\uB4DC\uBBFC \uB3C4\uB9E4\uBAB0 \uC870\uD68C \uC911\n\uB3D9\uB124\uACE3\uAC04 \uC870\uD68C \uC911\n\uC7A0\uC2DC\uB9CC \uAE30\uB2E4\uB824 \uC8FC\uC138\uC694', chatId);
    try {
      var results = await Promise.allSettled([getAdminOrders(), getGotganOrders()]);
      var aD = results[0].status === 'fulfilled' ? results[0].value : null;
      var fD = results[1].status === 'fulfilled' ? results[1].value : null;
      var msg = '<b>[\uC8FC\uBB38\uD604\uD669]</b>  ' + now + '\n' + '—'.repeat(18) + '\n\n';
      msg += aD ? fmt('<b>[\uC5B4\uB4DC\uBBFC] \uB3C4\uB9E4\uBAB0</b>', aD) : '\uC5B4\uB4DC\uBBFC \uC870\uD68C \uC2E4\uD328\n';
      msg += '\n';
      msg += fD ? fmt('<b>[\uACE3\uAC04] \uB3D9\uB124\uACE3\uAC04</b>', fD) : '\uACE3\uAC04 \uC870\uD68C \uC2E4\uD328\n';
      var at = (aD && aD.totalAmount) ? aD.totalAmount : 0;
      var ft = (fD && fD.totalAmount) ? fD.totalAmount : 0;
      if (at + ft > 0) {
        msg += '\n' + '—'.repeat(18) + '\n';
        msg += '<b>[\uD569\uC0B0 \uCD1D\uC561: ' + (at+ft).toLocaleString() + '\uC6D0]</b>\n';
        if (at > 0) msg += '  \uB3C4\uB9E4\uBAB0: ' + at.toLocaleString() + '\uC6D0\n';
        if (ft > 0) msg += '  \uB3D9\uB124\uACE3\uAC04: ' + ft.toLocaleString() + '\uC6D0\n';
      }
      if (mid) { await tgEdit(chatId, mid, msg); } else { await tgSend(msg, chatId); }
      log('send ok');
    } catch(e) { log('err: ' + e.message); await tgSend('\uC624\uB958: ' + e.message, chatId); }
    finally { busy = false; }
    return;
  }
}

// POLL -------------------------------------------------------------
var lastUpdateId = 0, polling = false;
var CMDS = [
  '/\uC8FC\uBB38\uAC74\uD655\uC778', '\uC8FC\uBB38\uAC74\uD655\uC778',
  '/\uC8FC\uBB38\uCD9C\uB825',   '\uC8FC\uBB38\uCD9C\uB825',
  '/\uC2B9\uC778\uC0C1\uD0DC',   '\uC2B9\uC778\uC0C1\uD0DC',
  '/\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8','\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8'
];
async function poll() {
  if (polling) return; polling = true;
  try {
    var updates = await tgGetUpdates(lastUpdateId);
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i]; lastUpdateId = u.update_id + 1;
      var msg2 = u.message || u.edited_message;
      if (!msg2 || !msg2.text) continue;
      var text = msg2.text.trim().split(' ')[0];
      var chatId = String(msg2.chat.id);
      if (chatId !== TG_CHAT) continue;
      log('recv: "' + text + '"');
      if (CMDS.indexOf(text) >= 0) handleCommand(text, chatId);
    }
  } catch(e) { log('poll err: ' + e.message); }
  finally { polling = false; }
}

log('[v19] admin fetch-POST login + XHR intercept');
log('  /\uC8FC\uBB38\uAC74\uD655\uC778  /\uC8FC\uBB38\uCD9C\uB825  /\uC2B9\uC778\uC0C1\uD0DC  /\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8');
setInterval(poll, 3000);
poll();
process.on('SIGINT',  function() { if (adminBrowser) adminBrowser.close(); if (fgBrowser) fgBrowser.close(); process.exit(0); });
process.on('SIGTERM', function() { if (adminBrowser) adminBrowser.close(); if (fgBrowser) fgBrowser.close(); process.exit(0); });
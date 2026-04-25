/**
 * tg_status_bot.js v14
 * 명령어: /주문건확인  /주문출력  /승인상태  /명령어리스트
 * - 어드민: Puppeteer 로그인
 * - tgSend: 재시도 3회
 * - 곳간:   split("/") 파싱
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const https     = require('https');
const puppeteer = require('puppeteer');

const TG_TOKEN    = process.env.TG_TOKEN || '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT     = process.env.TG_CHAT  || '6097520392';
const ADMIN_HOST  = 'dongnaegotgan.adminplus.co.kr';
const ADMIN_URL   = 'https://' + ADMIN_HOST + '/admin/';
const ADMIN_LOGIN = 'https://' + ADMIN_HOST + '/admin/login.html';
const ADMIN_ID    = process.env.ADMIN_ID || 'dongnaegotgan';
const ADMIN_PW    = process.env.ADMIN_PW || 'rhtrks12!@';
const FG_BASE     = 'https://dongnaegotgan.flexgate.co.kr';
const FG_LOGIN    = 'https://intro.flexgate.co.kr/Mypage/Login';
const FG_ID       = process.env.FG_ID || 'dongnaegotgan';
const FG_PW       = process.env.FG_PW || 'rhtrks12!@';

function log(m) { console.log('[' + new Date().toLocaleTimeString('ko-KR') + '] ' + m); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── tgSend 재시도 3회 ───────────────────────────────────────────
async function tgSend(msg, chatId, retry) {
  chatId = chatId || TG_CHAT;
  retry  = (retry === undefined) ? 3 : retry;
  var body = JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "HTML" });
  for (var i = 0; i < retry; i++) {
    try {
      await new Promise(function(resolve, reject) {
        var req = https.request({
          hostname: 'api.telegram.org',
          path: '/bot' + TG_TOKEN + '/sendMessage',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, function(res) {
          var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ resolve(d); });
        });
        req.on("error", reject);
        req.write(body); req.end();
      });
      return;
    } catch(e) {
      log('tgSend 오류 (' + (i+1) + '/' + retry + '): ' + e.message);
      if (i < retry - 1) await sleep(2000);
    }
  }
}

async function tgGetUpdates(offset) {
  return new Promise(function(resolve) {
    var req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + TG_TOKEN + '/getUpdates?offset=' + offset + '&timeout=20&limit=10',
      method: 'GET'
    }, function(res) {
      var d = ''; res.on('data', function(c){ d += c; });
      res.on("end", function() {
        try { var j = JSON.parse(d); resolve(j.ok ? j.result : []); }
        catch(e) { resolve([]); }
      });
    });
    req.on("error", function(){ resolve([]); });
    req.end();
  });
}

// ── 공유 브라우저 ───────────────────────────────────────────────
var browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  log('브라우저 시작...');
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--lang=ko-KR',
           '--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true
  });
  return browser;
}

// ── 어드민 Puppeteer ────────────────────────────────────────────
var adminPage = null, adminLoginTime = 0;

async function adminLogin() {
  var b = await getBrowser();
  if (!adminPage || adminPage.isClosed()) {
    adminPage = await b.newPage();
    adminPage.on("dialog", function(d){ d.accept().catch(function(){}); });
    await adminPage.evaluateOnNewDocument(function() {
      Object.defineProperty(navigator, "webdriver", { get: function(){ return false; } });
    });
    await adminPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  }
  log('  [어드민] 로그인 시작...');
  await adminPage.goto(ADMIN_LOGIN, { waitUntil: "networkidle2", timeout: 20000 });
  await sleep(500);

  // 폼 필드 탐색 (id/pw 또는 userId/password)
  var idSelectors = ['input[name="admid"], input[name="id"]','input[name="userId"]','#id','#userId'];
  var pwSelectors = ['input[name="pw"]','input[name="password"]','#pw','#password'];
  var idEl = null, pwEl = null;
  for (var si = 0; si < idSelectors.length; si++) {
    idEl = await adminPage.$(idSelectors[si]).catch(function(){ return null; });
    if (idEl) break;
  }
  for (var si2 = 0; si2 < pwSelectors.length; si2++) {
    pwEl = await adminPage.$(pwSelectors[si2]).catch(function(){ return null; });
    if (pwEl) break;
  }

  if (!idEl || !pwEl) {
    var inputs = await adminPage.evaluate(function() {
      return Array.from(document.querySelectorAll("input")).map(function(i){ return i.name+"/"+i.type; });
    });
    log('  [어드민] 폼 필드 못찾음: ' + JSON.stringify(inputs));
    return false;
  }

  await idEl.click({ clickCount: 3 }); await adminPage.keyboard.type(ADMIN_ID);
  await pwEl.click({ clickCount: 3 }); await adminPage.keyboard.type(ADMIN_PW);
  await sleep(300);

  var loginBtn = await adminPage.$('button[type="submit"],input[type="submit"],.btn-login').catch(function(){ return null; });
  if (loginBtn) {
    await Promise.all([
      adminPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function(){}),
      loginBtn.click()
    ]);
  } else {
    await Promise.all([
      adminPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function(){}),
      pwEl.press("Enter")
    ]);
  }

  for (var wi = 0; wi < 5; wi++) {
    await sleep(1000);
    var u = adminPage.url();
    if (u.indexOf("login") === -1 && u.indexOf("Login") === -1) break;
  }

  var afterUrl = adminPage.url();
  log('  [어드민] 로그인 후 URL: ' + afterUrl);
  if (afterUrl.indexOf("login") !== -1 || afterUrl.indexOf("Login") !== -1) {
    log('  [어드민] 로그인 실패');
    return false;
  }
  adminLoginTime = Date.now();
  log('  [어드민] 로그인 성공!');
  return true;
}

async function ensureAdmin() {
  if (Date.now() - adminLoginTime < 20*60*1000 && adminPage && !adminPage.isClosed()) return true;
  return await adminLogin();
}

async function getAdminOrders() {
  var ok = await ensureAdmin();
  if (!ok) return { orderCount: 0, prodMap: {}, totalAmount: 0 };

  var orderCount = 0, prodMap = {}, totalAmount = 0;
  try {
    // stats (신규주문 건수)
    var statsData = await adminPage.evaluate(async function(baseUrl) {
      try {
        var r = await fetch(baseUrl + "xml/real.stats.json.php", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
          body: ""
        });
        return await r.json();
      } catch(e) { return null; }
    }, ADMIN_URL);

    if (statsData && statsData.spnNew5) {
      orderCount = parseInt(statsData.spnNew5) || 0;
      log('  [어드민 stats] 신규=' + statsData.spnNew5 + ', 오늘=' + statsData.spnNew8);
    }

    // 주문 목록 JSON API (로그인된 브라우저 컨텍스트에서 호출)
    var todayKST = new Date(Date.now() + 9*60*60*1000).toISOString().slice(0,10);
    var sdateVal = JSON.stringify({ start: todayKST, end: todayKST });
    var qp = "proc=json&mod=order&actpage=od.list.bd"
           + "&status=10&datefld=b.regdate"
           + "&sdate=" + encodeURIComponent(sdateVal)
           + "&bizgrp=all&searchtype=all&searchval="
           + "&_search=false&rows=500&page=1&sidx=regdate&sord=desc";

    var listData = await adminPage.evaluate(async function(baseUrl, qs) {
      try {
        var r = await fetch(baseUrl + "order/json/od.list.bd.php?" + qs, {
          method: "GET",
          headers: { "X-Requested-With": "XMLHttpRequest" }
        });
        var txt = await r.text();
        // 로그인 페이지로 리다이렉트된 경우
        if (txt.indexOf("userId") !== -1 || txt.indexOf("login") !== -1) {
          return { __loginRequired: true };
        }
        return JSON.parse(txt);
      } catch(e) { return { __error: e.message, rows: [] }; }
    }, ADMIN_URL, qp);

    if (listData && listData.__loginRequired) {
      log('  [어드민] 세션 만료 → 재로그인');
      adminLoginTime = 0;
      var reOk = await adminLogin();
      if (!reOk) return { orderCount: orderCount, prodMap: prodMap, totalAmount: totalAmount };
      // 재시도
      listData = await adminPage.evaluate(async function(baseUrl, qs) {
        try {
          var r = await fetch(baseUrl + "order/json/od.list.bd.php?" + qs, {
            method: "GET",
            headers: { "X-Requested-With": "XMLHttpRequest" }
          });
          return JSON.parse(await r.text());
        } catch(e) { return { rows: [] }; }
      }, ADMIN_URL, qp);
    }

    if (listData && listData.__error) {
      log('  [어드민 목록 오류] ' + listData.__error);
    }

    var rows = (listData && listData.rows) ? listData.rows : [];
    var records = parseInt((listData && listData.records) || rows.length) || 0;
    log('  [어드민] rows=' + rows.length + ', records=' + records);
    if (!orderCount) orderCount = records;

    rows.forEach(function(row, ri) {
      var cell = Array.isArray(row.cell) ? row.cell : [];
      if (ri === 0) log('  [어드민 cell샘플] ' + JSON.stringify(cell).slice(0,150));

      // 금액 파싱
      var rowAmt = 0;
      cell.forEach(function(c) {
        if (typeof c !== "string") return;
        var clean = c.replace(/<[^>]+>/g,"").replace(/,/g,"").trim();
        var m = clean.match(/(\d{4,8})\s*원$/);
        if (m) { var v = parseInt(m[1]); if (v >= 1000 && v > rowAmt) rowAmt = v; }
      });
      totalAmount += rowAmt;

      // 상품명/수량 파싱 — split("/") 방식
      cell.forEach(function(c) {
        if (typeof c !== "string") return;
        var text = c.replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();
        if (text.indexOf("/") === -1) return;
        var parts = text.split("/");
        var namePart = parts[0].trim();
        var qtyMatch = parts[1] && parts[1].match(/^\s*(\d+)\s*개/);
        if (!qtyMatch) return;
        var qty = parseInt(qtyMatch[1]);
        var name = namePart.replace(/\([^)]*\)/g,"").replace(/\s+/g," ").trim();
        if (name.length < 2 || name.length > 50 || qty <= 0 || qty >= 1000) return;
        if (/배송비|배송|PJM|취소|주문번호/.test(name)) return;
        if (!prodMap[name]) prodMap[name] = { qty: 0, amt: 0 };
        prodMap[name].qty += qty;
        prodMap[name].amt += rowAmt;
      });
    });
  } catch(e) {
    log('  [어드민 오류] ' + e.message);
  }
  return { orderCount: orderCount, prodMap: prodMap, totalAmount: totalAmount };
}

// ── 곳간 Puppeteer ──────────────────────────────────────────────
var fgPage = null, fgLoginTime = 0;

async function fgLogin() {
  var b = await getBrowser();
  if (!fgPage || fgPage.isClosed()) {
    fgPage = await b.newPage();
    fgPage.on("dialog", function(d){ d.accept().catch(function(){}); });
    await fgPage.evaluateOnNewDocument(function() {
      Object.defineProperty(navigator, "webdriver", { get: function(){ return false; } });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, "plugins", { get: function(){ return [1,2,3]; } });
      Object.defineProperty(navigator, "languages", { get: function(){ return ["ko-KR","ko","en-US"]; } });
    });
    await fgPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  }
  log('  [곳간] 로그인 시작...');
  await fgPage.goto(FG_LOGIN, { waitUntil: "networkidle2", timeout: 20000 });
  try { await fgPage.waitForSelector('input[name="userId"]', { timeout: 5000 }); } catch(e) {}

  var idEl = await fgPage.$('input[name="userId"]');
  var pwEl = await fgPage.$('input[name="password"]');
  if (idEl && pwEl) {
    await idEl.click({ clickCount: 3 }); await fgPage.keyboard.type(FG_ID);
    await pwEl.click({ clickCount: 3 }); await fgPage.keyboard.type(FG_PW);
  }
  await sleep(300);
  var loginBtn = await fgPage.$('button[type="submit"],input[type="submit"]').catch(function(){ return null; });
  if (loginBtn) {
    await Promise.all([
      fgPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function(){}),
      loginBtn.click()
    ]);
  } else if (pwEl) {
    log('  [곳간] 버튼 못찾음 → Enter');
    await Promise.all([
      fgPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function(){}),
      pwEl.press("Enter")
    ]);
  }
  for (var i = 0; i < 8; i++) {
    await sleep(1000);
    if (fgPage.url().indexOf("Login") === -1) break;
  }
  log('  [곳간] 로그인 URL: ' + fgPage.url());
  fgLoginTime = Date.now();
}

async function ensureFgLogin() {
  if (Date.now() - fgLoginTime < 25*60*1000 && fgPage && !fgPage.isClosed()) return;
  await fgLogin();
}

async function getGotganOrders() {
  await ensureFgLogin();
  try {
    await fgPage.goto(FG_BASE + '/NewOrder/deal01?order_status=20&formtype=C&pagesize=1000',
      { waitUntil: "networkidle2", timeout: 15000 });
    await sleep(1500);

    if (fgPage.url().indexOf("Login") !== -1) {
      log('  [곳간] 세션 만료 → 재로그인');
      fgLoginTime = 0; await fgLogin();
      await fgPage.goto(FG_BASE + '/NewOrder/deal01?order_status=20&formtype=C&pagesize=1000',
        { waitUntil: "networkidle2", timeout: 15000 });
      await sleep(1500);
    }

    var html = await fgPage.content();
    var orderNums = new Set();
    var pjmRe = /PJM[A-Z0-9-]+/g, pm;
    while ((pm = pjmRe.exec(html)) !== null) orderNums.add(pm[0]);
    log('  [곳간] PJM 주문번호 ' + orderNums.size + '개');

    var result = await fgPage.evaluate(function() {
      var map = {}, total = 0;
      var rows = document.querySelectorAll("table tbody tr");
      var debugCells = [];

      rows.forEach(function(row, ri) {
        var cells = Array.from(row.querySelectorAll("td")).map(function(td) {
          return (td.innerText || td.textContent || "").replace(/\s+/g," ").trim();
        });
        if (ri === 0) {
          cells.slice(0,8).forEach(function(c,i){
            debugCells.push(i + ": \"" + c.slice(0,60) + "\"");
          });
        }
        if (cells.length < 6) return;
        var prodCell = cells[5] || "";
        if (!prodCell || prodCell.indexOf("/") === -1) return;

        // split("/") 방식 파싱
        var parts = prodCell.split("/");
        var name = parts[0].trim();
        var qtyPart = parts[1] || "";
        var qtyMatch = qtyPart.match(/(\d+)/);
        if (!qtyMatch) return;
        var qty = parseInt(qtyMatch[1]);

        // 긴 괄호 제거, 앞쪽 숫자/특수문자 제거
        name = name.replace(/\s*\([^)]{15,}\)\s*/g," ").trim();
        name = name.replace(/^[\d\s\[\]\(\)\·,]+/,"").trim();
        if (name.length < 2 || qty <= 0 || qty >= 1000) return;
        if (/배송|취소|결제|주문번호/.test(name)) return;

        // 금액 파싱 (cells[6])
        var amtCell = cells[6] || "";
        var amt = 0;
        var amtRe = /(\d{1,3}(?:,\d{3})+|\d{4,8})\s*원/g, am;
        while ((am = amtRe.exec(amtCell)) !== null) {
          var v = parseInt(am[1].replace(/,/g,""));
          if (v > amt && v < 10000000) amt = v;
        }

        if (!map[name]) map[name] = { qty: 0, amt: 0 };
        map[name].qty += qty;
        map[name].amt += amt;
        total += amt;
      });

      return { map: map, total: total, debugCells: debugCells, rowCount: rows.length };
    });

    log('  [곳간] tbody tr 수: ' + result.rowCount);
    if (result.debugCells.length) {
      log('  [곳간 cells] ' + result.debugCells.slice(0,7).join(' | '));
    }
    log('  [곳간] 상품 ' + Object.keys(result.map).length + '종, 총액 ' + result.total.toLocaleString() + '원');
    return { orderCount: orderNums.size, prodMap: result.map, totalAmount: result.total };

  } catch(e) {
    log('  [곳간 오류] ' + e.message);
    fgPage = null; fgLoginTime = 0;
    return { orderCount: 0, prodMap: {}, totalAmount: 0 };
  }
}

// ── 메시지 포맷 ──────────────────────────────────────────────────
function formatSection(title, data) {
  var orderCount  = data.orderCount  || 0;
  var prodMap     = data.prodMap     || {};
  var totalAmount = data.totalAmount || 0;
  var entries = Object.entries(prodMap)
    .map(function(pair) {
      var v = typeof pair[1] === "object" ? pair[1] : { qty: pair[1], amt: 0 };
      return [pair[0], v];
    })
    .filter(function(pair){ return pair[1].qty > 0; })
    .sort(function(a,b){ return b[1].qty - a[1].qty; });
  var total = totalAmount || entries.reduce(function(s,p){ return s + (p[1].amt||0); }, 0);
  var msg = title + "\n총 주문: <b>" + orderCount + "건</b>\n";
  if (total > 0) msg += "\uD83D\uDCB0 소계: <b>" + total.toLocaleString() + "원</b>\n";
  if (entries.length > 0) {
    msg += "\n\uD83D\uDCE6 상품별 수량\n";
    entries.slice(0,15).forEach(function(pair) {
      var n = pair[0], v = pair[1];
      var amtStr = v.amt > 0 ? " (" + v.amt.toLocaleString() + "원)" : "";
      msg += "\u2022 " + n + " <b>" + v.qty + "개</b>" + amtStr + "\n";
    });
  } else {
    msg += "  (상품 정보 없음)\n";
  }
  return msg;
}

// ── 명령 처리 ────────────────────────────────────────────────────
var busy = false;

async function handleCommand(cmd, chatId) {
  log('처리: ' + cmd);

  // /명령어리스트
  if (cmd === "/명령어리스트" || cmd === "명령어리스트") {
    await tgSend(
      "\uD83D\uDCCB <b>동네곳간 주문현황봇 명령어</b>\n"
      + "\u2500".repeat(22) + "\n"
      + "/주문건확인  \u2192 어드민+곳간 통합 현황\n"
      + "/주문출력    \u2192 곳간 주문 엑셀 출력\n"
      + "/승인상태    \u2192 자동승인 봇 상태\n"
      + "/명령어리스트 \u2192 이 목록\n"
      + "\u2500".repeat(22) + "\n"
      + "\uD83D\uDCA1 슬래시(/) 없이도 동작",
      chatId
    );
    return;
  }

  // /승인상태
  if (cmd === "/승인상태" || cmd === "승인상태") {
    await tgSend("\uD83D\uDFE2 gotgan-approve: 30초마다 인증대기 자동 승인 실행 중", chatId);
    return;
  }

  // /주문출력
  if (cmd === "/주문출력" || cmd === "주문출력") {
    await tgSend("\uD83D\uDDA8\uFE0F 곳간 주문 출력 시작... (약 30초 소요)", chatId);
    (async function() {
      var dlPage = null;
      try {
        var b2 = await getBrowser();
        dlPage = await b2.newPage();
        dlPage.on("dialog", function(d){ d.accept().catch(function(){}); });
        var cdp = await dlPage.createCDPSession();
        await cdp.send("Page.setDownloadBehavior", {
          behavior: "allow",
          downloadPath: require("path").join(require("os").homedir(), "Downloads")
        });
        await dlPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await dlPage.goto(FG_LOGIN, { waitUntil: "domcontentloaded", timeout: 20000 });
        await sleep(1500);
        var dId = await dlPage.$('input[name="userId"]');
        var dPw = await dlPage.$('input[name="password"]');
        if (dId) { await dId.click({ clickCount:3 }); await dId.type(FG_ID); }
        if (dPw) { await dPw.click({ clickCount:3 }); await dPw.type(FG_PW); }
        await sleep(500);
        await Promise.all([
          dlPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function(){}),
          dPw ? dPw.press("Enter") : Promise.resolve()
        ]);
        await sleep(2000);
        if (dlPage.url().indexOf("dongnaegotgan.flexgate.co.kr") === -1) {
          await dlPage.close();
          await tgSend("\u274C 곳간 로그인 실패.", chatId); return;
        }
        await dlPage.goto(FG_BASE + '/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000',
          { waitUntil: "networkidle2", timeout: 30000 });
        await sleep(2000);
        await dlPage.waitForFunction(
          function(){ return document.querySelectorAll("input[name=\"chk\"]").length > 0; },
          { timeout: 15000, polling: 500 }
        ).catch(function(){});
        var cnt = await dlPage.evaluate(function(){
          return document.querySelectorAll("input[name=\"chk\"]").length;
        });
        if (cnt === 0) {
          await dlPage.close();
          await tgSend("\uD83D\uDCED 배송준비 주문이 없습니다.", chatId); return;
        }
        await dlPage.evaluate(function() {
          document.getElementById("chkCheckDataAll").click();
          document.getElementById("customexcelFrm").value = "94";
        });
        await sleep(500);
        var createPromise = dlPage.waitForResponse(
          function(r){ return r.url().indexOf("CreateExcelIfile") !== -1; },
          { timeout: 30000 }
        ).catch(function(){ return null; });
        await dlPage.evaluate(function(){ orderExcelDownload(3); });
        var fileName = null;
        var cRes = await createPromise;
        if (cRes) {
          var txt = await cRes.text().catch(function(){ return ""; });
          var fm = txt.match(/order_\d+\.xlsx/);
          if (fm) fileName = fm[0];
          else { try { fileName = JSON.parse(txt).fileName || ""; } catch(e) {} }
        }
        if (!fileName) {
          await dlPage.close();
          await tgSend("\u274C 파일 생성 실패.", chatId); return;
        }
        await sleep(2000);
        await dlPage.goto(FG_BASE + '/NewOrder/ExcelDownload?fileName=' + encodeURIComponent(fileName),
          { waitUntil: "domcontentloaded", timeout: 20000 }).catch(function(){});
        await sleep(5000);
        await dlPage.close();
        await tgSend("\u2705 주문 엑셀 다운로드 완료! (" + cnt + "건)\n자동 출력 처리 중..", chatId);
      } catch(e) {
        if (dlPage) await dlPage.close().catch(function(){});
        await tgSend("\u274C 주문출력 오류: " + e.message, chatId);
      }
    })();
    return;
  }

  // /주문건확인
  if (cmd === "/주문건확인" || cmd === "주문건확인") {
    if (busy) { await tgSend("\u23F3 조회 중입니다...", chatId); return; }
    busy = true;
    try {
      var now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      log('통합 주문건 조회...');
      await tgSend("\uD83D\uDD0D 조회 중..", chatId);
      var results = await Promise.allSettled([getAdminOrders(), getGotganOrders()]);
      var aD = results[0].status === "fulfilled" ? results[0].value : null;
      var fD = results[1].status === "fulfilled" ? results[1].value : null;

      var msg = "\uD83D\uDCCA <b>주문현황</b>  " + now + "\n" + "\u2500".repeat(22) + "\n\n";
      msg += aD ? formatSection("\uD83C\uDFEA <b>[어드민] 도매몰</b>", aD) : "\uD83C\uDFEA 어드민 조회 실패\n";
      msg += "\n";
      msg += fD ? formatSection("\uD83D\uDED2 <b>[곳간] 동네곳간</b>", fD)     : "\uD83D\uDED2 곳간 조회 실패\n";

      var adminTotal  = (aD && aD.totalAmount) ? aD.totalAmount : 0;
      var gotganTotal = (fD && fD.totalAmount) ? fD.totalAmount : 0;
      var grandTotal  = adminTotal + gotganTotal;
      if (grandTotal > 0) {
        msg += "\n" + "\u2500".repeat(22) + "\n";
        msg += "\uD83D\uDCB5 <b>합산 총액: " + grandTotal.toLocaleString() + "원</b>\n";
        if (adminTotal  > 0) msg += "   어드민: " + adminTotal.toLocaleString()  + "원\n";
        if (gotganTotal > 0) msg += "   곳간: "   + gotganTotal.toLocaleString() + "원\n";
      }
      await tgSend(msg, chatId);
      log('발송 완료');
    } catch(e) {
      log('오류: ' + e.message);
      await tgSend("\u274C 오류: " + e.message, chatId);
    } finally {
      busy = false;
    }
    return;
  }
}

// ── 폴링 ─────────────────────────────────────────────────────────
var lastUpdateId = 0, polling = false;
var CMDS = [
  "/주문건확인","주문건확인",
  "/주문출력",  "주문출력",
  "/승인상태",  "승인상태",
  "/명령어리스트","명령어리스트"
];

async function poll() {
  if (polling) return; polling = true;
  try {
    var updates = await tgGetUpdates(lastUpdateId);
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      lastUpdateId = u.update_id + 1;
      var msg = u.message || u.edited_message;
      if (!msg || !msg.text) continue;
      var text   = msg.text.trim().split(" ")[0];
      var chatId = String(msg.chat.id);
      if (chatId !== TG_CHAT) continue;
      log('수신: "' + text + '"');
      if (CMDS.indexOf(text) !== -1) handleCommand(text, chatId);
    }
  } catch(e) { log('poll 오류: ' + e.message); }
  finally { polling = false; }
}

log('\uD83E\uDD16 주문현황 봇 v14');
log('   /주문건확인  /주문출력  /승인상태  /명령어리스트');
setInterval(poll, 3000);
poll();
process.on("SIGINT",  function(){ if (browser) browser.close(); process.exit(0); });
process.on("SIGTERM", function(){ if (browser) browser.close(); process.exit(0); });
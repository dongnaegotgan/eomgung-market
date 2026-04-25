/**
 * auto_approve_watch.js - 인증대기 자동 승인 감시 (Puppeteer 방식)
 * 30초마다 체크, 인증대기 발견 시 즉시 승인 + 텔레그램 알림
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ADMIN_URL = 'https://dongnaegotgan.adminplus.co.kr/admin/';
const ID  = process.env.ADMIN_ID || 'dongnaegotgan';
const PW  = process.env.ADMIN_PW || 'rhtrks12!@';
const TG_TOKEN = '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT  = '6097520392';
const CHECK_INTERVAL_MS = 30 * 1000;

let checkCount = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function logMsg(msg) {
  const line = `[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ${msg}`;
  console.log(line);
}

async function tg(msg) {
  try {
    const body = JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML' });
    await new Promise(r => {
      const req = require('https').request({
        hostname: 'api.telegram.org',
        path: `/bot${TG_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => { res.on('data', () => {}); res.on('end', r); });
      req.on('error', r); req.write(body); req.end();
    });
  } catch(e) {}
}

async function login(page) {
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  const idEl = await page.$('input[name="id"]') || await page.$('input[type="text"]');
  if (idEl) { await idEl.click({ clickCount: 3 }); await idEl.type(ID); }
  const pwEl = await page.$('input[type="password"]');
  if (pwEl) { await pwEl.click({ clickCount: 3 }); await pwEl.type(PW); }
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
    page.keyboard.press('Enter'),
  ]);
  await sleep(2000);
}

async function fetchPendingList(page) {
  const result = await page.evaluate(async () => {
    const params = new URLSearchParams({
      mod: 'bizpartner', actpage: 'bp.list1',
      datefld: 'a.regdate',
      sdate: JSON.stringify({ start: '', end: '' }),
      pstate: 'all', bizgrp: 'all', bizcate: 'all', searchval: '',
      _search: 'false', nd: String(Date.now()),
      rows: '100', page: '1',
      sidx: 'idx', sord: 'desc'
    });
    try {
      const res = await fetch(`/admin/bizpartner/json/bp.list1.php?${params}`);
      const data = await res.json();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  if (!result.ok) {
    logMsg(`  API 오류: ${result.error}`);
    return [];
  }

  const rows = result.data?.rows || [];
  const total = result.data?.records || 0;

  const pending = rows.filter(row => {
    const cell = Array.isArray(row.cell) ? row.cell : [];
    const rowStr = JSON.stringify(row);
    if (String(cell[2]) === '2') return true;
    if (rowStr.includes('인증대기') || rowStr.includes('승인대기')) return true;
    if (String(cell[2]) === '0' || String(cell[2]) === 'false') return true;
    return false;
  }).map(row => {
    const cell = Array.isArray(row.cell) ? row.cell : [];
    const idx = row.id || cell[0];
    const rawName = cell.find(c => c && typeof c === 'string' && c.includes('<b>')) || '';
    const name = rawName.replace(/<[^>]+>/g, '').trim() || `idx_${idx}`;
    return { idx: String(idx), name };
  });

  if (checkCount <= 3 && rows.length > 0) {
    const sample = rows[0];
    const cell = Array.isArray(sample.cell) ? sample.cell : [];
    logMsg(`  [디버그] 샘플 cell[0]=${cell[0]}, cell[2]=${cell[2]}, cell[3]=${cell[3]}`);
  }

  logMsg(`  체크 #${checkCount} — 전체 ${total}건, 인증대기 ${pending.length}건`);
  return pending;
}

async function approveOne(page, idx, name) {
  await page.evaluate((i) => {
    if (typeof modbizPartner === 'function') modbizPartner(String(i));
  }, idx);

  let loaded = false;
  for (let w = 0; w < 30; w++) {
    await sleep(300);
    loaded = await page.evaluate(() =>
      document.querySelector('input[name="bizgrp"]') !== null ||
      document.body.innerText.includes('수정하기')
    );
    if (loaded) break;
  }
  if (!loaded) {
    logMsg(`  건너뜀 ${name}: 팝업 로딩 실패`);
    return false;
  }

  await page.evaluate(() => {
    const r = document.querySelector('input[type="radio"][name="bizgrp"][value="1"]');
    if (r && !r.checked) r.click();
  });
  await sleep(150);
  await page.evaluate(() => {
    const r = document.querySelector('input[type="radio"][name="bzaccountstate"][value="1"]');
    if (r && !r.checked) r.click();
  });
  await sleep(150);
  await page.evaluate(() => {
    const r = document.querySelector('input[type="radio"][name="bizstate"][value="1"]');
    if (r && !r.checked) r.click();
  });
  await sleep(150);

  const saved = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, input[type="submit"]')];
    const btn = btns.find(b => (b.textContent || b.value || '').trim() === '수정하기');
    if (btn) { btn.click(); return true; }
    return false;
  });

  await sleep(2000);
  return saved;
}

let isRunning = false;
let browser = null;
let page = null;

async function doCheck() {
  if (isRunning) return;
  isRunning = true;
  checkCount++;

  try {
    if (!browser || !browser.isConnected()) {
      logMsg('🔑 브라우저 시작 및 로그인...');
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ko-KR'],
        defaultViewport: { width: 1440, height: 900 },
      });
      page = await browser.newPage();
      page.on('dialog', async d => await d.accept());
      await login(page);
      logMsg('✅ 로그인 완료');

      await page.evaluate(() => {
        const all = [...document.querySelectorAll('li, a, div, span')];
        const m = all.find(el => el.textContent.trim() === '거래처관리');
        if (m) m.click();
      });
      await sleep(800);
      await page.evaluate(() => {
        const all = [...document.querySelectorAll('li, a, div, span')];
        const m = all.find(el => el.textContent.trim() === '매출거래처');
        if (m) m.click();
      });
      await sleep(3000);
    }

    const pending = await fetchPendingList(page);

    if (pending.length === 0) {
      if (checkCount % 10 === 1) {
        logMsg('✅ 인증대기 없음 (정상 감시 중)');
      }
      return;
    }

    logMsg(`🔔 인증대기 ${pending.length}개 발견! 자동 승인 시작...`);
    await tg(`🔔 <b>[어드민] 인증대기 ${pending.length}개 발견!</b>\n${new Date().toLocaleString('ko-KR')}\n\n처리 시작...`);

    const success = [];
    const fail = [];

    for (const { idx, name } of pending) {
      logMsg(`  처리 중: ${name} (idx:${idx})`);
      const ok = await approveOne(page, idx, name);
      if (ok) {
        logMsg(`  ✅ ${name}: 승인 완료`);
        success.push(name);
      } else {
        logMsg(`  ❌ ${name}: 승인 실패`);
        fail.push(name);
      }
      await page.evaluate(() => {
        const all = [...document.querySelectorAll('li, a, div, span')];
        const m = all.find(el => el.textContent.trim() === '매출거래처');
        if (m) m.click();
      });
      await sleep(2500);
    }

    const now = new Date().toLocaleString('ko-KR');
    let msg = '';
    if (success.length > 0) {
      msg = `✅ <b>[어드민] 인증대기 승인 완료!</b>\n${now}\n\n`;
      msg += `✅ 승인 완료: ${success.length}개\n`;
      success.forEach(n => { msg += `  - ${n}\n`; });
      if (fail.length > 0) {
        msg += `\n❌ 실패: ${fail.length}개\n`;
        fail.forEach(n => { msg += `  - ${n}\n`; });
      }
    } else {
      msg = `❌ <b>[어드민] 승인 실패</b>\n${now}\n\n`;
      fail.forEach(n => { msg += `  - ${n}\n`; });
    }
    logMsg(msg.replace(/<[^>]+>/g, ''));
    await tg(msg);

  } catch (e) {
    logMsg(`⚠️ 오류: ${e.message}`);
    await tg(`⚠️ <b>[어드민] 오류 발생</b>\n${new Date().toLocaleString('ko-KR')}\n\n${e.message}`);
    try { await browser?.close(); } catch (_) {}
    browser = null;
    page = null;
  } finally {
    isRunning = false;
  }
}

logMsg(`🚀 인증대기 자동 승인 감시 시작 (${CHECK_INTERVAL_MS / 1000}초 간격)`);
doCheck();
const timer = setInterval(doCheck, CHECK_INTERVAL_MS);

process.on('SIGINT', () => { clearInterval(timer); if (browser) browser.close(); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(timer); if (browser) browser.close(); process.exit(0); });

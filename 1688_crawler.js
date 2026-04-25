'use strict';
/**
 * 1688_crawler.js — 동네곳간 1688 서버 크롤러 v1
 * PM2: pm2 start 1688_crawler.js --name gotgan-1688
 *
 * 텔레그램 명령:
 *   /크롤링 S925手链           기본 크롤링
 *   /크롤링 S925手链 필수:GRA  GRA 포함 상품만
 *   /크롤링 S925手链 제외:耳环 귀걸이 제외
 *   /크롤링 S925手链 페이지:3  3페이지만
 *   /시트초기화                자동수집 시트 전체 삭제
 *   /크롤링상태               현재 진행 상황
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const puppeteer = require('puppeteer');
const https     = require('https');
const http      = require('http');

// ── 설정 ─────────────────────────────────────────────────────────────
const TG_TOKEN      = process.env.TG_TOKEN;
const TG_CHAT       = process.env.TG_CHAT;
const WEBAPP_URL    = process.env.SHEET_WEBAPP_URL;
const EXCHANGE_RATE = parseFloat(process.env.EXCHANGE_RATE || '218');
const SUPPLY_RATIO  = parseFloat(process.env.SUPPLY_RATIO  || '1.5');
const MAX_PAGES     = parseInt(process.env.CRAWLER_MAX_PAGES || '5');

// ── 카테고리 자동 태깅 ─────────────────────────────────────────────
const CATEGORY_MAP = [
  { tag: '팔찌', zh: ['手链','手环','手镯','手饰'] },
  { tag: '목걸이', zh: ['项链','颈链','锁骨链','项坠','吊坠'] },
  { tag: '반지', zh: ['戒指','指环','尾戒'] },
  { tag: '귀걸이', zh: ['耳环','耳钉','耳夹','耳坠'] },
  { tag: '브로치', zh: ['胸针','别针'] },
];

function detectCategory(titleZh) {
  for (const cat of CATEGORY_MAP) {
    if (cat.zh.some(kw => titleZh.includes(kw))) return cat.tag;
  }
  return '';
}

// ── 상태 ─────────────────────────────────────────────────────────────
let isCrawling = false;
let crawlStatus = { keyword: '', current: 0, added: 0, total: 0 };
let lastUpdateId = 0;

const log = m => console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── TG 전송 ───────────────────────────────────────────────────────────
function tgSend(msg, chatId) {
  return new Promise(resolve => {
    const cid  = String(chatId || TG_CHAT);
    const body = JSON.stringify({ chat_id: cid, text: msg, parse_mode: 'HTML' });
    const req  = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

// ── TG Polling ────────────────────────────────────────────────────────
function tgPoll() {
  return new Promise(resolve => {
    const path = `/bot${TG_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=8`;
    https.get({ hostname: 'api.telegram.org', path }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ ok: false, result: [] }); }
      });
    }).on('error', () => resolve({ ok: false, result: [] }));
  });
}

// ── 구글 시트 전송 (기존 앱스크립트 doPost 형식) ─────────────────────
function sendToSheet(payload) {
  return new Promise(resolve => {
    if (!WEBAPP_URL) return resolve({ ok: false, error: 'WEBAPP_URL 미설정' });
    const body = JSON.stringify(payload);
    const url  = new URL(WEBAPP_URL);
    const mod  = url.protocol === 'https:' ? https : http;
    const req  = mod.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ ok: true, raw }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body); req.end();
  });
}

// ── 1688 크롤링 ───────────────────────────────────────────────────────
async function crawl(opts) {
  const { keyword, mustKeywords, excludeKeywords, maxPages, chatId } = opts;
  isCrawling = true;
  crawlStatus = { keyword, current: 0, added: 0, total: maxPages * 48 };

  log(`[크롤링] 시작: "${keyword}" | 필수:${mustKeywords} | 제외:${excludeKeywords}`);
  await tgSend(
    `🔍 <b>크롤링 시작!</b>\n검색어: <code>${keyword}</code>\n` +
    (mustKeywords.length ? `필수키워드: ${mustKeywords.join(', ')}\n` : '') +
    (excludeKeywords.length ? `제외키워드: ${excludeKeywords.join(', ')}\n` : '') +
    `최대 ${maxPages}페이지 수집`,
    chatId
  );

  let browser = null;
  const collected = [];

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--lang=zh-CN'],
      defaultViewport: { width: 1280, height: 900 }
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36'
    );
    page.on('dialog', d => d.accept().catch(() => {}));

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}&n=y&tab=selleroffer` +
                  (pageNum > 1 ? `&beginPage=${pageNum}` : '');
      log(`[크롤링] 페이지 ${pageNum}/${maxPages}...`);

      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
        await sleep(3000);

        const items = await page.evaluate(() => {
          const res = [];
          const cards = document.querySelectorAll(
            '.space-offer-card-box, .offer-list-row-offer, [class*="offer-item"], [class*="offeritem"]'
          );
          cards.forEach(card => {
            try {
              const titleEl = card.querySelector('[class*="title"], .title, h3');
              const titleZh = titleEl ? titleEl.innerText.trim() : '';
              if (!titleZh || titleZh.length < 3) return;

              const priceEl = card.querySelector('[class*="price"], .price');
              const priceText = priceEl ? priceEl.innerText.replace(/[^\d.]/g, '') : '0';
              const cny = parseFloat(priceText) || 0;
              if (cny <= 0) return;

              const linkEl = card.querySelector('a[href*="1688.com"]') || card.closest('a');
              let url = linkEl ? linkEl.href : '';
              if (!url || !url.includes('1688.com')) return;
              url = url.split('?')[0];

              const imgEl = card.querySelector('img');
              const imageUrl = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '';

              res.push({ titleZh, cny, url, imageUrl });
            } catch {}
          });
          return res;
        });

        log(`[크롤링] 페이지 ${pageNum}: ${items.length}개 발견`);

        for (const item of items) {
          crawlStatus.current++;

          // 필수 키워드 체크 (원본 중국어에서)
          if (mustKeywords.length > 0) {
            const ok = mustKeywords.every(kw => item.titleZh.toLowerCase().includes(kw.toLowerCase()));
            if (!ok) continue;
          }

          // 제외 키워드 체크 (원본 중국어에서)
          if (excludeKeywords.length > 0) {
            const bad = excludeKeywords.some(kw => item.titleZh.toLowerCase().includes(kw.toLowerCase()));
            if (bad) continue;
          }

          // 카테고리 자동 태깅
          const category = detectCategory(item.titleZh);
          const design = [
            keyword.toUpperCase().includes('S925') ? 's925' : '',
            category
          ].filter(Boolean).join(' ');

          collected.push({
            no: 0,            // 나중에 번호 부여
            design,
            name: item.titleZh,
            weight: '',
            cny: item.cny,
            url: item.url,
            imageBase64: ''   // URL 방식으로 변경 가능, 현재는 빈 값
          });
          crawlStatus.added++;
        }

      } catch (e) {
        log(`[크롤링] 페이지 ${pageNum} 오류: ${e.message}`);
      }

      if (pageNum < maxPages) await sleep(2500);
    }

    await browser.close(); browser = null;

    if (collected.length === 0) {
      await tgSend('⚠️ 수집된 상품이 없어요. 검색어나 필수키워드를 확인해주세요.', chatId);
      return;
    }

    log(`[크롤링] 총 ${collected.length}개 수집 → 시트 전송 중...`);
    await tgSend(`📦 <b>${collected.length}개 수집 완료!</b>\n구글 시트 저장 중...`, chatId);

    // No. 번호 부여 (서버에서 임시로 부여, 앱스크립트가 재계산)
    collected.forEach((item, i) => { item.no = i + 1; });

    // 50개씩 나눠서 전송
    const CHUNK = 50;
    let totalAdded = 0;
    for (let i = 0; i < collected.length; i += CHUNK) {
      const chunk = collected.slice(i, i + CHUNK);
      const result = await sendToSheet({
        sheetName: '자동수집',
        rate: EXCHANGE_RATE,
        supRate: SUPPLY_RATIO,
        items: chunk
      });
      log(`[시트] 청크 ${Math.floor(i/CHUNK)+1} 결과: ${JSON.stringify(result)}`);
      if (result.ok) totalAdded += (result.count || chunk.length);
      await sleep(1000);
    }

    // 카테고리 통계
    const cats = {};
    collected.forEach(c => {
      const cat = c.design.split(' ').pop() || '기타';
      cats[cat] = (cats[cat] || 0) + 1;
    });
    const catStr = Object.entries(cats).map(([k,v]) => `${k}:${v}개`).join(', ');

    await tgSend(
      `✅ <b>크롤링 완료!</b>\n` +
      `검색어: <code>${keyword}</code>\n` +
      `수집: ${collected.length}개 → 저장: ${totalAdded}개\n` +
      `카테고리: ${catStr}\n` +
      `공급가: ${Math.round(Math.min(...collected.map(c=>c.cny))*EXCHANGE_RATE*SUPPLY_RATIO/10)*10}~` +
      `${Math.round(Math.max(...collected.map(c=>c.cny))*EXCHANGE_RATE*SUPPLY_RATIO/10)*10}원`,
      chatId
    );

  } catch (e) {
    log(`[크롤링] 오류: ${e.message}`);
    if (browser) await browser.close().catch(() => {});
    await tgSend(`⚠️ 크롤링 오류: ${e.message}`, chatId);
  } finally {
    isCrawling = false;
  }
}

// ── 명령 파서 ─────────────────────────────────────────────────────────
function parseCommand(text) {
  const t = text.trim();
  if (t === '/크롤링상태') return { cmd: 'status' };
  if (t === '/시트초기화') return { cmd: 'reset' };
  if (t.startsWith('/크롤링')) {
    const body = t.slice(4).trim();
    const mustMatch    = body.match(/필수:([^\s]+)/);
    const excludeMatch = body.match(/제외:([^\s]+)/);
    const pagesMatch   = body.match(/페이지:(\d+)/);
    const keyword = body
      .replace(/필수:[^\s]+/g, '')
      .replace(/제외:[^\s]+/g, '')
      .replace(/페이지:\d+/g, '')
      .trim();
    return {
      cmd: 'crawl',
      keyword,
      mustKeywords:    mustMatch    ? mustMatch[1].split(',')    : [],
      excludeKeywords: excludeMatch ? excludeMatch[1].split(',') : [],
      maxPages: pagesMatch ? parseInt(pagesMatch[1]) : MAX_PAGES
    };
  }
  return null;
}

// ── 메인 루프 ─────────────────────────────────────────────────────────
async function main() {
  log('[1688 크롤러] 시작');
  log(`  WEBAPP_URL: ${WEBAPP_URL ? '✅ 설정됨' : '❌ 미설정'}`);
  log(`  환율: ${EXCHANGE_RATE}원/위안 | 공급가 배율: ${SUPPLY_RATIO}`);

  await tgSend(
    '🤖 <b>1688 크롤러 시작!</b>\n\n' +
    '<b>사용법:</b>\n' +
    '/크롤링 S925手链 — 팔찌 크롤링\n' +
    '/크롤링 S925项链 — 목걸이 크롤링\n' +
    '/크롤링 S925莫桑石 필수:GRA — GRA 인증만\n' +
    '/크롤링 S925手链 제외:耳环 — 귀걸이 제외\n' +
    '/크롤링 S925手链 페이지:3 — 3페이지만\n' +
    '/시트초기화 — 자동수집 시트 삭제\n' +
    '/크롤링상태 — 진행 확인'
  );

  while (true) {
    try {
      const upd = await tgPoll();
      if (!upd.ok || !upd.result.length) { await sleep(1000); continue; }

      for (const u of upd.result) {
        lastUpdateId = u.update_id;
        const msg = u.message;
        if (!msg?.text) continue;
        const chatId = msg.chat.id;
        const parsed = parseCommand(msg.text);
        if (!parsed) continue;

        log(`[TG] ${chatId}: ${msg.text}`);

        if (parsed.cmd === 'status') {
          await tgSend(
            isCrawling
              ? `🔄 <b>크롤링 중...</b>\n검색어: ${crawlStatus.keyword}\n처리: ${crawlStatus.current}개\n수집: ${crawlStatus.added}개`
              : '✅ 대기 중 (크롤링 없음)',
            chatId
          );
          continue;
        }

        if (parsed.cmd === 'reset') {
          const r = await sendToSheet({ action: 'clearSheet', sheetName: '자동수집' });
          await tgSend(r.ok ? '🗑️ 자동수집 시트 초기화 완료' : `⚠️ 초기화 실패: ${r.error}`, chatId);
          continue;
        }

        if (parsed.cmd === 'crawl') {
          if (isCrawling) {
            await tgSend('⚠️ 이미 크롤링 중! /크롤링상태 로 확인하세요.', chatId);
            continue;
          }
          if (!parsed.keyword) {
            await tgSend('❌ 검색어가 없어요.\n예: /크롤링 S925手链', chatId);
            continue;
          }
          setImmediate(() => crawl({ ...parsed, chatId }));
        }
      }
    } catch (e) {
      log('[루프] 오류: ' + e.message);
    }
    await sleep(1000);
  }
}

main().catch(e => { log('[치명 오류] ' + e.message); process.exit(1); });
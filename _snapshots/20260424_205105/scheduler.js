/**
 * scheduler.js — 자동 알림 스케줄러
 *
 * 스케줄 (KST):
 *   06:00 — 전체 시황 (오늘 vs 7일 평균 비교) → 카카오톡
 *   06:30 — 지정 품목 상세 리포트 → 카카오톡
 *   07:00 — 전날 데이터 DB 저장 + 폭락 알림
 *   08:00 — 전체 시황 2차 (경매 마감 후 최종) → 카카오톡
 */

require('dotenv').config();
const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');
const { saveRecords, buildAndSaveSummary, detectPriceDrop, getRecordCount } = require('./db');

const SERVICE_KEY         = (process.env.AT_SERVICE_KEY      || '').trim();
const KAKAO_APP_KEY       = (process.env.KAKAO_APP_KEY       || '').trim();
const KAKAO_ADMIN_KEY     = (process.env.KAKAO_ADMIN_KEY     || '').trim();
const KAKAO_CLIENT_SECRET = (process.env.KAKAO_CLIENT_SECRET || '').trim();
const KAKAO_REFRESH_TOKEN = (process.env.KAKAO_REFRESH_TOKEN || '').trim();
let   KAKAO_ACCESS_TOKEN  = (process.env.KAKAO_ACCESS_TOKEN  || '').trim();
const KAKAO_USER_ID       = (process.env.KAKAO_USER_ID       || '').trim();
const MIN_QTY             = parseInt(process.env.MIN_QTY || '5', 10);
const DROP_THRESHOLD      = parseFloat(process.env.DROP_THRESHOLD || '15');
const TRACKED_FILE        = path.join(__dirname, 'tracked_items.json');

// ── 지정 품목 관리 ─────────────────────────────────────────────────────
function loadTracked() {
  try {
    if (fs.existsSync(TRACKED_FILE))
      return JSON.parse(fs.readFileSync(TRACKED_FILE, 'utf8'));
  } catch(e) {}
  return ['산딸기', '수박', '딸기'];
}
function saveTracked(items) {
  fs.writeFileSync(TRACKED_FILE, JSON.stringify(items, null, 2));
}
function addTracked(item)    { const l=loadTracked(); if(!l.includes(item)){l.push(item);saveTracked(l);return true;} return false; }
function removeTracked(item) { const l=loadTracked(); const i=l.indexOf(item); if(i!==-1){l.splice(i,1);saveTracked(l);return true;} return false; }

module.exports.addTracked        = addTracked;
module.exports.removeTracked     = removeTracked;
module.exports.loadTracked       = loadTracked;
module.exports.sendMarketSummary = sendMarketSummary;

// ── 유틸 ───────────────────────────────────────────────────────────────
function kstYmd(offset = 0) {
  const d = new Date(Date.now() + 9*3600*1000 + offset*86400000);
  return d.toISOString().slice(0, 10);
}

function arrow(pct) {
  if (pct >= 10)  return `🔴▲${pct}%`;
  if (pct >= 3)   return `🟠▲${pct}%`;
  if (pct >= 0)   return `🟡▲${pct}%`;
  if (pct >= -3)  return `🟡▼${Math.abs(pct)}%`;
  if (pct >= -10) return `🟢▼${Math.abs(pct)}%`;
  return             `🔵▼${Math.abs(pct)}%`;
}

// ── 카카오 토큰 갱신 ───────────────────────────────────────────────────
async function refreshToken() {
  if (!KAKAO_REFRESH_TOKEN) return KAKAO_ACCESS_TOKEN;
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token', client_id: KAKAO_APP_KEY,
      refresh_token: KAKAO_REFRESH_TOKEN, client_secret: KAKAO_CLIENT_SECRET,
    });
    const res  = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json();
    if (data.access_token) KAKAO_ACCESS_TOKEN = data.access_token;
  } catch(e) { console.error('토큰 갱신 실패:', e.message); }
  return KAKAO_ACCESS_TOKEN;
}

async function sendKakao(text) {
  // 1차: 어드민 키 방식 (IP 제한 없음)
  if (KAKAO_ADMIN_KEY && KAKAO_USER_ID) {
    try {
      const body = new URLSearchParams({
        template_object: JSON.stringify({
          object_type: 'text', text,
          link: { web_url: '', mobile_web_url: '' },
        }),
        receiver_uuids: JSON.stringify([KAKAO_USER_ID]),
      });
      const res = await fetch('https://kapi.kakao.com/v1/api/talk/friends/message/default/send', {
        method: 'POST',
        headers: { Authorization: `KakaoAK ${KAKAO_ADMIN_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data = await res.json();
      console.log('카카오 어드민 응답:', JSON.stringify(data));
      if (data.successful_receiver_uuids?.length > 0) return true;
    } catch(e) { console.error('카카오 어드민 오류:', e.message); }
  }

  // 2차: 사용자 토큰 방식 (폴백)
  const token = await refreshToken();
  if (!token) return false;
  try {
    const body = new URLSearchParams({
      template_object: JSON.stringify({
        object_type: 'text', text,
        link: { web_url: '', mobile_web_url: '' },
      }),
    });
    const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json();
    if (data.result_code !== 0) console.error('카카오 토큰 방식 응답:', JSON.stringify(data));
    return data.result_code === 0;
  } catch(e) { console.error('카카오 토큰 오류:', e.message); return false; }
}

// ── API 전체 수집 ─────────────────────────────────────────────────────
async function fetchAll(date) {
  const all = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({
      serviceKey: SERVICE_KEY, pageNo: String(page), numOfRows: '1000',
      returnType: 'json',
      'cond[trd_clcln_ymd::EQ]': date,
      'cond[whsl_mrkt_cd::EQ]': '210001',
      'cond[corp_cd::EQ]': '21000101',
    });
    try {
      const res  = await fetch(`http://apis.data.go.kr/B552845/katRealTime2/trades2?${params}`);
      const body = await res.json();
      const total = body?.response?.body?.totalCount || 0;
      const items = body?.response?.body?.items?.item || [];
      const lst   = Array.isArray(items) ? items : (items ? [items] : []);
      all.push(...lst.filter(it => Number(it.qty) > 0 && Number(it.scsbd_prc) > 0));
      if (all.length >= total || lst.length === 0) break;
      page++;
      await new Promise(r => setTimeout(r, 300));
    } catch(e) { break; }
  }
  return all;
}

// chart.js의 groupItems 사용 (품목+품종 분리, qty 필터 없음)
function groupByItem(items) {
  const { groupItems } = require('./chart');
  return groupItems(items);
}

// ── [06:00 / 08:00] 전체 시황 이미지 발송 ──────────────────────────
async function sendMarketSummary(label) {
  const today = kstYmd(0);
  console.log(`\n📊 [전체 시황 ${label}] ${today}`);

  const todayAll = await fetchAll(today);
  const todayMap = groupByItem(todayAll, MIN_QTY);

  if (!Object.keys(todayMap).length) {
    await sendKakao(`📊 전체 시황 ${label}\n${today}\n\n아직 경매 데이터 없음`);
    return;
  }

  // 최근 7일 평균 계산
  const weekMap = {};
  for (let i = 1; i <= 10; i++) {
    const date = kstYmd(-i);
    const data = await fetchAll(date);
    if (!data.length) continue;
    const dm = groupByItem(data, MIN_QTY);
    Object.entries(dm).forEach(([key, v]) => {
      if (!weekMap[key]) weekMap[key] = { totalQty: 0, totalSum: 0, days: 0 };
      weekMap[key].totalQty += v.qty;
      weekMap[key].totalSum += v.qty * v.avg;
      weekMap[key].days++;
    });
    if (Object.keys(weekMap).length > 0 && Math.max(...Object.values(weekMap).map(v=>v.days)) >= 7) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const weekAvgMap = {};
  Object.entries(weekMap).forEach(([key, v]) => {
    if (v.days >= 2) weekAvgMap[key] = Math.round(v.totalSum / v.totalQty);
  });

  const items    = Object.entries(todayMap).sort((a, b) => b[1].cnt - a[1].cnt);
  const totalCnt = Object.values(todayMap).reduce((s, v) => s + v.cnt, 0);

  // ① 카카오톡 → 텍스트
  let kakaoMsg = `📊 전체 시황 ${label} (${today})\n농협부산(공) 총 ${totalCnt.toLocaleString()}건\n\n`;
  kakaoMsg += `품목         오늘        7일평균    변동\n`;
  kakaoMsg += `${'─'.repeat(32)}\n`;
  items.forEach(([nm, v]) => {
    const w7  = weekAvgMap[nm];
    const pct = w7 ? Math.round((v.avg - w7) / w7 * 100) : null;
    const arw = pct !== null ? arrow(pct) : '신규';
    const todayStr = v.avg.toLocaleString().padStart(8);
    const w7Str    = w7 ? w7.toLocaleString().padStart(8) : '      -';
    kakaoMsg += `${nm.slice(0,6).padEnd(7)} ${todayStr}원  ${w7Str}원  ${arw}\n`;
  });
  kakaoMsg += `\n🔴▲10%↑급등 🟠▲3~10% 🟡±3%\n🟢▼3~10% 🔵▼10%↑급락`;
  const kakaoOk = await sendKakao(kakaoMsg);
  console.log(kakaoOk ? `✅ 카카오 텍스트 발송 (${label})` : `❌ 카카오 발송 실패`);

  // ② 텔레그램 → 이미지
  try {
    const { sendMarketImage } = require('./chart');
    const tgOk = await sendMarketImage(todayMap, weekAvgMap, label, today);
    console.log(tgOk ? `✅ 텔레그램 이미지 발송 (${label})` : `❌ 텔레그램 이미지 실패`);
  } catch(e) {
    console.error('이미지 생성 실패:', e.message);
  }
}

// ── [06:30] 지정 품목 상세 리포트 ────────────────────────────────────
async function sendTrackedItems() {
  const today   = kstYmd(0);
  const tracked = loadTracked();
  console.log(`\n🎯 [지정 품목] ${today} | ${tracked.join(', ')}`);
  if (!tracked.length) return;

  const all = await fetchAll(today);

  // 7일치 미리 수집
  const weekData = [];
  for (let i = 1; i <= 7; i++) {
    const d = await fetchAll(kstYmd(-i));
    if (d.length) weekData.push({ date: kstYmd(-i), items: d });
    await new Promise(r => setTimeout(r, 200));
  }

  for (const target of tracked) {
    const term = target.toLowerCase();

    // 오늘 해당 품목 검색
    const items = all.filter(it => {
      const nm = (it.corp_gds_item_nm || '').toLowerCase();
      const vr = (it.corp_gds_vrty_nm || '').toLowerCase();
      return (nm.includes(term) || vr.includes(term)) && Number(it.qty) >= MIN_QTY;
    });

    // 7일 평균
    const weekItems = weekData.flatMap(d => d.items.filter(it => {
      const nm = (it.corp_gds_item_nm || '').toLowerCase();
      const vr = (it.corp_gds_vrty_nm || '').toLowerCase();
      return (nm.includes(term) || vr.includes(term)) && Number(it.qty) >= MIN_QTY;
    }));
    const weekTotalQty = weekItems.reduce((s, it) => s + Number(it.qty), 0);
    const weekAvg = weekTotalQty
      ? Math.round(weekItems.reduce((s, it) => s + Number(it.qty) * Number(it.scsbd_prc), 0) / weekTotalQty)
      : null;

    let msg;
    if (!items.length) {
      msg = `🎯 ${target}\n${today} 경락 없음`;
      if (weekAvg) msg += `\n\n7일 평균: ${weekAvg.toLocaleString()}원`;
    } else {
      const totalQty = items.reduce((s, it) => s + Number(it.qty), 0);
      const wAvg     = Math.round(items.reduce((s, it) => s + Number(it.qty) * Number(it.scsbd_prc), 0) / totalQty);
      const minP     = Math.min(...items.map(it => Number(it.scsbd_prc)));
      const maxP     = Math.max(...items.map(it => Number(it.scsbd_prc)));
      const times    = items.map(it => (it.scsbd_dt||'').slice(11,16)).filter(Boolean).sort();
      const pct      = weekAvg ? Math.round((wAvg - weekAvg) / weekAvg * 100) : null;

      // 품종별
      const byKind = {};
      items.forEach(it => {
        const k = it.corp_gds_vrty_nm || '일반';
        if (!byKind[k]) byKind[k] = [];
        byKind[k].push(it);
      });

      msg = `🎯 ${target} (${today})\n농협부산(공)\n\n`;
      if (times.length > 1) msg += `경락: ${times[0]} ~ ${times[times.length-1]}\n`;
      msg += `거래: ${items.length}건 / ${totalQty}개\n`;
      msg += `최저: ${minP.toLocaleString()}원\n`;
      msg += `평균: ${wAvg.toLocaleString()}원\n`;
      msg += `최고: ${maxP.toLocaleString()}원\n`;

      if (weekAvg) {
        msg += `\n📈 7일 평균: ${weekAvg.toLocaleString()}원`;
        if (pct !== null) msg += ` (${pct >= 0 ? '▲' : '▼'}${Math.abs(pct)}%)`;
      }

      // 품종이 여러 개면 품종별 표시
      if (Object.keys(byKind).length > 1) {
        msg += `\n\n품종별:\n`;
        Object.entries(byKind).forEach(([k, rows]) => {
          const tq = rows.reduce((s, it) => s + Number(it.qty), 0);
          const wa = Math.round(rows.reduce((s, it) => s + Number(it.qty) * Number(it.scsbd_prc), 0) / tq);
          msg += `▪ ${k}  평균 ${wa.toLocaleString()}원 (${rows.length}건)\n`;
        });
      }

      // 산딸기는 공급가 추가
      if (target === '산딸기') {
        const sp500 = Math.round((wAvg/2)*1.3);
        const sp1kg = Math.round(wAvg*1.3);
        msg += `\n📦 공급가(+30%)\n500g: ${sp500.toLocaleString()}원\n1kg:  ${sp1kg.toLocaleString()}원`;
      }
    }

    const ok = await sendKakao(msg);
    console.log(`${ok ? '✅' : '❌'} ${target} 리포트 발송`);
    await new Promise(r => setTimeout(r, 500)); // 연속 발송 간격
  }
}

// ── [07:00] 전날 DB 저장 + 폭락 알림 ────────────────────────────────
async function collectAndAlert() {
  const yesterday = kstYmd(-1);
  console.log(`\n📦 [DB 저장] ${yesterday}`);

  const existing = getRecordCount(yesterday);
  if (existing > 100) {
    console.log(`  이미 수집됨 (${existing}건) — 스킵`);
  } else {
    const all = await fetchAll(yesterday);
    if (all.length) {
      const mapped = all.map(r => {
        const dt = String(r.scsbd_dt || '');
        let saleTime = '', saleDate = r.trd_clcln_ymd || '';
        const m = dt.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})?/);
        if (m) { saleDate = saleDate||`${m[1]}-${m[2]}-${m[3]}`; saleTime=`${m[4]}${m[5]}${m[6]||'00'}`; }
        return {
          saleDate, saleTime,
          productName: r.corp_gds_item_nm || '',
          kindName:    r.corp_gds_vrty_nm || '',
          unit:        String(r.unit_qty||'') + (r.unit_nm||''),
          weight:      String(r.unit_qty||''),
          origin:      r.plor_nm || '',
          quantity:    Number(r.qty) || 0,
          price:       Number(r.scsbd_prc) || 0,
          company:     r.corp_nm || '',
          market:      r.whsl_mrkt_nm || '',
        };
      });
      const saved = saveRecords(mapped);
      const sumCnt = buildAndSaveSummary(yesterday, MIN_QTY);
      console.log(`  ✅ ${saved}건 저장 / 요약 ${sumCnt}품목`);
    }
  }

  // 폭락 감지 + 알림
  const drops = detectPriceDrop(DROP_THRESHOLD);
  if (drops.length) {
    let msg = `📉 폭락 알림 (${yesterday})\n7일 평균 대비 ${DROP_THRESHOLD}%↑ 하락\n${'─'.repeat(20)}\n`;
    drops.forEach((d, i) => {
      msg += `\n${i+1}. ${d.item_name}${d.kind_name?` (${d.kind_name})`:''}\n`;
      msg += `   7일평균: ${d.prev_avg.toLocaleString()}원\n`;
      msg += `   최근가:  ${d.latest_price.toLocaleString()}원  ▼${d.drop_pct}%\n`;
    });
    msg += `\n⚠️ 공급가 재검토 필요`;
    const ok = await sendKakao(msg);
    console.log(ok ? '✅ 폭락 알림 발송' : '❌ 폭락 알림 실패');
  }
}

// ── [DB 저장] 오늘 새벽 경매 데이터 수집 및 저장 ───────────────────
async function collectTodayData() {
  const today = kstYmd(0);
  console.log(`\n📦 [DB 최신화] ${today} 오늘 경매 데이터 수집...`);
  const all = await fetchAll(today);
  if (!all.length) { console.log('  데이터 없음'); return; }

  const mapped = all.map(r => {
    const dt = String(r.scsbd_dt || '');
    let saleTime = '', saleDate = r.trd_clcln_ymd || '';
    const m = dt.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})?/);
    if (m) { saleDate = saleDate||`${m[1]}-${m[2]}-${m[3]}`; saleTime=`${m[4]}${m[5]}${m[6]||'00'}`; }
    return {
      saleDate, saleTime,
      productName: r.corp_gds_item_nm || '',
      kindName:    r.corp_gds_vrty_nm || '',
      unit:        String(r.unit_qty||'') + (r.unit_nm||''),
      weight:      String(r.unit_qty||''),
      origin:      r.plor_nm || '',
      quantity:    Number(r.qty) || 0,
      price:       Number(r.scsbd_prc) || 0,
      company:     r.corp_nm || '',
      market:      r.whsl_mrkt_nm || '',
    };
  });

  const saved  = saveRecords(mapped);
  const sumCnt = buildAndSaveSummary(today, MIN_QTY);
  console.log(`  ✅ ${today} DB 최신화 완료: ${saved}건 저장 / 요약 ${sumCnt}품목`);

  // 폭락 감지 (오늘 vs 7일 비교)
  const drops = detectPriceDrop(DROP_THRESHOLD);
  if (drops.length) {
    let msg = `📉 폭락 알림 (${today})\n7일 평균 대비 ${DROP_THRESHOLD}%↑ 하락\n${'─'.repeat(20)}\n`;
    drops.forEach((d, i) => {
      msg += `\n${i+1}. ${d.item_name}${d.kind_name?` (${d.kind_name})`:''} ▼${d.drop_pct}%\n`;
      msg += `   7일평균: ${d.prev_avg.toLocaleString()}원 → 오늘: ${d.latest_price.toLocaleString()}원\n`;
    });
    msg += `\n⚠️ 공급가 재검토 필요`;
    const ok = await sendKakao(msg);
    console.log(ok ? '✅ 폭락 알림 발송' : '❌ 폭락 알림 실패');
  }
}


// ── 판매 추천 분석 ─────────────────────────────────────────────────
// 기준 1: 경매에 있는데 우리가 안 파는 품목
// 기준 4: 최근 거래량이 급증한 품목 (오늘 vs 7일 평균 대비 2배↑)

// 우리가 이미 판매 중인 품목 키워드
const OUR_ITEMS = new Set([
  '산딸기','딸기','로메인','케일','깻잎','청경채','애호박','가시오이',
  '백다다기','알배추','가지','방울토마토','완숙토마토','팽이버섯',
  '팽이','느타리','새송이','만가닥','표고','쌈배추','치커리',
  '양상추','양배추','대파','쪽파','부추','당근','고구마','양파',
  '쥬키니','단호박','청양','꽈리','오이고추','모닝','청피망',
  '파프리카','무','적근대','적채','수박','참외','오이','상추',
  '미나리','시금치','감자','토마토',
]);

function isOurItem(itemName, vrtyName) {
  const combined = (itemName + vrtyName).toLowerCase();
  for (const kw of OUR_ITEMS) {
    if (combined.includes(kw)) return true;
  }
  return false;
}

async function sendSalesRecommendation() {
  const today     = kstYmd(0);
  const todayData = await fetchAll(today);
  if (!todayData.length) return;

  // 오늘 품목별 거래량 집계
  const todayMap = {};
  todayData.forEach(it => {
    const nm = it.corp_gds_item_nm || '';
    const vr = it.corp_gds_vrty_nm || '';
    const qty = Number(it.qty) || 0;
    const prc = Number(it.scsbd_prc) || 0;
    if (!nm || qty <= 0 || prc <= 0) return;
    const key = vr ? `${nm}(${vr})` : nm;
    if (!todayMap[key]) todayMap[key] = { nm, vr, qty: 0, sum: 0, cnt: 0 };
    todayMap[key].qty += qty;
    todayMap[key].sum += qty * prc;
    todayMap[key].cnt++;
  });

  // 7일 평균 거래량 집계
  const weekMap = {};
  for (let i = 1; i <= 7; i++) {
    const data = await fetchAll(kstYmd(-i));
    data.forEach(it => {
      const nm = it.corp_gds_item_nm || '';
      const vr = it.corp_gds_vrty_nm || '';
      const qty = Number(it.qty) || 0;
      const prc = Number(it.scsbd_prc) || 0;
      if (!nm || qty <= 0 || prc <= 0) return;
      const key = vr ? `${nm}(${vr})` : nm;
      if (!weekMap[key]) weekMap[key] = { qty: 0, days: new Set() };
      weekMap[key].qty += qty;
      weekMap[key].days.add(it.trd_clcln_ymd || '');
    });
    await new Promise(r => setTimeout(r, 200));
  }

  // 7일 일평균 거래량
  const weekAvgQty = {};
  Object.entries(weekMap).forEach(([key, v]) => {
    weekAvgQty[key] = v.qty / Math.max(v.days.size, 1);
  });

  const newItems    = [];  // 기준1: 미등록 품목
  const trendItems  = [];  // 기준4: 급증 품목
  const freshItems  = [];  // 신규: 최근 14일간 없다가 오늘 처음 등장

  Object.entries(todayMap).forEach(([key, v]) => {
    const avgP = Math.round(v.sum / v.qty);
    const item = { key, nm: v.nm, vr: v.vr, qty: v.qty, avgP, cnt: v.cnt };

    // 기준1: 미등록 (거래건수 3건 이상만)
    if (!isOurItem(v.nm, v.vr) && v.cnt >= 3) {
      newItems.push(item);
    }

    // 기준4: 급증 (오늘 거래량 >= 7일 일평균의 2배, 최소 5건)
    const dayAvg = weekAvgQty[key] || 0;
    if (dayAvg > 0 && v.qty >= dayAvg * 2 && v.cnt >= 5) {
      item.dayAvg = Math.round(dayAvg);
      item.ratio  = Math.round(v.qty / dayAvg * 10) / 10;
      trendItems.push(item);
    }

    // 신규 입고: 최근 14일간 데이터가 아예 없다가 오늘 처음 등장 (3건 이상)
    if (!weekMap[key] && v.cnt >= 3) {
      freshItems.push(item);
    }
  });

  if (!newItems.length && !trendItems.length && !freshItems.length) return;

  let msg = `📣 <b>오늘의 판매 추천</b>
${today} 엄궁농산물도매시장

`;

  if (newItems.length) {
    msg += `🆕 <b>미등록 품목 (${newItems.length}개)</b>
`;
    newItems
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, 8)
      .forEach(it => {
        const name = it.vr ? `${it.vr}(${it.nm})` : it.nm;
        msg += `▪ ${name}  평균 ${it.avgP.toLocaleString()}원 (${it.cnt}건/${it.qty}개)
`;
      });
    msg += '\n';
  }

  if (trendItems.length) {
    msg += `🔥 <b>거래량 급증 품목 (${trendItems.length}개)</b>
`;
    trendItems
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 5)
      .forEach(it => {
        const name = it.vr ? `${it.vr}(${it.nm})` : it.nm;
        msg += `▪ ${name}  평균 ${it.avgP.toLocaleString()}원
`;
        msg += `  오늘 ${it.qty}개 ↑ (7일평균 ${it.dayAvg}개 대비 ${it.ratio}배)
`;
      });
  }

  const ok = await sendKakao(msg);
  console.log(ok ? '✅ 판매 추천 발송' : '❌ 판매 추천 실패');

  // 텔레그램에도 발송
  try {
    const tgBody = new URLSearchParams({ chat_id: process.env.TG_CHAT_ID, text: msg, parse_mode: 'HTML' });
    await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tgBody.toString(),
    });
  } catch(e) {}
}

// ── cron 등록 ─────────────────────────────────────────────────────────
// KST 시각 → UTC 변환 (KST = UTC+9)
// KST 05:00 = UTC 20:00  ← 경매 시작 전 DB 초기화
// KST 06:00 = UTC 21:00  ← 1차 시황 발송
// KST 06:30 = UTC 21:30  ← 지정 품목 리포트
// KST 07:00 = UTC 22:00  ← DB 최신화 1차
// KST 07:30 = UTC 22:30  ← DB 최신화 2차
// KST 08:00 = UTC 23:00  ← 2차 시황 발송 + DB 최신화 최종

// 매시 30분마다 오늘 DB 최신화 (05:30 ~ 09:30 KST)
// UTC 20:30, 21:30, 22:30, 23:30, 00:30
cron.schedule('30 20 * * *', () => collectTodayData(), { timezone: 'UTC' }); // KST 05:30
cron.schedule('0 21 * * *',  () => sendMarketSummary('06:00'), { timezone: 'UTC' }); // KST 06:00
cron.schedule('30 21 * * *', async () => {               // KST 06:30
  await collectTodayData();
  await sendTrackedItems();
}, { timezone: 'UTC' });
cron.schedule('0 22 * * *',  () => collectTodayData(),  { timezone: 'UTC' }); // KST 07:00
cron.schedule('30 22 * * *', () => collectTodayData(),  { timezone: 'UTC' }); // KST 07:30
cron.schedule('0 23 * * *',  async () => {               // KST 08:00
  await collectTodayData();
  await sendMarketSummary('08:00');
}, { timezone: 'UTC' });
cron.schedule('30 23 * * *', async () => {              // KST 08:30
  await collectTodayData();
  await sendSalesRecommendation();                         // 판매 추천
}, { timezone: 'UTC' });
cron.schedule('0 0 * * *',   () => collectTodayData(),  { timezone: 'UTC' }); // KST 09:00

// ── 화요일 오전 9시 공급가 자동 업데이트 (KST 09:00 = UTC 00:00 화요일)
cron.schedule('0 0 * * 2', async () => {
  console.log('\n🤖 [화요일] 어드민 공급가 자동 업데이트 시작...');
  try {
    const { run } = require('./auto_price');
    await run();
  } catch(e) {
    console.error('공급가 자동화 오류:', e.message);
  }
}, { timezone: 'UTC' });

console.log('⏰ 스케줄러 등록 완료');
console.log('   05:30 KST — DB 최신화 시작');
console.log('   06:00 KST — 전체 시황 1차 (오늘 vs 7일 비교)');
console.log('   06:30 KST — DB 최신화 + 지정 품목 리포트');
console.log('   07:00 KST — DB 최신화');
console.log('   07:30 KST — DB 최신화');
console.log('   08:00 KST — DB 최신화 + 전체 시황 2차 (최종)');
console.log('   08:30 KST — DB 최신화 + 판매 추천 발송');
console.log('   09:00 KST — DB 최신화 최종');
// ── 인증대기 거래처 자동 승인 (실시간 감시) ───────────────────────────
// [PATCHED] // [PATCHED] const approveWatch = require('./auto_approve_watch');
// [PATCHED] // [PATCHED] approveWatch.startWatch(30000); // 30초마다 인증대기 체크 → 즉시 승인
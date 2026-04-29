/**
 * 엄궁농산물도매시장 실시간 경락가 조회 서버
 * ----------------------------------------------------------------------
 * 한국농수산식품유통공사_전국 공영도매시장 실시간 경매정보
 *   - 공공데이터포털: https://www.data.go.kr/data/15141808/openapi.do
 *   - 엔드포인트:   http://apis.data.go.kr/B552845/katRealTime2
 *
 * ※ 구 부산전용 API (6260000/EgMarketAuction) 는 2025-02-28 자로 폐기되고
 *   위 aT 전국 통합 API 로 이관되었습니다. 따라서 반드시 15141808 의 키를
 *   새로 발급받아야 실제 데이터가 나옵니다.
 */

require('dotenv').config();
const express = require('express');
require('./scheduler');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const SERVICE_KEY = (process.env.AT_SERVICE_KEY || process.env.SERVICE_KEY || '').trim();
const API_CANDIDATES = [
  // 정식 경로 (Swagger 명세에서 확인됨): basePath=/B552845/katRealTime2, path=/trades2
  'http://apis.data.go.kr/B552845/katRealTime2/trades2',
  // 혹시 다른 패턴으로 노출될 경우 대비
  'http://apis.data.go.kr/B552845/katRealTime2/getkatRealTime2',
];

// 필터 (이름 기반 — API 에서 직접 LIKE 필터 적용)
const MARKET_CODE = (process.env.MARKET_CODE || '210001').trim();   // 부산엄궁
const MARKET_NAME = (process.env.MARKET_NAME || '엄궁').trim();
const CORP_CODE   = (process.env.CORP_CODE   || '21000101').trim(); // 농협부산(공)
const CORP_NAME   = (process.env.CORP_NAME   || '농협부산').trim();

// USE_MOCK=true 면 실제 API 대신 목업 반환 (디자인 미리보기용)
const USE_MOCK = process.env.USE_MOCK === 'true';

if (!SERVICE_KEY && !USE_MOCK) {
  console.error('\n❌ .env 에 AT_SERVICE_KEY 가 설정되어 있지 않습니다.');
  console.error('   공공데이터포털 → https://www.data.go.kr/data/15141808/openapi.do');
  console.error('   → 활용신청 후 발급된 "일반 인증키(Encoding)" 를 AT_SERVICE_KEY 로 넣어주세요.\n');
  console.error('   (임시로 USE_MOCK=true 로 두면 샘플 데이터로 UI 확인 가능)\n');
  process.exit(1);
}

const xmlParser = new XMLParser({ ignoreAttributes: false, trimValues: true });

// ── 캐시 ──────────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL_MS = 15_000;
function getCache(k) {
  const v = cache.get(k);
  if (!v) return null;
  if (Date.now() - v.at > CACHE_TTL_MS) { cache.delete(k); return null; }
  return v.data;
}
function setCache(k, data) { cache.set(k, { at: Date.now(), data }); }

// ── 유틸 ──────────────────────────────────────────────────────────────
function todayYmd() {
  // KST 기준 오늘 YYYY-MM-DD
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

function normalize(s) {
  return String(s || '').replace(/[\s()()（）\[\]]/g, '').toLowerCase();
}
function containsNorm(haystack, needle) {
  if (!needle) return true;
  return normalize(haystack).includes(normalize(needle));
}

// ── aT API 필드 → 프론트 스키마 매핑 ─────────────────────────────────
function mapAtRow(r) {
  const dt = String(r.scsbd_dt || '');
  let saleTime = '';
  let saleDate = r.trd_clcln_ymd || '';
  if (dt) {
    const m = dt.match(/(\d{4})-?(\d{2})-?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})?/);
    if (m) {
      saleDate = saleDate || `${m[1]}-${m[2]}-${m[3]}`;
      saleTime = `${m[4]}${m[5]}${m[6] || '00'}`;
    }
  }
  const unitQty = Number(r.unit_qty) || 0;
  const unitNm  = r.unit_nm || '';
  const pkgNm   = r.pkg_nm || '';
  const unitLabel = unitQty
    ? `${unitQty}${unitNm}${pkgNm ? ' ' + pkgNm : ''}`
    : (pkgNm || unitNm);

  return {
    saleDate,
    saleTime,
    productName: r.corp_gds_item_nm || r.gds_mclsf_nm || r.gds_lclsf_nm || '',
    kindName:    r.corp_gds_vrty_nm || r.gds_sclsf_nm || '',
    grade:       r.grd_nm || r.sz_nm || '',
    unit:        unitLabel,
    weight:      unitQty ? `${unitQty}${unitNm}` : '',
    origin:      r.plor_nm || '',
    quantity:    Number(r.qty) || 0,
    price:       Number(r.scsbd_prc) || 0,
    company:     r.corp_nm || '',
    shipper:     r.shpr_nm || r.shipper || '',
    market:      r.whsl_mrkt_nm || '',
    _seq:        r.auctn_seq || '',
  };
}

// ── aT API 호출 ───────────────────────────────────────────────────────
async function callAtApi({ date, pageNo = 1, numOfRows = 1000 }) {
  const params = new URLSearchParams();
  params.set('serviceKey', SERVICE_KEY);
  params.set('pageNo', String(pageNo));
  params.set('numOfRows', String(numOfRows));
  params.set('returnType', 'json');
  params.set('cond[trd_clcln_ymd::EQ]', date);
  // 코드를 알면 EQ 로 정확히, 모르면 LIKE 로 부분 일치
  if (MARKET_CODE) {
    params.set('cond[whsl_mrkt_cd::EQ]', MARKET_CODE);
  } else if (MARKET_NAME) {
    params.set('cond[whsl_mrkt_nm::LIKE]', MARKET_NAME);
  }
  if (CORP_CODE) {
    params.set('cond[corp_cd::EQ]', CORP_CODE);
  } else if (CORP_NAME) {
    params.set('cond[corp_nm::LIKE]', CORP_NAME);
  }

  let lastErr = null;
  for (const base of API_CANDIDATES) {
    const url = `${base}?${params.toString()}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json, text/xml' } });
      const text = await res.text();
      const ct = res.headers.get('content-type') || '';

      if (ct.includes('json') || text.trim().startsWith('{')) {
        try { return { ok: true, url, raw: JSON.parse(text) }; } catch (_) {}
      }
      if (text.trim().startsWith('<')) {
        return { ok: true, url, raw: xmlParser.parse(text) };
      }
      lastErr = { status: res.status, message: text.slice(0, 200), url };

      // 401/403 은 "엔드포인트는 맞는데 권한 문제" — 다음 후보 시도해봤자 의미없음, 즉시 중단
      if (res.status === 401 || res.status === 403) break;
    } catch (e) {
      lastErr = { message: e.message, url };
    }
  }
  return { ok: false, ...lastErr };
}

function extractItems(raw) {
  if (!raw) return [];
  const body = raw?.response?.body ?? raw?.body ?? raw?.data ?? raw;
  const items = body?.items?.item ?? body?.items ?? body?.item ?? body?.data ?? [];
  if (Array.isArray(items)) return items;
  if (items && typeof items === 'object') return [items];
  return [];
}

function extractHeader(raw) {
  const h = raw?.response?.header ?? raw?.header ?? {};
  return {
    resultCode: h.resultCode || h.resultcode || '',
    resultMsg:  h.resultMsg  || h.resultmsg  || '',
  };
}

// ── 목업 (USE_MOCK=true 전용) ────────────────────────────────────────
function mockItems(n = 120) {
  const today = todayYmd();
  const src = [
    ['수박','꿀수박(꼭지절단)','대구광역시 달성군', 2, 14],
    ['수박','꿀수박(꼭지절단)','경상남도 함양군', 5, 12],
    ['수박','일반','충남 논산', 5, 15],
    ['사과','부사','경북 영주', 10, 10],
    ['토마토','대추방울','부산 강서', 5, 5],
    ['상추','청상추','충남 논산', 4, 4],
    ['배추','월동배추','전남 해남', 8, 10],
    ['마늘','난지','경남 남해', 10, 10],
  ];
  const items = [];
  for (let i = 0; i < n; i++) {
    const s = src[Math.floor(Math.random() * src.length)];
    const sizeKg = Math.floor(s[3] + Math.random() * (s[4] - s[3] + 1));
    const hh = String(5 + Math.floor(Math.random()*3)).padStart(2,'0');
    const mm = String(Math.floor(Math.random()*60)).padStart(2,'0');
    const ss = String(Math.floor(Math.random()*60)).padStart(2,'0');
    items.push({
      auctn_seq: `MOCK-${i}`,
      scsbd_dt: `${today} ${hh}:${mm}:${ss}`,
      trd_clcln_ymd: today,
      whsl_mrkt_cd: '240003', whsl_mrkt_nm: '부산엄궁',
      corp_cd: 'C01', corp_nm: '농협부산(공)',
      corp_gds_item_nm: s[0], corp_gds_vrty_nm: s[1],
      plor_nm: s[2],
      scsbd_prc: Math.floor(5000 + Math.random() * 80000),
      qty: Math.floor(5 + Math.random() * 150),
      unit_qty: sizeKg, unit_nm: 'kg',
      pkg_nm: '상자',
    });
  }
  return items;
}

// ── 라우트 ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/auction', async (req, res) => {
  const date = (req.query.date || todayYmd()).trim();
  const cacheKey = `auction:${date}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  if (USE_MOCK) {
    const rawRows = mockItems(120);
    const items = rawRows.map(mapAtRow);
    const filtered = items.filter(
      (it) => containsNorm(it.market, MARKET_NAME) && containsNorm(it.company, CORP_NAME)
    );
    const payload = {
      ok: true, source: 'mock',
      fetchedAt: new Date().toISOString(),
      date, filter: { market: MARKET_NAME, company: CORP_NAME },
      rawCount: items.length, count: filtered.length,
      items: filtered,
    };
    setCache(cacheKey, payload);
    return res.json(payload);
  }

  const result = await callAtApi({ date, numOfRows: 1000 });
  if (!result.ok) {
    const msg = result.message || '';
    const status = result.status || 0;
    // 403: 키는 유효하나 권한이 없거나 전파 대기 중
    if (status === 403 || /forbidden/i.test(msg)) {
      return res.status(502).json({
        ok: false,
        error: '403 Forbidden',
        code: 'FORBIDDEN',
        hint:
          '키는 유효합니다. 다음 두 가지 중 하나입니다.\n' +
          '① 이 API(15141808) 활용신청이 아직 안 된 상태\n' +
          '   → https://www.data.go.kr/data/15141808/openapi.do 에서 활용신청\n' +
          '② 승인은 됐지만 권한 전파 중 (보통 10~30분, 드물게 1~2시간)\n' +
          '   → 잠시 뒤 자동 갱신되면 실제 데이터가 들어옵니다. 기다리시면 됩니다.',
      });
    }
    // 401: 키 자체가 무효
    if (status === 401 || /unauthorized/i.test(msg)) {
      return res.status(502).json({
        ok: false,
        error: '401 Unauthorized',
        hint: '.env 의 AT_SERVICE_KEY 값이 공공데이터포털 "마이페이지 → 인증키 발급현황" 의 일반 인증키와 정확히 일치하는지 확인하세요.',
      });
    }
    return res.status(502).json({
      ok: false,
      error: msg || `HTTP ${status || '?'}`,
      hint: '(1) 공공데이터포털 15141808 활용신청 승인 여부 확인 (2) AT_SERVICE_KEY 정확성 확인',
    });
  }

  const header = extractHeader(result.raw);
  if (header.resultCode && !['00', 'INFO-00', '0', ''].includes(header.resultCode)) {
    return res.status(502).json({
      ok: false,
      error: `${header.resultCode} ${header.resultMsg}`,
      hint: '공공데이터포털 응답 헤더에 오류가 포함돼 있습니다.',
    });
  }

  const rawRows = extractItems(result.raw);
  const items = rawRows.map(mapAtRow);
  const filtered = items.filter(
    (it) => containsNorm(it.market, MARKET_NAME) && containsNorm(it.company, CORP_NAME)
  );

  const payload = {
    ok: true, source: 'live',
    fetchedAt: new Date().toISOString(),
    date,
    filter: { market: MARKET_NAME, company: CORP_NAME, marketCode: MARKET_CODE || null, corpCode: CORP_CODE || null },
    rawCount: items.length,
    count: filtered.length,
    items: filtered,
    endpoint: result.url,
  };
  setCache(cacheKey, payload);
  res.json(payload);
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    serviceKeyLoaded: Boolean(SERVICE_KEY),
    useMock: USE_MOCK,
    filter: { market: MARKET_NAME, company: CORP_NAME, marketCode: MARKET_CODE || null, corpCode: CORP_CODE || null },
    time: new Date().toISOString(),
  });
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── 서버 시작 시 오늘+어제 데이터 자동 캐시 로드 ─────────────────────
async function initCache() {
  const kst = new Date(Date.now() + 9*3600*1000);
  const today = kst.toISOString().slice(0,10);
  const yd = new Date(kst); yd.setDate(yd.getDate()-1);
  const yesterday = yd.toISOString().slice(0,10);
  console.log('\n📦 데이터 캐시 초기화...');
  await loadDayData(today);
  await loadDayData(yesterday);
  console.log('✅ 캐시 준비 완료\n');
}

// 자정(KST 00:00)에 새 날짜 데이터 자동 로드
function scheduleAutoRefresh() {
  const kst = new Date(Date.now() + 9*3600*1000);
  const next = new Date(kst);
  next.setUTCHours(15, 0, 0, 0); // UTC 15:00 = KST 00:00
  if (next <= kst) next.setUTCDate(next.getUTCDate() + 1);
  setTimeout(async () => {
    const newDay = new Date(Date.now() + 9*3600*1000).toISOString().slice(0,10);
    console.log(`🔄 자정 캐시 갱신: ${newDay}`);
    dataCache.delete(newDay); // 혹시 있으면 삭제 후 재로드
    await loadDayData(newDay);
    scheduleAutoRefresh(); // 다음 자정 예약
  }, next - kst);
}


// _auction_refresh_endpoint_v1_ - 캐시 강제 갱신 (스케줄러 → 봇 연동)
app.post('/admin/refresh-cache', (req, res) => {
  const kst = new Date(Date.now() + 9*3600*1000);
  const today = kst.toISOString().slice(0, 10);
  dataCache.delete(today);
  loadDayData(today)
    .then(items => console.log(`[캐시 갱신] ${today} → ${items.length}건`))
    .catch(() => {});
  res.json({ ok: true, date: today });
});
app.listen(PORT, () => {
  console.log(`\n🚜 엄궁 경락가 서버 기동: http://localhost:${PORT}`);
  console.log(`   API: aT 전국 공영도매시장 실시간 경매정보 (15141808)`);
  console.log(`   키:  ${SERVICE_KEY ? SERVICE_KEY.slice(0,8) + '...' + SERVICE_KEY.slice(-4) : '(없음, USE_MOCK 모드)'}`);
  console.log(`   필터 도매시장: ${MARKET_CODE ? '[' + MARKET_CODE + '] ' : ''}${MARKET_NAME}`);
  console.log(`   필터 도매법인: ${CORP_CODE   ? '[' + CORP_CODE   + '] ' : ''}${CORP_NAME}`);
  console.log(`   조회일: 오늘 (KST, ?date=YYYY-MM-DD 로 변경 가능)\n`);
  initCache().catch(console.error);
  scheduleAutoRefresh();
});

// ── 텔레그램 봇 ────────────────────────────────────────────────────────
const TG_TOKEN   = (process.env.TG_TOKEN   || '').trim();
const TG_CHAT_ID = (process.env.TG_CHAT_ID || '').trim();
const https = require('https');

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return false;
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data).ok === true); } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

// ── 전체 경락 데이터 캐시 ────────────────────────────────────────────
// 날짜별로 전체 데이터를 메모리에 보관 → 품목명/품종명 어디서든 검색 가능
const dataCache = new Map(); // key: YYYY-MM-DD, value: [{...}]

async function loadDayData(date) {
  // _loadDayData_agromarket_v1_ - at.agromarket.kr HTML 파싱 방식 (2026-04-28)
  if (dataCache.has(date)) return dataCache.get(date);

  const https = require('https');
  const all = [];
  let page = 1;
  const PAGE_SIZE = 1000;

  while (true) {
    const qs = [
      'pageNo=' + page,
      'saledateBefore=' + date,
      'largeCdBefore=', 'midCdBefore=', 'smallCdBefore=',
      'saledate=' + date,
      'whsalCd=210001',
      'cmpCd=21000101',
      'mmCd=', 'largeCd=', 'midCd=', 'smallCd=', 'sanCd=', 'smallCdSearch=',
      'pageSize=' + PAGE_SIZE,
      'dCostSort='
    ].join('&');

    const rows = await new Promise((resolve) => {
      const req = https.get({
        hostname: 'at.agromarket.kr',
        path: '/domeinfo/sanRealtime.do?' + qs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'Referer': 'https://at.agromarket.kr/domeinfo/sanRealtime.do'
        }
      }, (res) => {
        let d = '';
        res.on('data', x => d += x);
        res.on('end', () => {
          const result = [];
          const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          let m;
          while ((m = trRe.exec(d)) !== null) {
            const tds = m[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
            if (!tds || tds.length < 12) continue;
            const cells = tds.map(t => t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
            // cells[1] = 시간 문자열 (데이터 행 판별)
            if (!cells[1] || cells[1].length < 5) continue;
            const qty = Number(cells[10]) || 0;
            const prc = Number((cells[11] || '').replace(/,/g, '')) || 0;
            if (qty > 0 && prc > 0) {
              result.push({
                corp_gds_item_nm: cells[6],  // 품목명
                corp_gds_vrty_nm: cells[7],  // 품종명
                qty:       qty,               // 수량
                scsbd_prc: prc                // 경락가
              });
            }
          }
          resolve(result);
        });
      });
      req.on('error', () => resolve([]));
      req.setTimeout(15000, () => { req.destroy(); resolve([]); });
    });

    all.push(...rows);
    // 마지막 페이지 판별: 받은 행 수 < pageSize
    if (rows.length < PAGE_SIZE) break;
    page++;
    await new Promise(r => setTimeout(r, 300));
  }

  dataCache.set(date, all); // 0건도 캐시 저장 (반복 HTTP 요청 방지)
  console.log(`📦 캐시 로드: ${date} → ${all.length}건 (at.agromarket)`);
  return all;
}

// 검색: 품목명 OR 품종명 포함 여부로 검색 (어떤 이름으로 불러도 찾음)
async function fetchAuction(searchTerm, vrtyFilter, date) {
  const data = await loadDayData(date);
  const term = searchTerm.trim().toLowerCase();

  const matched = data.filter(it => {
    const itemNm = (it.corp_gds_item_nm || '').toLowerCase();
    const vrtyNm = (it.corp_gds_vrty_nm || '').toLowerCase();
    const qty = Number(it.qty) || 0;
    if (qty < 0) return false;
    // 1글자 단어는 품목명 완전일치 또는 시작 일치 (배추/양배추 혼동 방지)
    let nameMatch;
    if (term.length === 1) {
      nameMatch = itemNm === term || itemNm.startsWith(term + '(') || itemNm.startsWith(term + ' ');
    } else {
      nameMatch = itemNm.includes(term) || vrtyNm.includes(term);
    }
    if (vrtyFilter) return nameMatch && vrtyNm.includes(vrtyFilter.toLowerCase());
    return nameMatch;
  });

  return matched;
}


function calcStats(items) {
  if (!items.length) return null;
  const prices = items.map(it => Number(it.scsbd_prc));
  const totalQty = items.reduce((s, it) => s + Number(it.qty), 0);
  const wAvg = Math.round(items.reduce((s, it) => s + Number(it.qty) * Number(it.scsbd_prc), 0) / totalQty);
  return { min: Math.min(...prices), max: Math.max(...prices), avg: wAvg, cnt: items.length, totalQty };
}

// 명령어 처리
async function handleCommand(text, chatId) {
  const kstNow = new Date(Date.now() + 9*3600*1000);
  const today     = kstNow.toISOString().slice(0,10);
  const yd        = new Date(kstNow); yd.setDate(yd.getDate()-1);
  const yesterday = yd.toISOString().slice(0,10);

  const raw = text.trim();
  const has = (...words) => words.some(w => raw.replace('/','').includes(w));

  // ── 전체 공급가 업데이트 (텔레그램 수동 트리거) ─────────────────────
  // [제거됨] 공급가업데이트→auto_price 오연결 제거

  // ── 단가 즉시 변경 명령 (최우선 처리) ──────────────────────────────
  // "변경|수정|바꿔" 키워드 + 숫자 패턴이면 단가 변경으로 처리
  const _hasChange = /변경|수정|바꿔|단가변경/.test(raw);
  // "원" 앞의 숫자를 가격으로 추출 (200g 같은 단위 숫자 오인식 방지)
  // 예: "두릅 200g 7500원 변경" → 가격=7500, 상품명="두릅 200g"
  const _priceMatch = _hasChange
    ? (raw.match(/(\d[\d,]+)원/) || raw.match(/(.+?)\s+(\d[\d,]+)\s*(?:으로|로)?\s*(?:변경|수정|바꿔)/))
    : null;
  if (_priceMatch && _hasChange) {
    // "원" 앞 숫자 방식으로 가격 추출
    const _wonMatch = raw.match(/(\d[\d,]+)원/);
    const _newPrice = _wonMatch ? parseInt(_wonMatch[1].replace(/,/g,'')) : 0;
    // 상품명: 가격 숫자와 "원" 및 변경 키워드 제거
    const _productName = raw
      .replace(/(\d[\d,]+)원.*/, '')  // 가격부터 끝까지 제거
      .replace(/으로|로|변경|수정|바꿔|단가|해줘|주세요/g, '')
      .trim();
    if (_newPrice >= 100 && _newPrice < 10000000 && _productName.length >= 2) {
      try {
        const { run: _updatePrice } = require('./auto_price_single');
        const _result = await _updatePrice(_productName, _newPrice);
        if (_result.success) {
          const _names = _result.updatedNames?.join(', ') || _productName;
          return `✅ <b>단가 변경 완료</b>\n${_names}\n${_result.oldPrice.toLocaleString()}원 → <b>${_newPrice.toLocaleString()}원</b>\n어드민 업로드 완료`;
        } else if (_result.needsSelection) {
          const _list = _result.items.map((it,i)=>`${i+1}. ${it.name}`).join('\n');
          return `🔍 <b>"${_productName}"</b> 검색 결과가 여러 개입니다.\n정확한 상품명으로 다시 입력해주세요:\n\n${_list}\n\n예) ${_result.items[0]?.name} ${_newPrice.toLocaleString()}원으로 변경`;
        } else {
          return `❌ 단가 변경 실패\n${_result.message}\n\n사용법: [상품명] [금액]원으로 변경\n예) 적근대 300g 1500원으로 변경`;
        }
      } catch(e) {
        return `❌ 오류: ${e.message}`;
      }
    }
  }

  // 날짜 감지
  const useYesterday = has('어제','전날','전일');
  const targetDate   = useYesterday ? yesterday : today;
  const dateLabel    = useYesterday ? `어제(${yesterday})` : `오늘(${today})`;

  // 주간 여부
  const isWeekly = has('일주일','7일','주간','weekly','한주','이번주','최근');

  // 검색어 추출 — 공백 기준 토큰 단위로만 불용어 제거
  const stopTokens = new Set([
    '시세','경매','경락','단가','가격','알려줘','알려주세요','얼마야','얼마에요',
    '어때요','조회해줘','확인해줘','오늘','어제','금일','전날','전일','보여줘','봐',
    '최근','일주일','7일','주간','weekly','한주','이번주','줘요','이야','인가요',
    '인가','줘','요','야','좀','제발','오늘시세','어제시세','주간시세','일주일시세','오늘경락','어제경락','현재시세','오늘시세','어제시세','주간시세','일주일시세','오늘경락','어제경락','현재시세',
  ]);
  let searchWord = raw.replace('/','').trim()
    .split(/\s+/)
    .filter(t => t.length > 0 && !stopTokens.has(t))
    .join(' ').trim();

  // 명령어 감지
  const slashCmd = raw.startsWith('/') ? raw.slice(1).split(' ')[0] : null;
  let cmd = slashCmd;
  if (!cmd) {
    if (has('산딸기'))                  cmd = isWeekly ? '주간검색' : '검색';
    else if (has('수박'))               cmd = isWeekly ? '주간검색' : '검색';
    else if (has('과일'))               cmd = '과일';
    else if (has('채소','엽채'))        cmd = '채소';
    else if (has('과채'))               cmd = '과채';
    else if (has('버섯'))               cmd = '버섯';
    else if (has('도움말','명령어','뭐','어떻게','사용법','start')) cmd = 'help';
    else if (has('시황','전체시황','오늘시황')) cmd = '시황';
    else if (searchWord.length >= 1)    cmd = isWeekly ? '주간검색' : '검색';
  }
  if (slashCmd && isWeekly) cmd = '주간검색';

  // ── 단량 추출 헬퍼 ────────────────────────────────────────────────
  const getUnit = (rows) => {
    const units = {};
    rows.forEach(it => {
      const uQty=Number(it.unit_qty)||0, uNm=(it.unit_nm||'').trim(), pkg=(it.pkg_nm||'').trim();
      const ul = uQty ? `${uQty}${uNm}${pkg?' '+pkg:''}` : (pkg||uNm||'-');
      units[ul] = (units[ul]||0)+1;
    });
    return Object.entries(units).sort((a,b)=>b[1]-a[1])[0]?.[0]||'-';
  };

  // ── 공통 응답 생성 (품종+단량 조합으로 분리) ────────────────────────
  const buildReply = async (label, items, targetD, emoji='🔍') => {
    if (!items.length) return null;

    // 단량 추출
    const getUnitLabel = (it) => {
      const uQty=Number(it.unit_qty)||0, uNm=(it.unit_nm||'').trim(), pkg=(it.pkg_nm||'').trim();
      return uQty ? `${uQty}${uNm}${pkg?' '+pkg:''}` : (pkg||uNm||'-');
    };

    // 품종+단량 조합으로 그룹
    const groups = {};
    items.forEach(it => {
      const vrty = it.corp_gds_vrty_nm || '';
      const unit = getUnitLabel(it);
      const key  = vrty ? `${vrty}|||${unit}` : unit;
      if (!groups[key]) groups[key] = { vrty, unit, rows:[] };
      groups[key].rows.push(it);
    });

    // 그룹이 1개이고 품종/단량 구분 없으면 단순 출력
    const gList = Object.values(groups);

    // 7일 평균 (전체 기준)
    const weekItems = [];
    for (let i=1; i<=7; i++) {
      const d = new Date(Date.now()+9*3600*1000); d.setDate(d.getDate()-i);
      const dd = d.toISOString().slice(0,10);
      const wi = await fetchAuction(searchWord, null, dd);
      weekItems.push(...wi);
    }
    const weekAvg = weekItems.length
      ? Math.round(weekItems.reduce((s,it)=>s+Number(it.qty)*Number(it.scsbd_prc),0) /
                   weekItems.reduce((s,it)=>s+Number(it.qty),0))
      : null;

    const dLabel = targetD===today ? `오늘(${today})` : `어제(${yesterday})`;
    let msg = `${emoji} <b>${label} 시세</b>\n${dLabel} 농협부산(공)\n\n`;

    if (gList.length === 1) {
      // 단일 그룹
      const g = gList[0];
      const s = calcStats(g.rows);
      const totalQty = g.rows.reduce((sum,it) => sum + Number(it.qty), 0);
      const nm = g.vrty || label;
      msg += `▪ ${nm} [${g.unit}]\n`;
      msg += `거래: ${s.cnt}건 / 수량: ${totalQty.toLocaleString()}개\n`;
      msg += `최저: ${s.min.toLocaleString()}원\n`;
      msg += `평균: ${s.avg.toLocaleString()}원\n`;
      msg += `최고: ${s.max.toLocaleString()}원`;
    } else {
      // 다중 그룹 — 단량 기준 정렬 (숫자 추출)
      gList.sort((a,b) => {
        const na = parseFloat(a.unit)||0, nb = parseFloat(b.unit)||0;
        if (na !== nb) return na - nb;
        return a.vrty.localeCompare(b.vrty);
      });
      gList.forEach(g => {
        const s = calcStats(g.rows);
        const totalQty = g.rows.reduce((sum,it) => sum + Number(it.qty), 0);
        const nm = g.vrty ? `${g.vrty} [${g.unit}]` : `[${g.unit}]`;
        msg += `▪ ${nm}  ${totalQty.toLocaleString()}개\n`;
        msg += `  최저 ${s.min.toLocaleString()} / 평균 ${s.avg.toLocaleString()} / 최고 ${s.max.toLocaleString()}원 (${s.cnt}건)\n`;
      });
    }

    if (weekAvg) {
      const allS = calcStats(items);
      const pct  = Math.round((allS.avg-weekAvg)/weekAvg*100);
      msg += `\n\n📈 7일평균: ${weekAvg.toLocaleString()}원 (${pct>=0?'▲':'▼'}${Math.abs(pct)}%)`;
    }
    return msg;
  };

  // ── 도움말 ───────────────────────────────────────────────────────
  if (cmd === 'help' || cmd === 'start' || cmd === '도움말') {
    return '🚜 <b>엄궁농산물 시세봇</b>\n농협부산(공) 기준\n\n' +
      '아무 품목명이나 입력하세요!\n\n' +
      '<b>예시</b>\n' +
      '• 가시오이 시세\n• 산딸기 얼마야\n• 수박 일주일\n• 어제 로메인\n• 당근 주간\n\n' +
      '<b>카테고리</b>\n/과일 /채소 /과채 /버섯\n\n' +
      '<b>전체 시황</b>\n/시황 — 지금 바로 전체 시황 이미지 받기\n\n' +
      '<b>알림 관리</b>\n/추적목록 /추적추가 품목명 /추적삭제 품목명\n\n' +
      `📅 기준: 오늘(${today})`;
  }

  // ── 카테고리 조회 ────────────────────────────────────────────────
  const categories = {
    '과일': { icon:'🍎', list:['딸기','수박','참외','사과','배','포도','복숭아','블루베리','메론','바나나','파인애플','만감','단감','감귤','레몬','오렌지','망고'] },
    '채소': { icon:'🥬', list:['배추','양배추','상추','치커리','케일','브로코리(녹색꽃양배','청경채','대파','쪽파','시금치','깻잎','열무','얼갈이배추','부추','쑥갓','쑥','근대','미나리','취나물','참나물','곤달비'] },
    '과채': { icon:'🫑', list:['풋고추','꽈리고추','홍고추','오이','호박','가지','파프리카','피망(단고추)','토마토','방울토마토','무','당근','양파','감자','고구마','마늘','우엉'] },
    '버섯': { icon:'🍄', list:['느타리버섯','새송이','표고버섯','만가닥','팽이버섯','양송이'] },
  };
  for (const [catKey, cat] of Object.entries(categories)) {
    if (cmd === catKey || cmd === catKey+'류') {
      let msg = `${cat.icon} <b>${catKey}류 시세</b>\n${dateLabel} 농협부산(공)\n\n`;
      for (const nm of cat.list) {
        const items = await fetchAuction(nm, null, targetDate);
        if (!items.length) continue;
        const s    = calcStats(items);
        const unit = getUnit(items);
        const totalQty = items.reduce((sum,it) => sum + Number(it.qty), 0);
        msg += `▪ ${nm} [${unit}] ${totalQty.toLocaleString()}개  평균 ${s.avg.toLocaleString()}원 (${s.cnt}건)\n`;
      }
      return msg.length > 80 ? msg : `${cat.icon} ${dateLabel} ${catKey}류 경락 없음`;
    }
  }

  // ── 주간 검색 ────────────────────────────────────────────────────
  if (cmd === '주간검색' && searchWord.length >= 1) {
    const days = [];
    for (let i=0; i<7; i++) {
      const d=new Date(Date.now()+9*3600*1000); d.setDate(d.getDate()-i);
      days.push(d.toISOString().slice(0,10));
    }
    const results = [];
    for (const d of days) {
      const items = await fetchAuction(searchWord, null, d);
      if (!items.length) continue;
      const s = calcStats(items); const unit = getUnit(items);
      const totalQty = items.reduce((sum,it) => sum + Number(it.qty), 0);
      results.push({ date:d, unit, totalQty, ...s });
    }
    if (!results.length) return `🔍 <b>${searchWord}</b>\n최근 7일 경락 없음`;
    const weekAvg = Math.round(results.reduce((s,r)=>s+r.avg*r.cnt,0)/results.reduce((s,r)=>s+r.cnt,0));
    let msg = `🔍 <b>${searchWord} 주간 시세</b>\n최근 7일 농협부산(공)\n\n`;
    results.forEach(r => {
      msg += `▪ ${r.date.slice(5)} [${r.unit}] ${r.totalQty.toLocaleString()}개\n`;
      msg += `  최저${r.min.toLocaleString()} / 평균${r.avg.toLocaleString()} / 최고${r.max.toLocaleString()}원 (${r.cnt}건)\n`;
    });
    msg += `\n📊 7일 평균: ${weekAvg.toLocaleString()}원`;
    return msg;
  }

  // ── 단일 품목 검색 (전품목 공통 응답) ────────────────────────────
  if (cmd === '검색' && searchWord.length >= 1) {
    let items = await fetchAuction(searchWord, null, targetDate);

    // 오늘 없으면 어제 자동 조회
    let usedDate = targetDate;
    if (!items.length && targetDate === today) {
      items = await fetchAuction(searchWord, null, yesterday);
      usedDate = yesterday;
    }

    if (!items.length) {
      return `🔍 <b>${searchWord}</b>\n최근 2일 경락 없음\n주간 조회: "${searchWord} 일주일 시세"`;
    }

    const reply = await buildReply(searchWord, items, usedDate, '🔍');
    return reply || `🔍 ${searchWord} 조회 실패`;
  }

  // ── 지정 품목 추가/삭제 ──────────────────────────────────────────
  const { addTracked, removeTracked, loadTracked } = require('./scheduler');

  if (cmd === '추적목록' || cmd === '지정목록') {
    const list = loadTracked();
    const listStr = list.length ? list.map((v,i)=>(i+1)+'. '+v).join('\n') : '없음';
    return '🎯 지정 품목 목록 (매일 06:30 텔레그램)\n\n' + listStr + '\n\n추가: /추적추가 품목명\n삭제: /추적삭제 품목명';
  }
  const addMatch = raw.match(new RegExp('^[/]?(추적추가|지정추가)\\s+(.+)'));
  if (addMatch) {
    const item = addMatch[2].trim();
    return addTracked(item) ? '✅ '+item+' 추가됨\n매일 06:30 텔레그램으로 받습니다' : '⚠️ '+item+' 이미 등록됨';
  }
  const delMatch = raw.match(new RegExp('^[/]?(추적삭제|지정삭제)\\s+(.+)'));
  if (delMatch) {
    const item = delMatch[2].trim();
    return removeTracked(item) ? '✅ '+item+' 삭제됨' : '⚠️ '+item+' 목록에 없음';
  }



  // ── 전체 시황 수동 요청 ───────────────────────────────────────────
  if (cmd === '시황' || cmd === '전체시황' || cmd === '오늘시황') {
    await sendTelegramTo(chatId, '📊 전체 시황 생성 중... 잠시만 기다려주세요!');
    try {
      const { sendMarketSummary } = require('./scheduler');
      await sendMarketSummary('수동요청');
    } catch(e) {
      return '❌ 시황 생성 실패: ' + e.message;
    }
    return null;
  }

  return '❓ 품목명을 입력하거나 /도움말 로 명령어 확인';
}
// 텔레그램 polling
let lastUpdateId = 0;
const SERVER_START_TIME = Math.floor(Date.now() / 1000); // 서버 시작 Unix timestamp

// _server_polling_robust_v1_ - fetch lockup 방지 (AbortController 30s + isPolling guard)
let _isPolling = false;
async function pollTelegram() {
  if (!TG_TOKEN) return;
  if (_isPolling) return;
  _isPolling = true;
  let _abortCtrl = null;
  let _abortTimer = null;
  try {
    const params = new (require('url').URLSearchParams)({
      offset: String(lastUpdateId + 1),
      timeout: '25',
    });
    _abortCtrl = new AbortController();
    _abortTimer = setTimeout(() => { try { _abortCtrl.abort(); } catch (_) {} }, 30000);
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?${params}`, { signal: _abortCtrl.signal });
    clearTimeout(_abortTimer); _abortTimer = null;
    const data = await res.json();
    if (!data.ok || !data.result.length) return;

    for (const update of data.result) {
      lastUpdateId = update.update_id;
      const msg = update.message;
      if (!msg?.text) continue;
      // 시세봇 화이트리스트 v2
      const text = msg.text;
      const isPriceQuery  = /시세|시황/.test(text);
      const isWeeklyQuery = /일주일|7일|주간|weekly/.test(text);
      const isCategoryCmd = /^\/(과일|채소|과채|버섯)류?(\s|$)/.test(text);
      const isTrackCmd    = /^\/(추적|지정)(목록|추가|삭제)(\s|$)/.test(text);
      const isHelpCmd     = /^\/(도움말|help|start)(\s|$)/.test(text);
      const _svPriceCmd   = /변경|수정|바꿔|단가변경/.test(text);
      if (!isPriceQuery && !isWeeklyQuery && !isCategoryCmd && !isTrackCmd && !isHelpCmd && !_svPriceCmd) continue;

      if (msg.date < SERVER_START_TIME) {
        console.log(`⏭ 과거 메시지 스킵: [${msg.from?.first_name}] ${msg.text}`);
        continue;
      }

      const chatId = String(msg.chat.id);
      console.log(`📱 텔레그램 수신 [${msg.from?.first_name}]: ${msg.text}`);
      if(isPriceQuery||isWeeklyQuery||isCategoryCmd){sendTelegramTo(chatId,"🔍 "+msg.text.replace(/오늘|시세|시황|일주일|7일|주간|weekly/g,"").trim()+" 조회 중...").catch(()=>{});}
      (async()=>{
        const TIMEOUT_MS=30000;
        let timer;
        const timeoutPromise=new Promise(r=>{timer=setTimeout(()=>r({__TIMEOUT__:true}),TIMEOUT_MS);});
        try{
          const result=await Promise.race([handleCommand(msg.text,chatId),timeoutPromise]);
          clearTimeout(timer);
          if(result&&result.__TIMEOUT__){
            console.error("[poll] handleCommand 30s timeout:",msg.text);
            await sendTelegramTo(chatId,"⚠️ 응답 시간 초과 (30초). 잠시 후 다시 시도해주세요.").catch(()=>{});
          }else if(result){
            const ok=await sendTelegramTo(chatId,result);
            if(!ok)console.error("[poll] sendTelegramTo failed for:",msg.text);
          }else{
            console.log("[poll] no reply for:",msg.text);
          }
        }catch(e){clearTimeout(timer);console.error("[poll]",e.message);}
      })().catch(e=>console.error("[poll-outer]",e.message));



    }
  } catch(e) {
    // timeout/abort/network 모두 무시 — 다음 cycle 재시도
  } finally {
    if (_abortTimer) clearTimeout(_abortTimer);
    _isPolling = false;
  }
}

async function sendTelegramTo(chatId, text) {
  // _sendtg_v4_robust_ - 에러 로깅 + statusCode 체크 + 자동 retry 1회
  const attempt = (retryNum) => new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
        } else {
          console.error('[tg] HTTP ' + res.statusCode + ' retry=' + retryNum + ' body:', data.slice(0, 250));
          resolve(false);
        }
      });
    });
    req.on('error', err => {
      console.error('[tg] error retry=' + retryNum + ':', err.code || err.message);
      resolve(false);
    });
    req.on('timeout', () => {
      console.error('[tg] timeout 15s retry=' + retryNum);
      try { req.destroy(); } catch (_) {}
      resolve(false);
    });
    req.write(body);
    req.end();
  });
  const ok = await attempt(0);
  if (ok) return true;
  await new Promise(r => setTimeout(r, 2000));
  return await attempt(1);
}

if (TG_TOKEN) {
  (function loop(){pollTelegram().catch(()=>{}).then(()=>setTimeout(loop,200));})(); // 3초마다 체크
  console.log(`\n📱 텔레그램 봇 시작: @Gotgani_bot`);
}
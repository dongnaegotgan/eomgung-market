// WATCH: v3.1 — 풀 B안 (감지만, 자동처리 없음, TG 사전승인 필수)
// v3.1: 시작 시 _pending 잔존 파일 스캔 + 묶음 알림
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const { readExcel, makeTg, analyzeSuspicion, calcTotal } = require('./lib/orderHelpers');

const DOWNLOADS = path.join(process.env.USERPROFILE || 'C:/Users/moapi', 'Downloads');
const ROOT = __dirname;
const PENDING_DIR = path.join(ROOT, '_pending');
const TIMEOUT_DIR = path.join(ROOT, '_timeout');
const PROCESSED_ORDERS_FILE = path.join(ROOT, '_processed_orders.txt');

// _orders_to_status_bot_v1_ - 신규주문 알림 → @gotgan_status_bot 발송
const TG_TOKEN = process.env.TG_STATUS_TOKEN || process.env.TG_TOKEN || '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT = process.env.TG_CHAT || '6097520392';
const tg = makeTg(TG_TOKEN, TG_CHAT);

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5분 무응답 시 보류

function log(m) { console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${m}`); }
function fmtAmount(n) { return new Intl.NumberFormat('ko-KR').format(n); }

// 이전 처리된 주문번호 로드 (중복출력 검출용)
function loadProcessedOrders() {
  if (!fs.existsSync(PROCESSED_ORDERS_FILE)) return new Set();
  try {
    return new Set(
      fs.readFileSync(PROCESSED_ORDERS_FILE, 'utf8')
        .split('\n').filter(Boolean)
        .map(line => line.split('\t')[0])
    );
  } catch { return new Set(); }
}

// pending 파일에 timeout 타이머 — N ms 후 정리 (msUntilTimeout 미지정 시 5분)
function scheduleTimeout(pendingId, msUntilTimeout) {
  const ms = (msUntilTimeout != null) ? msUntilTimeout : APPROVAL_TIMEOUT_MS;
  setTimeout(() => {
    const xlsx = path.join(PENDING_DIR, `${pendingId}.xlsx`);
    const json = path.join(PENDING_DIR, `${pendingId}.json`);
    if (!fs.existsSync(xlsx)) return; // 이미 처리됨/취소됨

    // 처리 중 상태면 timeout 보류 (재시작 직후 /처리시작 친 케이스 보호)
    try {
      const meta = JSON.parse(fs.readFileSync(json, 'utf8'));
      if (meta.status === 'processing') {
        log(`TIMEOUT 보류 (처리 중): ${pendingId}`);
        return;
      }
    } catch {}

    fs.mkdirSync(TIMEOUT_DIR, { recursive: true });
    try { fs.renameSync(xlsx, path.join(TIMEOUT_DIR, `${pendingId}.xlsx`)); } catch {}
    try { fs.renameSync(json, path.join(TIMEOUT_DIR, `${pendingId}.json`)); } catch {}
    tg(`⏰ 5분 무응답 → 자동 보류\nID: <code>${pendingId}</code>\n\n나중에 처리하려면 <code>/처리시작 ${pendingId}</code>`);
    log(`TIMEOUT: ${pendingId} → _timeout/`);
  }, ms);
}

// ── 시작 시 _pending 스캔 (PM2 재시작 후 잔존 파일 정리) ──
async function startupScanPending() {
  fs.mkdirSync(PENDING_DIR, { recursive: true });
  fs.mkdirSync(TIMEOUT_DIR, { recursive: true });

  let jsonFiles;
  try {
    jsonFiles = fs.readdirSync(PENDING_DIR).filter(f => f.endsWith('.json'));
  } catch (e) {
    log(`STARTUP SCAN ERR: ${e.message}`);
    return;
  }

  if (jsonFiles.length === 0) {
    log('STARTUP SCAN: _pending 비어있음');
    return;
  }

  const expired = [];    // 5분 초과 awaiting → _timeout 이동
  const inProgress = []; // status: processing 잔존 (인쇄물 확인 요망)
  const survived = [];   // 5분 미만 awaiting → 타이머 재등록

  const now = Date.now();
  for (const jf of jsonFiles) {
    const id = jf.replace('.json', '');
    const jsonPath = path.join(PENDING_DIR, jf);
    let meta;
    try { meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); }
    catch { meta = { id, detectedAt: null }; }

    if (meta.status === 'processing') {
      inProgress.push({ id, meta });
      continue;
    }

    const detectedMs = meta.detectedAt ? new Date(meta.detectedAt).getTime() : 0;
    const elapsedMs = detectedMs ? now - detectedMs : APPROVAL_TIMEOUT_MS + 1;

    if (elapsedMs >= APPROVAL_TIMEOUT_MS) {
      // 5분 초과 → 즉시 _timeout 이동
      const xlsx = path.join(PENDING_DIR, `${id}.xlsx`);
      try { if (fs.existsSync(xlsx)) fs.renameSync(xlsx, path.join(TIMEOUT_DIR, `${id}.xlsx`)); } catch {}
      try { fs.renameSync(jsonPath, path.join(TIMEOUT_DIR, `${id}.json`)); } catch {}
      expired.push({ id, meta });
      log(`STARTUP TIMEOUT: ${id} → _timeout/`);
    } else {
      // 5분 미만 → 남은 시간으로 타이머 재등록
      const remainMs = APPROVAL_TIMEOUT_MS - elapsedMs;
      scheduleTimeout(id, remainMs);
      survived.push({ id, remainMs, meta });
      log(`STARTUP RESCHEDULE: ${id} (남은 ${Math.ceil(remainMs/1000)}초)`);
    }
  }

  // ── 묶음 알림 한 통 ──
  if (expired.length === 0 && inProgress.length === 0 && survived.length === 0) return;

  let msg = '🧹 <b>PM2 재시작 — 잔존 파일 정리</b>\n\n';

  if (expired.length > 0) {
    msg += `<b>⏰ 자동 보류 (${expired.length}건)</b>\n`;
    for (const e of expired) {
      msg += `  • <code>${e.id}</code>`;
      if (e.meta.rowCount != null) {
        msg += ` (${e.meta.rowCount}행, ${e.meta.dateRangeDays || '?'}일치)`;
      }
      msg += '\n';
    }
    msg += '\n';
  }

  if (inProgress.length > 0) {
    msg += `<b>⚠️ 처리 중이던 (${inProgress.length}건) — 인쇄물 확인 요망</b>\n`;
    for (const p of inProgress) {
      msg += `  • <code>${p.id}</code>`;
      if (p.meta.startedAt) msg += ` (${p.meta.startedAt.slice(11,19)} 시작)`;
      msg += '\n';
    }
    msg += '메타 수동 정리: _pending → _processed 이동 또는 status 필드 삭제\n\n';
  }

  if (survived.length > 0) {
    msg += `<b>⏳ 대기 유지 (${survived.length}건)</b>\n`;
    for (const s of survived) {
      msg += `  • <code>${s.id}</code> — 남은 ${Math.ceil(s.remainMs/1000)}초\n`;
    }
  }

  await tg(msg);
}

async function detectFile(srcPath) {
  fs.mkdirSync(PENDING_DIR, { recursive: true });

  // 엑셀 읽고 분석
  log(`READ ${path.basename(srcPath)}...`);
  let rows;
  try {
    rows = await readExcel(srcPath);
  } catch (e) {
    log(`엑셀 읽기 실패: ${e.message}`);
    await tg(`<b>[동네곳간] 파일 읽기 실패</b>\n${path.basename(srcPath)}\n${e.message}`);
    return;
  }
  if (rows.length === 0) {
    log('빈 파일');
    return;
  }

  // 분석
  const sus = analyzeSuspicion(rows);
  const total = calcTotal(rows);

  // 중복 주문번호 체크 (이전 처리분에 동일 주문 있는지)
  const processed = loadProcessedOrders();
  const orderNos = [...new Set(rows.map(r => String(r['주문번호'] || '').trim()).filter(Boolean))];
  const dupOrders = orderNos.filter(o => processed.has(o));
  if (dupOrders.length > 0) {
    sus.suspicious = true;
    sus.reasons.push(`이미 처리된 주문 ${dupOrders.length}건 포함`);
  }

  // pendingId = 타임스탬프 기반 (파일명 충돌 방지)
  const ts = new Date();
  const pendingId = `ord_${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}_${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}${String(ts.getSeconds()).padStart(2,'0')}`;

  const pendingXlsx = path.join(PENDING_DIR, `${pendingId}.xlsx`);
  const pendingJson = path.join(PENDING_DIR, `${pendingId}.json`);
  fs.copyFileSync(srcPath, pendingXlsx);

  const meta = {
    id: pendingId,
    originalFilename: path.basename(srcPath),
    detectedAt: ts.toISOString(),
    rowCount: sus.rowCount,
    orderCount: sus.orderCount,
    dateRange: [sus.oldest, sus.newest],
    dateRangeDays: sus.dateRangeDays,
    totalAmount: total,
    suspicious: sus.suspicious,
    suspicionReasons: sus.reasons,
    duplicateOrders: dupOrders,
    status: 'awaiting',
  };
  fs.writeFileSync(pendingJson, JSON.stringify(meta, null, 2));

  // 텔레그램 알림
  const susBlock = sus.suspicious
    ? `🚨 <b>의심 사유</b>\n${sus.reasons.map(r => `  • ${r}`).join('\n')}\n\n` +
      `<b>의심 파일은 ID 명시 필수</b>:\n<code>/처리시작 ${pendingId}</code>\n<code>/취소 ${pendingId}</code>`
    : `✅ 정상 범위\n\n처리: <code>/처리시작</code>\n취소: <code>/취소</code>`;

  const icon = sus.suspicious ? '⚠️' : '🆕';
  const head = sus.suspicious ? '<b>의심 주문 파일 감지</b>' : '<b>새 주문 파일 감지</b>';

  await tg(
    `${icon} ${head}\n\n` +
    `파일: <code>${path.basename(srcPath)}</code>\n` +
    `ID: <code>${pendingId}</code>\n\n` +
    `📊 행수 ${sus.rowCount}건 / 주문번호 ${sus.orderCount}개\n` +
    `📅 ${sus.oldest || '?'} ~ ${sus.newest || '?'} (${sus.dateRangeDays}일치)\n` +
    `💰 약 ${fmtAmount(total)}원\n\n` +
    susBlock + `\n\n⏱️ 5분 무응답 시 자동 보류`
  );
  log(`PENDING: ${pendingId}  rows=${sus.rowCount} orders=${sus.orderCount} ${sus.suspicious ? '🚨' : 'OK'}`);
  scheduleTimeout(pendingId);

  // 원본 파일은 그대로 둠 — 사용자가 다시 다운로드해도 동일 ID 안 생기게
  // (timeout 후엔 _timeout/ 으로 이동되어 재처리 막힘)
}

// ── 진입점 ──
let processing = false, lastFile = '', lastTime = 0;

async function main() {
  // 1) 시작 스캔 — 실패해도 watch는 계속 (메인 기능 보호)
  try {
    await startupScanPending();
  } catch (e) {
    log(`STARTUP SCAN ERR: ${e.message}`);
  }

  // 2) Downloads 감시 시작
  log(`WATCH (v3.1 풀B안): ${DOWNLOADS}`);
  log(`PENDING: ${PENDING_DIR}`);

  fs.watch(DOWNLOADS, (event, filename) => {
    if (!filename || !filename.match(/^order_\d+.*\.xlsx$/)) return;
    if (processing) return;
    const now = Date.now();
    if (filename === lastFile && now - lastTime < 20000) return;

    const fp = path.join(DOWNLOADS, filename);
    setTimeout(async () => {
      try {
        if (!fs.existsSync(fp)) return;
        const stat = fs.statSync(fp);
        if (stat.size < 1000) return;
        if (filename === lastFile && Date.now() - lastTime < 20000) return;
        lastFile = filename;
        lastTime = Date.now();
        processing = true;
        log(`NEW: ${filename} (${(stat.size/1024).toFixed(0)}KB)`);
        try { await detectFile(fp); }
        catch (e) {
          log(`ERR: ${e.message}`);
          await tg(`<b>[동네곳간] 감지 오류</b>\n${e.message}`);
        }
      } finally {
        processing = false;
      }
    }, 2000);
  });
}

main();
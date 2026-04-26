// 텔레그램 사전승인 핸들러 (tg_status_bot.js에서 사용)
// 명령: /처리시작 [id?]  /취소 [id?]  /대기목록
// v2: race lock (안3 — 메모리 Set + JSON status)
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PENDING_DIR = path.join(ROOT, '_pending');
const CANCELLED_DIR = path.join(ROOT, '_cancelled');
const PROCESS_ORDER_JS = path.join(ROOT, 'processOrder.js');

// ── Race lock — 메모리 즉시 거부용 (안3) ──
// 같은 PM2 프로세스(gotgan-status) 안에서만 호출되므로 cross-process lock 불필요
// JSON status 'processing'이 영구 락 역할 (PM2 재시작 후에도 보호)
const inFlight = new Set();
const MEMORY_LOCK_TTL_MS = 5 * 60 * 1000; // 5분 (실제 처리 1~2분이라 안전 마진)

function listPending() {
  try {
    return fs.readdirSync(PENDING_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
      .sort();
  } catch { return []; }
}

function loadMeta(id) {
  try { return JSON.parse(fs.readFileSync(path.join(PENDING_DIR, `${id}.json`), 'utf8')); }
  catch { return null; }
}

function saveMeta(id, meta) {
  try {
    fs.writeFileSync(path.join(PENDING_DIR, `${id}.json`), JSON.stringify(meta, null, 2));
    return true;
  } catch { return false; }
}

// tgSend(msg, chatId) 함수를 인자로 받아 핸들러 클로저 반환
module.exports = function createApprovalHandler(tgSend) {
  function handleList(chatId) {
    const ids = listPending();
    if (ids.length === 0) { tgSend('대기 중인 파일 없음', chatId); return; }
    let msg = '<b>📋 대기 중인 파일</b>\n\n';
    for (const id of ids) {
      const meta = loadMeta(id);
      if (!meta) { msg += `<code>${id}</code> (메타 오류)\n\n`; continue; }
      const sus = meta.suspicious ? '🚨 ' : '';
      const proc = meta.status === 'processing' ? '⚙️ 처리 중 ' : '';
      msg += `${proc}${sus}<code>${id}</code>\n`;
      msg += `  ${meta.rowCount}건/${meta.orderCount}주문, ${meta.dateRangeDays}일치\n`;
      if (meta.suspicious) msg += `  사유: ${(meta.suspicionReasons || []).join(', ')}\n`;
      msg += '\n';
    }
    msg += '처리: <code>/처리시작 [ID]</code>\n취소: <code>/취소 [ID]</code>';
    tgSend(msg, chatId);
  }

  function handleApprove(idArg, chatId) {
    let id = idArg;
    if (!id) {
      const ids = listPending();
      if (ids.length === 0) { tgSend('대기 중인 파일 없음', chatId); return; }
      // 처리 중인 것 제외하고 가장 최근
      const candidates = ids.filter(i => {
        const m = loadMeta(i);
        return !m || m.status !== 'processing';
      });
      if (candidates.length === 0) { tgSend('처리 가능한 파일 없음 (모두 처리 중)', chatId); return; }
      id = candidates[candidates.length - 1];
    }

    const xlsx = path.join(PENDING_DIR, `${id}.xlsx`);
    if (!fs.existsSync(xlsx)) { tgSend(`해당 ID 없음: <code>${id}</code>`, chatId); return; }

    // ── Race lock 체크 ──
    if (inFlight.has(id)) {
      tgSend(`⚠️ 이미 처리 중: <code>${id}</code>`, chatId);
      return;
    }
    const meta = loadMeta(id);
    if (meta && meta.status === 'processing') {
      tgSend(
        `⚠️ 이미 처리 시작됨 (이전 세션): <code>${id}</code>\n` +
        `시작: ${meta.startedAt || '?'}\n` +
        `인쇄물 확인 후 메타 수동 정리 필요`,
        chatId
      );
      return;
    }

    if (meta && meta.suspicious && !idArg) {
      tgSend(`🚨 의심 파일은 ID 명시 필수\n<code>/처리시작 ${id}</code>`, chatId);
      return;
    }

    // ── 락 획득 ──
    inFlight.add(id);
    if (meta) {
      meta.status = 'processing';
      meta.startedAt = new Date().toISOString();
      saveMeta(id, meta);
    }
    // 메모리 락은 5분 후 안전 해제 (JSON은 _processed/ 이동으로 자연 해제)
    setTimeout(() => inFlight.delete(id), MEMORY_LOCK_TTL_MS);

    tgSend(`▶️ 처리 시작: <code>${id}</code>`, chatId);
    const child = spawn('node', [PROCESS_ORDER_JS, id], { detached: true, stdio: 'ignore' });
    child.unref();
  }

  function handleCancel(idArg, chatId) {
    let id = idArg;
    if (!id) {
      const ids = listPending();
      if (ids.length === 0) { tgSend('대기 중인 파일 없음', chatId); return; }
      id = ids[ids.length - 1];
    }

    // 처리 중인 파일 취소 방지
    if (inFlight.has(id)) {
      tgSend(`⚠️ 처리 중인 파일은 취소 불가: <code>${id}</code>`, chatId);
      return;
    }
    const meta = loadMeta(id);
    if (meta && meta.status === 'processing') {
      tgSend(
        `⚠️ 처리 중 상태인 파일 취소 불가: <code>${id}</code>\n` +
        `인쇄물 확인 후 메타 수동 정리 필요`,
        chatId
      );
      return;
    }

    fs.mkdirSync(CANCELLED_DIR, { recursive: true });
    const fromX = path.join(PENDING_DIR, `${id}.xlsx`);
    const fromJ = path.join(PENDING_DIR, `${id}.json`);
    const toX = path.join(CANCELLED_DIR, `${id}.xlsx`);
    const toJ = path.join(CANCELLED_DIR, `${id}.json`);
    try {
      if (fs.existsSync(fromX)) fs.renameSync(fromX, toX);
      if (fs.existsSync(fromJ)) fs.renameSync(fromJ, toJ);
      tgSend(`🗑️ 취소: <code>${id}</code>`, chatId);
    } catch (e) {
      tgSend(`❌ 취소 실패: ${e.message}`, chatId);
    }
  }

  return {
    // 메인 진입점 — handleCommand 안에서 호출
    // rawText: 원본 메시지 (예: "/처리시작 ord_20260426_193001")
    // returns true if handled, false if not an approval command
    tryHandle(rawText, chatId) {
      const m = rawText.match(/^\/?(처리시작|취소|대기목록)(?:\s+(\S+))?\s*$/);
      if (!m) return false;
      const cmd = m[1];
      const arg = m[2] || null;
      if (cmd === '대기목록') handleList(chatId);
      else if (cmd === '처리시작') handleApprove(arg, chatId);
      else if (cmd === '취소') handleCancel(arg, chatId);
      return true;
    },
  };
};
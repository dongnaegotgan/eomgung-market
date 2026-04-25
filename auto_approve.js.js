/**
 * auto_approve_watch.js — 인증대기 실시간 자동 승인
 * 30초마다 auto_approve.js 실행 (가장 단순하고 확실한 방식)
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHECK_INTERVAL_MS = 30 * 1000;
const LOG_FILE = path.join(__dirname, 'admin_downloads', 'approve_watch.log');
const APPROVE_SCRIPT = path.join(__dirname, 'auto_approve.js');

function logMsg(msg) {
  const line = `[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ${msg}`;
  console.log(line);
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch(e) {}
}

let isRunning = false;
let timer = null;

function doCheck() {
  if (isRunning) return;
  isRunning = true;

  exec(`node "${APPROVE_SCRIPT}"`, { cwd: __dirname }, (err, stdout) => {
    isRunning = false;
    if (!stdout) return;

    // 인증대기 있을 때만 로그 출력
    if (stdout.includes('처리할 업체 없음') || stdout.includes('인증대기 업체가 없')) return;

    const lines = stdout.split('\n').filter(l => l.trim() &&
      (l.includes('✅') || l.includes('❌') || l.includes('🔔') || l.includes('인증대기'))
    );
    if (lines.length) lines.forEach(l => logMsg(l.trim()));
  });
}

function startWatch(intervalMs = CHECK_INTERVAL_MS) {
  logMsg(`🚀 인증대기 감시 시작 (${intervalMs / 1000}초 간격)`);
  doCheck();
  timer = setInterval(doCheck, intervalMs);
  return { stop: stopWatch };
}

function stopWatch() {
  if (timer) { clearInterval(timer); timer = null; }
  logMsg('🛑 감시 중지');
}

if (require.main === module) {
  startWatch();
  process.on('SIGINT', () => { stopWatch(); process.exit(0); });
}

module.exports = { startWatch, stopWatch };
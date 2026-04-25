/**
 * log_viewer.js — 동네곳간 PM2 서버 로그 뷰어
 *
 * 사용법:
 *   node log_viewer.js
 *   브라우저에서 http://localhost:9999 접속
 *
 * pm2로 등록하려면:
 *   pm2 start log_viewer.js --name "gotgan-logview"
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT     = 9999;
const LOG_DIR  = path.join(os.homedir(), '.pm2', 'logs');
const LINES    = 200; // 각 로그 최대 표시 줄 수

const PROCESSES = [
  { key: 'gotgan-server',    label: '🚜 시세봇',        color: '#f59e0b' },
  { key: 'gotgan-status',    label: '📦 현황봇',        color: '#3b82f6' },
  { key: 'gotgan-approve',   label: '✅ 인증승인',      color: '#10b981' },
  { key: 'gotgan-scheduler', label: '⏰ 스케줄러',      color: '#8b5cf6' },
  { key: 'gotgan-watcher',   label: '👁 주문감시',      color: '#ec4899' },
  { key: 'gotgan-mini',      label: '🔌 미니서버',      color: '#6366f1' },
];

function readTail(filePath, maxLines) {
  try {
    if (!fs.existsSync(filePath)) return '(파일 없음)';
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.slice(-maxLines).join('\n');
  } catch (e) {
    return '(읽기 오류: ' + e.message + ')';
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtml(query) {
  const active = query.tab || PROCESSES[0].key;
  const showErr = query.err === '1';

  const tabs = PROCESSES.map(p => {
    const isActive = p.key === active;
    return `<button class="tab ${isActive ? 'active' : ''}" onclick="location.href='?tab=${p.key}${showErr?'&err=1':''}'">
      <span class="dot" style="background:${p.color}"></span>${p.label}
    </button>`;
  }).join('');

  const proc = PROCESSES.find(p => p.key === active) || PROCESSES[0];
  const outFile = path.join(LOG_DIR, proc.key + '-out.log');
  const errFile = path.join(LOG_DIR, proc.key + '-error.log');
  const logContent = showErr ? readTail(errFile, LINES) : readTail(outFile, LINES);

  const lines = logContent.split('\n').map(line => {
    let cls = '';
    if (line.includes('✅') || line.includes('완료') || line.includes('성공')) cls = 'ok';
    else if (line.includes('❌') || line.includes('오류') || line.includes('Error') || line.includes('TypeError')) cls = 'err';
    else if (line.includes('⚠') || line.includes('경고') || line.includes('warn')) cls = 'warn';
    else if (line.includes('🚀') || line.includes('🤖') || line.includes('기동') || line.includes('시작')) cls = 'info';
    return `<div class="line ${cls}">${escapeHtml(line)}</div>`;
  }).join('');

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>동네곳간 서버 로그</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: #0a0a0f;
    color: #e2e8f0;
    font-family: 'Consolas', 'D2Coding', monospace;
    min-height: 100vh;
  }
  .header {
    background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
    border-bottom: 1px solid #1e293b;
    padding: 16px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .header h1 {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: #f1f5f9;
  }
  .header h1 span { color: #6366f1; }
  .timestamp {
    font-size: 12px;
    color: #64748b;
  }
  .refresh-btn {
    background: #1e293b;
    border: 1px solid #334155;
    color: #94a3b8;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
  }
  .refresh-btn:hover { background: #334155; color: #e2e8f0; }

  .tabs {
    display: flex;
    gap: 4px;
    padding: 12px 24px;
    background: #0f172a;
    border-bottom: 1px solid #1e293b;
    flex-wrap: wrap;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #1e293b;
    border: 1px solid #334155;
    color: #94a3b8;
    padding: 7px 14px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .tab:hover { background: #334155; color: #e2e8f0; }
  .tab.active {
    background: #1e1b4b;
    border-color: #6366f1;
    color: #a5b4fc;
  }
  .dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 24px;
    background: #0a0a0f;
    border-bottom: 1px solid #1a1a2e;
  }
  .log-type {
    display: flex;
    gap: 8px;
  }
  .type-btn {
    background: transparent;
    border: 1px solid #1e293b;
    color: #64748b;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    transition: all 0.15s;
  }
  .type-btn.active { border-color: #6366f1; color: #a5b4fc; background: #0f0f2a; }
  .type-btn:hover { color: #e2e8f0; }
  .meta { font-size: 11px; color: #475569; }

  .log-container {
    padding: 0 24px 24px;
    overflow-x: auto;
  }
  .log-box {
    background: #050509;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 16px;
    overflow-y: auto;
    max-height: calc(100vh - 260px);
    margin-top: 12px;
  }
  .line {
    padding: 2px 0;
    font-size: 12.5px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-all;
    color: #94a3b8;
    border-bottom: 1px solid #0d1117;
  }
  .line:last-child { border-bottom: none; }
  .line.ok   { color: #4ade80; }
  .line.err  { color: #f87171; background: rgba(248,113,113,0.05); }
  .line.warn { color: #fbbf24; }
  .line.info { color: #60a5fa; }

  .auto-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #10b981;
    background: rgba(16,185,129,0.1);
    border: 1px solid rgba(16,185,129,0.2);
    padding: 2px 8px;
    border-radius: 4px;
  }
  .pulse {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #10b981;
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse {
    0%,100% { opacity:1; }
    50% { opacity:0.3; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>🏪 <span>동네곳간</span> 서버 로그</h1>
  <div style="display:flex;align-items:center;gap:12px;">
    <span class="auto-badge"><span class="pulse"></span> LIVE</span>
    <span class="timestamp">${now}</span>
    <button class="refresh-btn" onclick="location.reload()">⟳ 새로고침</button>
  </div>
</div>

<div class="tabs">${tabs}</div>

<div class="toolbar">
  <div class="log-type">
    <button class="type-btn ${!showErr?'active':''}" onclick="location.href='?tab=${active}'">OUT 로그</button>
    <button class="type-btn ${showErr?'active':''}" onclick="location.href='?tab=${active}&err=1'">ERROR 로그</button>
  </div>
  <span class="meta">최근 ${LINES}줄 표시 · 자동새로고침 10초</span>
</div>

<div class="log-container">
  <div class="log-box" id="logbox">${lines}</div>
</div>

<script>
  // 자동 스크롤 (맨 아래)
  const box = document.getElementById('logbox');
  box.scrollTop = box.scrollHeight;

  // 10초마다 자동 새로고침
  setTimeout(() => location.reload(), 10000);
</script>
</body>
</html>`;
}

function parseQuery(url) {
  const q = {};
  const idx = url.indexOf('?');
  if (idx < 0) return q;
  url.slice(idx+1).split('&').forEach(part => {
    const [k,v] = part.split('=');
    if (k) q[decodeURIComponent(k)] = decodeURIComponent(v||'');
  });
  return q;
}

const server = http.createServer((req, res) => {
  const q = parseQuery(req.url);
  const html = buildHtml(q);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, () => {
  console.log(`\n🖥  동네곳간 로그 뷰어 시작`);
  console.log(`   http://localhost:${PORT}\n`);
});
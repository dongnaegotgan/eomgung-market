/**
 * mini_server.js — 배송준비 자동화 미니 서버 (포트 3001)
 * 
 * 역할:
 * 1. Chrome 탭 폴링 응답 (/api/download-check)
 * 2. Chrome 탭에서 엑셀 수신 (/api/receive-excel)  
 * 3. 수신 후 엑셀 처리 자동 실행
 * 
 * pm2로 실행: pm2 start mini_server.js --name "gotgan-mini"
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 3001;
const TRIGGER_FILE = path.join(__dirname, '_download_trigger');
const OUT_DIR = path.join(__dirname, 'order_output');

function log(m) { console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${m}`); }

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // ── GET /api/download-check ──────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/download-check') {
    if (fs.existsSync(TRIGGER_FILE)) {
      fs.unlinkSync(TRIGGER_FILE);
      log('🔔 다운로드 트리거 감지 → Chrome 탭에 명령 전송');
      res.writeHead(200);
      res.end(JSON.stringify({ trigger: true }));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ trigger: false }));
    }
    return;
  }

  // ── POST /api/receive-excel ──────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/receive-excel') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { fileName, fileData } = JSON.parse(body);
        if (!fileName || !fileData) throw new Error('파라미터 없음');

        fs.mkdirSync(OUT_DIR, { recursive: true });
        const buf = Buffer.from(fileData, 'base64');
        const filePath = path.join(OUT_DIR, fileName);
        fs.writeFileSync(filePath, buf);
        log(`✅ 엑셀 수신: ${fileName} (${(buf.length/1024).toFixed(0)}KB)`);

        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));

        // 엑셀 처리 실행
        const script = path.join(__dirname, 'order_process.js');
        exec(`node "${script}" --local`, { cwd: __dirname }, (err, stdout) => {
          if (stdout) stdout.trim().split('\n').forEach(l => log(l));
          if (err) log(`❌ 처리 오류: ${err.message}`);
        });

      } catch(e) {
        log(`❌ receive-excel 오류: ${e.message}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── GET /api/trigger (수동 트리거용) ─────────────────────────
  if (req.method === 'GET' && req.url === '/api/trigger') {
    fs.writeFileSync(TRIGGER_FILE, new Date().toISOString());
    log('🔔 수동 트리거 설정');
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, message: '트리거 설정됨' }));
    return;
  }


  if(req.method==='POST'&&req.url==='/write-file'){let b='';req.on('data',d=>{b+=d;});req.on('end',()=>{var d=JSON.parse(b);fs.writeFileSync(require('path').join(__dirname,d.fn),d.ct,'utf8');res.writeHead(200);res.end(JSON.stringify({ok:true}));});return;}
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  log(`🚀 곳간 미니 서버 시작: http://localhost:${PORT}`);
  log('   /api/download-check — Chrome 탭 폴링');
  log('   /api/receive-excel  — 엑셀 수신');
  log('   /api/trigger        — 수동 트리거');
});

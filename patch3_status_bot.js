/**
 * patch3_status_bot.js
 * handleCommand + formatSection 전체를 한글 버전으로 교체
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'tg_status_bot.js');
let src = fs.readFileSync(TARGET, 'utf8');
const original = src;

// ── formatSection + handleCommand 전체를 정규식으로 찾아 교체 ─────────
// "function formatSection" 시작부터 마지막 "}" 이후 poll() 시작 전까지

const replaceBlock = /function formatSection[\s\S]+?(?=\/\/ .{0,10} ?대쭅|\/\/ .{0,10} poll|let lastUpdateId)/;

const newBlock = `function formatSection(title, data) {
  const { orderCount, prodMap } = data;
  const entries = Object.entries(prodMap).filter(([,q])=>q>0).sort((a,b)=>b[1]-a[1]);
  let msg = \`\${title}\\n총 주문: <b>\${orderCount}건</b>\\n\`;
  if (entries.length > 0) {
    msg += \`\\n📦 상품별 수량\\n\`;
    entries.slice(0,15).forEach(([n,q]) => { msg += \`  • \${n} <b>\${q}개</b>\\n\`; });
  } else {
    msg += \`  (상품 정보 없음)\\n\`;
  }
  return msg;
}

// ── 명령 처리 ─────────────────────────────────────────────────────────
let busy = false;
async function handleCommand(cmd, chatId) {
  log(\`처리: \${cmd}\`);

  if (cmd === '/도움말' || cmd === '도움말') {
    await tgSend(
      \`📋 <b>명령어</b>\\n\` +
      \`/현황 — 어드민+곳간 통합\\n\` +
      \`/어드민 — 어드민플러스만\\n\` +
      \`/곳간 — flexgate만\\n\` +
      \`/알림 — 자동승인 상태\\n\` +
      \`/곳간출력 — 주문 엑셀 출력\`,
      chatId
    );
    return;
  }

  if (cmd === '/알림' || cmd === '알림') {
    await tgSend('🔔 gotgan-approve: 30초 간격 인증대기 자동 승인 실행 중', chatId);
    return;
  }

  if (cmd === '/곳간출력' || cmd === '곳간출력') {
    await tgSend('📥 곳간 출력 시작... (약 30초 소요)', chatId);
    (async () => {
      let dlBrowser = null;
      try {
        const os = require('os');
        const DOWNLOADS = require('path').join(os.homedir(), 'Downloads');
        const FG_BASE = 'https://dongnaegotgan.flexgate.co.kr';
        const FG_INTRO = 'https://intro.flexgate.co.kr';

        dlBrowser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'],
          defaultViewport: { width: 1440, height: 900 },
        });
        const dlPage = await dlBrowser.newPage();
        dlPage.on('dialog', d => d.accept().catch(()=>{}));
        const cdp = await dlPage.createCDPSession();
        await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
        await dlPage.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        await dlPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await dlPage.goto(\`\${FG_INTRO}/Mypage/Login\`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(1500);
        const idEl = await dlPage.$('input[name="userId"]');
        const pwEl = await dlPage.$('input[name="password"]');
        if (idEl) { await idEl.click({clickCount:3}); await idEl.type(FG_ID); }
        if (pwEl) { await pwEl.click({clickCount:3}); await pwEl.type(FG_PW); }
        await sleep(500);
        await Promise.all([
          dlPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
          pwEl ? pwEl.press('Enter') : Promise.resolve(),
        ]);
        await sleep(2000);

        const afterUrl = dlPage.url();
        if (!afterUrl.includes('dongnaegotgan.flexgate.co.kr')) {
          await dlBrowser.close();
          await tgSend('❌ 곳간 로그인 실패. 직접 확인 필요.', chatId);
          return;
        }

        await dlPage.goto(\`\${FG_BASE}/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000\`,
          { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(2000);
        await dlPage.waitForFunction(
          () => document.querySelectorAll('input[name="chk"]').length > 0,
          { timeout: 15000, polling: 500 }
        ).catch(()=>{});

        const cnt = await dlPage.evaluate(() => document.querySelectorAll('input[name="chk"]').length);
        if (cnt === 0) {
          await dlBrowser.close();
          await tgSend('📭 배송준비중 주문이 없습니다.', chatId);
          return;
        }

        await dlPage.evaluate(() => {
          document.getElementById('chkCheckDataAll').click();
          document.getElementById('customexcelFrm').value = '94';
        });
        await sleep(500);

        const createPromise = dlPage.waitForResponse(r => r.url().includes('CreateExcelIfile'),
          { timeout: 30000 }).catch(()=>null);
        await dlPage.evaluate(() => orderExcelDownload(3));

        let fileName = null;
        const res = await createPromise;
        if (res) {
          const text = await res.text().catch(()=>'');
          const m = text.match(/order_\\d+\\.xlsx/);
          if (m) fileName = m[0];
          else { try { fileName = JSON.parse(text).fileName || ''; } catch(e){} }
        }

        if (!fileName) {
          await dlBrowser.close();
          await tgSend('❌ 파일 생성 실패.', chatId);
          return;
        }

        await sleep(2000);
        await dlPage.goto(\`\${FG_BASE}/NewOrder/ExcelDownload?fileName=\${encodeURIComponent(fileName)}\`,
          { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
        await sleep(5000);
        await dlBrowser.close();
        await tgSend(\`✅ 곳간 엑셀 다운로드 완료! (\${cnt}건)\\n자동 출력 처리 중..\`, chatId);

      } catch(e) {
        if (dlBrowser) await dlBrowser.close().catch(()=>{});
        await tgSend(\`❌ 곳간 출력 오류: \${e.message}\`, chatId);
      }
    })();
    return;
  }

  if (busy) { await tgSend('⏳ 조회 중입니다...', chatId); return; }
  busy = true;

  try {
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    if (cmd === '/현황' || cmd === '현황') {
      log('통합 현황 조회...');
      await tgSend('🔍 조회 중..', chatId);
      const [aR, fR] = await Promise.allSettled([getAdminOrders(), getGotganOrders()]);
      const aD = aR.status==='fulfilled' ? aR.value : null;
      const fD = fR.status==='fulfilled' ? fR.value : null;
      let msg = \`📊 <b>주문현황</b>  \${now}\\n\${'─'.repeat(20)}\\n\\n\`;
      msg += aD ? formatSection('🏪 <b>[어드민] 상품쇼핑몰</b>', aD) : '🏪 어드민 조회 실패\\n';
      msg += '\\n';
      msg += fD ? formatSection('🛒 <b>[곳간] flexgate</b>', fD) : '🛒 곳간 조회 실패\\n';
      await tgSend(msg, chatId);
      log('발송 완료');

    } else if (cmd === '/어드민' || cmd === '어드민') {
      await tgSend('🔍 어드민 조회...', chatId);
      const d = await getAdminOrders();
      await tgSend(\`📊 <b>어드민</b>  \${now}\\n\\n\` + formatSection('🏪', d), chatId);

    } else if (cmd === '/곳간' || cmd === '곳간') {
      fgLoginTime = 0;
      await tgSend('🔍 곳간 조회...', chatId);
      const d = await getGotganOrders();
      await tgSend(\`📊 <b>곳간</b>  \${now}\\n\\n\` + formatSection('🛒', d), chatId);
    }

  } catch(e) {
    log(\`오류: \${e.message}\`);
    await tgSend(\`❌ 오류: \${e.message}\`, chatId);
  } finally {
    busy = false;
  }
}

`;

if (replaceBlock.test(src)) {
  src = src.replace(replaceBlock, newBlock);
  console.log('✅ 패치 1: formatSection + handleCommand 전체 교체');
} else {
  // fallback: 개행 기준으로 찾기
  const lines = src.split('\n');
  const startIdx = lines.findIndex(l => l.includes('function formatSection'));
  // poll 또는 lastUpdateId 시작 라인 찾기
  const endIdx = lines.findIndex((l, i) => i > startIdx && (
    l.includes('lastUpdateId') || l.includes('polling =') || l.includes('async function poll')
  ));

  if (startIdx >= 0 && endIdx > startIdx) {
    lines.splice(startIdx, endIdx - startIdx, ...newBlock.split('\n'));
    src = lines.join('\n');
    console.log(`✅ 패치 1: formatSection + handleCommand 교체 (라인 ${startIdx}~${endIdx})`);
  } else {
    console.log(`❌ 패치 실패: formatSection을 찾을 수 없음 (startIdx=${startIdx}, endIdx=${endIdx})`);
    process.exit(1);
  }
}

// ── poll() 내 CMDS 재확인 ──────────────────────────────────────────────
if (!src.includes("'/현황'")) {
  src = src.replace(
    /const CMDS = \[[\s\S]*?\];/,
    `const CMDS = [
  '/현황','현황',
  '/어드민','어드민',
  '/곳간','곳간',
  '/도움말','도움말',
  '/알림','알림',
  '/곳간출력','곳간출력'
];`
  );
  console.log('✅ 패치 2: CMDS 배열 재교체');
} else {
  console.log('⏭️  스킵: CMDS 배열 (이미 한글)');
}

// ── 저장 ──────────────────────────────────────────────────────────────
if (src !== original) {
  const bak = TARGET.replace('.js', `.p3bak_${Date.now()}.js`);
  fs.writeFileSync(bak, original, 'utf8');
  fs.writeFileSync(TARGET, src, 'utf8');
  console.log(`\n✅ 패치3 완료!`);
  console.log(`   백업: ${require('path').basename(bak)}`);
  console.log(`\n실행:`);
  console.log(`   pm2 restart gotgan-status`);
  console.log(`   pm2 logs gotgan-status --lines 15 --nostream`);
} else {
  console.log('\n⚠️  변경 없음');
}
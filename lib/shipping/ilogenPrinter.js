/**
 * ilogenPrinter.js  [B'단계]
 *
 * iLOGEN 직접 송장 발행 - 실제 DOM 구조 기반
 *
 * iframe URL: lrm01f-reserve/lrm01f0040.html
 * 주요 selector:
 *   - 엑셀타입: #cbExcelTy (옵션: "A타입 | 곳간어드민")
 *   - 파일열기: #btnOpenfile
 *   - 엑셀검증: #btnChkExcel
 *   - 서버전송: #btnSendServer
 *   - 변환완료탭: #dataTab
 */

const path = require('path');
const fs = require('fs');

const ILOGEN_LOGIN_URL = 'https://logis.ilogen.com/';
const ILOGEN_ID = '54751376';
const ILOGEN_FRAME_URL = 'lrm01f0040';

async function printIlogenLabels(bm, opts) {
  const { excelPath, downloadPath, cookiePath = null, dryRun = false, log = console.log } = opts;
  const page = bm.mainPage;

  // 1. 쿠키 복원
  if (cookiePath && fs.existsSync(cookiePath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
      const client = await page.target().createCDPSession();
      for (const cookie of cookies) await client.send('Network.setCookie', cookie).catch(() => {});
      log(`[I] 쿠키 복원 완료 (${cookies.length}개)`);
    } catch (e) { log('[I] 쿠키 복원 실패 (무시)'); }
  }

  // 2. native 브라우저 다이얼로그 자동 수락 (window.confirm/alert → 자동 "예"/"확인")
  page.on('dialog', async dialog => {
    log(`[I] 브라우저 다이얼로그 자동처리: ${dialog.type()} — "${dialog.message().substring(0, 60)}"`);
    await dialog.accept();
  });

  // 3. iLOGEN 메인 진입
  log('[I] iLOGEN 메인 진입');
  await page.goto(ILOGEN_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // 3. 자동 로그인
  await ensureLoggedIn(page, log, cookiePath);

  // 4. 팝업 닫기 (유통판매채널 → "닫기" 버튼)
  log('[I] 첫 팝업 닫기');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '닫기');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // 5. 예약관리 클릭
  log('[I] 예약관리 메뉴 클릭');
  await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a')).find(a => a.textContent.trim() === '예약관리');
    if (link) link.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // 6. 주문등록/출력(복수건) 클릭
  log('[I] 주문등록/출력(복수건) 클릭');
  await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a')).find(a => a.textContent.trim() === '주문등록/출력(복수건)');
    if (link) link.click();
  });
  await new Promise(r => setTimeout(r, 4000));

  // 7. lrm01f0040 iframe 찾기 (최대 10초 대기)
  log('[I] 작업 iframe 탐색');
  let workFrame = null;
  for (let i = 0; i < 10; i++) {
    workFrame = page.frames().find(f => f.url().includes(ILOGEN_FRAME_URL));
    if (workFrame) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!workFrame) throw new Error('[I] 주문등록/출력 iframe 못 찾음');
  log(`[I] iframe 확인: ${workFrame.url()}`);

  // 8. 엑셀타입 "A타입 | 곳간어드민" 설정
  log('[I] 엑셀타입 설정');
  await workFrame.evaluate(() => {
    const sel = document.querySelector('#cbExcelTy');
    if (!sel) throw new Error('#cbExcelTy 없음');
    const opt = Array.from(sel.options).find(o => o.text.includes('곳간어드민'));
    if (!opt) throw new Error('곳간어드민 옵션 없음');
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  log('[I] 엑셀타입: A타입 | 곳간어드민');

  // 9. 파일열기 (#btnOpenfile)
  log(`[I] 파일 업로드: ${path.basename(excelPath)}`);
  const [fileChooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 15000 }),
    workFrame.evaluate(() => {
      const btn = document.querySelector('#btnOpenfile');
      if (!btn) throw new Error('#btnOpenfile 없음');
      btn.click();
    }),
  ]);
  await fileChooser.accept([excelPath]);
  await new Promise(r => setTimeout(r, 4000));

  // 10. 데이터 로드 대기
  await workFrame.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, { timeout: 20000 });
  log('[I] 엑셀 데이터 로드 완료');

  // 11. dry-run
  if (dryRun) {
    log('[I] dry-run — 서버전송 직전 멈춤');
    return { printed: 0, errors: 0, dryRunStopped: true, invoiceExcelPath: null };
  }

  // 12. 엑셀검증
  log('[I] 엑셀검증');
  await workFrame.evaluate(() => document.querySelector('#btnChkExcel').click());
  await new Promise(r => setTimeout(r, 3000));

  // 13. 서버전송 → Space 2회 (예, 완료확인)
  log('[I] 2.서버전송');
  await workFrame.evaluate(() => document.querySelector('#btnSendServer').click());
  await new Promise(r => setTimeout(r, 2000)); // 예 팝업 뜨는 시간
  log('[I] Space 1/2 — 예');
  await page.keyboard.press('Space');
  await new Promise(r => setTimeout(r, 6000)); // 서버 전송 완료 + 완료확인 팝업 대기
  log('[I] Space 2/2 — 완료 확인');
  await page.keyboard.press('Space');
  await new Promise(r => setTimeout(r, 3000));

  // 16. 변환완료 탭
  log('[I] 변환완료 탭');
  await workFrame.evaluate(() => { const t = document.querySelector('#dataTab'); if (t) t.click(); });
  // IBGrid 데이터 로드 대기 — 미출력 건수 텍스트가 나타날 때까지
  await workFrame.waitForFunction(
    () => /미출력\s*\[/.test(document.body.innerText || ''),
    { timeout: 30000 }
  ).catch(() => {});
  await new Promise(r => setTimeout(r, 3000)); // IBGrid 렌더링 완료 대기

  // 17. 전체 선택 — IBGrid SetValue API로 직접 체크 (JS로 해결, OS 클릭 불필요)
  log('[I] 전체 선택 (IBGrid SetValue API)');
  const checkedCount = await workFrame.evaluate(() => {
    const s = window.sheet4;
    if (!s || !s.Rows) return -1;
    const skipIds = new Set(['Header','HR1','Filter','FormulaRow','NoData','InfoRow','HeightSpace','NoPageData','Toolbar']);
    let count = 0;
    for (const k of Object.keys(s.Rows)) {
      if (!skipIds.has(k)) {
        try { s.SetValue(s.Rows[k], 'isCheck', 1); count++; } catch(e) {}
      }
    }
    return count;
  });
  if (checkedCount < 0) throw new Error('[I] IBGrid sheet4 없음');
  log(`[I] 전체 선택 완료 (${checkedCount}행 체크)`);

  // 18. 3.운송장출력 (#btnSilpPrint) 클릭 → 팝업 뜸
  log('[I] 3.운송장출력');
  await workFrame.evaluate(() => {
    const btn = document.querySelector('#btnSilpPrint');
    if (!btn) throw new Error('#btnSilpPrint 버튼 없음');
    btn.click();
  });
  await new Promise(r => setTimeout(r, 3000)); // 팝업 뜰 시간

  // 18-1. 운송장 발행 팝업 → (신)감열B 행 page.mouse.click()으로 선택
  log('[I] (신)감열B 행 선택');
  const gaYeolBCoords = await (async () => {
    // iframe 위치 (page 기준)
    const iframeEl2 = await page.$('iframe[src*="lrm01f0040"]');
    if (!iframeEl2) return null;
    const iframeBox2 = await iframeEl2.boundingBox();
    // TD 위치 (workFrame 기준)
    const tdRect = await workFrame.evaluate(() => {
      const td = Array.from(document.querySelectorAll('td'))
        .find(el => el.textContent.trim() === '(신)감열B' && el.offsetParent !== null);
      if (!td) return null;
      const r = td.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!tdRect) return null;
    return { x: iframeBox2.x + tdRect.x, y: iframeBox2.y + tdRect.y };
  })();

  if (gaYeolBCoords) {
    log(`[I] (신)감열B 클릭 좌표: (${Math.round(gaYeolBCoords.x)}, ${Math.round(gaYeolBCoords.y)})`);
    await page.mouse.click(gaYeolBCoords.x, gaYeolBCoords.y);
    await new Promise(r => setTimeout(r, 500));
    log('[I] (신)감열B 클릭 완료');
  } else {
    log('[I] ⚠️ (신)감열B TD 좌표 못 찾음 — 첫 번째 행으로 진행');
  }

  // 19. 운송장출력 (#prtBtn) 클릭
  log('[I] 운송장 발행 팝업 → 운송장출력 클릭');
  await workFrame.waitForFunction(
    () => { const btn = document.querySelector('#prtBtn'); return !!(btn && btn.offsetParent !== null); },
    { timeout: 10000 }
  );
  await page.accessibility.snapshot().catch(() => {});
  await workFrame.evaluate(() => document.querySelector('#prtBtn').click());
  log('[I] 운송장출력 클릭 완료');

  // 20. MSG000 팝업 대기 → "예" Space 처리
  log('[I] MSG000 확인 팝업 대기');
  await workFrame.waitForFunction(
    () => {
      const btn = document.querySelector('#btn-popupModal1');
      return !!(btn && btn.offsetParent !== null && btn.textContent.trim() === '예');
    },
    { timeout: 10000 }
  ).catch(() => {});
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.press('Space');
  log('[I] MSG000 예 처리 (Space)');

  // 21. 인쇄 다이얼로그 — Python win32gui로 "인쇄" 창 찾아 "확인" BM_CLICK
  //     좌표/DOM/MCP 모두 실패 → OS 레벨 Win32 메시지로 직접 클릭
  log('[I] 인쇄 다이얼로그 대기 → Python win32gui 확인 클릭 시작');
  const printConfirmPy = require('path').join(require('os').tmpdir(), 'oz_print_confirm.py');
  const pyScript = [
    'import win32gui, win32api, win32process, win32con, time, sys',
    '',
    '# 인쇄 창 나타날 때까지 최대 15초 대기 (0.5초 간격 × 30회)',
    'hwnd = 0',
    'for _ in range(30):',
    '    result = [0]',
    '    def cb(h, _):',
    '        if win32gui.IsWindowVisible(h) and "\uc778\uc1c4" in win32gui.GetWindowText(h):',
    '            result[0] = h',
    '    win32gui.EnumWindows(cb, None)',
    '    if result[0]:',
    '        hwnd = result[0]',
    '        break',
    '    time.sleep(0.5)',
    'if not hwnd:',
    '    print("TIMEOUT"); sys.exit(1)',
    'print("FOUND hwnd=" + str(hwnd))',
    '',
    'btn = [0]',
    'def cb2(h, _):',
    '    if "\ud655\uc778" in win32gui.GetWindowText(h):',
    '        btn[0] = h',
    'try: win32gui.EnumChildWindows(hwnd, cb2, None)',
    'except: pass',
    '',
    'if not btn[0]:',
    '    print("BTN NOT FOUND"); sys.exit(1)',
    'print("BTN hwnd=" + str(btn[0]))',
    '',
    'win32api.SendMessage(btn[0], win32con.BM_CLICK, 0, 0)',
    'time.sleep(0.5)',
    'still = win32gui.IsWindow(hwnd) and win32gui.IsWindowVisible(hwnd)',
    'if not still:',
    '    print("BM_CLICK OK - dialog closed")',
    'else:',
    '    print("BM_CLICK sent but still open")',
    '    sys.exit(1)',
  ].join('\n');
  require('fs').writeFileSync(printConfirmPy, pyScript, 'utf8');
  await new Promise((resolve, reject) => {
    require('child_process').exec(
      'python "' + printConfirmPy + '"',
      { timeout: 20000 },
      (err, stdout, stderr) => {
        const out = (stdout + stderr).trim();
        log('[I] print_confirm: ' + out);
        if (err) { log('[I] ⚠️ print_confirm 실패: ' + err.message); }
        resolve(); // 실패해도 다음 단계 진행
      }
    );
  });
  // 21. 인쇄 완료 팝업 처리 후 엑셀저장
  log('[I] 인쇄 완료 팝업 대기');
  {
    const popupSelectors = ['#btn-popupModal1','#btn-popupModal2','#btn-popupModal3','#btn-popupModal4'];
    let popupBtn = null;
    const allFrames = [workFrame, ...page.frames().filter(f => f !== workFrame)];
    for (let attempt = 0; attempt < 20 && !popupBtn; attempt++) {
      for (const fr of allFrames) {
        for (const sel of popupSelectors) {
          try {
            const el = await fr.$(sel);
            if (el) {
              const visible = await fr.evaluate(s => {
                const b = document.querySelector(s);
                return !!(b && b.offsetParent !== null);
              }, sel);
              if (visible) { popupBtn = el; break; }
            }
          } catch (_) {}
        }
        if (popupBtn) break;
      }
      if (!popupBtn) await new Promise(r => setTimeout(r, 500));
    }
    if (popupBtn) {
      await popupBtn.click();
      log('[I] 완료 팝업 닫힘');
      await new Promise(r => setTimeout(r, 500));
    } else {
      log('[I] 완료 팝업 없음 (무시)');
    }
  }

  log('[I] 엑셀저장');
  const beforeFiles = new Set(fs.readdirSync(downloadPath));
  await workFrame.evaluate(() => {
    // 텍스트로 찾기 (id 없음)
    const btn = document.querySelector('.btn.base.outline.expt')
      || Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '엑셀저장');
    if (!btn) throw new Error('엑셀저장 버튼 없음');
    btn.click();
  });
  const invoiceExcelPath = await waitForDownload(downloadPath, beforeFiles, 60000);
  log(`[I] 다운로드: ${path.basename(invoiceExcelPath)}`);



  const stats = await workFrame.evaluate(() => {
    const txt = document.body.innerText || '';
    return {
      printed: parseInt((txt.match(/출력완료\s*\[?(\d+)\]?/) || [])[1] || '0', 10),
      errors: parseInt((txt.match(/오류\s*\[?(\d+)\]?/) || [])[1] || '0', 10),
    };
  });
  if (stats.errors > 0) throw new Error(`[I] 출력 오류 ${stats.errors}건`);
  log(`[I] 완료: ${stats.printed}건`);

  return { printed: stats.printed, errors: stats.errors, dryRunStopped: false, invoiceExcelPath };
}

async function ensureLoggedIn(page, log, cookiePath) {
  const isLogin = await page.evaluate(() => !!document.querySelector('input[type="password"]')).catch(() => false);
  if (!isLogin) { log('[I] 로그인 상태 확인'); return; }

  const pw = process.env.ILOGEN_PW;
  if (!pw) throw new Error('[I] .env에 ILOGEN_PW 필요');

  log('[I] 자동 로그인');
  const idField = await page.$('input[type="text"]');
  if (idField) { await idField.click({ clickCount: 3 }); await idField.type(ILOGEN_ID, { delay: 50 }); }

  const pwField = await page.$('input[type="password"]');
  if (pwField) {
    await pwField.click();
    await pwField.type(pw, { delay: 50 });
    await new Promise(r => setTimeout(r, 300));
    await pwField.press('Enter');
  }

  await new Promise(r => setTimeout(r, 1500));
  const still = await page.$('input[type="password"]').catch(() => null);
  if (still) {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /로그인/.test(b.textContent));
      if (btn) btn.click();
    });
  }

  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 20000 });
  log('[I] 로그인 완료');
  await new Promise(r => setTimeout(r, 2000));

  if (cookiePath) {
    try {
      const client = await page.target().createCDPSession();
      const { cookies } = await client.send('Network.getAllCookies');
      fs.mkdirSync(path.dirname(cookiePath), { recursive: true });
      fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2), 'utf-8');
      log(`[I] 쿠키 갱신 (${cookies.length}개)`);
    } catch (e) {}
  }
}

async function clickDialogBtn(page, frame, text) {
  // 버튼이 DOM에 실제로 나타날 때까지 대기 (최대 15초)
  await frame.waitForFunction(
    (t) => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === t);
      return !!(btn && btn.offsetParent !== null);
    },
    { timeout: 15000 },
    text
  ).catch(() => {});

  const done = await frame.evaluate((t) => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === t);
    if (btn) { btn.click(); return true; }
    return false;
  }, text).catch(() => false);

  if (!done) {
    await page.evaluate((t) => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === t);
      if (btn) btn.click();
    }, text);
  }
}

async function waitForDownload(downloadPath, beforeFiles, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 1500));
    const files = fs.readdirSync(downloadPath).filter(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp'));
    const newFiles = files.filter(f => !beforeFiles.has(f));
    if (newFiles.length > 0) {
      return path.join(downloadPath, newFiles.sort((a, b) =>
        fs.statSync(path.join(downloadPath, b)).mtimeMs - fs.statSync(path.join(downloadPath, a)).mtimeMs
      )[0]);
    }
  }
  throw new Error('[I] 다운로드 timeout');
}

module.exports = { printIlogenLabels };
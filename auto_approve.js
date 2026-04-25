/**
 * auto_approve.js
 * 매출거래처 "인증대기" 업체 자동 승인 + 텔레그램 알림
 *
 * 실행 방법:
 *   node auto_approve.js        → 전체 인증대기 자동 승인
 *   node auto_approve.js --dry  → 대상 목록만 출력 (실제 수정 안 함)
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ADMIN_URL = 'https://dongnaegotgan.adminplus.co.kr/admin/';
const ID = process.env.ADMIN_ID || 'dongnaegotgan';
const PW = process.env.ADMIN_PW || 'rhtrks12!@';
const DRY_RUN = process.argv.includes('--dry');

const TG_TOKEN = '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc';
const TG_CHAT  = '6097520392';

// ── 텔레그램 발송 ─────────────────────────────────────────────
async function tgSend(msg) {
  try {
    const body = JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML' });
    await new Promise(r => {
      const req = require('https').request({
        hostname: 'api.telegram.org',
        path: `/bot${TG_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => { res.on('data', () => {}); res.on('end', r); });
      req.on('error', r);
      req.write(body);
      req.end();
    });
  } catch (e) {}
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 로그인 ────────────────────────────────────────────────────
async function login(page) {
  console.log('🔑 로그인 중...');
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="password"]');
  const idEl = await page.$('input[name="id"]') || await page.$('input[type="text"]');
  if (idEl) { await idEl.click({ clickCount: 3 }); await idEl.type(ID); }
  const pwEl = await page.$('input[type="password"]');
  if (pwEl) { await pwEl.click({ clickCount: 3 }); await pwEl.type(PW); }
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
    page.keyboard.press('Enter'),
  ]);
  await sleep(2000);
  console.log('  ✅ 로그인 완료\n');
}

// ── 인증대기 업체 목록 수집 ───────────────────────────────────
async function collectPendingList(page) {
  const allTargets = [];

  for (let pageNum = 1; pageNum <= 50; pageNum++) {
    if (pageNum > 1) {
      const moved = await page.evaluate((pn) => {
        const pageLinks = [...document.querySelectorAll('.paging a, .pagination a, a[onclick*="page"]')];
        const targetLink = pageLinks.find(a => a.textContent.trim() === String(pn));
        if (targetLink) { targetLink.click(); return true; }
        if (typeof go === 'function') {
          go(`?mod=trade&actpage=sale.list&page=${pn}&rownum=100`);
          return true;
        }
        return false;
      }, pageNum);
      if (!moved) break;
      await sleep(2000);
    }

    const rows = await page.evaluate(() => {
      const result = [];
      const allRows = document.querySelectorAll('table tbody tr, table tr');
      allRows.forEach((row, idx) => {
        const cells = [...row.querySelectorAll('td')];
        const cellTexts = cells.map(c => c.textContent.trim());
        const isInjeung = cellTexts.some(t => t === '인증대기');
        if (!isInjeung) return;
        const name = cellTexts.filter(t => t.length > 1 && t.length < 50 && !/^\d+$/.test(t) && t !== '인증대기')[0] || `unknown_${idx}`;
        const modBtn = row.querySelector('a[onclick*="mod"], a[onclick*="edit"], a[onclick*="view"], td:last-child a, td:last-child button, a');
        const onclick = modBtn?.getAttribute('onclick') || '';
        const href = modBtn?.href || '';
        const idxMatch = onclick.match(/idx=(\d+)/) || href.match(/idx=(\d+)/) ||
                         onclick.match(/\((\d+)/) || onclick.match(/,\s*(\d+)\s*\)/);
        result.push({ name, onclick, href, idx: idxMatch ? idxMatch[1] : null });
      });
      return result;
    });

    console.log(`  페이지 ${pageNum}: 인증대기 ${rows.length}개`);
    if (rows.length > 0) allTargets.push(...rows);

    const hasNext = await page.evaluate((pn) => {
      const links = [...document.querySelectorAll('.paging a, .pagination a')];
      return links.some(a => a.textContent.trim() === String(pn + 1));
    }, pageNum);
    if (!hasNext) break;
  }

  return allTargets;
}

// ── 단일 업체 팝업에서 승인 처리 ─────────────────────────────
async function processPopup(browser, target) {
  const { name, onclick, href, idx } = target;

  let popupUrl = null;
  if (idx) {
    popupUrl = `${ADMIN_URL}?mod=trade&actpage=sale.form&idx=${idx}`;
  } else if (href && href.includes('http')) {
    popupUrl = href;
  }

  if (!popupUrl) {
    console.log(`  ⚠️ ${name}: URL 구성 불가 (onclick: ${onclick})`);
    return false;
  }

  const popup = await browser.newPage();
  popup.on('dialog', async d => { console.log(`    dialog: ${d.message()}`); await d.accept(); });

  try {
    await popup.goto(popupUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(2000);

    if (DRY_RUN) {
      const title = await popup.title();
      console.log(`  🔍 [DRY] ${name}: 팝업 로드됨 (${title})`);
      return true;
    }

    // 공급가그룹 → 셀러 선택
    await popup.evaluate(() => {
      const labels = [...document.querySelectorAll('label')];
      const sellerLabel = labels.find(l => l.textContent.trim().includes('셀러'));
      if (sellerLabel) {
        const radio = document.getElementById(sellerLabel.getAttribute('for')) ||
                      sellerLabel.querySelector('input[type="radio"]');
        if (radio && !radio.checked) radio.click();
      }
    });
    await sleep(300);

    // 사용여부 → 사용함 선택
    await popup.evaluate(() => {
      const allTrs = [...document.querySelectorAll('tr')];
      for (const tr of allTrs) {
        if (tr.textContent.includes('사용여부')) {
          const labels = [...tr.querySelectorAll('label')];
          const useLabel = labels.find(l => l.textContent.trim() === '사용함');
          if (useLabel) {
            const radio = document.getElementById(useLabel.getAttribute('for')) ||
                          useLabel.querySelector('input[type="radio"]');
            if (radio && !radio.checked) { radio.click(); return; }
          }
          const radios = [...tr.querySelectorAll('input[type="radio"]')];
          radios.forEach(r => {
            const nearText = r.parentElement?.textContent || '';
            if (nearText.includes('사용함')) r.click();
          });
          return;
        }
      }
    });
    await sleep(300);

    // 수정하기 클릭
    const saved = await popup.evaluate(() => {
      const btns = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a')];
      const saveBtn = btns.find(b =>
        b.textContent.includes('수정하기') || b.value?.includes('수정') ||
        b.textContent.includes('저장') || b.value?.includes('저장')
      );
      if (saveBtn) { saveBtn.click(); return saveBtn.textContent || saveBtn.value; }
      return null;
    });

    await sleep(2000);
    console.log(`  ✅ ${name}: 승인완료 (버튼: ${saved})`);
    return true;

  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    return false;
  } finally {
    await popup.close().catch(() => {});
  }
}

// ── 메인 실행 ─────────────────────────────────────────────────
async function run() {
  const startTime = new Date();
  console.log('\n🚀 인증대기 자동 승인 시작');
  if (DRY_RUN) console.log('   ※ DRY RUN 모드\n');

  const outDir = path.join(__dirname, 'admin_downloads');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ko-KR'],
    defaultViewport: { width: 1400, height: 900 },
  });

  const results = { success: [], fail: [] };

  try {
    const page = await browser.newPage();
    page.on('dialog', async d => { await d.accept(); });

    await login(page);

    // 매출거래처 목록으로 이동
    console.log('🔍 매출거래처 목록 로드 중...');
    await page.goto(`${ADMIN_URL}?mod=trade&actpage=sale.list&rownum=100`, { waitUntil: 'networkidle2' });

    let loaded = false;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const text = await page.evaluate(() => document.body.innerText);
      if (text.includes('거래처') && text.length > 3000) {
        loaded = true;
        console.log('  ✅ 페이지 로드됨');
        break;
      }
    }

    if (!loaded) {
      await page.evaluate(() => {
        if (typeof go === 'function') go('?mod=trade&actpage=sale.list&rownum=100');
      });
      await sleep(3000);
    }

    const pageText = await page.evaluate(() => document.body.innerText);
    const hasInjeung = pageText.includes('인증대기');
    console.log(`\n인증대기 포함: ${hasInjeung}`);

    if (!hasInjeung) {
      console.log('\n✅ 처리할 인증대기 거래처 없음!');
      // 텔레그램: 인증대기 없음 알림
      await tgSend(`✅ [어드민] 인증대기 거래처 없음\n${startTime.toLocaleString('ko-KR')}`);
      return;
    }

    // 인증대기 목록 수집
    const targets = await collectPendingList(page);
    console.log(`\n📋 총 ${targets.length}개 인증대기 업체 발견`);

    if (targets.length === 0) {
      await tgSend(`✅ [어드민] 인증대기 거래처 없음\n${startTime.toLocaleString('ko-KR')}`);
      return;
    }

    if (DRY_RUN) {
      console.log('\n🔍 DRY RUN - 대상 목록:');
      targets.forEach((t, i) => console.log(`  ${i+1}. ${t.name} (idx: ${t.idx})`));
      return;
    }

    // 텔레그램: 처리 시작 알림
    await tgSend(`🔄 <b>[어드민] 인증대기 승인 시작</b>\n${startTime.toLocaleString('ko-KR')}\n\n📋 처리 대상: ${targets.length}개\n${targets.map((t,i) => `  ${i+1}. ${t.name}`).join('\n')}`);

    // 순차 처리
    console.log('\n⚙️ 처리 시작...');
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      console.log(`[${i+1}/${targets.length}] ${t.name}...`);
      const ok = await processPopup(browser, t);
      if (ok) results.success.push(t.name);
      else results.fail.push(t.name);
      await sleep(500);
    }

    // 결과 출력
    const endTime = new Date();
    const elapsed = Math.round((endTime - startTime) / 1000);
    console.log('\n═══════════════════════════════════════');
    console.log(`✅ 성공: ${results.success.length}개`);
    console.log(`❌ 실패: ${results.fail.length}개`);
    console.log(`⏱ 소요시간: ${elapsed}초`);
    if (results.fail.length > 0) {
      console.log('\n실패 목록:');
      results.fail.forEach(n => console.log(`  - ${n}`));
    }
    console.log('═══════════════════════════════════════\n');

    // 로그 저장
    const logFile = path.join(outDir, `approve_${new Date().toISOString().slice(0,10)}.json`);
    fs.writeFileSync(logFile, JSON.stringify({ date: endTime.toISOString(), elapsed, ...results }, null, 2));
    console.log(`📄 로그: ${logFile}`);

    // ── 텔레그램 알림 ──────────────────────────────────
    if (results.success.length > 0) {
      const msg = [
        `✅ <b>[어드민] 인증대기 승인 완료!</b>`,
        `${endTime.toLocaleString('ko-KR')}`,
        ``,
        `✅ 승인 완료: <b>${results.success.length}개</b>`,
        ...results.success.map(n => `  · ${n}`),
        results.fail.length > 0 ? `\n❌ 실패: ${results.fail.length}개\n${results.fail.map(n => '  · ' + n).join('\n')}` : '',
        `\n⏱ 소요: ${elapsed}초`
      ].filter(Boolean).join('\n');
      await tgSend(msg);
    } else {
      await tgSend(`❌ <b>[어드민] 승인 실패</b>\n${endTime.toLocaleString('ko-KR')}\n\n처리 대상 ${targets.length}개 중 성공 0개\n${results.fail.map(n => '  · ' + n).join('\n')}`);
    }

  } finally {
    await browser.close();
  }
}

run().catch(async (e) => {
  console.error('❌ 오류:', e.message);
  await tgSend(`❌ <b>[어드민] auto_approve 오류</b>\n${new Date().toLocaleString('ko-KR')}\n\n${e.message}`);
});
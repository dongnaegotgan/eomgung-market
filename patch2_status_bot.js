/**
 * patch2_status_bot.js
 * 1. CMDS 배열에 /현황 추가 (한글 명시)
 * 2. handleCommand에 /현황 케이스 명시 추가
 * 3. 상품 파싱 강화 (flexgate HTML 실제 구조 대응)
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'tg_status_bot.js');
let src = fs.readFileSync(TARGET, 'utf8');
const original = src;
let count = 0;

function patch(desc, from, to) {
  if (src.includes(from)) {
    src = src.replace(from, to);
    count++;
    console.log(`✅ 패치 ${count}: ${desc}`);
    return true;
  }
  console.log(`⏭️  스킵: ${desc}`);
  return false;
}

// ── 패치 1: CMDS 배열 교체 (한글 명시) ──────────────────────────────
// 기존 CMDS 배열 전체를 찾아서 교체
const cmdsPatterns = [
  // 깨진 인코딩 패턴들
  /const CMDS = \[.*?\];/s,
];

let cmdReplaced = false;
for (const pattern of cmdsPatterns) {
  if (pattern.test(src)) {
    src = src.replace(pattern,
      `const CMDS = [
  '/현황','현황',
  '/어드민','어드민',
  '/곳간','곳간',
  '/도움말','도움말',
  '/알림','알림',
  '/곳간출력','곳간출력'
];`
    );
    count++;
    cmdReplaced = true;
    console.log(`✅ 패치 ${count}: CMDS 배열 한글 교체`);
    break;
  }
}
if (!cmdReplaced) {
  console.log('⏭️  스킵: CMDS 배열 (이미 교체됨)');
}

// ── 패치 2: handleCommand 내 /현황 케이스가 한글인지 확인 후 추가 ────
// poll() 내에서 CMDS 체크 후 handleCommand 호출하는 부분도 확인
// handleCommand 내 if 조건들이 깨진 인코딩이면 한글로 교체

// /현황 케이스 (깨진 인코딩 → 한글)
patch(
  '현황 케이스 한글화',
  "if (cmd === '/?꾪솴' || cmd === '?꾪솴') {",
  "if (cmd === '/현황' || cmd === '현황') {"
);

// /어드민 케이스
patch(
  '어드민 케이스 한글화',
  "} else if (cmd === '/?대뱶誘? || cmd === '?대뱶誘?) {",
  "} else if (cmd === '/어드민' || cmd === '어드민') {"
);
patch(
  '어드민 케이스 한글화 (따옴표 변형)',
  "} else if (cmd === '/?대뱶誘?' || cmd === '?대뱶誘?') {",
  "} else if (cmd === '/어드민' || cmd === '어드민') {"
);

// /곳간 케이스
patch(
  '곳간 케이스 한글화',
  "} else if (cmd === '/怨녠컙' || cmd === '怨녠컙') {",
  "} else if (cmd === '/곳간' || cmd === '곳간') {"
);

// /도움말 케이스
patch(
  '도움말 케이스 한글화',
  "if (cmd === '/?꾩?留?' || cmd === '?꾩?留?') {",
  "if (cmd === '/도움말' || cmd === '도움말') {"
);
patch(
  '도움말 케이스 한글화 (따옴표 변형)',
  "if (cmd === '/?꾩?留? || cmd === '?꾩?留?) {",
  "if (cmd === '/도움말' || cmd === '도움말') {"
);

// /알림 케이스
patch(
  '알림 케이스 한글화',
  "if (cmd === '/?뚮┝' || cmd === '?뚮┝') {",
  "if (cmd === '/알림' || cmd === '알림') {"
);
patch(
  '알림 케이스 한글화 (따옴표 변형)',
  "if (cmd === '/?뚮┝' || cmd === '?뚮┝') {",
  "if (cmd === '/알림' || cmd === '알림') {"
);

// /곳간출력 케이스
patch(
  '곳간출력 케이스 한글화',
  "if (cmd === '/怨녠컙異쒕젰' || cmd === '怨녠컙異쒕젰') {",
  "if (cmd === '/곳간출력' || cmd === '곳간출력') {"
);

// ── 패치 3: 상품 파싱 개선 ────────────────────────────────────────────
// flexgate 실제 HTML: "상품명개" 또는 "상품명 N개" 형태로 텍스트 노드에 있음
// Puppeteer evaluate 내부 prodMap 파싱 교체
const oldParsing = `    // ?곹뭹 ?뚯떛 (?뚯씠釉붿뿉??
    const prodMap = await fgPage.evaluate(() => {
      const map = {};
      const rows = document.querySelectorAll('table tr, .order-item, .product-item');
      rows.forEach(row => {
        const text = row.innerText || '';
        // "?곹뭹紐?/ ?섎웾 媛? ?⑦꽩
        const m = text.match(/([^\\n\\/]{2,30})\\s*\\/\\s*(\\d+)\\s*媛?);
        if (m) {
          const name = m[1].trim(); const qty = parseInt(m[2]);
          if (name.length >= 2 && qty > 0 && !/?뚭퀎|?⑷퀎|寃곗젣|諛곗넚|?좏깮/.test(name))
            map[name] = (map[name]||0) + qty;
        }
      });
      return map;
    });`;

const newParsing = `    // 상품 파싱 (flexgate 실제 HTML 구조 대응)
    const prodMap = await fgPage.evaluate(() => {
      const map = {};

      // 방법 A: tbody tr 셀에서 "상품명 / N개" 패턴 탐색
      document.querySelectorAll('table tbody tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')].map(td =>
          (td.innerText || td.textContent || '').replace(/\\s+/g, ' ').trim()
        );
        cells.forEach(cell => {
          // "상품명 / 숫자" 또는 "상품명 숫자개"
          const m1 = cell.match(/^([^/\\n]{2,30}?)\\s*\\/\\s*(\\d+)/);
          const m2 = cell.match(/^([^\\n]{2,30}?)\\s+(\\d+)\\s*개/);
          const m = m1 || m2;
          if (m) {
            const name = m[1].trim(); const qty = parseInt(m[2]);
            if (name.length >= 2 && qty > 0 && qty < 9999 &&
                !/배송비|배송|주소|전화|합계|취소|금액|결제|원$/.test(name))
              map[name] = (map[name] || 0) + qty;
          }
        });
      });

      // 방법 B: 전체 텍스트에서 "N개" 패턴 (방법A 보완)
      if (Object.keys(map).length === 0) {
        const lines = (document.body.innerText || '').split('\\n');
        lines.forEach(line => {
          line = line.trim();
          const m = line.match(/^([^\\t/]{2,30}?)\\s+(\\d+)\\s*개/);
          if (m) {
            const name = m[1].trim(); const qty = parseInt(m[2]);
            if (name.length >= 2 && qty > 0 && qty < 9999 &&
                !/배송비|배송|주소|전화|합계|취소|금액|결제|원$|\\d/.test(name))
              map[name] = (map[name] || 0) + qty;
          }
        });
      }
      return map;
    });`;

if (src.includes(oldParsing)) {
  src = src.replace(oldParsing, newParsing);
  count++;
  console.log(`✅ 패치 ${count}: 상품 파싱 개선`);
} else {
  // 이미 패치된 경우이거나 다른 형태
  console.log('⏭️  스킵: 상품 파싱 (이미 개선됨 또는 구조 다름)');
}

// ── 저장 ─────────────────────────────────────────────────────────────
if (src !== original) {
  const backup = TARGET.replace('.js', `.patch2_bak_${Date.now()}.js`);
  fs.writeFileSync(backup, original, 'utf8');
  fs.writeFileSync(TARGET, src, 'utf8');
  console.log(`\n✅ 패치 완료! (총 ${count}개)`);
  console.log(`   백업: ${path.basename(backup)}`);
  console.log(`\n실행:`);
  console.log(`   pm2 restart gotgan-status`);
  console.log(`   pm2 logs gotgan-status --lines 20 --nostream`);
} else {
  console.log('\n⚠️  변경 없음. 파일 구조를 직접 확인하세요.');
}
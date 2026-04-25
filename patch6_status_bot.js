/**
 * patch6_status_bot.js
 * v9 기준 곳간 상품 파싱 정규식 수정
 * ' / ' 공백 유연하게 처리
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'tg_status_bot.js');
let src = fs.readFileSync(TARGET, 'utf8');
const original = src;

// ── 곳간 파싱 블록 교체 ───────────────────────────────────────────────
// v9의 amountData evaluate 블록에서 슬래시 파싱 부분 수정
const oldParsing = `    // 상품 파싱: 셀[5] = "상품명 / N 개 · 선택:옵션..."
    const amountData = await fgPage.evaluate(() => {
      const map = {};
      let total = 0;

      document.querySelectorAll('table tbody tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')].map(td =>
          (td.innerText || td.textContent || '').replace(/\\\\s+/g, ' ').trim()
        );
        if (cells.length < 6) return;

        const prodCell = cells[5] || '';
        if (!prodCell || !prodCell.includes(' / ')) return;

        const slashIdx = prodCell.indexOf(' / ');
        const namePart = prodCell.slice(0, slashIdx).trim();
        const afterSlash = prodCell.slice(slashIdx + 3).trim();

        const qtyM = afterSlash.match(/^(\\\\d+)\\\\s*개/);
        if (!qtyM) return;

        const qty = parseInt(qtyM[1]);`;

const newParsing = `    // 상품 파싱: 셀[5] = "상품명 / N 개 · 선택:옵션..."
    const amountData = await fgPage.evaluate(() => {
      const map = {};
      let total = 0;

      document.querySelectorAll('table tbody tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')].map(td =>
          (td.innerText || td.textContent || '').replace(/\\s+/g, ' ').trim()
        );
        if (cells.length < 6) return;

        const prodCell = cells[5] || '';
        if (!prodCell) return;

        // 슬래시 앞뒤 공백 유무 상관없이 "상품명 / N 개" 파싱
        const slashM = prodCell.match(/^(.+?)\\s*\\/\\s*(\\d+)\\s*개/);
        if (!slashM) return;

        const namePart = slashM[1].trim();
        const qty = parseInt(slashM[2]);`;

if (src.includes(oldParsing)) {
  src = src.replace(oldParsing, newParsing);
  console.log('✅ 패치 1: 곳간 슬래시 정규식 수정');
} else {
  // v9 파일에서 직접 찾기
  const marker1 = "if (!prodCell || !prodCell.includes(' / ')) return;";
  const marker2 = "const slashIdx = prodCell.indexOf(' / ');\n        const namePart = prodCell.slice(0, slashIdx).trim();\n        const afterSlash = prodCell.slice(slashIdx + 3).trim();\n\n        const qtyM = afterSlash.match(/^(\\d+)\\s*개/);\n        if (!qtyM) return;\n\n        const qty = parseInt(qtyM[1]);";
  
  if (src.includes(marker1)) {
    const replacement1 = "// 슬래시 앞뒤 공백 유무 상관없이 파싱\n        const slashM = prodCell.match(/^(.+?)\\s*\\/\\s*(\\d+)\\s*개/);\n        if (!slashM) return;\n\n        const namePart = slashM[1].trim();\n        const qty = parseInt(slashM[2]);";
    
    // marker1 제거 + marker2 교체
    src = src.replace(marker1 + "\n\n        " + "const slashIdx = prodCell.indexOf(' / ');", 
                      "// 슬래시 앞뒤 공백 유무 상관없이 파싱\n        const slashM = prodCell.match(/^(.+?)\\s*\\/\\s*(\\d+)\\s*개/);\n        if (!slashM) return;");
    
    // namePart, qty 교체
    src = src.replace(
      "const namePart = prodCell.slice(0, slashIdx).trim();\n        const afterSlash = prodCell.slice(slashIdx + 3).trim();\n\n        const qtyM = afterSlash.match(/^(\\d+)\\s*개/);\n        if (!qtyM) return;\n\n        const qty = parseInt(qtyM[1]);",
      "const namePart = slashM[1].trim();\n        const qty = parseInt(slashM[2]);"
    );
    console.log('✅ 패치 1: 곳간 슬래시 정규식 수정 (직접 교체)');
  } else {
    console.log('⚠️  marker1 못찾음 → 전체 evaluate 블록 교체 시도');
    
    // amountData evaluate 전체 교체
    const evalStart = src.indexOf('const amountData = await fgPage.evaluate(() => {');
    if (evalStart >= 0) {
      // evaluate 블록 끝 찾기 (return { map, total }; 이후 });)
      const evalEnd = src.indexOf('return { map, total };\n    });', evalStart);
      if (evalEnd >= 0) {
        const newEval = `const amountData = await fgPage.evaluate(() => {
      const map = {};
      let total = 0;

      document.querySelectorAll('table tbody tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')].map(td =>
          (td.innerText || td.textContent || '').replace(/\\s+/g, ' ').trim()
        );
        if (cells.length < 6) return;

        const prodCell = cells[5] || '';
        if (!prodCell) return;

        // 슬래시 앞뒤 공백 유무 상관없이 "상품명 / N 개" 파싱
        const slashM = prodCell.match(/^(.+?)\\s*\\/\\s*(\\d+)\\s*개/);
        if (!slashM) return;

        const namePart = slashM[1].trim();
        const qty = parseInt(slashM[2]);

        // 긴 괄호 설명 제거
        let name = namePart.replace(/\\s*\\([^)]{15,}\\)\\s*/g, ' ').replace(/\\s+/g, ' ').trim();
        if (name.length < 2 || qty <= 0 || qty >= 1000) return;
        if (/배송비|배송|주소|취소|결제/.test(name)) return;

        // 금액 (셀[6])
        const amtCell = cells[6] || '';
        let amt = 0;
        const amtMs = amtCell.match(/(\\d{1,3}(?:,\\d{3})+|\\d{4,8})\\s*원/g);
        if (amtMs) amtMs.forEach(m => {
          const v = parseInt(m.replace(/[,원]/g,''));
          if (v > amt && v < 10000000) amt = v;
        });

        if (!map[name]) map[name] = { qty: 0, amt: 0 };
        map[name].qty += qty;
        map[name].amt += amt;
        total += amt;
      });

      `;
        
        const endMarker = 'return { map, total };\n    });';
        src = src.slice(0, evalStart) + newEval + endMarker + src.slice(evalEnd + endMarker.length);
        console.log('✅ 패치 1: 곳간 evaluate 블록 전체 교체');
      }
    }
  }
}

// ── 어드민 로그인 추가 디버그 ──────────────────────────────────────────
// 로그인 각 hop의 상태 코드와 헤더를 출력
const oldLoginLog = "log(`  [어드민] 로그인 완료, 쿠키: ${Object.keys(cookies).join(', ') || '없음'}`);";
const newLoginLog = `// 디버그: 로그인 최종 쿠키 확인
  log(\`  [어드민] 로그인 완료, 쿠키: \${Object.keys(cookies).join(', ') || '없음'}\`);
  if (Object.keys(cookies).length === 0) {
    log('  [어드민] ⚠️ 쿠키 없음 - 세션 없이 stats만 사용 (주문 목록 미조회)');
  }`;

if (src.includes(oldLoginLog)) {
  src = src.replace(oldLoginLog, newLoginLog);
  console.log('✅ 패치 2: 어드민 로그인 디버그 추가');
}

// 저장
if (src !== original) {
  const bak = TARGET.replace('.js', `.p6bak_${Date.now()}.js`);
  fs.writeFileSync(bak, original, 'utf8');
  fs.writeFileSync(TARGET, src, 'utf8');
  console.log(`\n✅ 패치6 완료!`);
  console.log(`   백업: ${path.basename(bak)}`);
  console.log(`\n실행:`);
  console.log(`   pm2 restart gotgan-status`);
  console.log(`   pm2 logs gotgan-status --lines 15 --nostream`);
} else {
  console.log('\n⚠️  변경 없음');
}
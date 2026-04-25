/**
 * patch4_status_bot.js
 * 1. 어드민 상품명 + 수량 + 금액 파싱
 * 2. 곳간 상품명 + 수량 + 금액 파싱
 * 3. formatSection: 금액 표시 + 총합계
 * 4. /현황: 어드민+곳간 합산 총액 표시
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'tg_status_bot.js');
let src = fs.readFileSync(TARGET, 'utf8');
const original = src;

// ── 1. getAdminOrders: 상품+수량+금액 파싱 강화 ──────────────────────
const oldAdminParse = /const prodMap = \{\};\s*try \{[\s\S]+?log\(`  \[어드민 오늘[\s\S]+?rows=\$\{rows\.length\}\`\);[\s\S]+?rows\.forEach[\s\S]+?\}\);\s*\} catch[\s\S]+?\}\s*return \{ orderCount, prodMap \};/;

const newAdminParse = `const prodMap = {};
  let totalAmount = 0;
  try {
    const res = await req({ hostname: ADMIN_HOST,
      path: \`/admin/order/json/od.list.bd.php?\${params}\`, method: 'GET',
      headers: { 'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
        'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' }
    });

    let data;
    try { data = JSON.parse(res.body); }
    catch(e) {
      adminLoginTime = 0; await adminLogin();
      const res2 = await req({ hostname: ADMIN_HOST,
        path: \`/admin/order/json/od.list.bd.php?\${params}\`, method: 'GET',
        headers: { 'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
          'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' }
      });
      data = JSON.parse(res2.body);
    }

    const rows = data.rows || [];
    const listCount = parseInt(data.records) || rows.length;
    log(\`  [어드민 오늘(\${todayKST})] \${data.records}건, rows=\${rows.length}\`);

    rows.forEach(row => {
      const cell = Array.isArray(row.cell) ? row.cell : [];
      // cell 전체를 디버그 (처음 1건만)
      if (rows.indexOf(row) === 0) {
        log(\`  [어드민 cell샘플] \${JSON.stringify(cell).slice(0,200)}\`);
      }

      // 주문금액 추출 (숫자가 큰 셀 = 금액)
      let orderAmt = 0;
      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const clean = c.replace(/<[^>]+>/g,'').replace(/,/g,'').trim();
        // 1000~9999999 사이 숫자 = 금액 가능성
        const amtM = clean.match(/^(\\d{4,8})$/);
        if (amtM) {
          const v = parseInt(amtM[1]);
          if (v >= 1000 && v > orderAmt) orderAmt = v;
        }
        // "N,NNN원" 또는 "N,NNN" 형태
        const wonM = clean.match(/(\\d{1,3}(?:,\\d{3})+)원?$/);
        if (wonM) {
          const v = parseInt(wonM[1].replace(/,/g,''));
          if (v >= 1000 && v > orderAmt) orderAmt = v;
        }
      });
      totalAmount += orderAmt;

      // 상품명 + 수량 추출
      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const text = c.replace(/<[^>]+>/g,'').replace(/\\s+/g,' ').trim();
        // 패턴1: "상품명 N개"
        const m1 = text.match(/^(.{2,30}?)\\s+(\\d+)개/);
        if (m1) {
          const name = m1[1].trim(); const qty = parseInt(m1[2]);
          if (qty > 0 && qty < 1000 && name.length >= 2 &&
              !/배송|주소|전화|합계|취소|결제/.test(name))
            prodMap[name] = (prodMap[name]||{qty:0,amt:0});
            prodMap[name].qty += qty;
          return;
        }
        // 패턴2: "상품명 / N"
        const m2 = text.match(/^(.{2,30}?)\\s*\\/\\s*(\\d+)/);
        if (m2) {
          const name = m2[1].trim(); const qty = parseInt(m2[2]);
          if (qty > 0 && qty < 1000 && name.length >= 2 &&
              !/배송|주소|전화|합계|취소|결제/.test(name)) {
            if (!prodMap[name]) prodMap[name] = {qty:0,amt:0};
            prodMap[name].qty += qty;
          }
        }
      });
    });
  } catch(e) { log(\`  [어드민] 목록 오류: \${e.message}\`); }

  return { orderCount, prodMap, totalAmount };`;

if (oldAdminParse.test(src)) {
  src = src.replace(oldAdminParse, newAdminParse);
  console.log('✅ 패치 1: 어드민 상품+금액 파싱');
} else {
  // fallback: prodMap 선언부터 return까지 찾기
  const start = src.indexOf('  const prodMap = {};\n  try {\n    const res = await req({ hostname: ADMIN_HOST');
  const end = src.indexOf('return { orderCount, prodMap };', start);
  if (start > 0 && end > start) {
    src = src.slice(0, start) + newAdminParse + '\n' + src.slice(end + 'return { orderCount, prodMap };'.length);
    console.log('✅ 패치 1: 어드민 상품+금액 파싱 (fallback)');
  } else {
    console.log('⚠️  패치 1 스킵: 어드민 파싱 위치 못찾음');
  }
}

// ── 2. getGotganOrders: 상품+수량+금액 파싱 강화 ────────────────────
// prodMap 반환을 {qty, amt} 구조로, totalAmount 추가
const oldGotganReturn = /return \{ orderCount: orderNums\.size, prodMap \};/;
const newGotganReturn = `// 곳간 금액 파싱 (DOM에서 직접)
    const amountData = await fgPage.evaluate(() => {
      let total = 0;
      const map = {};

      document.querySelectorAll('table tbody tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')].map(td =>
          (td.innerText || td.textContent || '').replace(/\\s+/g,' ').trim()
        );
        if (cells.length < 3) return;

        let prodName = '', prodQty = 0, prodAmt = 0;

        cells.forEach((cell, i) => {
          // 상품명/수량 패턴
          const m1 = cell.match(/^([^/\\n]{2,30}?)\\s*\\/\\s*(\\d+)/);
          const m2 = cell.match(/^([^\\n]{2,30}?)\\s+(\\d+)\\s*개/);
          if (m1 || m2) {
            const m = m1 || m2;
            prodName = m[1].trim();
            prodQty = parseInt(m[2]);
          }
          // 금액 패턴: "12,000" 또는 "12000"
          const wonM = cell.replace(/,/g,'').match(/^(\\d{4,8})$/);
          if (wonM) {
            const v = parseInt(wonM[1]);
            if (v >= 1000) prodAmt = Math.max(prodAmt, v);
          }
          const wonM2 = cell.match(/(\\d{1,3}(?:,\\d{3})+)/);
          if (wonM2) {
            const v = parseInt(wonM2[1].replace(/,/g,''));
            if (v >= 1000) prodAmt = Math.max(prodAmt, v);
          }
        });

        if (prodName.length >= 2 && prodQty > 0 &&
            !/배송비|배송|주소|전화|합계|취소|금액|결제/.test(prodName)) {
          if (!map[prodName]) map[prodName] = {qty:0, amt:0};
          map[prodName].qty += prodQty;
          map[prodName].amt += prodAmt;
          total += prodAmt;
        }
      });

      // fallback: 텍스트 전체
      if (Object.keys(map).length === 0) {
        const lines = (document.body.innerText||'').split('\\n');
        lines.forEach(line => {
          const m = line.trim().match(/^([^\\t/]{2,30}?)\\s+(\\d+)\\s*개/);
          if (m) {
            const name = m[1].trim(); const qty = parseInt(m[2]);
            if (name.length >= 2 && qty > 0 && qty < 9999 &&
                !/배송비|배송|합계|결제|원$|^\\d/.test(name)) {
              if (!map[name]) map[name] = {qty:0, amt:0};
              map[name].qty += qty;
            }
          }
        });
      }

      return { map, total };
    });

    log(\`  [곳간] 상품=\${Object.keys(amountData.map).length}종, 총액=\${amountData.total.toLocaleString()}원\`);
    return { orderCount: orderNums.size, prodMap: amountData.map, totalAmount: amountData.total };`;

if (oldGotganReturn.test(src)) {
  src = src.replace(oldGotganReturn, newGotganReturn);
  console.log('✅ 패치 2: 곳간 상품+금액 파싱');
} else {
  console.log('⚠️  패치 2 스킵: 곳간 return 위치 못찾음');
}

// ── 3. formatSection: 금액 포함 포맷 ────────────────────────────────
const oldFormat = /function formatSection\(title, data\) \{[\s\S]+?return msg;\s*\}/;
const newFormat = `function formatSection(title, data) {
  const { orderCount, prodMap, totalAmount } = data;
  // prodMap 값이 {qty,amt} 객체이거나 숫자일 수 있음 (하위호환)
  const entries = Object.entries(prodMap)
    .map(([n, v]) => [n, typeof v === 'object' ? v : {qty: v, amt: 0}])
    .filter(([,v]) => v.qty > 0)
    .sort((a,b) => b[1].qty - a[1].qty);

  const total = totalAmount || entries.reduce((s,[,v])=>s+(v.amt||0),0);
  const totalStr = total > 0 ? \`  💰 소계: <b>\${total.toLocaleString()}원</b>\\n\` : '';

  let msg = \`\${title}\\n총 주문: <b>\${orderCount}건</b>\\n\${totalStr}\`;
  if (entries.length > 0) {
    msg += \`\\n📦 상품별 수량\\n\`;
    entries.slice(0,15).forEach(([n,v]) => {
      const amtStr = v.amt > 0 ? \` (\${v.amt.toLocaleString()}원)\` : '';
      msg += \`  • \${n} <b>\${v.qty}개</b>\${amtStr}\\n\`;
    });
  } else {
    msg += \`  (상품 정보 없음)\\n\`;
  }
  return msg;
}`;

if (oldFormat.test(src)) {
  src = src.replace(oldFormat, newFormat);
  console.log('✅ 패치 3: formatSection 금액 포함');
} else {
  console.log('⚠️  패치 3 스킵: formatSection 못찾음');
}

// ── 4. /현황: 합산 총액 표시 ────────────────────────────────────────
const oldHyunhwang = /msg \+= fD \? formatSection\('🛒 <b>\[곳간\] flexgate<\/b>', fD\) : '🛒 곳간 조회 실패\\n';\s*await tgSend\(msg, chatId\);/;
const newHyunhwang = `msg += fD ? formatSection('🛒 <b>[곳간] flexgate</b>', fD) : '🛒 곳간 조회 실패\\n';

      // 합산 총액
      const adminTotal = aD?.totalAmount || 0;
      const gotganTotal = fD?.totalAmount || 0;
      const grandTotal = adminTotal + gotganTotal;
      if (grandTotal > 0) {
        msg += \`\\n${'─'.repeat(20)}\\n💵 <b>합산 총액: \${grandTotal.toLocaleString()}원</b>\\n\`;
        if (adminTotal > 0) msg += \`   어드민: \${adminTotal.toLocaleString()}원\\n\`;
        if (gotganTotal > 0) msg += \`   곳간: \${gotganTotal.toLocaleString()}원\\n\`;
      }

      await tgSend(msg, chatId);`;

if (oldHyunhwang.test(src)) {
  src = src.replace(oldHyunhwang, newHyunhwang);
  console.log('✅ 패치 4: /현황 합산 총액');
} else {
  console.log('⚠️  패치 4 스킵: /현황 합산 위치 못찾음');
}

// ── 저장 ────────────────────────────────────────────────────────────
if (src !== original) {
  const bak = TARGET.replace('.js', `.p4bak_${Date.now()}.js`);
  fs.writeFileSync(bak, original, 'utf8');
  fs.writeFileSync(TARGET, src, 'utf8');
  console.log(`\n✅ 패치4 완료!`);
  console.log(`   백업: ${path.basename(bak)}`);
  console.log(`\n실행:`);
  console.log(`   pm2 restart gotgan-status`);
  console.log(`   pm2 logs gotgan-status --lines 20 --nostream`);
} else {
  console.log('\n⚠️  변경 없음');
}
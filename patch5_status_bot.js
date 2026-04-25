/**
 * patch5_status_bot.js
 * 실제 데이터 구조 기반으로 파싱 정확하게 수정
 *
 * 확인된 구조:
 * [어드민] stats: spnNew5=신규주문수, 로그인 redirect 체인 문제
 * [곳간] 셀[5]: "상품명 / N 개 · 선택:옵션명..." 패턴
 *         셀[6]: "N 원 0 원 / ..." 금액(0원이 많음 - 실제 금액 셀 다를 수 있음)
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'tg_status_bot.js');
let src = fs.readFileSync(TARGET, 'utf8');
const original = src;
let patchCount = 0;

// ── 1. 어드민 로그인: redirect 체인 완전히 따라가기 ─────────────────
const oldAdminLogin = /async function adminLogin\(\) \{[\s\S]+?adminLoginTime = Date\.now\(\);\s*\}/;
const newAdminLogin = `async function adminLogin() {
  const body = new URLSearchParams({ id: ADMIN_ID, pw: ADMIN_PW, mode: 'login' }).toString();
  let cookies = {};
  let nextReq = {
    options: {
      hostname: ADMIN_HOST, path: '/admin/login.php', method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Referer': ADMIN_URL, 'User-Agent': 'Mozilla/5.0',
      }
    },
    body: body
  };

  // redirect 체인 최대 6번 따라가기
  for (let hop = 0; hop < 6; hop++) {
    const res = await req(nextReq.options, nextReq.body || null);
    const newC = parseCookies(res.headers['set-cookie']);
    Object.assign(cookies, newC);

    const loc = res.headers['location'];
    if (!loc) break;

    // 다음 요청 준비
    let nextHostname = ADMIN_HOST;
    let nextPath = loc;
    if (loc.startsWith('http')) {
      try {
        const u = new URL(loc);
        nextHostname = u.hostname;
        nextPath = u.pathname + u.search;
      } catch(e) {}
    }
    nextReq = {
      options: {
        hostname: nextHostname, path: nextPath, method: 'GET',
        headers: {
          'Cookie': cookieStr(cookies),
          'User-Agent': 'Mozilla/5.0',
          'Referer': ADMIN_URL,
        }
      },
      body: null
    };
  }

  adminCookies = cookies;
  adminLoginTime = Date.now();
  log(\`  [어드민] 로그인 완료 쿠키: \${Object.keys(cookies).join(', ') || '없음'}\`);
}`;

if (oldAdminLogin.test(src)) {
  src = src.replace(oldAdminLogin, newAdminLogin);
  patchCount++;
  console.log(`✅ 패치 ${patchCount}: 어드민 로그인 redirect 체인`);
} else {
  console.log('⚠️  어드민 로그인 함수 못찾음');
}

// ── 2. 어드민 주문 목록: stats 카운트 + 날짜 필터 수정 ───────────────
// getAdminOrders 내 params + prodMap 파싱 전체 교체
const oldAdminGetOrders = /async function getAdminOrders\(\) \{[\s\S]+?return \{ orderCount[\s\S]+?\};[\s\S]*?\}/;
const newAdminGetOrders = `async function getAdminOrders() {
  await ensureAdmin();
  const todayKST = new Date(Date.now() + 9*60*60*1000).toISOString().slice(0,10);

  // stats에서 실시간 신규주문 수 가져오기
  let orderCount = 0;
  let totalAmount = 0;
  try {
    const sr = await req({
      hostname: ADMIN_HOST, path: '/admin/xml/real.stats.json.php', method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': 0,
        'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
        'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest'
      }
    }, '');
    const stats = JSON.parse(sr.body);
    // spnNew5=신규주문, spnNew8=오늘주문(전체상태)
    orderCount = parseInt(stats.spnNew8) || parseInt(stats.spnNew5) || 0;
    log(\`  [어드민 stats] 오늘주문=\${stats.spnNew8}, 신규=\${stats.spnNew5}\`);
  } catch(e) {
    log(\`  [어드민 stats 오류] \${e.message}\`);
  }

  // 주문 목록 조회 (오늘 날짜, 전체 상태)
  const params = new URLSearchParams({
    proc: 'json', mod: 'order', actpage: 'od.list.bd',
    status: '', datefld: 'b.regdate',
    sdate: JSON.stringify({ start: todayKST, end: todayKST }),
    bizgrp: 'all', searchtype: 'all', searchval: '',
    _search: 'false', rows: '500', page: '1', sidx: 'regdate', sord: 'desc'
  });

  const prodMap = {};
  try {
    const res = await req({
      hostname: ADMIN_HOST,
      path: \`/admin/order/json/od.list.bd.php?\${params}\`, method: 'GET',
      headers: {
        'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
        'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest'
      }
    });

    let data;
    try { data = JSON.parse(res.body); }
    catch(e) {
      log(\`  [어드민] JSON 파싱 실패, 재로그인\`);
      adminLoginTime = 0; await adminLogin();
      const res2 = await req({
        hostname: ADMIN_HOST,
        path: \`/admin/order/json/od.list.bd.php?\${params}\`, method: 'GET',
        headers: {
          'Cookie': cookieStr(adminCookies), 'Referer': ADMIN_URL,
          'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest'
        }
      });
      data = JSON.parse(res2.body);
    }

    const rows = data.rows || [];
    const listCount = parseInt(data.records) || rows.length;
    log(\`  [어드민] 오늘(\${todayKST}) \${listCount}건, rows=\${rows.length}\`);

    // orderCount는 stats 값 우선, 없으면 리스트 수
    if (!orderCount) orderCount = listCount;

    rows.forEach((row, rowIdx) => {
      const cell = Array.isArray(row.cell) ? row.cell : [];

      // 디버그: 첫번째 행 셀 출력
      if (rowIdx === 0) log(\`  [어드민 cell샘플] \${JSON.stringify(cell).slice(0,200)}\`);

      // 금액 추출 (숫자가 큰 셀)
      let rowAmt = 0;
      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const clean = c.replace(/<[^>]+>/g,'').replace(/,/g,'').trim();
        // "N원" 또는 큰 숫자
        const m = clean.match(/(\\d{4,8})\\s*원?$/);
        if (m) {
          const v = parseInt(m[1]);
          if (v >= 1000 && v > rowAmt) rowAmt = v;
        }
      });
      totalAmount += rowAmt;

      // 상품명 + 수량 파싱
      cell.forEach(c => {
        if (typeof c !== 'string') return;
        const text = c.replace(/<[^>]+>/g,'').replace(/\\s+/g,' ').trim();

        // 패턴: "상품명 / N 개" (곳간과 유사한 어드민 형식)
        // · 이후 옵션 정보 제거
        const mainPart = text.split('·')[0].trim();

        const m1 = mainPart.match(/^(.{2,50}?)\\s*\\/\\s*(\\d+)\\s*개?/);
        if (m1) {
          const name = m1[1].replace(/\\([^)]*\\)/g,'').trim(); // 괄호 내용 제거
          const qty = parseInt(m1[2]);
          if (name.length >= 2 && name.length <= 40 && qty > 0 && qty < 1000 &&
              !/배송비|배송|주소|전화|합계|취소|결제|PJM|입금|원$/.test(name)) {
            if (!prodMap[name]) prodMap[name] = { qty: 0, amt: 0 };
            prodMap[name].qty += qty;
            prodMap[name].amt += rowAmt;
          }
          return;
        }

        // 패턴: "상품명 N개"
        const m2 = text.match(/^(.{2,40}?)\\s+(\\d+)개/);
        if (m2) {
          const name = m2[1].trim();
          const qty = parseInt(m2[2]);
          if (name.length >= 2 && qty > 0 && qty < 1000 &&
              !/배송비|배송|PJM|입금|원$/.test(name)) {
            if (!prodMap[name]) prodMap[name] = { qty: 0, amt: 0 };
            prodMap[name].qty += qty;
          }
        }
      });
    });
  } catch(e) {
    log(\`  [어드민 목록 오류] \${e.message}\`);
  }

  return { orderCount, prodMap, totalAmount };
}`;

if (oldAdminGetOrders.test(src)) {
  src = src.replace(oldAdminGetOrders, newAdminGetOrders);
  patchCount++;
  console.log(`✅ 패치 ${patchCount}: 어드민 getAdminOrders 전체 교체`);
} else {
  console.log('⚠️  getAdminOrders 함수 못찾음 → 라인 기반으로 교체 시도');
  const lines = src.split('\n');
  const si = lines.findIndex(l => l.includes('async function getAdminOrders'));
  const ei = lines.findIndex((l, i) => i > si + 5 && l.match(/^}$/));
  if (si >= 0 && ei > si) {
    lines.splice(si, ei - si + 1, ...newAdminGetOrders.split('\n'));
    src = lines.join('\n');
    patchCount++;
    console.log(`✅ 패치 ${patchCount}: 어드민 getAdminOrders (라인 기반)`);
  } else {
    console.log('❌ getAdminOrders 교체 실패');
  }
}

// ── 3. 곳간 상품 파싱: 셀[5] 기반 정확한 패턴 ───────────────────────
// "상품명 / N 개 · 선택:옵션..." 형식
const oldGotganProdMap = /\/\/ ?곹뭹 ?뚯떛 \(?뚯씠釉붿뿉\?\?[\s\S]+?return \{ orderCount: orderNums\.size, prodMap \};/;

const newGotganReturn = `// 곳간 상품 파싱 (셀[5] 기반: "상품명 / N 개 · 선택:옵션")
    const amountData = await fgPage.evaluate(() => {
      const map = {};
      let total = 0;

      document.querySelectorAll('table tbody tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')].map(td =>
          (td.innerText || td.textContent || '').replace(/\\s+/g, ' ').trim()
        );
        if (cells.length < 6) return;

        // 셀[5]에서 상품명/수량 파싱
        // 형식: "상품명 / N 개 · 선택:옵션명..."
        const prodCell = cells[5] || '';
        if (!prodCell) return;

        // "·" 이후 옵션 제거, "/" 기준으로 상품명과 수량 분리
        const slashIdx = prodCell.indexOf(' / ');
        if (slashIdx < 0) return;

        const namePart = prodCell.slice(0, slashIdx).trim();
        const afterSlash = prodCell.slice(slashIdx + 3).trim(); // "N 개 · 선택:..."

        // 수량 추출
        const qtyM = afterSlash.match(/^(\\d+)\\s*개/);
        if (!qtyM) return;

        const qty = parseInt(qtyM[1]);
        // 상품명 정리 (괄호 내 긴 설명 제거)
        let name = namePart
          .replace(/\\s*\\([^)]{15,}\\)\\s*/g, ' ')  // 15자 초과 괄호 내용 제거
          .replace(/\\s+/g, ' ')
          .trim();

        if (name.length < 2 || qty <= 0 || qty >= 1000) return;
        if (/배송비|배송|주소|취소|결제/.test(name)) return;

        // 금액: 셀[6]에서 찾기
        const amtCell = cells[6] || '';
        let amt = 0;
        const amtMatches = amtCell.match(/(\\d{1,3}(?:,\\d{3})+|\\d{4,8})\\s*원/g);
        if (amtMatches) {
          amtMatches.forEach(m => {
            const v = parseInt(m.replace(/[,원]/g, ''));
            if (v > amt && v < 10000000) amt = v;
          });
        }

        if (!map[name]) map[name] = { qty: 0, amt: 0 };
        map[name].qty += qty;
        map[name].amt += amt;
        total += amt;
      });

      return { map, total };
    });

    log(\`  [곳간] 상품=\${Object.keys(amountData.map).length}종, 총액=\${amountData.total.toLocaleString()}원\`);
    return { orderCount: orderNums.size, prodMap: amountData.map, totalAmount: amountData.total };`;

if (oldGotganProdMap.test(src)) {
  src = src.replace(oldGotganProdMap, newGotganReturn);
  patchCount++;
  console.log(`✅ 패치 ${patchCount}: 곳간 상품 파싱 (셀[5] 기반)`);
} else {
  // fallback: return { orderCount: orderNums.size, prodMap }; 직전의 prodMap 블록 교체
  const marker = 'return { orderCount: orderNums.size, prodMap };';
  const idx = src.lastIndexOf(marker);
  if (idx >= 0) {
    // prodMap 선언부터 찾기
    const prodMapIdx = src.lastIndexOf('const prodMap = await fgPage.evaluate', idx);
    if (prodMapIdx >= 0) {
      src = src.slice(0, prodMapIdx) + newGotganReturn + '\n' + src.slice(idx + marker.length);
      patchCount++;
      console.log(`✅ 패치 ${patchCount}: 곳간 상품 파싱 (fallback)`);
    } else {
      console.log('⚠️  곳간 prodMap 위치 못찾음');
    }
  } else {
    console.log('⚠️  곳간 return 위치 못찾음');
  }
}

// ── 4. formatSection: 이미 패치됨 확인 ──────────────────────────────
if (!src.includes('totalAmount')) {
  console.log('⚠️  formatSection에 totalAmount 없음 - patch4 재적용 필요');
} else {
  console.log('⏭️  스킵: formatSection 이미 금액 포함');
}

// ── 저장 ─────────────────────────────────────────────────────────────
if (src !== original) {
  const bak = TARGET.replace('.js', `.p5bak_${Date.now()}.js`);
  fs.writeFileSync(bak, original, 'utf8');
  fs.writeFileSync(TARGET, src, 'utf8');
  console.log(`\n✅ 패치5 완료! (${patchCount}개)`);
  console.log(`   백업: ${path.basename(bak)}`);
  console.log(`\n실행:`);
  console.log(`   pm2 restart gotgan-status`);
  console.log(`   pm2 logs gotgan-status --lines 20 --nostream`);
} else {
  console.log('\n⚠️  변경 없음');
}
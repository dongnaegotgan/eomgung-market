/**
 * debug_orders.js
 * 어드민플러스 + 곳간 실제 데이터 구조 확인
 * node debug_orders.js 로 실행
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const https = require('https');
const puppeteer = require('puppeteer');

const ADMIN_HOST = 'dongnaegotgan.adminplus.co.kr';
const ADMIN_ID   = process.env.ADMIN_ID || 'dongnaegotgan';
const ADMIN_PW   = process.env.ADMIN_PW || 'rhtrks12!@';
const FG_URL     = 'https://dongnaegotgan.flexgate.co.kr';
const FG_LOGIN   = 'https://intro.flexgate.co.kr/Mypage/Login';
const FG_ID      = process.env.FG_ID  || 'dongnaegotgan';
const FG_PW      = process.env.FG_PW  || 'rhtrks12!@';

function req(options, body = null) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
function parseCookies(arr) {
  const c = {};
  (arr||[]).forEach(s => {
    const [kv] = s.split(';'); const [k,v] = kv.split('=');
    if(k) c[k.trim()]=(v||'').trim();
  });
  return c;
}
function cookieStr(c) { return Object.entries(c).map(([k,v])=>`${k}=${v}`).join('; '); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function debugAdmin() {
  console.log('\n=== [어드민] 데이터 구조 확인 ===');
  
  // 로그인
  const body = new URLSearchParams({ id: ADMIN_ID, pw: ADMIN_PW, mode: 'login' }).toString();
  const res = await req({ hostname: ADMIN_HOST, path: '/admin/login.php', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body), 'User-Agent': 'Mozilla/5.0' }
  }, body);
  let c = parseCookies(res.headers['set-cookie']);
  if (!Object.keys(c).length && res.headers['location']) {
    const r2 = await req({ hostname: ADMIN_HOST, path: res.headers['location'],
      method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
    c = parseCookies(r2.headers['set-cookie']);
  }
  console.log('로그인 쿠키:', Object.keys(c).join(', '));

  // stats 확인
  try {
    const sr = await req({ hostname: ADMIN_HOST, path: '/admin/xml/real.stats.json.php', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': 0,
        'Cookie': cookieStr(c), 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' }
    }, '');
    console.log('\n[stats 전체 응답]:', sr.body.slice(0, 500));
  } catch(e) { console.log('stats 오류:', e.message); }

  // 주문 목록 (오늘, 전체 status)
  const todayKST = new Date(Date.now() + 9*60*60*1000).toISOString().slice(0,10);
  const params = new URLSearchParams({
    proc: 'json', mod: 'order', actpage: 'od.list.bd',
    status: '', datefld: 'b.regdate',
    sdate: JSON.stringify({ start: todayKST, end: todayKST }),
    bizgrp: 'all', searchtype: 'all', searchval: '',
    _search: 'false', rows: '5', page: '1', sidx: 'regdate', sord: 'desc'
  });

  try {
    const lr = await req({ hostname: ADMIN_HOST,
      path: `/admin/order/json/od.list.bd.php?${params}`, method: 'GET',
      headers: { 'Cookie': cookieStr(c), 'User-Agent': 'Mozilla/5.0',
        'X-Requested-With': 'XMLHttpRequest' }
    });
    
    let data;
    try { data = JSON.parse(lr.body); } catch(e) {
      console.log('JSON 파싱 실패. 응답 앞부분:', lr.body.slice(0, 300));
      return;
    }
    
    console.log('\n총 레코드:', data.records, '/ rows수:', (data.rows||[]).length);
    
    const rows = data.rows || [];
    if (rows.length === 0) {
      console.log('오늘 주문 없음 → status="" 전체기간으로 재시도');
      const params2 = new URLSearchParams({
        proc: 'json', mod: 'order', actpage: 'od.list.bd',
        status: '', datefld: 'b.regdate',
        sdate: JSON.stringify({ start: '', end: '' }),
        bizgrp: 'all', searchtype: 'all', searchval: '',
        _search: 'false', rows: '3', page: '1', sidx: 'regdate', sord: 'desc'
      });
      const lr2 = await req({ hostname: ADMIN_HOST,
        path: `/admin/order/json/od.list.bd.php?${params2}`, method: 'GET',
        headers: { 'Cookie': cookieStr(c), 'User-Agent': 'Mozilla/5.0',
          'X-Requested-With': 'XMLHttpRequest' }
      });
      try {
        const data2 = JSON.parse(lr2.body);
        console.log('전체기간 총:', data2.records, '건');
        const rows2 = data2.rows || [];
        if (rows2.length > 0) {
          console.log('\n[첫번째 주문 row.cell 전체]:');
          console.log(JSON.stringify(rows2[0].cell, null, 2));
          if (rows2[1]) {
            console.log('\n[두번째 주문 row.cell 전체]:');
            console.log(JSON.stringify(rows2[1].cell, null, 2));
          }
        }
      } catch(e) { console.log('재시도 실패:', e.message); }
      return;
    }
    
    console.log('\n[첫번째 주문 row.cell 전체]:');
    console.log(JSON.stringify(rows[0].cell, null, 2));
    if (rows[1]) {
      console.log('\n[두번째 주문 row.cell 전체]:');
      console.log(JSON.stringify(rows[1].cell, null, 2));
    }
    
  } catch(e) { console.log('목록 오류:', e.message); }
}

async function debugGotgan() {
  console.log('\n=== [곳간] 데이터 구조 확인 ===');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--lang=ko-KR'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  page.on('dialog', d => d.accept().catch(()=>{}));
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    await page.goto(FG_LOGIN, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(1000);

    const idEl = await page.$('input[name="userId"]');
    const pwEl = await page.$('input[name="password"]');
    if (idEl) { await idEl.click({clickCount:3}); await page.keyboard.type(FG_ID); }
    if (pwEl) { await pwEl.click({clickCount:3}); await page.keyboard.type(FG_PW); }
    await sleep(300);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
      pwEl ? pwEl.press('Enter') : Promise.resolve(),
    ]);
    await sleep(2000);
    console.log('로그인 후 URL:', page.url());

    await page.goto(`${FG_URL}/NewOrder/deal01?order_status=10&formtype=A&pagesize=1000`,
      { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(1500);

    // 테이블 구조 분석
    const tableData = await page.evaluate(() => {
      const result = {
        tableCount: document.querySelectorAll('table').length,
        tbodyRows: document.querySelectorAll('tbody tr').length,
        firstRowCells: [],
        secondRowCells: [],
        bodyTextSample: '',
        pjmCount: 0,
      };

      // PJM 패턴 카운트
      const html = document.documentElement.innerHTML;
      const pjms = html.match(/PJM[A-Z0-9]+/g);
      result.pjmCount = pjms ? new Set(pjms).size : 0;

      // 첫번째 tbody tr의 셀 텍스트
      const rows = document.querySelectorAll('tbody tr');
      if (rows[0]) {
        result.firstRowCells = [...rows[0].querySelectorAll('td')].map(td => 
          (td.innerText || '').replace(/\s+/g,' ').trim().slice(0, 80)
        );
      }
      if (rows[1]) {
        result.secondRowCells = [...rows[1].querySelectorAll('td')].map(td =>
          (td.innerText || '').replace(/\s+/g,' ').trim().slice(0, 80)
        );
      }

      // body 텍스트 샘플 (주문 테이블 부분)
      const mainTable = document.querySelector('.table-responsive table, #orderListTable, table.table');
      if (mainTable) {
        result.bodyTextSample = mainTable.innerText.slice(0, 800);
      } else {
        result.bodyTextSample = document.body.innerText.slice(0, 800);
      }

      return result;
    });

    console.log('테이블 수:', tableData.tableCount);
    console.log('tbody tr 수:', tableData.tbodyRows);
    console.log('PJM 주문번호 수:', tableData.pjmCount);
    console.log('\n[첫번째 행 셀 목록]:');
    tableData.firstRowCells.forEach((cell, i) => console.log(`  셀[${i}]: "${cell}"`));
    console.log('\n[두번째 행 셀 목록]:');
    tableData.secondRowCells.forEach((cell, i) => console.log(`  셀[${i}]: "${cell}"`));
    console.log('\n[테이블 텍스트 샘플]:');
    console.log(tableData.bodyTextSample);

  } catch(e) {
    console.log('곳간 오류:', e.message);
  } finally {
    await browser.close();
  }
}

(async () => {
  try {
    await debugAdmin();
    await debugGotgan();
    console.log('\n=== 디버그 완료 ===');
    console.log('위 내용을 캡처해서 전달해주세요!');
  } catch(e) {
    console.error('실행 오류:', e.message);
  }
  process.exit(0);
})();
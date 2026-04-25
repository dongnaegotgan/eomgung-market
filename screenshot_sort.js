require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE = 'https://dongnaegotgan.adminplus.co.kr/admin/';

async function login(page) {
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="password"]');
  const idEl = await page.$('input[name="id"]') || await page.$('input[type="text"]');
  if (idEl) { await idEl.click({ clickCount: 3 }); await idEl.type(process.env.ADMIN_ID || 'dongnaegotgan'); }
  const pwEl = await page.$('input[type="password"]');
  if (pwEl) { await pwEl.click({ clickCount: 3 }); await pwEl.type(process.env.ADMIN_PW || 'rhtrks12!@'); }
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
    page.keyboard.press('Enter'),
  ]);
  await new Promise(r => setTimeout(r, 2000));
  console.log('로그인 완료');
}

async function run() {
  const outDir = path.join(__dirname, 'admin_downloads');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ko-KR'],
    defaultViewport: { width: 1400, height: 900 },
  });

  try {
    const page = await browser.newPage();
    await login(page);

    // 1단계: 상품 리스트 전체 링크 조사
    console.log('\n상품 리스트 전체 링크 조사 중...');
    await page.goto(BASE + '?mod=product&actpage=prt.list', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    const allLinks = await page.evaluate(() => {
      return [...document.querySelectorAll('a, button')].map(el => ({
        text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60),
        href: el.href || '',
        onclick: (el.getAttribute('onclick') || '').slice(0, 100),
      })).filter(el => el.text.length > 0);
    });

    console.log('\n발견된 모든 링크/버튼:');
    allLinks.forEach((l, i) => {
      if (l.href || l.onclick) {
        console.log(`  [${i}] "${l.text}" | href: ${l.href.slice(0, 80)} | onclick: ${l.onclick}`);
      }
    });

    // 2단계: 정렬 관련 URL 후보 직접 시도
    const sortCandidates = [
      '?mod=product&actpage=prt.sort',
      '?mod=product&actpage=prt.sort_partner',
      '?mod=product&actpage=prt.order',
      '?mod=product&actpage=prt.psort',
      '?mod=product&actpage=sort',
    ];

    console.log('\n정렬 페이지 URL 후보 탐색...');
    for (const candidate of sortCandidates) {
      await page.goto(BASE + candidate, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
      const hasSort = await page.evaluate(() => {
        const body = document.body.innerText;
        return body.includes('정렬') || body.includes('순서') || body.includes('드래그');
      });
      const title = await page.title();
      console.log(`  ${candidate} => ${hasSort ? '정렬 관련 내용 있음' : '없음'} | ${title}`);
      if (hasSort) {
        await page.screenshot({ path: path.join(outDir, 'sort_candidate.png'), fullPage: true });
        console.log('  sort_candidate.png 저장!');
      }
    }

    // 3단계: 정렬 관련 키워드 요소 탐색
    console.log('\n상품 리스트 재탐색 - 정렬 관련 요소...');
    await page.goto(BASE + '?mod=product&actpage=prt.list', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    const sortElements = await page.evaluate(() => {
      const keywords = ['정렬', '순서', '협력사', 'sort', '드래그'];
      return [...document.querySelectorAll('*')].filter(el =>
        el.children.length === 0 &&
        keywords.some(k => el.textContent.trim().includes(k)) &&
        el.textContent.trim().length < 50
      ).map(el => ({
        tag: el.tagName,
        text: el.textContent.trim(),
        class: el.className,
        id: el.id,
      })).slice(0, 20);
    });

    console.log('\n정렬 관련 요소:');
    sortElements.forEach(el => console.log(`  <${el.tag}> "${el.text}" class="${el.class}" id="${el.id}"`));

    await page.screenshot({ path: path.join(outDir, 'sort_page.png'), fullPage: true });
    console.log('\nsort_page.png 저장 완료');

  } finally {
    await browser.close();
  }
}

run().catch(console.error);
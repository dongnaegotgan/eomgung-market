/**
 * debug_approve.js - bp.form.html.php 전체 HTML 저장 및 분석
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ADMIN_URL = 'https://dongnaegotgan.adminplus.co.kr/admin/';
const ID = process.env.ADMIN_ID || 'dongnaegotgan';
const PW = process.env.ADMIN_PW || 'rhtrks12!@';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const outDir = path.join(__dirname, 'admin_downloads');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ko-KR'],
    defaultViewport: { width: 1440, height: 900 },
  });

  try {
    const page = await browser.newPage();
    page.on('dialog', async d => await d.accept());

    // 로그인
    await page.goto(ADMIN_URL, { waitUntil: 'networkidle2' });
    const idEl = await page.$('input[name="id"]') || await page.$('input[type="text"]');
    if (idEl) { await idEl.click({ clickCount: 3 }); await idEl.type(ID); }
    const pwEl = await page.$('input[type="password"]');
    if (pwEl) { await pwEl.click({ clickCount: 3 }); await pwEl.type(PW); }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ]);
    await sleep(2000);
    console.log('✅ 로그인 완료');

    // 매출거래처 메뉴 로드
    await page.evaluate(() => {
      const all = [...document.querySelectorAll('li, a, div, span')];
      const m = all.find(el => el.textContent.trim() === '거래처 관리');
      if (m) m.click();
    });
    await sleep(800);
    await page.evaluate(() => {
      const all = [...document.querySelectorAll('li, a, div, span')];
      const m = all.find(el => el.textContent.trim() === '매출거래처');
      if (m) m.click();
    });
    await sleep(3000);

    // bp.form.html.php 직접 fetch해서 저장
    const formHtml = await page.evaluate(async () => {
      const res = await fetch('/admin/bizpartner/bp.form.html.php?idx=674');
      return await res.text();
    });

    const htmlPath = path.join(outDir, 'bp_form_674.html');
    fs.writeFileSync(htmlPath, formHtml, 'utf8');
    console.log(`\n📄 bp_form_674.html 저장 (${formHtml.length} bytes)`);

    // 모든 input/select 분석
    const analysis = await page.evaluate(async () => {
      const res = await fetch('/admin/bizpartner/bp.form.html.php?idx=674');
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // 모든 라디오 그룹
      const radioGroups = {};
      doc.querySelectorAll('input[type="radio"]').forEach(el => {
        if (!radioGroups[el.name]) radioGroups[el.name] = [];
        // 라벨 텍스트 찾기
        let labelText = '';
        const forLabel = doc.querySelector(`label[for="${el.id}"]`);
        if (forLabel) labelText = forLabel.textContent.trim();
        else {
          const parentLabel = el.closest('label');
          if (parentLabel) labelText = parentLabel.textContent.trim().replace(el.value, '').trim();
          else {
            // 형제 텍스트 노드
            const parent = el.parentElement;
            if (parent) labelText = parent.textContent.replace(/\s+/g, ' ').trim().slice(0, 30);
          }
        }
        radioGroups[el.name].push({
          value: el.value,
          checked: el.checked,
          id: el.id,
          label: labelText
        });
      });

      // 모든 숨겨진 input
      const hiddenInputs = {};
      doc.querySelectorAll('input[type="hidden"]').forEach(el => {
        hiddenInputs[el.name] = el.value;
      });

      // textarea 있으면
      const textareas = {};
      doc.querySelectorAll('textarea').forEach(el => {
        textareas[el.name] = el.value?.slice(0, 50);
      });

      return { radioGroups, hiddenInputs, textareas };
    });

    console.log('\n📋 모든 라디오 그룹:');
    Object.entries(analysis.radioGroups).forEach(([name, opts]) => {
      console.log(`  [${name}]`);
      opts.forEach(o => console.log(`    value="${o.value}" checked=${o.checked} label="${o.label}"`));
    });

    console.log('\n📋 숨겨진 inputs:');
    Object.entries(analysis.hiddenInputs).forEach(([k, v]) => {
      console.log(`  ${k} = "${v}"`);
    });

    if (Object.keys(analysis.textareas).length > 0) {
      console.log('\n📋 Textareas:');
      Object.entries(analysis.textareas).forEach(([k, v]) => console.log(`  ${k} = "${v}"`));
    }

    // "인증대기" 텍스트 검색
    console.log('\n🔍 "인증" 관련 HTML:');
    const injeungMatches = formHtml.match(/.{0,50}인증.{0,50}/g) || [];
    injeungMatches.forEach(m => console.log('  ' + m.trim()));

    console.log('\n🔍 "state" 관련 input name:');
    const stateMatches = formHtml.match(/name="[^"]*state[^"]*"/gi) || [];
    [...new Set(stateMatches)].forEach(m => console.log('  ' + m));

    console.log('\n🔍 "pstate" 관련:');
    const pstateMatches = formHtml.match(/.{0,100}pstate.{0,100}/g) || [];
    pstateMatches.slice(0, 5).forEach(m => console.log('  ' + m.trim()));

  } finally {
    await browser.close();
  }
}

run().catch(console.error);
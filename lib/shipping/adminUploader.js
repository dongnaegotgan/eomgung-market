/**
 * adminUploader.js  [C단계]
 *
 * iLOGEN 송장 엑셀 → 어드민 일괄발송처리 업로드
 *
 * 핵심 변경:
 *   1. iLOGEN 파일에서 주문번호/운송장번호만 추출 → 2열 파일 생성 후 능동형 업로드
 *      (원본 파일은 3행 헤더라 능동형 파서가 인식 못함 → 1행 헤더 파일로 변환)
 *   2. page.once('dialog') 제거 → ilogenPrinter.js의 page.on('dialog') 전역 핸들러와
 *      충돌하던 "Cannot accept dialog which is already handled!" 오류 해결
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const XLSX = require('xlsx');

const ADMIN_DELIVERY_URL = 'http://dongnaegotgan.adminplus.co.kr/admin/?mod=order&actpage=od.list.bd&status=4&datefld=b.regdate&bizgrp=all&searchtype=all&searchval=&page=1&rownum=1000';

/** iLOGEN 엑셀에서 주문번호/운송장번호 2열만 추출한 업로드용 파일 생성 */
function buildUploadExcel(srcPath, log) {
  const wb = XLSX.readFile(srcPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 헤더 행 탐지 (주문번호 + 운송장번호 둘 다 있는 행)
  let headerRowIdx = -1;
  let orderCol = -1;
  let invoiceCol = -1;

  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const row = rows[r];
    let o = -1, i = -1;
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '').trim();
      if (cell === '주문번호') o = c;
      if (cell === '운송장번호') i = c;
    }
    if (o >= 0 && i >= 0) {
      headerRowIdx = r;
      orderCol = o;
      invoiceCol = i;
      break;
    }
  }

  if (headerRowIdx < 0) {
    log(`[H] 주문번호/운송장번호 열 자동탐지 실패. 헤더 샘플: ${rows.slice(0, 3).map(r => r.slice(0, 5).join('|')).join(' / ')}`);
    return null;
  }

  const colLetter = c => String.fromCharCode(65 + c);
  log(`[H] 탐지된 열 — 주문번호:${colLetter(orderCol)}, 운송장번호:${colLetter(invoiceCol)}`);

  // 데이터 추출 (헤더 다음 행부터)
  const data = [['주문번호', '운송장번호']];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const orderNo   = String(row[orderCol]   || '').trim();
    const invoiceNo = String(row[invoiceCol] || '').trim();
    if (orderNo && invoiceNo) data.push([orderNo, invoiceNo]);
  }

  if (data.length <= 1) {
    log('[H] 추출된 데이터 없음');
    return null;
  }

  log(`[H] 추출 완료: ${data.length - 1}건`);

  const newWb = XLSX.utils.book_new();
  const newWs = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(newWb, newWs, 'Sheet1');

  const tmpPath = path.join(os.tmpdir(), `admin_upload_${Date.now()}.xlsx`);
  XLSX.writeFile(newWb, tmpPath);
  return tmpPath;
}

/** xlsx 파일 헤더 로그 출력 (디버그용) */
function logHeaders(excelPath, log) {
  try {
    const wb = XLSX.readFile(excelPath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let r = range.s.r; r <= Math.min(range.s.r + 4, range.e.r); r++) {
      const row = [];
      for (let c = range.s.c; c <= Math.min(range.e.c, 25); c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const text = cell ? String(cell.v) : '';
        if (text.trim()) row.push(`${XLSX.utils.encode_col(c)}="${text}"`);
      }
      if (row.length > 0) log(`[H] 파일 ${r + 1}행: ${row.join(', ')}`);
    }
  } catch (e) {
    log(`[H] 헤더 읽기 오류: ${e.message}`);
  }
}

async function uploadShippingExcel(bm, opts) {
  const { excelPath, log = console.log } = opts;
  const page = bm.mainPage;

  // 1. 파일 헤더 로그
  logHeaders(excelPath, log);

  // 2. 원본 iLOGEN 파일 그대로 사용 (수동형 S=주문번호, D=운송장번호)
  const uploadPath = excelPath;

  // 3. 배송준비중 직접 이동
  log('[H] 어드민 배송준비중 페이지 이동');
  await page.goto(ADMIN_DELIVERY_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  if (/login|Login/i.test(page.url())) {
    throw new Error('[H] 어드민 미로그인 상태');
  }

  // 4. jQuery UI Dialog 열기
  log('[H] "엑셀 일괄발송처리" 다이얼로그 열기');
  const dialogOpened = await page.evaluate(() => {
    if (typeof window.dlvExcelinsert === 'function') {
      window.dlvExcelinsert();
      return true;
    }
    return false;
  });
  if (!dialogOpened) throw new Error('[H] dlvExcelinsert() 함수 없음');
  await new Promise(r => setTimeout(r, 1500));

  // 5. 수동형 선택 + 로젠택배(4)/S/D 명시 설정
  log('[H] 수동형 선택 (로젠택배/S열/D열)');
  await page.evaluate(() => {
    const dlg = document.querySelector('.ui-dialog');
    if (!dlg) return;
    // 수동형 선택
    const radio = dlg.querySelector('input[name="uploadtype"][value="passive"]');
    if (radio) radio.click();
    // 택배사/열 설정
    const cmp = dlg.querySelector('select[name="dlvcmpcode"]');
    const ord = dlg.querySelector('select[name="ordcol"]');
    const dlv = dlg.querySelector('select[name="dlvcol"]');
    if (cmp) cmp.value = '4';
    if (ord) ord.value = 'S';
    if (dlv) dlv.value = 'D';
  });
  await new Promise(r => setTimeout(r, 500));

  // 6. 파일 업로드 (2열 추출 파일)
  const uploadName = path.basename(excelPath);
  log(`[H] 엑셀 업로드: ${uploadName}`);
  await page.waitForSelector('input[name="qqfile"]', { timeout: 8000 });
  const fileInput = await page.$('input[name="qqfile"]');
  if (!fileInput) throw new Error('[H] 파일 input[name="qqfile"] 없음');
  await fileInput.uploadFile(uploadPath);
  await new Promise(r => setTimeout(r, 1500));

  // 7. 저장하기 클릭
  //    ※ page.once('dialog') 제거 — ilogenPrinter.js의 page.on('dialog') 전역 핸들러와
  //      이중처리 충돌 방지. dialog는 전역 핸들러가 자동 accept 처리.
  log('[H] "저장하기" 클릭');

  let lastDialogMsg = '';
  const captureDialog = (dialog) => { lastDialogMsg = dialog.message(); };
  page.once('dialog', captureDialog);

  const saved = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.ui-dialog-buttonpane button'))
      .find(b => b.textContent.trim() === '저장하기');
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!saved) throw new Error('[H] "저장하기" 버튼 없음');

  await new Promise(r => setTimeout(r, 4000));
  page.off('dialog', captureDialog);

  // 8. 결과 확인
  const resultText = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '');
  log(`[H] 업로드 후 화면:\n${resultText.slice(0, 300)}`);

  if (lastDialogMsg && lastDialogMsg.includes('배송정보를 찾을 수 없')) {
    throw new Error(`[H] 어드민 업로드 실패: ${lastDialogMsg}`);
  }

  // 원본 파일 유지

  log('[H] 어드민 송장 업로드 완료');
  return { uploadedFile: uploadName };
}

module.exports = { uploadShippingExcel };
// 동네곳간 주문 처리 CLI
// 사용: node processOrder.js <pendingId>
//   pendingId = _pending/<id>.xlsx 와 <id>.json 의 id
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');

const { readExcel, makeTg } = require('./lib/orderHelpers');
const { createSobun, createPacking, createDelivery } = require('./lib/sheetBuilders');
const { parseAddress } = require('./lib/addressParser');
const { buildWorkbook: buildLabelWorkbook } = require('./lib/buildLabels');
const _printer = require('./lib/printerUtil');
const NO_PRINT = process.argv.includes('--no-print') || process.env.NO_PRINT === '1';
const printDefault = NO_PRINT ? async (p) => console.log(`[DRY-RUN] skip print: ${p}`) : _printer.printDefault;
const printTo      = NO_PRINT ? async (p, pr) => console.log(`[DRY-RUN] skip print to ${pr}: ${p}`) : _printer.printTo;

const ROOT = __dirname;
const PENDING_DIR = path.join(ROOT, '_pending');
const PROCESSED_DIR = path.join(ROOT, '_processed');
const OUT_DIR = path.join(ROOT, 'order_output');
const PROCESSED_ORDERS_FILE = path.join(ROOT, '_processed_orders.txt');

const LABEL_PRINTER = process.env.LABEL_PRINTER || '곳간-주소스티커';
const TG_TOKEN = process.env.TG_STATUS_TOKEN || process.env.TG_TOKEN || '8796752509:AAFX54QxpY0SCXxAwpOXqqxVrKEvlZhSNKc'; // _processOrder_status_bot_v1_
const TG_CHAT = process.env.TG_CHAT || '6097520392';
const tg = makeTg(TG_TOKEN, TG_CHAT);

function log(m) { console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${m}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function buildLabels(rows, outPath) {
  const seen = new Set();
  const parsed = [];
  for (const row of rows) {
    const ono = String(row['주문번호'] || '').trim();
    const addr = String(row['주소'] || '').trim();
    const name = String(row['수령인명'] || row['수령인'] || '').trim();
    if (!ono || seen.has(ono) || !addr) continue;
    seen.add(ono);
    parsed.push(parseAddress(addr, name));
  }
  await buildLabelWorkbook(parsed, outPath);
  return { path: outPath, count: parsed.length };
}

function appendProcessedOrders(orderNos) {
  const list = orderNos.filter(Boolean);
  if (list.length === 0) return;
  fs.appendFileSync(PROCESSED_ORDERS_FILE, list.map(o => `${o}\t${new Date().toISOString()}\n`).join(''));
}

async function processPending(pendingId) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });

  const pendingXlsx = path.join(PENDING_DIR, `${pendingId}.xlsx`);
  const pendingJson = path.join(PENDING_DIR, `${pendingId}.json`);

  if (!fs.existsSync(pendingXlsx)) throw new Error(`pending xlsx 없음: ${pendingXlsx}`);

  const meta = fs.existsSync(pendingJson)
    ? JSON.parse(fs.readFileSync(pendingJson, 'utf8'))
    : { id: pendingId };

  log(`READ ${pendingId}`);
  const rows = await readExcel(pendingXlsx);
  log(`  ${rows.length}rows`);

  const now = new Date().toLocaleString('ko-KR');
  await tg(`<b>[동네곳간] 주문 처리 시작</b>\n${now}\n\n주문 ${rows.length}건 처리 중...`);

  const today = new Date().toISOString().slice(0, 10);
  const sobunPath = path.join(OUT_DIR, `소분작업_${today}.xlsx`);
  const packingPath = path.join(OUT_DIR, `패킹용_${today}.xlsx`);
  const ecoDelivPath = path.join(OUT_DIR, `배송담당_에코_${today}.xlsx`);
  const otherDelivPath = path.join(OUT_DIR, `배송담당_그외_${today}.xlsx`);
  const labelPath = path.join(OUT_DIR, `주소스티커_${today}.xlsx`);

  log('BUILD: 소분작업');
  const sb = await createSobun(rows, sobunPath);
  log(`  → ${sb.kindCount}종 / ${sb.totalQty}개`);

  log('BUILD: 패킹용');
  const pk = await createPacking(rows, packingPath);
  log(`  → ${pk.count}건`);

  log('BUILD: 배송담당 에코');
  const dEco = await createDelivery(rows, ecoDelivPath, 'eco');
  log(`  → ${dEco ? `${dEco.count}건 (계란:${dEco.withEgg})` : '0건 (생성안함)'}`);

  log('BUILD: 배송담당 그외');
  const dOther = await createDelivery(rows, otherDelivPath, 'other');
  log(`  → ${dOther ? `${dOther.count}건 (계란:${dOther.withEgg})` : '0건 (생성안함)'}`);

  log('BUILD: 주소 스티커');
  const lbl = await buildLabels(rows, labelPath);
  log(`  → ${lbl.count}장`);

  log('PRINT START...');
  await printDefault(sobunPath); await sleep(2000);
  await printDefault(packingPath); await sleep(2000);
  if (dEco) { await printDefault(ecoDelivPath); await sleep(2000); }
  if (dOther) { await printDefault(otherDelivPath); await sleep(2000); }
  if (lbl.count > 0) { await printTo(labelPath, LABEL_PRINTER); await sleep(2000); }

  // 처리완료 → _processed/ 이동 + 주문번호 기록
  const processedXlsx = path.join(PROCESSED_DIR, `${pendingId}.xlsx`);
  const processedJson = path.join(PROCESSED_DIR, `${pendingId}.json`);
  fs.renameSync(pendingXlsx, processedXlsx);
  if (fs.existsSync(pendingJson)) {
    meta.processedAt = new Date().toISOString();
    meta.outputs = { sobun: sb, packing: pk, deliveryEco: dEco, deliveryOther: dOther, label: lbl };
    fs.writeFileSync(processedJson, JSON.stringify(meta, null, 2));
    fs.renameSync(pendingJson, processedJson);
  }
  const orderNos = [...new Set(rows.map(r => String(r['주문번호'] || '').trim()).filter(Boolean))];
  appendProcessedOrders(orderNos);

  const fin = new Date().toLocaleString('ko-KR');
  const labelLine = lbl.count > 0 ? `\n장5: 주소스티커 (${lbl.count}장)` : '';
  await tg(
    `<b>[동네곳간] 출력 완료!</b>\n${fin}\n\n${rows.length}건 처리\n` +
    `장1: 소분작업\n장2: 패킹용(전체)\n` +
    `장3: 배송담당 에코델타\n장4: 배송담당 그외지역${labelLine}`
  );
  log('DONE');
}

const _args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const pendingId = _args[0];
if (!pendingId) {
  console.error('Usage: node processOrder.js <pendingId>');
  process.exit(1);
}
processPending(pendingId).catch(async err => {
  console.error('ERROR:', err);
  await tg(`<b>[동네곳간] 처리 오류</b>\n${pendingId}\n\n${err.message}`);
  process.exit(1);
});

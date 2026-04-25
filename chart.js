/**
 * chart.js — 시황 이미지 생성 + 텔레그램 발송
 * - 품목+품종 분리 표시
 * - qty 필터 없음 (전체 품목 표시)
 * - 최저가 / 평균가 / 최고가 / 7일평균 / 변동
 * - 20개씩 분할 발송
 */
require('dotenv').config();
const { createCanvas, loadImage } = require('canvas');
const path  = require('path');
const https = require('https');

const TG_TOKEN   = (process.env.TG_TOKEN   || '').trim();
const TG_CHAT_ID = (process.env.TG_CHAT_ID || '').trim();
const LOGO_PATH  = path.join(__dirname, 'logo.png');
const CHUNK      = 20;

const C = {
  bg:'#faf6f0', hbg:'#f0e8dc', rodd:'#faf6f0', reven:'#f5ede0',
  br:'#c8651e', tx:'#2c1810', sub:'#8b6355',
  min_c:'#2980b9', max_c:'#c0392b', unit_c:'#7f8c8d',
};

const pctColor = p => p===null?'#b2bec3':p>=10?'#d63031':p>=3?'#e17055':p>=0?'#fdcb6e':p>=-3?'#00b894':p>=-10?'#00cec9':'#0984e3';
const pctLabel = p => p===null?'신규':(p>=0?'▲':'▼')+Math.abs(p)+'%';
const won = n => n.toLocaleString();

// ── 데이터 그룹화 (품목+품종 분리, qty 필터 없음) ─────────────────────
function groupItems(items) {
  const map = {};
  items.forEach(it => {
    const nm   = it.corp_gds_item_nm || '';
    const vrty = it.corp_gds_vrty_nm || '';
    const qty  = Number(it.qty), prc = Number(it.scsbd_prc);
    if (!nm || qty <= 0 || prc <= 0) return;

    const key = vrty ? `${nm}|||${vrty}` : nm;
    if (!map[key]) map[key] = { nm, vrty, qty:0, sum:0, cnt:0, min:Infinity, max:-Infinity, units:{} };
    map[key].qty += qty; map[key].sum += qty*prc; map[key].cnt++;
    map[key].min = Math.min(map[key].min, prc);
    map[key].max = Math.max(map[key].max, prc);

    const uQty=Number(it.unit_qty)||0, uNm=(it.unit_nm||'').trim(), pkgNm=(it.pkg_nm||'').trim();
    const ul = uQty ? `${uQty}${uNm}${pkgNm?' '+pkgNm:''}` : (pkgNm||uNm||'-');
    map[key].units[ul] = (map[key].units[ul]||0)+1;
  });

  const r = {};
  Object.entries(map).forEach(([key, v]) => {
    const topUnit = Object.entries(v.units).sort((a,b)=>b[1]-a[1])[0]?.[0]||'-';
    r[key] = {
      displayName: v.vrty || v.nm,
      nm: v.nm, vrty: v.vrty,
      avg: Math.round(v.sum/v.qty), min: v.min, max: v.max,
      cnt: v.cnt, qty: v.qty, unit: topUnit,
    };
  });
  return r;
}

// ── 이미지 생성 ────────────────────────────────────────────────────────
async function createMarketImage(rows, pageLabel, date, totalCnt) {
  const ROW_H=42, PAD=14, TH=90, HH=46, FH=44, W=900;
  const H = TH+HH+rows.length*ROW_H+FH+PAD;
  const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d');

  // 배경
  ctx.fillStyle=C.bg; ctx.fillRect(0,0,W,H);
  ctx.fillStyle=C.hbg; ctx.fillRect(0,0,W,TH);
  ctx.fillStyle=C.br; ctx.fillRect(0,TH-3,W,3);

  // 로고
  let lx=PAD;
  try {
    const logo=await loadImage(LOGO_PATH);
    const lh=62, lw=Math.round(logo.width*lh/logo.height);
    ctx.drawImage(logo,PAD,(TH-lh)/2,lw,lh); lx=PAD+lw+14;
  } catch(e){}

  // 타이틀
  ctx.textAlign='left'; ctx.fillStyle=C.br; ctx.font='bold 20px sans-serif';
  ctx.fillText(`전체 시황 ${pageLabel}`, lx, 34);
  ctx.fillStyle=C.sub; ctx.font='13px sans-serif';
  ctx.fillText(`${date}  농협부산(공)  총 ${totalCnt.toLocaleString()}건`, lx, 56);
  ctx.fillText('엄궁농산물도매시장', lx, 74);

  // 컬럼
  const cols=[
    {l:'품목/품종', x:PAD,  w:120, a:'left'},
    {l:'단량/박스', x:148,  w:105, a:'left'},
    {l:'최저가',    x:265,  w:100, a:'right'},
    {l:'평균가',    x:377,  w:110, a:'right'},
    {l:'최고가',    x:499,  w:100, a:'right'},
    {l:'7일평균',   x:611,  w:108, a:'right'},
    {l:'변동',      x:731,  w:155, a:'center'},
  ];

  ctx.fillStyle='#e8ddd0'; ctx.fillRect(0,TH,W,HH);
  cols.forEach(c=>{
    ctx.fillStyle=C.sub; ctx.font='bold 12px sans-serif';
    if(c.a==='right'){ctx.textAlign='right';ctx.fillText(c.l,c.x+c.w,TH+30);}
    else if(c.a==='center'){ctx.textAlign='center';ctx.fillText(c.l,c.x+c.w/2,TH+30);}
    else{ctx.textAlign='left';ctx.fillText(c.l,c.x,TH+30);}
  });
  [cols[1].x,cols[2].x,cols[3].x,cols[4].x,cols[5].x,cols[6].x].forEach(x=>{
    ctx.strokeStyle='rgba(0,0,0,0.08)';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x-3,TH+6);ctx.lineTo(x-3,TH+HH-4);ctx.stroke();
  });
  ctx.strokeStyle=C.br; ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(0,TH+HH);ctx.lineTo(W,TH+HH);ctx.stroke();

  // 데이터 행
  rows.forEach((row,i)=>{
    const ry=TH+HH+i*ROW_H;
    ctx.fillStyle=i%2===0?C.rodd:C.reven; ctx.fillRect(0,ry,W,ROW_H);
    const cy=ry+ROW_H*0.64;

    // 품목/품종
    if(row.vrty){
      ctx.textAlign='left'; ctx.fillStyle=C.tx; ctx.font='bold 13px sans-serif';
      ctx.fillText(row.vrty.slice(0,7), cols[0].x, ry+ROW_H*0.45);
      ctx.fillStyle=C.sub; ctx.font='10px sans-serif';
      ctx.fillText(row.nm.slice(0,5), cols[0].x, ry+ROW_H*0.78);
    } else {
      ctx.textAlign='left'; ctx.fillStyle=C.tx; ctx.font='bold 14px sans-serif';
      ctx.fillText(row.displayName.slice(0,7), cols[0].x, cy);
    }

    // 단량
    ctx.textAlign='left'; ctx.fillStyle=C.unit_c; ctx.font='12px sans-serif';
    ctx.fillText((row.unit||'-').slice(0,9), cols[1].x, cy);

    // 최저가
    ctx.textAlign='right'; ctx.fillStyle=C.min_c; ctx.font='13px sans-serif';
    ctx.fillText(won(row.min), cols[2].x+cols[2].w, cy);

    // 평균가 (굵게)
    ctx.textAlign='right'; ctx.fillStyle=C.tx; ctx.font='bold 15px sans-serif';
    ctx.fillText(won(row.avg), cols[3].x+cols[3].w, cy);

    // 최고가
    ctx.textAlign='right'; ctx.fillStyle=C.max_c; ctx.font='13px sans-serif';
    ctx.fillText(won(row.max), cols[4].x+cols[4].w, cy);

    // 7일평균
    ctx.textAlign='right'; ctx.fillStyle=C.sub; ctx.font='13px sans-serif';
    ctx.fillText(row.week7 ? won(row.week7) : '-', cols[5].x+cols[5].w, cy);

    // 변동
    const color=pctColor(row.pct), lbl=pctLabel(row.pct);
    ctx.font='bold 13px sans-serif'; ctx.textAlign='center';
    const tw=ctx.measureText(lbl).width+18, tx2=cols[6].x+cols[6].w/2;
    ctx.fillStyle=color+'22'; ctx.beginPath(); ctx.roundRect(tx2-tw/2,ry+7,tw,ROW_H-14,5); ctx.fill();
    ctx.strokeStyle=color+'88'; ctx.lineWidth=1; ctx.beginPath(); ctx.roundRect(tx2-tw/2,ry+7,tw,ROW_H-14,5); ctx.stroke();
    ctx.fillStyle=color; ctx.fillText(lbl,tx2,cy);

    ctx.strokeStyle='rgba(0,0,0,0.05)'; ctx.lineWidth=0.5;
    ctx.beginPath();ctx.moveTo(0,ry+ROW_H);ctx.lineTo(W,ry+ROW_H);ctx.stroke();
  });

  // 범례
  const fy=TH+HH+rows.length*ROW_H+8;
  ctx.font='11px sans-serif'; ctx.textAlign='left';
  [{c:C.min_c,l:'최저가'},{c:C.tx,l:'평균가'},{c:C.max_c,l:'최고가'}].forEach((l,i)=>{
    ctx.fillStyle=l.c; ctx.fillRect(PAD+i*90,fy+7,10,10);
    ctx.fillStyle=C.sub; ctx.fillText(l.l,PAD+i*90+14,fy+16);
  });
  [{c:'#d63031',l:'급등▲10%↑'},{c:'#e17055',l:'▲3~10%'},{c:'#00cec9',l:'▼3~10%'},{c:'#0984e3',l:'급락▼10%↑'}].forEach((l,i)=>{
    ctx.fillStyle=l.c; ctx.fillRect(PAD+290+i*95,fy+7,10,10);
    ctx.fillStyle=C.sub; ctx.fillText(l.l,PAD+290+i*95+14,fy+16);
  });
  ctx.textAlign='right'; ctx.fillStyle=C.br; ctx.font='bold 11px sans-serif';
  ctx.fillText('동네곳간 경락가 시스템', W-PAD, fy+16);

  return canvas.toBuffer('image/png');
}

// ── 텔레그램 이미지 발송 ──────────────────────────────────────────────
async function sendTelegramImage(imageBuffer, caption) {
  if (!TG_TOKEN || !TG_CHAT_ID) return false;
  const bd='----TGBound'+Date.now().toString(16), CRLF='\r\n';
  const meta=`--${bd}${CRLF}Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}${TG_CHAT_ID}${CRLF}--${bd}${CRLF}Content-Disposition: form-data; name="caption"${CRLF}${CRLF}${caption}${CRLF}`;
  const file=`--${bd}${CRLF}Content-Disposition: form-data; name="photo"; filename="market.png"${CRLF}Content-Type: image/png${CRLF}${CRLF}`;
  const end=`${CRLF}--${bd}--${CRLF}`;
  const body=Buffer.concat([Buffer.from(meta,'utf8'),Buffer.from(file,'utf8'),imageBuffer,Buffer.from(end,'utf8')]);
  return new Promise(resolve=>{
    const req=https.request({
      hostname:'api.telegram.org', path:`/bot${TG_TOKEN}/sendPhoto`, method:'POST',
      headers:{'Content-Type':`multipart/form-data; boundary=${bd}`,'Content-Length':body.length}
    },(res)=>{
      let d=''; res.on('data',x=>d+=x);
      res.on('end',()=>{try{resolve(JSON.parse(d).ok===true);}catch{resolve(false);}});
    });
    req.on('error',()=>resolve(false)); req.write(body); req.end();
  });
}

// ── 메인: 전체 시황 이미지 발송 (20개씩 분할) ─────────────────────────
async function sendMarketImage(todayMap, weekAvgMap, label, date) {
  const totalCnt = Object.values(todayMap).reduce((s,v)=>s+v.cnt, 0);

  // 거래건수 많은 순 정렬
  const allRows = Object.entries(todayMap)
    .sort((a,b) => b[1].cnt - a[1].cnt)
    .map(([key, v]) => {
      const w7  = weekAvgMap[key] || null;
      const pct = w7 ? Math.round((v.avg-w7)/w7*100) : null;
      return { displayName:v.displayName, nm:v.nm, vrty:v.vrty, unit:v.unit, min:v.min, avg:v.avg, max:v.max, week7:w7, pct };
    });

  // 20개씩 분할
  const chunks = [];
  for (let i=0; i<allRows.length; i+=CHUNK) chunks.push(allRows.slice(i,i+CHUNK));

  let allOk = true;
  for (let i=0; i<chunks.length; i++) {
    const pageLabel = chunks.length > 1 ? `${label} (${i+1}/${chunks.length})` : label;
    const buf = await createMarketImage(chunks[i], pageLabel, date, totalCnt);
    const ok  = await sendTelegramImage(buf, `📊 전체 시황 ${pageLabel} | ${date} 농협부산(공)`);
    console.log(ok ? `✅ 이미지 ${i+1}/${chunks.length} 발송` : `❌ 이미지 ${i+1}/${chunks.length} 실패`);
    if (!ok) allOk = false;
    if (i < chunks.length-1) await new Promise(r=>setTimeout(r,600));
  }
  return allOk;
}

module.exports = { sendMarketImage, groupItems };

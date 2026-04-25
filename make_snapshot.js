const fs = require('fs');
const path = require('path');

const BASE = 'D:\\경락가데이터서버\\eomgung-market';
const SNAP_DIR = path.join(BASE, '_snapshots');

// 날짜 기반 폴더명
const now = new Date();
const pad = n => String(n).padStart(2,'0');
const name = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const dest = path.join(SNAP_DIR, name);

fs.mkdirSync(dest, { recursive: true });

const files = ['tg_status_bot.js', 'scheduler.js', 'server.js'];
files.forEach(f => {
  const src = path.join(BASE, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dest, f));
    console.log(`✅ ${f} 백업완료`);
  } else {
    console.log(`⚠️ ${f} 없음`);
  }
});

console.log(`\n📦 스냅샷 폴더: _snapshots\\${name}`);
console.log('\n복구 명령어:');
files.forEach(f => {
  console.log(`  copy "_snapshots\\${name}\\${f}" ${f}`);
});
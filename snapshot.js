/**
 * snapshot.js — 동네곳간 서버 파일 스냅샷 저장/복원
 *
 * 사용법:
 *   node snapshot.js save          → 현재 상태 저장
 *   node snapshot.js save "메모"   → 메모와 함께 저장
 *   node snapshot.js list          → 저장된 스냅샷 목록
 *   node snapshot.js restore       → 최신 스냅샷으로 복원
 *   node snapshot.js restore [번호] → 목록에서 선택 복원
 */

const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

const BASE_DIR     = __dirname;
const SNAPSHOT_DIR = path.join(BASE_DIR, '_snapshots');

// 백업할 파일 목록 (핵심 파일만)
const TARGET_FILES = [
  'tg_status_bot.js',
  'auto_approve_watch.js',
  'server.js',
  'scheduler.js',
  'order_watcher.js',
  'mini_server.js',
  'db.js',
];

function pad(n) { return String(n).padStart(2, '0'); }

function getTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function formatDate(ts) {
  // ts = '20260424_213000'
  return `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(9,11)}:${ts.slice(11,13)}:${ts.slice(13,15)}`;
}

function listSnapshots() {
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  return fs.readdirSync(SNAPSHOT_DIR)
    .filter(f => fs.statSync(path.join(SNAPSHOT_DIR, f)).isDirectory())
    .sort()
    .reverse(); // 최신순
}

// ── SAVE ─────────────────────────────────────────────────────────────────────
function save(memo) {
  const ts   = getTimestamp();
  const dir  = path.join(SNAPSHOT_DIR, ts);
  fs.mkdirSync(dir, { recursive: true });

  const saved = [];
  const missing = [];

  TARGET_FILES.forEach(file => {
    const src = path.join(BASE_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dir, file));
      saved.push(file);
    } else {
      missing.push(file);
    }
  });

  // pm2 list 저장
  try {
    const pm2list = execSync('pm2 jlist', { encoding: 'utf8' });
    fs.writeFileSync(path.join(dir, '_pm2_list.json'), pm2list);
  } catch(e) {}

  // 메모 저장
  const meta = {
    timestamp: ts,
    date: formatDate(ts),
    memo: memo || '',
    saved,
    missing,
  };
  fs.writeFileSync(path.join(dir, '_meta.json'), JSON.stringify(meta, null, 2));

  console.log(`\n✅ 스냅샷 저장 완료: ${ts}`);
  console.log(`   날짜: ${formatDate(ts)}`);
  if (memo) console.log(`   메모: ${memo}`);
  console.log(`   저장된 파일 (${saved.length}개): ${saved.join(', ')}`);
  if (missing.length) console.log(`   ⚠ 없는 파일: ${missing.join(', ')}`);
  console.log(`   경로: ${dir}\n`);
}

// ── LIST ─────────────────────────────────────────────────────────────────────
function list() {
  const snaps = listSnapshots();
  if (snaps.length === 0) {
    console.log('\n저장된 스냅샷이 없습니다.\n node snapshot.js save 로 저장하세요.\n');
    return;
  }
  console.log(`\n📦 저장된 스냅샷 (${snaps.length}개)\n`);
  snaps.forEach((ts, i) => {
    const metaPath = path.join(SNAPSHOT_DIR, ts, '_meta.json');
    let memo = '';
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      memo = meta.memo ? ` — ${meta.memo}` : '';
    } catch(e) {}
    console.log(`  [${i+1}] ${formatDate(ts)}${memo}  (${ts})`);
  });
  console.log('');
}

// ── RESTORE ──────────────────────────────────────────────────────────────────
function restore(idx) {
  const snaps = listSnapshots();
  if (snaps.length === 0) {
    console.log('\n❌ 저장된 스냅샷이 없습니다.\n');
    process.exit(1);
  }

  // idx 없으면 최신 (0번)
  const n = idx !== undefined ? parseInt(idx) - 1 : 0;
  if (isNaN(n) || n < 0 || n >= snaps.length) {
    console.log(`\n❌ 잘못된 번호. 1~${snaps.length} 사이로 입력하세요.\n`);
    process.exit(1);
  }

  const ts  = snaps[n];
  const dir = path.join(SNAPSHOT_DIR, ts);

  let metaMemo = '';
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8'));
    metaMemo = meta.memo ? ` (${meta.memo})` : '';
  } catch(e) {}

  console.log(`\n🔄 복원 시작: ${formatDate(ts)}${metaMemo}\n`);

  // 현재 상태 자동 백업
  console.log('  1. 현재 상태 자동 백업 중...');
  save('복원 전 자동백업');

  // 파일 복원
  console.log('  2. 파일 복원 중...');
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('_'));
  const restored = [];
  files.forEach(file => {
    const src  = path.join(dir, file);
    const dest = path.join(BASE_DIR, file);
    fs.copyFileSync(src, dest);
    restored.push(file);
    console.log(`     ✓ ${file}`);
  });

  // pm2 프로세스 재시작
  console.log('  3. PM2 프로세스 재시작 중...');
  const procs = ['gotgan-server', 'gotgan-status', 'gotgan-approve', 'gotgan-scheduler', 'gotgan-watcher', 'gotgan-mini'];
  procs.forEach(proc => {
    try {
      execSync(`pm2 restart ${proc}`, { encoding: 'utf8' });
      console.log(`     ✓ ${proc} 재시작`);
    } catch(e) {
      console.log(`     - ${proc} (없음, 건너뜀)`);
    }
  });

  console.log(`\n✅ 복원 완료! ${formatDate(ts)} 상태로 돌아왔습니다.\n`);
  console.log('   확인: pm2 list\n');
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
const [,, cmd, arg] = process.argv;

switch (cmd) {
  case 'save':
    save(arg || '');
    break;
  case 'list':
    list();
    break;
  case 'restore':
    restore(arg);
    break;
  default:
    console.log(`
📸 동네곳간 스냅샷 도구

사용법:
  node snapshot.js save          현재 상태 저장
  node snapshot.js save "메모"   메모와 함께 저장
  node snapshot.js list          저장된 스냅샷 목록
  node snapshot.js restore       최신 스냅샷으로 복원
  node snapshot.js restore 2     목록 2번으로 복원
`);
}
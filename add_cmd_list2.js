const fs = require('fs');
const p = 'D:\\경락가데이터서버\\eomgung-market\\tg_status_bot.js';
let t = fs.readFileSync(p, 'utf8');

fs.writeFileSync(p + '.bak_cmd_' + Date.now(), t);

// CMDS 배열 끝에 명령어확인 추가
const OLD_CMDS = "'/명령어리스트','명령어리스트'];";
const NEW_CMDS = "'/명령어리스트','명령어리스트','/명령어확인','명령어확인'];";

if (!t.includes(OLD_CMDS)) {
  console.log('CMDS 패턴 없음, 현재내용:', t.slice(t.indexOf('CMDS'), t.indexOf('CMDS')+150));
  process.exit(1);
}
t = t.replace(OLD_CMDS, NEW_CMDS);
console.log('CMDS 수정완료');

// handleCommand 안에서 명령어리스트 핸들러 찾아서 그 앞에 명령어확인 핸들러 삽입
const LIST_HANDLER = "if(cmd=='/명령어리스트'||cmd=='명령어리스트')";
const idx = t.indexOf(LIST_HANDLER);
if (idx < 0) {
  console.log('핸들러 패턴 없음');
  process.exit(1);
}

const NEW_HANDLER = `if(cmd=='/명령어확인'||cmd=='명령어확인'){
    const m=[
      '📋 전체 명령어 안내',
      '',
      '━━━ 주문현황봇 ━━━',
      '/주문건확인  → 어드민+곳간 통합 주문현황',
      '/주문출력   → 곳간 배송준비 엑셀 다운로드',
      '/승인상태   → 자동승인 봇 상태',
      '',
      '━━━ 시세봇 ━━━',
      '품목명 시세     → 시세 조회 (예: 깻잎 시세)',
      '품목명 주간     → 7일 주간 시세',
      '품목명 어제 시세 → 어제 시세',
      '',
      '/과일류  /채소류  /버섯류  /특용작물',
      '→ 카테고리별 시세',
      '',
      '/시황       → 오늘 전체 시황',
      '/추적목록    → 추적 품목 목록',
      '/추적추가 품목명 → 추적 추가',
      '/추적제거 품목명 → 추적 제거',
      '/도움말      → 시세봇 도움말'
    ].join('\\n');
    await tgSend(m, chatId); return;
  }
  `;

t = t.slice(0, idx) + NEW_HANDLER + t.slice(idx);
fs.writeFileSync(p, t, 'utf8');
console.log('완료 - pm2 restart gotgan-status 실행하세요');
/**
 * add_tg_to_tracked.js
 * sendTrackedItems() 함수에 텔레그램 발송 추가
 * sendKakao 바로 다음 줄에 텔레그램 발송 코드 삽입
 */
const fs = require('fs');
const path = 'D:\\경락가데이터서버\\eomgung-market\\scheduler.js';

let t = fs.readFileSync(path, 'utf8');

// 백업
const bak = path + '.bak_tg_tracked_' + Date.now() + '.js';
fs.writeFileSync(bak, t);
console.log('백업:', bak);

// 찾을 패턴 - sendTrackedItems 함수 내 카카오 발송 후 대기 부분
const OLD = `    const ok = await sendKakao(msg);
    console.log(\`\${ok ? '✅' : '❌'} \${target} 리포트 발송\`);
    await new Promise(r => setTimeout(r, 500)); // 연속 발송 간격`;

const NEW = `    const ok = await sendKakao(msg);
    console.log(\`\${ok ? '✅' : '❌'} \${target} 리포트 발송\`);
    // 텔레그램에도 발송
    try {
      const tgBody = new URLSearchParams({ chat_id: process.env.TG_CHAT_ID, text: msg, parse_mode: 'HTML' });
      await fetch(\`https://api.telegram.org/bot\${process.env.TG_TOKEN}/sendMessage\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tgBody.toString(),
      });
      console.log(\`✅ \${target} 텔레그램 발송\`);
    } catch(e) { console.log(\`❌ \${target} 텔레그램 실패:\`, e.message); }
    await new Promise(r => setTimeout(r, 500)); // 연속 발송 간격`;

if (!t.includes(OLD)) {
  console.log('❌ 패턴 못찾음 - 수동 확인 필요');
  process.exit(1);
}

t = t.replace(OLD, NEW);
fs.writeFileSync(path, t, 'utf8');
console.log('✅ 텔레그램 발송 추가 완료');
console.log('\n다음 실행:');
console.log('   pm2 restart gotgan-scheduler');
/**
 * add_cmd_list.js
 * tg_status_bot.js에 명령어확인 커맨드 추가
 */
const fs = require('fs');
const path = 'D:\\경락가데이터서버\\eomgung-market\\tg_status_bot.js';
let t = fs.readFileSync(path, 'utf8');

const bak = path + '.bak_cmdlist_' + Date.now() + '.js';
fs.writeFileSync(bak, t);

// 1. CMDS 배열에 명령어확인 추가
// 기존: '/명령어리스트','명령어리스트'];
// 변경: '/명령어리스트','명령어리스트','/명령어확인','명령어확인'];
const OLD_CMDS = "'/\\uBA85\\uB839\\uC5B4\\uB9AC\\uC2A4\\uD2B8','\\uBA85\\uB839\\uC5B4\\uB9AC\\uC2A4\\uD2B8'];";
const NEW_CMDS = "'/\\uBA85\\uB839\\uC5B4\\uB9AC\\uC2A4\\uD2B8','\\uBA85\\uB839\\uC5B4\\uB9AC\\uC2A4\\uD2B8','/" +
  "\\uBA85\\uB839\\uC5B4\\uD655\\uC778','\\uBA85\\uB839\\uC5B4\\uD655\\uC778'];";

// CMDS 배열을 직접 찾기 (유니코드 이스케이프 방식)
// 실제 파일에서는 한글로 저장되어 있을 수 있으므로 두 방식 모두 시도
const cmds_pattern1 = "'\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8','\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8'];";
const cmds_replace1 = "'\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8','\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8','/\uBA85\uB839\uC5B4\uD655\uC778','\uBA85\uB839\uC5B4\uD655\uC778'];";

if (t.includes(cmds_pattern1)) {
  t = t.replace(cmds_pattern1, cmds_replace1);
  console.log('CMDS 배열 수정 완료');
} else {
  console.log('CMDS 패턴 못찾음 - 현재 CMDS 내용:');
  const i = t.indexOf('CMDS');
  console.log(t.slice(i, i+200));
  process.exit(1);
}

// 2. handleCommand에 명령어확인 핸들러 추가
// /명령어리스트 핸들러 다음에 추가
const OLD_HANDLER = "if(cmd==='\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8'||cmd==='\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8'||cmd==='/\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8'){";

// 위 패턴 못찾으면 다른 패턴 시도
let handlerIdx = t.indexOf('\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8'); // 명령어리스트
if (handlerIdx < 0) {
  console.log('핸들러 패턴 못찾음');
  process.exit(1);
}

// 명령어리스트 핸들러 블록 찾기 - handleCommand 함수 내에서
const funcStart = t.indexOf('function handleCommand');
const listIdx = t.indexOf('\uBA85\uB839\uC5B4\uB9AC\uC2A4\uD2B8', funcStart);
// 해당 if 블록의 닫는 } 찾기
let braceCount = 0;
let blockStart = t.lastIndexOf('\n', listIdx);
// if( 찾기
let ifStart = t.lastIndexOf('if(', listIdx);
let pos = ifStart;
while (pos < t.length) {
  if (t[pos] === '{') braceCount++;
  if (t[pos] === '}') {
    braceCount--;
    if (braceCount === 0) break;
  }
  pos++;
}
const blockEnd = pos + 1; // } 다음

const newHandler = `
  if(cmd==='\uBA85\uB839\uC5B4\uD655\uC778'||cmd==='/\uBA85\uB839\uC5B4\uD655\uC778'){
    const msg=[
      '\uD83D\uDCCB \uC804\uCCB4 \uBA85\uB839\uC5B4 \uC548\uB0B4',
      '',
      '\u2501\u2501\u2501 \uC8FC\uBB38\uD604\uD669\uBD07 \u2501\u2501\u2501',
      '/\uC8FC\uBB38\uAC74\uD655\uC778  \u2192 \uC5B4\uB4DC\uBBFC+\uACF3\uAC04 \uD1B5\uD569 \uC8FC\uBB38\uD604\uD669',
      '/\uC8FC\uBB38\uCD9C\uB825   \u2192 \uACF3\uAC04 \uBC30\uC1A1\uC900\uBE44 \uC5D1\uC140 \uB2E4\uC6B4\uB85C\uB4DC',
      '/\uC2B9\uC778\uC0C1\uD0DC   \u2192 \uC790\uB3D9\uC2B9\uC778 \uBD07 \uC0C1\uD0DC',
      '',
      '\u2501\u2501\u2501 \uC2DC\uC138\uBD07 \u2501\u2501\u2501',
      '\uD488\uBAA9\uBA85 \uC2DC\uC138     \u2192 \uC2DC\uC138 \uC870\uD68C (\uC608: \uAE68\uC78E \uC2DC\uC138)',
      '\uD488\uBAA9\uBA85 \uC8FC\uAC04     \u2192 7\uC77C \uC8FC\uAC04 \uC2DC\uC138',
      '\uD488\uBAA9\uBA85 \uC5B4\uC81C \uC2DC\uC138 \u2192 \uC5B4\uC81C \uC2DC\uC138',
      '',
      '/\uACFC\uC77C\uB958  /\uCC44\uC18C\uB958  /\uBC84\uC12F\uB958  /\uD2B9\uC6A9\uC791\uBB3C',
      '\u2192 \uCE74\uD14C\uACE0\uB9AC\uBCC4 \uC2DC\uC138',
      '',
      '/\uC2DC\uD669       \u2192 \uC624\uB298 \uC804\uCCB4 \uC2DC\uD669',
      '/\uCD94\uC801\uBAA9\uB85D    \u2192 \uCD94\uC801 \uD488\uBAA9 \uBAA9\uB85D',
      '/\uCD94\uC801\uCD94\uAC00 \uD488\uBAA9\uBA85 \u2192 \uCD94\uC801 \uCD94\uAC00',
      '/\uCD94\uC801\uC81C\uAC70 \uD488\uBAA9\uBA85 \u2192 \uCD94\uC801 \uC81C\uAC70',
      '/\uB3C4\uC6C0\uB9D0      \u2192 \uC2DC\uC138\uBD07 \uB3C4\uC6C0\uB9D0'
    ].join('\n');
    await tgSend(msg, chatId);
    return;
  }`;

t = t.slice(0, blockEnd) + newHandler + t.slice(blockEnd);
fs.writeFileSync(path, t, 'utf8');
console.log('명령어확인 핸들러 추가 완료');
console.log('\n실행:\n   pm2 restart gotgan-status');
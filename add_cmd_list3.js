const fs = require('fs');
const p = 'D:\\경락가데이터서버\\eomgung-market\\tg_status_bot.js';
let t = fs.readFileSync(p, 'utf8');

fs.writeFileSync(p + '.bak_cmd3_' + Date.now(), t);

// 파일은 한글을 \uXXXX 리터럴로 저장 - 이를 그대로 매칭
const OLD_CMDS = "'/\\uBA85\\uB839\\uC5B4\\uB9AC\\uC2A4\\uD2B8','\\uBA85\\uB839\\uC5B4\\uB9AC\\uC2A4\\uD2B8'];";
const NEW_CMDS = "'/\\uBA85\\uB839\\uC5B4\\uB9AC\\uC2A4\\uD2B8','\\uBA85\\uB839\\uC5B4\\uB9AC\\uC2A4\\uD2B8','/\\uBA85\\uB839\\uC5B4\\uD655\\uC778','\\uBA85\\uB839\\uC5B4\\uD655\\uC778'];";

if (!t.includes(OLD_CMDS)) {
  console.log('CMDS 패턴 없음');
  process.exit(1);
}
t = t.replace(OLD_CMDS, NEW_CMDS);
console.log('CMDS 수정완료');

// handleCommand에서 명령어리스트 핸들러 찾아서 앞에 명령어확인 핸들러 삽입
const LIST_HANDLER = "if(cmd=='/\\uBA85\\uB839\\uC5B4\\uB9AC\\uC2A4\\uD2B8'||cmd=='\\uBA85\\uB839\\uC5B4\\uB9AC\\uC2A4\\uD2B8')";
const idx = t.indexOf(LIST_HANDLER);
if (idx < 0) {
  // 다른 패턴 시도
  console.log('핸들러 패턴 없음, 파일 끝에 추가방식으로 처리');
}

const NEW_HANDLER = `if(cmd=='/\\uBA85\\uB839\\uC5B4\\uD655\\uC778'||cmd=='\\uBA85\\uB839\\uC5B4\\uD655\\uC778'){
    const m=[
      '\\uD83D\\uDCCB \\uC804\\uCCB4 \\uBA85\\uB839\\uC5B4 \\uC548\\uB0B4',
      '',
      '\\u2501\\u2501\\u2501 \\uC8FC\\uBB38\\uD604\\uD669\\uBD07 \\u2501\\u2501\\u2501',
      '/\\uC8FC\\uBB38\\uAC74\\uD655\\uC778  \\u2192 \\uC5B4\\uB4DC\\uBBFC+\\uACF3\\uAC04 \\uD1B5\\uD569 \\uC8FC\\uBB38\\uD604\\uD669',
      '/\\uC8FC\\uBB38\\uCD9C\\uB825   \\u2192 \\uACF3\\uAC04 \\uBC30\\uC1A1\\uC900\\uBE44 \\uC5D1\\uC140 \\uB2E4\\uC6B4\\uB85C\\uB4DC',
      '/\\uC2B9\\uC778\\uC0C1\\uD0DC   \\u2192 \\uC790\\uB3D9\\uC2B9\\uC778 \\uBD07 \\uC0C1\\uD0DC',
      '',
      '\\u2501\\u2501\\u2501 \\uC2DC\\uC138\\uBD07 \\u2501\\u2501\\u2501',
      '\\uD488\\uBAA9\\uBA85 \\uC2DC\\uC138     \\u2192 \\uC2DC\\uC138 \\uC870\\uD68C (\\uC608: \\uAE68\\uC78E \\uC2DC\\uC138)',
      '\\uD488\\uBAA9\\uBA85 \\uC8FC\\uAC04     \\u2192 7\\uC77C \\uC8FC\\uAC04 \\uC2DC\\uC138',
      '\\uD488\\uBAA9\\uBA85 \\uC5B4\\uC81C \\uC2DC\\uC138 \\u2192 \\uC5B4\\uC81C \\uC2DC\\uC138',
      '',
      '/\\uACFC\\uC77C\\uB958  /\\uCC44\\uC18C\\uB958  /\\uBC84\\uC12F\\uB958  /\\uD2B9\\uC6A9\\uC791\\uBB3C',
      '\\u2192 \\uCE74\\uD14C\\uACE0\\uB9AC\\uBCC4 \\uC2DC\\uC138',
      '',
      '/\\uC2DC\\uD669       \\u2192 \\uC624\\uB298 \\uC804\\uCCB4 \\uC2DC\\uD669',
      '/\\uCD94\\uC801\\uBAA9\\uB85D    \\u2192 \\uCD94\\uC801 \\uD488\\uBAA9 \\uBAA9\\uB85D',
      '/\\uCD94\\uC801\\uCD94\\uAC00 \\uD488\\uBAA9\\uBA85 \\u2192 \\uCD94\\uC801 \\uCD94\\uAC00',
      '/\\uCD94\\uC801\\uC81C\\uAC70 \\uD488\\uBAA9\\uBA85 \\u2192 \\uCD94\\uC801 \\uC81C\\uAC70',
      '/\\uB3C4\\uC6C0\\uB9D0      \\u2192 \\uC2DC\\uC138\\uBD07 \\uB3C4\\uC6C0\\uB9D0'
    ].join('\\n');
    await tgSend(m, chatId); return;
  }
  `;

if (idx >= 0) {
  t = t.slice(0, idx) + NEW_HANDLER + t.slice(idx);
  console.log('핸들러 삽입완료');
} else {
  // handleCommand 함수 내 busy 체크 이후 첫번째 if 앞에 삽입
  const busyIdx = t.indexOf('if(busy)');
  if (busyIdx >= 0) {
    const afterBusy = t.indexOf('\n', busyIdx) + 1;
    t = t.slice(0, afterBusy) + '  ' + NEW_HANDLER + t.slice(afterBusy);
    console.log('핸들러 대안삽입완료');
  }
}

fs.writeFileSync(p, t, 'utf8');
console.log('완료 - pm2 restart gotgan-status 실행하세요');
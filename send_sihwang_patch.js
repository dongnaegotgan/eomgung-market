/**
 * send_sihwang_patch.js
 * server.js에서 시황/전체시황/오늘시황 명령어가
 * 품목 검색으로 잡히는 문제 수정
 *
 * 사용법: node send_sihwang_patch.js
 */
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'server.js');
let src = fs.readFileSync(FILE, 'utf8');

// 650번 줄 근처: else if (searchWord.length >= 1) 앞에 시황 예외 추가
const OLD = `    else if (searchWord.length >= 1)    cmd = isWeekly ? '주간검색' : '검색';`;
const NEW = `    else if (has('시황','전체시황','오늘시황')) cmd = '시황';
    else if (searchWord.length >= 1)    cmd = isWeekly ? '주간검색' : '검색';`;

if (!src.includes(OLD)) {
  console.log('❌ 대상 코드를 찾지 못했습니다. 이미 패치됐거나 코드가 변경됐을 수 있습니다.');
  console.log('아래 줄이 존재하는지 확인하세요:');
  console.log(OLD);
  process.exit(1);
}

if (src.includes(`has('시황','전체시황','오늘시황')`)) {
  console.log('✅ 이미 패치되어 있습니다.');
  process.exit(0);
}

src = src.replace(OLD, NEW);
fs.writeFileSync(FILE, src, 'utf8');
console.log('✅ server.js 패치 완료');
console.log("추가된 줄: else if (has('시황','전체시황','오늘시황')) cmd = '시황';");
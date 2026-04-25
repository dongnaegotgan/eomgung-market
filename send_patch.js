const http = require('http');
const content = "\nconst fs = require('fs');\nconst path = require('path');\nconst file = path.join(__dirname, 'scheduler.js');\nlet content = fs.readFileSync(file, 'utf8');\n\n// approveWatch \uad00\ub828 \uc904 \uc81c\uac70\nconst lines = content.split('\\n');\nconst patched = lines.map(line => {\n  if (line.includes('approveWatch') || line.includes('auto_approve_watch')) {\n    return '// [PATCHED] ' + line;\n  }\n  return line;\n}).join('\\n');\n\nfs.writeFileSync(file, patched, 'utf8');\nconsole.log('\u2705 scheduler.js \ud328\uce58 \uc644\ub8cc');\n\n// \ubcc0\uacbd\ub41c \uc904 \ud655\uc778\nlines.forEach((line, i) => {\n  if (line.includes('approveWatch') || line.includes('auto_approve_watch')) {\n    console.log('\uc8fc\uc11d\ucc98\ub9ac\ub41c \uc904 ' + (i+1) + ': ' + line.trim().slice(0, 80));\n  }\n});\n";
const body = JSON.stringify({ fn: 'patch_scheduler.js', ct: content });
const req = http.request({
  hostname: 'localhost', port: 3001, path: '/write-file',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('결과:', d));
});
req.on('error', e => console.error('오류:', e.message));
req.write(body);
req.end();
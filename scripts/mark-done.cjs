// 자동 작업 도우미: 일별 할일·체크리스트에서 글자가 맞는 [ ] 항목을 [x]로 바꾸고 로그에 한 줄 남긴다.
// 사용: node scripts/mark-done.cjs <MM-DD_요일> "<로그 내용>" "<할일 줄 일부>" ["<체크리스트 줄 일부>" ...]
const fs = require('fs');
const [day, log, ...needles] = process.argv.slice(2);
const files = [`docs/일별_할일/${day}/할일.md`, 'docs/해야할일_체크리스트.md'];
let hits = 0;
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  for (const n of needles) {
    const i = s.split('\n').findIndex((l) => l.includes('- [ ]') && l.includes(n));
    if (i < 0) continue;
    const lines = s.split('\n');
    lines[i] = lines[i].replace('- [ ]', '- [x]');
    s = lines.join('\n');
    hits++;
  }
  fs.writeFileSync(f, s);
}
const now = new Date(Date.now() + 9 * 3600e3).toISOString();
const stamp = `${now.slice(5, 7)}/${now.slice(8, 10)} ${now.slice(11, 16)}`;
fs.appendFileSync('docs/자동작업/로그.md', `| ${stamp} | ${log} | 완료 | (이번 커밋) |\n`);
console.log(`checked ${hits}`);

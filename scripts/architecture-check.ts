// 구조 검사 (SOPHIA scripts/architecture-check.ts 방식, 써브웨이 규칙만):
//  1. 김민지 엔진(vendor/sophia/pure_engine)은 입출력 규칙·canonical 밖을 부르지 않는다 (외부·도메인 모름)
//  2. vendor/sophia 는 써브웨이 코드(src/)를 부르지 않는다 (가져온 그대로)
//  3. 판단 규칙(subway-menu·subway-store)은 서버·네트워크·외부 연결을 부르지 않는다 (같은 입력 같은 결과)
//  4. 화면·서버 코드에 키 값이 박혀 있지 않다
// 실행: npm run check
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((n) => {
    const p = join(dir, n);
    return statSync(join(root, p)).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
const imports = (file: string) => [...readFileSync(join(root, file), 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
const errors: string[] = [];

for (const f of walk('vendor/sophia/pure_engine'))
  for (const i of imports(f)) if (!/^\.\/|contracts\/src\/decision-contract\.ts$/.test(i) || i.startsWith('node:')) errors.push(`${f}: 엔진이 밖을 부름 → ${i}`);
for (const f of walk('vendor/sophia'))
  for (const i of imports(f))
    if (i.startsWith('.') && !relative(join(root, 'vendor/sophia'), resolve(root, dirname(f), i)).match(/^[^.]/)) errors.push(`${f}: vendor가 밖을 부름 → ${i}`);
for (const f of [...walk('src/subway-menu'), ...walk('src/subway-store')])
  for (const i of imports(f)) if (/server|node:http|node:net|providers\/(?!place-data-provider)|fetch/.test(i)) errors.push(`${f}: 판단 규칙이 서버·외부를 부름 → ${i}`);
for (const f of [...walk('src'), ...walk('scripts')]) {
  const t = readFileSync(join(root, f), 'utf8');
  if (/(KakaoAK\s+[0-9a-f]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{20,})/.test(t)) errors.push(`${relative(root, f)}: 키 값처럼 보이는 글자`);
}

if (errors.length) {
  console.error('구조 검사 실패:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('구조 검사 통과');

// 지금 gemma의 시험지 답(id 모양)을 학습 정답과 같은 이름 모양으로 바꾼다 → evaluate.py --score 로 같은 기준 채점 (10/20 밤)
//   npx tsx scripts/train/gemma-preds.ts var/train/gemma-out.json var/train/gemma-preds.jsonl
import { readFileSync, writeFileSync } from 'node:fs';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';

const catalog = loadSubwayCatalog();
const nameOf = (id: string) => catalog.menus.find((m) => m.id === id)?.name ?? catalog.ingredients.find((x) => x.id === id)?.name ?? catalog.toppings.find((x) => x.id === id)?.name ?? id;
const [inFile, outFile] = process.argv.slice(2);
const { out, secPer } = JSON.parse(readFileSync(inFile!, 'utf8')) as { out: string[]; secPer: number };
const names = (x: unknown) => (Array.isArray(x) ? (x.length ? x.map((v) => nameOf(String(v))).sort() : x) : x);
const lines = out.map((s) => {
  try {
    const j = JSON.parse(s);
    const o = j.options ?? {};
    for (const k of ['addVegetables', 'removeVegetables', 'sauces', 'toppings']) o[k] = names(o[k]);
    if (o.bread) o.bread = nameOf(o.bread);
    if (o.cheese && o.cheese !== 'NONE') o.cheese = nameOf(o.cheese);
    if (j.menu) j.menu = nameOf(j.menu);
    for (const k of ['allergies', 'wantMains', 'kinds']) if (Array.isArray(j.conditions?.[k])) j.conditions[k] = j.conditions[k].length ? [...j.conditions[k]].sort() : null;
    return JSON.stringify(j);
  } catch {
    return s;
  }
});
writeFileSync(outFile!, lines.join('\n') + '\n');
console.log(`${lines.length}개 · 문장당 ${secPer.toFixed(2)}초`);

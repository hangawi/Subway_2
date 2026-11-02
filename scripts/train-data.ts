// AI 학습 자료 (10/20 밤, 학습 1번): 문장 → 지금 AI가 내야 하는 JSON (intentJsonSchema 모양) — 정답은 규칙이 알아들은 값
// (1·2차 6,000문장에서 규칙 결과가 정답 표와 100% 같다고 확인함). 시험지는 다른 난수로 만든 1,000문장 (학습 자료와 같은 문장 없음)
//   npx tsx scripts/train-data.ts [--set 1,2] → var/train/train.jsonl · test.jsonl · docs/검수/학습_시험지.md
// 키·비밀번호·개인 정보 없음 (시험 문장만)
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadSubwayCatalog } from '../src/catalog/subway-catalog.ts';
import { INSTRUCTIONS } from '../src/conversation/interpret.ts';
import type { Intent } from '../src/conversation/intent-schema.ts';
import { parseRules } from '../src/conversation/rules.ts';
import { make3000 } from './talk-3000.ts';
import { make3000b } from './talk-3000-2.ts';
import { make3000c } from './talk-3000-3.ts';

const catalog = loadSubwayCatalog();
const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const sets = (arg('--set') ?? '1,2').split(',');

/** id → 이름 (작은 모델은 id보다 이름을 잘 배움 — 쓸 때 코드가 이름 → id로 바꿈) */
export const nameOfId = (id: string) => catalog.menus.find((m) => m.id === id)?.name ?? catalog.ingredients.find((x) => x.id === id)?.name ?? catalog.toppings.find((x) => x.id === id)?.name ?? id;
/** 규칙 결과 → AI 출력 JSON (말하지 않은 칸은 null, 메뉴·재료는 이름) */
export function toAiJson(i: Intent): Record<string, unknown> {
  const c = i.conditions;
  const o = i.options;
  const arr = (x: string[] | undefined) => (x && x.length ? [...x].sort() : null);
  const names = (x: string[] | undefined) => (x && x.length ? x.map(nameOfId).sort() : null);
  return {
    conditions: {
      allergies: arr(c.allergies), budgetKrw: c.budgetKrw ?? null, maxEnergyKcal: c.maxEnergyKcal ?? null, maxSodiumMg: c.maxSodiumMg ?? null,
      goal: c.goal ?? null, wantMains: arr(c.wantMains), place: c.place ?? null, kinds: arr(c.kinds), avoidSpicy: c.avoidSpicy ?? null, wantSpicy: c.wantSpicy ?? null, nearby: null,
    },
    options: {
      size: o.size ?? null, bread: o.bread ? nameOfId(o.bread) : null, cheese: o.cheese === null ? 'NONE' : o.cheese ? nameOfId(o.cheese) : null,
      addVegetables: names(o.addVegetables), removeVegetables: names(o.removeVegetables), sauces: o.sauces ? o.sauces.map(nameOfId).sort() : null, toppings: names(o.toppings),
      set: o.set === null ? 'NONE' : (o.set ?? null), drink: o.drink ?? null, setItem: o.setItem ?? null,
    },
    menu: i.menu ? nameOfId(i.menu) : null, ask: i.ask ?? null, followUp: i.followUp ?? null,
  };
}

const texts = (set: string) => {
  const list = set === '1' ? make3000(catalog) : set === '2' ? make3000b(catalog) : set === '3' ? make3000c(catalog) : [];
  return list.flatMap((c) => [...((c as { before?: string[] }).before ?? []), c.text]);
};
const row = (text: string) => JSON.stringify({ messages: [{ role: 'system', content: INSTRUCTIONS }, { role: 'user', content: text }, { role: 'assistant', content: JSON.stringify(toAiJson(parseRules(text, catalog).intent)) }] });

if (process.argv[1]?.endsWith('train-data.ts')) {
  const train = [...new Set(sets.flatMap(texts))];
  const seen = new Set(train);
  // 시험지: 2차 틀에 다른 난수 → 학습 자료에 없는 문장만, 묶음마다 고르게 1,000개
  const pool = make3000b(catalog, 777).filter((c) => !c.before && !seen.has(c.text));
  const groups = [...new Set(pool.map((c) => c.group))];
  const test: typeof pool = [];
  for (let k = 0; test.length < 1000 && k < 3000; k++) for (const g of groups) {
    const x = pool.filter((c) => c.group === g)[k];
    if (x && test.length < 1000) test.push(x);
  }
  mkdirSync('var/train', { recursive: true });
  writeFileSync('var/train/train.jsonl', train.map(row).join('\n') + '\n');
  writeFileSync('var/train/test.jsonl', test.map((c) => row(c.text)).join('\n') + '\n');
  writeFileSync('docs/검수/학습_시험지.md', [
    '# AI 학습 시험지 (10/20 밤) — 학습에 안 쓴 1,000문장',
    '',
    `> 만든 곳: \`scripts/train-data.ts\` (2차 틀 + 다른 난수 777, 학습 자료 ${train.length}문장과 같은 문장 없음). 정답 = 규칙이 알아들은 값을 AI 출력 모양(JSON)으로`,
    '',
    '| 번호 | 묶음 | 문장 |',
    '|---|---|---|',
    ...test.map((c, i) => `| ${i + 1} | ${c.group} | ${c.text.replace(/\|/g, '/')} |`),
    '',
  ].join('\n'));
  console.log(`학습 ${train.length}문장 (세트 ${sets.join('·')}) · 시험지 ${test.length}문장 · 묶음 ${groups.length}`);
}

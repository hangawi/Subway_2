import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { interpret } from '../../src/conversation/interpret.ts';
import { judge, needsSecondPass } from '../../scripts/talk-cases.ts';
import { make3000 } from '../../scripts/talk-3000.ts';

// 3,000문장 시험 중 한 번에 하나씩 말하는 2,900문장 (10/20) — 규칙만(AI 없이). 목록: docs/검수/3000문장_목록.md
// 틀린 문장만 모아 한 번에 보여 준다 (2,900개를 it 하나씩 만들면 느림)
const c = loadSubwayCatalog();
const nameOf = (id: string | null) => (id ? (c.menus.find((m) => m.id === id)?.name ?? id) : null);
const ing = (id: string) => c.ingredients.find((x) => x.id === id)?.name ?? c.singles?.find((x) => x.id === id)?.name ?? id;
const sample = c.menus.find((m) => m.name === '로스트 치킨')!.id;

describe('3,000문장 시험 — 한 번 말하기 2,900문장 (규칙만)', () => {
  const all = make3000(c);
  it('2,900문장, 같은 문장 없음', () => {
    expect(all.length).toBe(2900);
    expect(new Set(all.map((x) => x.text)).size).toBe(all.length);
  });
  it('전부 맞게 알아들음', async () => {
    const fails: string[] = [];
    for (const x of all) {
      const r = await interpret(x.text, c, {}, null);
      let ch = r.choices ?? {};
      if (needsSecondPass({ ...r, ask: r.intent.ask })) ch = (await interpret(x.text, c, { menuId: sample, prefs: r.prefs }, null)).choices ?? {};
      const bad = judge(x.text, x.want, { ...r, ask: r.intent.ask }, ch, nameOf, ing);
      if (bad.length) fails.push(`${x.id} ${x.text} → ${bad.join(' / ')}`);
    }
    expect(fails).toEqual([]);
  }, 120000);
});

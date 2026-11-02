import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { interpret } from '../../src/conversation/interpret.ts';
import { judge, needsSecondPass } from '../../scripts/talk-cases.ts';
import { make3000 } from '../../scripts/talk-3000.ts';
import { make3000b } from '../../scripts/talk-3000-2.ts';

// 3,000문장 시험 2차 (10/20 저녁) — 한 번 말하기 2,900문장, 규칙만. 대화 이어 말하기는 앞 말을 context로. 목록: docs/검수/3000문장_목록_2차.md
// (주문서·알레르기·금액·매장 글·추천 Top3 깊게 보기는 scripts/talk-3000-run2.ts)
const c = loadSubwayCatalog();
const nameOf = (id: string | null) => (id ? (c.menus.find((m) => m.id === id)?.name ?? id) : null);
const ing = (id: string) => c.ingredients.find((x) => x.id === id)?.name ?? c.singles?.find((x) => x.id === id)?.name ?? id;
const sample = c.menus.find((m) => m.name === '로스트 치킨')!.id;

describe('3,000문장 시험 2차 — 2,900문장 (규칙만)', () => {
  const all = make3000b(c);
  it('2,900문장, 1차와 겹치는 문장 없음', () => {
    expect(all.length).toBe(2900);
    const first = new Set(make3000(c).map((x) => x.text));
    expect(all.filter((x) => !x.before && first.has(x.text))).toEqual([]);
  });
  it('전부 맞게 알아들음', async () => {
    const fails: string[] = [];
    for (const x of all) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx: any = {};
      for (const b of x.before ?? []) {
        const p = await interpret(b, c, { ...ctx }, null);
        ctx.menuId = p.menuId ?? ctx.menuId;
        ctx.choices = p.choices ?? ctx.choices;
        ctx.prefs = { ...(ctx.prefs ?? {}), ...p.prefs };
      }
      const r = await interpret(x.text, c, { ...ctx }, null);
      const menuId = r.menuId ?? ctx.menuId ?? null;
      let ch = r.choices ?? (r.menuId ? null : ctx.choices) ?? {};
      if (!menuId && needsSecondPass({ ...r, ask: r.intent.ask })) ch = (await interpret(x.text, c, { menuId: sample, prefs: r.prefs }, null)).choices ?? {};
      const bad = judge(x.text, x.want, { ...r, menuId, ask: r.intent.ask }, ch, nameOf, ing);
      if (bad.length) fails.push(`${x.id} ${x.text} → ${bad.join(' / ')}`);
    }
    expect(fails).toEqual([]);
  }, 180000);
});

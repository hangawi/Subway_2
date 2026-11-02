import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { interpret } from '../../src/conversation/interpret.ts';
import { createSubwayServer } from '../../src/server/server.ts';
import type { Providers } from '../../src/server/providers.ts';
import { stamp } from '../../vendor/sophia/services/providers/place-data-provider.ts';

// 10/21 예형님이 실제 화면에서 찾은 것:
//  1 아침에 "좀 있다가 점심 먹을 거니까 점심 추천해줘" → 아침 메뉴를 먼저 골랐음 (말한 끼니를 안 봄)
//  2 "소고기 들어간 걸로 가볍게 추천해줘" → 338kcal이 1위(193kcal 샐러드가 있는데) + "든든한 편이에요"
const catalog = loadSubwayCatalog();
const providers: Providers = {
  places: {
    name: 'f',
    search: async () => ({ ok: true, data: [], stamp: stamp('f', false, 0, 1) }),
    nearby: async (_k, _c, r) => ({ ok: true, data: r === 1000 ? [{ place_id: 'k:1', name: '써브웨이 강남역점', category: null, address: '서울', point: { lat: 37.499, lng: 127.0276 }, phone: null, url: null, distance_m: 150 }] : [], stamp: stamp('f', true, 0, 1) }),
  },
  sources: { hours: { name: 'h', hours: async () => ({ ok: true, data: { status: 'OPERATIONAL', periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, minute: 0 }, close: { day, minute: 1439 } })) }, stamp: stamp('h', false, 0, 1) }) } },
  ready: { places: true, hours: true, walk: false, transit: false, car: false },
};
const server = createSubwayServer({ catalog, providers, version: { commit: 't', engineSource: 't', builtAt: 't' }, clock: () => new Date('2026-10-21T09:40:00+09:00') });
let base = '';
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
const top = async (text: string) => {
  const r = await interpret(text, catalog, {}, null);
  const rec = await (await fetch(`${base}/api/menus/recommend`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ location: { lat: 37.4979, lng: 127.0276 }, prefs: r.prefs, at: '2026-10-21T09:40:00+09:00' }) })).json();
  return { r, top: rec.menus.top as Array<{ name: string; why: string[] }> };
};
const isMorning = (n: string) => catalog.menus.find((m) => m.name === n)!.kind.startsWith('MORNING');
const kcal = (n: string) => catalog.menus.find((m) => m.name === n)!.nutrition15cm!.energyKcal!;

describe('말한 끼니·가볍게 (10/21)', () => {
  it('아침 9:40에 "점심 추천해줘" → 아침 메뉴 없음, "점심 메뉴로"', async () => {
    const { r, top: t } = await top('좀 있다가 점심 먹을 거니까 점심 추천해줘');
    expect(r.understood).toContain('점심 메뉴로');
    expect(r.prefs.meal).toBe('LUNCH');
    expect(t.length).toBeGreaterThan(0);
    expect(t.some((m) => isMorning(m.name))).toBe(false);
  });
  it('아침 9:40에 끼니를 말 안 하면 → 지금 시각대로 아침 메뉴 먼저', async () => {
    const { top: t } = await top('뭐 먹지');
    expect(isMorning(t[0]!.name)).toBe(true);
  });
  it('"소고기 들어간 걸로 가볍게" → 가벼운 순(193kcal 먼저), "든든한 편이에요" 없음', async () => {
    const { top: t } = await top('소고기 들어간 걸로 가볍게 추천해줘');
    expect(kcal(t[0]!.name)).toBe(Math.min(...catalog.menus.filter((m) => /스테이크|비프/.test(m.name) && m.nutrition15cm?.energyKcal).map((m) => m.nutrition15cm!.energyKcal!)));
    expect(t.map((m) => kcal(m.name))).toEqual([...t.map((m) => kcal(m.name))].sort((a, b) => a - b));
    expect(t.every((m) => !m.why.includes('든든한 편이에요'))).toBe(true);
    expect(t[0]!.why[0]).toMatch(/kcal로 가벼워요/);
  });
});

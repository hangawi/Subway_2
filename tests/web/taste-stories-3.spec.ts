import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { createSubwayServer } from '../../src/server/server.ts';
import type { Providers } from '../../src/server/providers.ts';
import { stamp } from '../../vendor/sophia/services/providers/place-data-provider.ts';
import { runStory } from '../../scripts/taste-stories.ts';
import { makeStories2 } from '../../scripts/taste-stories-3.ts';

// 3,000문장 시험 중 취향 기억하기 이야기 3차 (10/21 아침) — 사투리·수다 속 취향·바꾸기·주문 기록 섞기. 목록: docs/검수/3000문장_목록_3차.md
const catalog = loadSubwayCatalog();
const providers: Providers = {
  places: {
    name: 'fake',
    search: async () => ({ ok: true, data: [], stamp: stamp('fake', false, 0, 1) }),
    nearby: async (_k, _c, radius) => ({ ok: true, data: radius === 1000 ? [{ place_id: 'kakao:1', name: '써브웨이 강남역점', category: null, address: '서울', point: { lat: 37.499, lng: 127.0276 }, phone: '02-1', url: null, distance_m: 150 }] : [], stamp: stamp('fake', true, 0, 1) }),
  },
  sources: { hours: { name: 'h', hours: async () => ({ ok: true, data: { status: 'OPERATIONAL', periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, minute: 0 }, close: { day, minute: 1439 } })) }, stamp: stamp('h', false, 0, 1) }) } },
  ready: { places: true, hours: true, walk: false, transit: false, car: false },
};
const server = createSubwayServer({ catalog, providers, version: { commit: 't', engineSource: 't', builtAt: 't' }, clock: () => new Date('2026-10-20T12:10:00+09:00') });
let base = '';
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('취향 기억하기 이야기 3차 (규칙만)', () => {
  const stories = makeStories2();
  it('100개 넘음', () => expect(stories.length).toBeGreaterThanOrEqual(100));
  it('전부 통과', async () => {
    const fails: string[] = [];
    for (const st of stories) {
      const bad = await runStory(st, base);
      if (bad.length) fails.push(`${st.id} ${st.title}: ${bad.join(' / ')}`);
    }
    expect(fails).toEqual([]);
  }, 300000); // 전체 시험을 같이 돌리면 느려서 (10/21)
});

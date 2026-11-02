import { describe, expect, it } from 'vitest';
import { recommendFlow, type FlowInput } from '../../src/flow/recommend-flow.ts';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import type { PlaceRecord, VenueHours } from '../../vendor/sophia/packages/contracts/src/place-contract.ts';
import type { HoursProvider, NearbyPlace, PlaceDataProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';
import { stamp } from '../../vendor/sophia/services/providers/place-data-provider.ts';

// 10/12 점검: 강남역 근처 가짜 지도 데이터로 위치 → 매장 → 메뉴까지 한 번에 (실제 키 확인은 별도).
const gangnam = { lat: 37.4979, lng: 127.0276 };
const near = (id: string, name: string, distance: number, dLat: number): NearbyPlace => ({
  place_id: `kakao:${id}`, name, category: '음식점', address: '서울 강남구', point: { lat: gangnam.lat + dLat, lng: gangnam.lng }, phone: null, url: null, distance_m: distance,
});
const station: PlaceRecord = { place_id: 'kakao:st', name: '강남역', category: null, address: null, point: gangnam, phone: null, url: null };
const places: PlaceDataProvider = {
  name: 'fake',
  search: async () => ({ ok: true, data: [station], stamp: stamp('fake', false, 0, 1) }),
  nearby: async (_k, _c, radius) => ({
    ok: true,
    data: radius === 1000 ? [near('1', '써브웨이 강남역점', 150, 0.0013), near('2', '써브웨이 강남대로점', 420, 0.0038), near('3', '써브웨이 역삼점', 900, 0.008), near('4', '써브웨이 신논현점', 700, 0.006)] : [],
    stamp: stamp('fake', true, 0, 1),
  }),
};
const daily = (o: number, c: number): VenueHours => ({ status: 'OPERATIONAL', periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, minute: o }, close: { day, minute: c } })) });
const hours: HoursProvider = {
  name: 'fake-hours',
  hours: async (name) => {
    const map: Record<string, VenueHours> = { '써브웨이 강남역점': daily(420, 1320), '써브웨이 강남대로점': daily(480, 1260), '써브웨이 신논현점': daily(600, 720) };
    return { ok: true, data: map[name] ?? null, stamp: stamp('fake', false, 0, 1) }; // 역삼점은 영업시간 모름
  },
};
const input = (over: Partial<FlowInput> = {}): FlowInput => ({
  location: { kind: 'COORDS', point: gangnam },
  places,
  sources: { hours },
  referenceAt: '2026-10-12T12:10:00+09:00',
  prefs: { allergies: [], maxEnergyKcal: null, maxSodiumMg: null, budgetKrw: null, kinds: null, goal: null },
  ...over,
});

describe('추천 흐름: 위치 → 매장 → 메뉴 Top3', () => {
  it('영업 중인 가까운 매장 1곳 + 대안, 이유 ("걸어서 5분, 지금 영업 중")', async () => {
    const r = await recommendFlow(input());
    if (r.step !== 'DONE') throw new Error(r.step);
    expect(r.store.candidates[0]!.candidate_id).toBe('kakao:1');
    expect(r.store.candidates[0]!.reason_codes).toEqual(expect.arrayContaining(['OPEN_NOW', 'WALK_5_MIN']));
    expect(r.store.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.store.rejected.find((x) => x.candidate_id === 'kakao:4')!.reason_codes).toEqual(['CLOSED_NOW']); // 신논현점 12시 닫음
  });

  it('위치를 거부해도 직접 입력하면 같은 결과', async () => {
    const byGps = await recommendFlow(input());
    const byText = await recommendFlow(input({ location: { kind: 'TEXT', text: '강남역' } }));
    if (byGps.step !== 'DONE' || byText.step !== 'DONE') throw new Error('not done');
    expect(byText.label).toBe('강남역');
    expect(byText.store.candidates.map((c) => c.candidate_id)).toEqual(byGps.store.candidates.map((c) => c.candidate_id));
  });

  it('영업시간 모르는 매장은 빼지 않고 "확인 필요"(HOURS_UNKNOWN)', async () => {
    const r = await recommendFlow(input());
    if (r.step !== 'DONE') throw new Error(r.step);
    const yeoksam = r.store.candidates.find((c) => c.candidate_id === 'kakao:3');
    expect(yeoksam?.reason_codes).toContain('HOURS_UNKNOWN');
  });

  it('메뉴 Top3까지 이어지고, 아침 시간엔 아침 메뉴가 올라온다', async () => {
    const lunch = await recommendFlow(input());
    const morning = await recommendFlow(input({ referenceAt: '2026-10-12T08:10:00+09:00' }));
    if (lunch.step !== 'DONE' || morning.step !== 'DONE') throw new Error('not done');
    expect(lunch.menu.candidates).toHaveLength(3);
    expect(lunch.menu.candidates.some((c) => c.reason_codes.includes('BREAKFAST_TIME'))).toBe(false);
    expect(morning.menu.candidates[0]!.reason_codes).toContain('BREAKFAST_TIME');
  });

  it('위치를 못 정하면 그 단계에서 멈춘다', async () => {
    const r = await recommendFlow(input({ location: { kind: 'COORDS', point: { lat: 35.68, lng: 139.76 } } }));
    expect(r).toEqual({ step: 'LOCATION', location: { status: 'OUTSIDE_KOREA' } });
  });

  it('넘겨준 메뉴 데이터를 쓴다 (서버 묶음 파일에서 기본 경로를 다시 읽지 않음 — 10/13 운영 오류)', async () => {
    const full = loadSubwayCatalog();
    const one = { ...full, menus: full.menus.filter((m) => m.name === '참치') };
    const r = await recommendFlow({ ...input(), catalog: one });
    if (r.step !== 'DONE') throw new Error(r.step);
    expect(r.menu.candidates.map((c) => c.menu.name)).toEqual(['참치']);
  });
});

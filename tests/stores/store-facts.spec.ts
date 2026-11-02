import { describe, expect, it } from 'vitest';
import { openState, storeFacts, transitLeft, TRANSIT_LOOKUPS } from '../../src/stores/store-facts.ts';
import type { SubwayStore } from '../../src/stores/find-stores.ts';
import type { VenueHours } from '../../vendor/sophia/packages/contracts/src/place-contract.ts';
import { failed, stamp, type HoursProvider, type RouteProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';

const origin = { lat: 37.498, lng: 127.0276 };
const daily = (openMin: number, closeMin: number): VenueHours => ({
  status: 'OPERATIONAL',
  periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, minute: openMin }, close: { day, minute: closeMin } })),
});
const store = (id: string, name: string, distanceM: number): SubwayStore => ({
  id, name, branch: null, address: null, point: { lat: 37.5, lng: 127.03 }, phone: null, url: null, distanceM,
});
const hoursBy = (map: Record<string, VenueHours | null>): HoursProvider => ({
  name: 'fake-hours',
  hours: async (name) => ({ ok: true, data: map[name] ?? null, stamp: stamp('fake', false, 0, 1) }),
});
const route = (name: string, minutes: number | null, calls: string[] = [], fail = false): RouteProvider => ({
  name,
  modes: ['WALK'],
  route: async (from) => {
    calls.push(`${from.lat},${from.lng}`);
    return fail ? failed('QUOTA_EXCEEDED') : { ok: true, data: { minutes, distance_m: null, too_close: false }, stamp: stamp(name, true, 0, 1) };
  },
});
const at = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00+09:00`).toISOString();

describe('영업 중인지', () => {
  it('열림 / 30분 안에 닫힘 / 닫힘 / 모름', () => {
    const h = daily(8 * 60, 22 * 60);
    expect(openState(h, at('12:10'))).toBe('OPEN');
    expect(openState(h, at('21:45'))).toBe('CLOSING_SOON');
    expect(openState(h, at('22:30'))).toBe('CLOSED');
    expect(openState(null, at('12:10'))).toBe('UNKNOWN');
    expect(openState({ status: 'CLOSED_PERMANENTLY', periods: [] }, at('12:10'))).toBe('CLOSED');
  });
});

describe('매장 정보 붙이기 (영업 + 이동 시간)', () => {
  it('1km 이하는 걷기: TMAP이 있으면 실제 길, 없으면 직선 거리 추정', async () => {
    const s = [store('a', '써브웨이 A', 350)];
    const withTmap = await storeFacts(origin, s, { hours: hoursBy({}), walk: route('tmap', 6) }, at('12:10'));
    expect(withTmap[0]!.travel).toEqual({ mode: 'WALK', minutes: 6, source: 'TMAP' });
    const noTmap = await storeFacts(origin, s, { hours: hoursBy({}) }, at('12:10'));
    expect(noTmap[0]!.travel).toEqual({ mode: 'WALK', minutes: 5, source: 'ESTIMATE' }); // 350m ÷ 70
  });

  it('1km 넘으면 대중교통, 가까운 3곳만 묻는다 (하루 한도 아끼기)', async () => {
    const calls: string[] = [];
    const s = [1, 2, 3, 4, 5].map((i) => store(String(i), `써브웨이 ${i}`, 1500 + i));
    const r = await storeFacts(origin, s, { hours: hoursBy({}), transit: route('odsay', 12, calls) }, at('12:10'));
    expect(calls).toHaveLength(TRANSIT_LOOKUPS);
    expect(calls[0]).toBe(`${origin.lat},${origin.lng}`); // 출발지는 내 위치
    expect(r.slice(0, 3).every((x) => x.travel.source === 'ODSAY')).toBe(true);
    expect(r[3]!.travel.source).toBe('ESTIMATE');
  });

  it('ODsay 한도가 다 차면 걷기 추정으로 대신한다', async () => {
    const r = await storeFacts(origin, [store('a', '써브웨이 A', 2100)], { hours: hoursBy({}), transit: route('odsay', null, [], true) }, at('12:10'));
    expect(r[0]!.travel).toEqual({ mode: 'WALK', minutes: 30, source: 'ESTIMATE' });
  });

  it('영업시간을 못 찾으면 "확인 필요"', async () => {
    const r = await storeFacts(origin, [store('a', '써브웨이 A', 100), store('b', '써브웨이 B', 200)], { hours: hoursBy({ '써브웨이 A': daily(480, 1320) }) }, at('12:10'));
    expect(r.map((x) => x.open)).toEqual(['OPEN', 'UNKNOWN']);
  });
});

describe('ODsay 오늘 남은 횟수', () => {
  it('한도가 있으면 남은 횟수, 없으면 모름', () => {
    expect(transitLeft({ ...route('odsay', 1), usage: () => ({ used: 27, limit: 30 }) })).toEqual({ left: 3, limit: 30 });
    expect(transitLeft({ ...route('odsay', 1), usage: () => ({ used: 31, limit: 30 }) })).toEqual({ left: 0, limit: 30 });
    expect(transitLeft(route('odsay', 1))).toBeNull();
    expect(transitLeft(null)).toBeNull();
  });
});

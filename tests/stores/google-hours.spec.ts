import { describe, expect, it } from 'vitest';
import { createGoogleHoursProvider, type StoreHours } from '../../src/stores/google-hours.ts';
import { openState, storeFacts } from '../../src/stores/store-facts.ts';
import { explainStore } from '../../src/subway-store/explain.ts';

const near = { lat: 37.499, lng: 127.0286 };
const place = (extra: Record<string, unknown>) => ({ displayName: { text: '써브웨이 강남역점' }, location: { latitude: 37.499, longitude: 127.0286 }, businessStatus: 'OPERATIONAL', ...extra });
const week = (o: number, c: number) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: o, minute: 0 }, close: { day, hour: c, minute: 0 } }));
const fake = (places: unknown[]) => {
  const sent: Array<Record<string, string>> = [];
  const fetcher = async (_u: string, init?: RequestInit) => {
    sent.push(init!.headers as Record<string, string>);
    return new Response(JSON.stringify({ places }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { p: createGoogleHoursProvider({ api_key: 'k', fetcher, clock: () => 0 }), sent };
};
// 2026-10-13(화) 12:10 서울
const at = '2026-10-13T12:10:00+09:00';

describe('매장 영업시간: 이번 주 실제 영업시간 먼저', () => {
  it('이번 주 실제(currentOpeningHours)가 있으면 그걸 쓴다 — 오늘 매장이 등록한 휴무가 반영됨', async () => {
    // 평소엔 7~22시인데, 이번 주 실제는 화요일(2)이 빠짐 = 오늘 임시 휴무
    const current = week(7, 22).filter((p) => p.open.day !== 2);
    const { p, sent } = fake([place({ regularOpeningHours: { periods: week(7, 22) }, currentOpeningHours: { periods: current, specialDays: [{ date: { year: 2026, month: 10, day: 13 } }] } })]);
    const r = await p.hours('써브웨이 강남역점', near);
    if (!r.ok || !r.data) throw new Error('no data');
    const h = r.data as StoreHours;
    expect(h.source).toBe('CURRENT');
    expect(h.specialDates).toEqual(['2026-10-13']);
    expect(openState(h, at)).toBe('CLOSED');
    expect(sent[0]!['x-goog-fieldmask']).toContain('currentOpeningHours');
  });

  it('이번 주 실제가 없으면 평소 영업시간', async () => {
    const { p } = fake([place({ regularOpeningHours: { periods: week(7, 22) } })]);
    const r = await p.hours('써브웨이 강남역점', near);
    expect(r.ok && (r.data as StoreHours).source).toBe('REGULAR');
    expect(r.ok && openState(r.data, at)).toBe('OPEN');
  });

  it('브레이크타임 (10~15, 16~21): 15:30은 닫음', async () => {
    const split = [0, 1, 2, 3, 4, 5, 6].flatMap((day) => [{ open: { day, hour: 10, minute: 0 }, close: { day, hour: 15, minute: 0 } }, { open: { day, hour: 16, minute: 0 }, close: { day, hour: 21, minute: 0 } }]);
    const { p } = fake([place({ currentOpeningHours: { periods: split } })]);
    const r = await p.hours('써브웨이 강남역점', near);
    expect(r.ok && openState(r.data, '2026-10-13T15:30:00+09:00')).toBe('CLOSED');
    expect(r.ok && openState(r.data, '2026-10-13T14:40:00+09:00')).toBe('CLOSING_SOON');
  });

  it('이름이 같은 매장이 둘이거나 멀면 모름 (다른 매장 영업시간을 쓰지 않음)', async () => {
    const { p } = fake([place({}), place({})]);
    expect((await p.hours('써브웨이 강남역점', near)).ok).toBe(true);
    const r = await p.hours('써브웨이 강남역점', near);
    expect(r.ok && r.data).toBeNull();
  });

  it('매장 카드: 특별 영업일이면 그 안내, 공휴일이면 "매장마다 다를 수 있어요"', async () => {
    const { p } = fake([place({ currentOpeningHours: { periods: week(9, 18), specialDays: [{ date: { year: 2026, month: 10, day: 13 } }] } })]);
    const [s] = await storeFacts(near, [{ id: 'k:1', name: '써브웨이 강남역점', branch: null, address: null, point: near, phone: null, url: null, distanceM: 100 }], { hours: p }, at);
    expect(s!.specialToday).toBe(true);
    expect(explainStore(s!, ['OPEN_NOW'], '한글날')).toContain('오늘은 매장이 따로 정한 영업시간이에요');
    expect(explainStore({ ...s!, specialToday: false }, ['OPEN_NOW'], '한글날')).toContain('한글날 — 매장마다 다를 수 있어요');
    expect(explainStore({ ...s!, specialToday: false }, ['OPEN_NOW'], null)).not.toContain('한글날 — 매장마다 다를 수 있어요');
  });
});

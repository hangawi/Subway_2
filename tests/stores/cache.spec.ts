import { describe, expect, it } from 'vitest';
import { HOURS_KEEP_MS, keepHours, keepWalk } from '../../src/stores/cache.ts';
import { stamp, type HoursProvider, type RouteProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';

const near = { lat: 37.4979, lng: 127.0276 };

describe('외부 자료 짧게 보관 (10/15 점검)', () => {
  it('영업시간: 같은 매장은 30분 동안 다시 안 묻고, 지나면 다시 묻는다', async () => {
    let calls = 0;
    let now = 0;
    const raw: HoursProvider = { name: 'h', hours: async () => (calls++, { ok: true, data: { status: 'OPERATIONAL', periods: [] }, stamp: stamp('h', true, 0, 1) }) };
    const p = keepHours(raw, () => now);
    await p.hours('써브웨이 강남역점', near);
    await p.hours('써브웨이 강남역점', { lat: near.lat + 0.00001, lng: near.lng }); // 약 1m 차이 = 같은 곳
    expect(calls).toBe(1);
    await p.hours('써브웨이 역삼점', near);
    expect(calls).toBe(2);
    now = HOURS_KEEP_MS + 1;
    await p.hours('써브웨이 강남역점', near);
    expect(calls).toBe(3);
    expect(p.name).toBe('h');
  });

  it('실패(한도 초과 등)는 보관하지 않고 다음에 다시 묻는다', async () => {
    let calls = 0;
    const raw: HoursProvider = { name: 'h', hours: async () => (calls++, { ok: false, failure: { code: 'QUOTA_EXCEEDED', retry_after_ms: null } as never }) };
    const p = keepHours(raw);
    await p.hours('a', near);
    await p.hours('a', near);
    expect(calls).toBe(2);
  });

  it('걷기: 같은 출발·도착은 한 번만, 하루 한도 표시(usage)는 그대로', async () => {
    let calls = 0;
    const raw: RouteProvider = {
      name: 'tmap', modes: ['WALK'],
      route: async () => (calls++, { ok: true, data: { minutes: 4 } as never, stamp: stamp('tmap', true, 0, 1) }),
      usage: () => ({ used: calls, limit: 300 }),
    } as RouteProvider;
    const p = keepWalk(raw);
    for (let i = 0; i < 5; i++) await p.route(near, { lat: 37.499, lng: 127.028 }, null);
    expect(calls).toBe(1);
    expect(p.usage?.()).toEqual({ used: 1, limit: 300 });
    expect(p.modes).toEqual(['WALK']);
  });
});

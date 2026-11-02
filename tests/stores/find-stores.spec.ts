import { describe, expect, it } from 'vitest';
import { findSubwayStores } from '../../src/stores/find-stores.ts';
import type { NearbyPlace, PlaceDataProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';
import { failed, stamp } from '../../vendor/sophia/services/providers/place-data-provider.ts';

const center = { lat: 37.498, lng: 127.0276 };
const p = (id: string, name: string, distance: number | null, dLat = 0.001): NearbyPlace => ({
  place_id: `kakao:${id}`, name, category: '음식점', address: '서울', point: { lat: center.lat + dLat, lng: center.lng }, phone: '02', url: null, distance_m: distance,
});
const provider = (byRadius: Record<number, NearbyPlace[]>, calls: number[] = []): PlaceDataProvider => ({
  name: 'fake',
  search: async () => ({ ok: true, data: [], stamp: stamp('fake', false, 0, 1) }),
  nearby: async (kind, _c, radius, menu) => {
    calls.push(radius);
    expect([kind, menu]).toEqual(['FOOD', '써브웨이']);
    return { ok: true, data: byRadius[radius] ?? [], stamp: stamp('fake', true, 0, 1) };
  },
});

describe('근처 써브웨이 찾기', () => {
  it('써브웨이가 아닌 가게는 빼고 거리순으로', async () => {
    const r = await findSubwayStores(center, provider({ 1000: [p('3', '써브웨이 역삼점', 800), p('9', '샌드위치 가게', 50), p('1', '써브웨이 강남역점', 120), p('2', 'SUBWAY 테헤란점', 400)] }));
    expect(r.status).toBe('OK');
    if (r.status === 'OK') {
      expect(r.stores.map((s) => s.name)).toEqual(['써브웨이 강남역점', 'SUBWAY 테헤란점', '써브웨이 역삼점']);
      expect(r.stores[0]).toMatchObject({ branch: '강남역점', distanceM: 120 });
      expect(r.radiusM).toBe(1000);
    }
  });

  it('1km에 없으면 3km로 넓힌다', async () => {
    const calls: number[] = [];
    const r = await findSubwayStores(center, provider({ 1000: [], 3000: [p('5', '써브웨이 선릉점', 2400)] }, calls));
    expect(calls).toEqual([1000, 3000]);
    expect(r).toMatchObject({ status: 'OK', radiusM: 3000 });
  });

  it('3km에도 없으면 "근처에 없음"', async () => {
    expect(await findSubwayStores(center, provider({}))).toEqual({ status: 'NONE', radiusM: 3000 });
  });

  it('같은 매장 두 번, 반경 밖, 거리 없음(좌표로 계산)', async () => {
    const r = await findSubwayStores(center, provider({ 1000: [p('1', '써브웨이 A', 100), p('1', '써브웨이 A', 100), p('7', '써브웨이 먼곳', 1500), p('8', '써브웨이 거리없음', null)] }));
    if (r.status !== 'OK') throw new Error('not ok');
    expect(r.stores.map((s) => s.id)).toEqual(['kakao:1', 'kakao:8']);
    expect(r.stores[1]!.distanceM).toBeGreaterThan(100);
  });

  it('최대 15곳', async () => {
    const many = Array.from({ length: 20 }, (_, i) => p(String(i), `써브웨이 ${i}호점`, 100 + i));
    const r = await findSubwayStores(center, provider({ 1000: many }));
    if (r.status === 'OK') expect(r.stores).toHaveLength(15);
  });

  it('연결 실패는 이유 그대로', async () => {
    const bad: PlaceDataProvider = { name: 'x', search: async () => failed('TIMEOUT'), nearby: async () => failed('TIMEOUT') };
    expect(await findSubwayStores(center, bad)).toEqual({ status: 'FAILED', failure: 'TIMEOUT' });
  });
});

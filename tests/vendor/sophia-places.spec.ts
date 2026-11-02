import { describe, expect, it } from 'vitest';
import { createKakaoLocalProvider } from '../../vendor/sophia/services/providers/kakao-local-provider.ts';
import { openDuring } from '../../vendor/sophia/domains/scheduling/opening-hours.ts';
import { scriptedPlaceProviders } from '../../vendor/sophia/packages/test-support/scripted-places.ts';
import { seoulDayTime } from '../../vendor/sophia/apps/client-pwa/src/seoul-time.ts';
import type { FetchLike } from '../../vendor/sophia/services/providers/place-data-provider.ts';

// 10/12: SOPHIA 장소·이동 연결을 가져왔는지 확인하는 시험 (네트워크 없음).
describe('SOPHIA 장소 연결 (vendor)', () => {
  it('카카오: "써브웨이" 키워드를 음식점(FD6)으로, 거리순으로 묻는다', async () => {
    const seen: string[] = [];
    const fetcher: FetchLike = async (url) => {
      seen.push(url);
      return new Response(
        JSON.stringify({
          documents: [
            { id: '101', place_name: '써브웨이 강남역점', category_name: '음식점 > 패스트푸드 > 써브웨이', road_address_name: '서울 강남구 강남대로 1', phone: '02-000-0000', x: '127.0276', y: '37.4979', distance: '120' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const kakao = createKakaoLocalProvider({ api_key: 'test', fetcher });
    const r = await kakao.nearby('FOOD', { lat: 37.498, lng: 127.0276 }, 1000, '써브웨이');
    expect(r.ok).toBe(true);
    const q = new URL(seen[0]!).searchParams;
    expect([q.get('query'), q.get('category_group_code'), q.get('sort'), q.get('radius')]).toEqual(['써브웨이', 'FD6', 'distance', '1000']);
    if (r.ok) expect(r.data[0]).toMatchObject({ place_id: 'kakao:101', name: '써브웨이 강남역점', distance_m: 120 });
  });

  it('영업시간: 열린 시간 안이면 true, 닫힌 시간이면 false, 모르면 null', () => {
    const daily = { status: 'OPERATIONAL' as const, periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, minute: 8 * 60 }, close: { day, minute: 22 * 60 } })) };
    expect(openDuring(daily, '2026-10-12T03:10:00Z', null)).toBe(true); // 서울 12:10
    expect(openDuring(daily, '2026-10-12T14:30:00Z', null)).toBe(false); // 서울 23:30
    expect(openDuring(null, '2026-10-12T03:10:00Z', null)).toBeNull();
  });

  it('시험용 장소 데이터: 걷기 경로가 나오고 실제 자료가 아니라고 표시된다', async () => {
    const p = scriptedPlaceProviders({ clock: () => Date.parse('2026-10-12T03:00:00Z') });
    const walk = p.routes.find((x) => x.modes.includes('WALK'))!;
    const r = await walk.route({ lat: 37.498, lng: 127.0276 }, { lat: 37.5, lng: 127.03 }, null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.minutes).toBeGreaterThan(0);
      expect(r.stamp.live).toBe(false);
    }
  });

  it('서울 시각 글자', () => {
    expect(seoulDayTime('2026-10-12T03:10:00Z')).toMatch(/12:10|오후 12:10|12시 10분/);
  });
});

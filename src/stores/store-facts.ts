// 찾은 매장마다: 지금 영업 중인지(Google 영업시간 + SOPHIA openDuring) + 이동 시간.
// 영업시간을 못 찾으면 "확인 필요"(UNKNOWN): 영업 중이라고 치지 않는다.
// 이동 시간:
//  - 1km 이하: 걷기. TMAP 도보 경로가 있으면 그것, 없거나 실패하면 직선 거리 ÷ 분당 70m (설계값, "추정")
//  - 1km 넘음: 대중교통(ODsay). 하루 30회를 SOPHIA와 같이 쓰므로 가까운 3곳만 묻고, 한도·실패면 걷기 추정으로
//  - 차: 사용자가 차라고 말했을 때만
import { openDuring } from '../../vendor/sophia/domains/scheduling/opening-hours.ts';
import type { GeoPoint, VenueHours } from '../../vendor/sophia/packages/contracts/src/place-contract.ts';
import type { HoursProvider, RouteProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';
import type { SubwayStore } from './find-stores.ts';

export const WALK_M_PER_MIN = 70;
export const WALK_LIMIT_M = 1000;
export const TRANSIT_LOOKUPS = 3;
export const CLOSING_SOON_MIN = 30;

export type OpenState = 'OPEN' | 'CLOSING_SOON' | 'CLOSED' | 'UNKNOWN';
export type TravelSource = 'TMAP' | 'ODSAY' | 'KAKAO_MOBILITY' | 'ESTIMATE';

export interface StoreFacts extends SubwayStore {
  open: OpenState;
  hours: VenueHours | null;
  /** 영업시간이 어디서 왔나: 이번 주 실제(CURRENT, 매장 등록 특별 영업 반영) / 평소(REGULAR) */
  hoursSource: 'CURRENT' | 'REGULAR' | null;
  /** 오늘이 매장이 따로 정한 특별 영업일인지 */
  specialToday: boolean;
  travel: { mode: 'WALK' | 'TRANSIT' | 'CAR'; minutes: number; source: TravelSource };
}

export interface FactSources {
  hours: HoursProvider;
  walk?: RouteProvider | null;
  transit?: RouteProvider | null;
  car?: RouteProvider | null;
}

const addMin = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();

export function openState(hours: VenueHours | null, referenceAt: string): OpenState {
  const now = openDuring(hours, referenceAt, null);
  if (now === null) return 'UNKNOWN';
  if (!now) return 'CLOSED';
  return openDuring(hours, referenceAt, addMin(referenceAt, CLOSING_SOON_MIN)) === false ? 'CLOSING_SOON' : 'OPEN';
}

// ODsay 오늘 남은 횟수 (SOPHIA와 같이 쓰는 하루 한도). 한도를 모르면 null.
export function transitLeft(transit: RouteProvider | null | undefined): { left: number; limit: number } | null {
  const u = transit?.usage?.();
  return u ? { left: Math.max(0, u.limit - u.used), limit: u.limit } : null;
}

const walkEstimate = (distanceM: number) => ({ mode: 'WALK' as const, minutes: Math.max(1, Math.ceil(distanceM / WALK_M_PER_MIN)), source: 'ESTIMATE' as const });

export async function storeFacts(
  origin: GeoPoint,
  stores: SubwayStore[],
  sources: FactSources,
  referenceAt: string,
  opts: { byCar?: boolean } = {},
): Promise<StoreFacts[]> {
  let transitAsked = 0;
  const out: StoreFacts[] = [];
  for (const s of stores) {
    const h = await sources.hours.hours(s.name, s.point);
    const hours = h.ok ? h.data : null;
    let travel: StoreFacts['travel'] = walkEstimate(s.distanceM);
    if (opts.byCar && sources.car) {
      const r = await sources.car.route(origin, s.point, referenceAt);
      if (r.ok && r.data.minutes !== null) travel = { mode: 'CAR', minutes: r.data.minutes, source: 'KAKAO_MOBILITY' };
    } else if (s.distanceM <= WALK_LIMIT_M) {
      if (sources.walk) {
        const r = await sources.walk.route(origin, s.point, null);
        if (r.ok && r.data.minutes !== null) travel = { mode: 'WALK', minutes: r.data.minutes, source: 'TMAP' };
      }
    } else if (sources.transit && transitAsked < TRANSIT_LOOKUPS) {
      transitAsked++;
      const r = await sources.transit.route(origin, s.point, referenceAt);
      if (r.ok && r.data.minutes !== null) travel = { mode: 'TRANSIT', minutes: r.data.minutes, source: 'ODSAY' };
    }
    const extra = hours as (VenueHours & { source?: 'CURRENT' | 'REGULAR'; specialDates?: string[] }) | null;
    const today = new Date(Date.parse(referenceAt) + 9 * 3_600_000).toISOString().slice(0, 10);
    out.push({ ...s, hours, hoursSource: extra?.source ?? (hours ? 'REGULAR' : null), specialToday: !!extra?.specialDates?.includes(today), open: openState(hours, referenceAt), travel });
  }
  return out;
}

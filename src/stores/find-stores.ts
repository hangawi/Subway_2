// 근처 써브웨이 매장 찾기: 카카오 로컬에서 음식점(FD6) 중 "써브웨이" 키워드, 거리순.
// 반경 1km에서 0곳이면 3km로 한 번만 넓힌다. 이름에 써브웨이·서브웨이·SUBWAY가 없는 가게는 뺀다 (지어낸 매장 0).
import type { DataFailure, GeoPoint } from '../../vendor/sophia/packages/contracts/src/place-contract.ts';
import type { NearbyPlace, PlaceDataProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';

export interface SubwayStore {
  id: string;
  name: string;
  branch: string | null;
  address: string | null;
  point: GeoPoint;
  phone: string | null;
  url: string | null;
  distanceM: number;
}

export type StoreSearch =
  | { status: 'OK'; stores: SubwayStore[]; radiusM: number; live: boolean }
  | { status: 'NONE'; radiusM: number }
  | { status: 'FAILED'; failure: DataFailure };

export const SEARCH_RADII_M = [1000, 3000] as const;
export const MAX_STORES = 15;
const BRAND = /써브웨이|서브웨이|subway/i;

export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function toStore(p: NearbyPlace, center: GeoPoint): SubwayStore {
  const branch = p.name.replace(BRAND, '').trim();
  return {
    id: p.place_id,
    name: p.name,
    branch: branch || null,
    address: p.address,
    point: p.point,
    phone: p.phone,
    url: p.url,
    distanceM: p.distance_m ?? distanceM(center, p.point),
  };
}

export async function findSubwayStores(center: GeoPoint, places: PlaceDataProvider): Promise<StoreSearch> {
  let radius: number = SEARCH_RADII_M[0];
  for (radius of SEARCH_RADII_M) {
    const r = await places.nearby('FOOD', center, radius, '써브웨이');
    if (!r.ok) return { status: 'FAILED', failure: r.failure };
    const seen = new Set<string>();
    const stores = r.data
      .filter((p) => BRAND.test(p.name))
      .map((p) => toStore(p, center))
      .filter((s) => s.distanceM <= radius && !seen.has(s.id) && (seen.add(s.id), true))
      .sort((a, b) => a.distanceM - b.distanceM || (a.id < b.id ? -1 : 1))
      .slice(0, MAX_STORES);
    if (stores.length) return { status: 'OK', stores, radiusM: radius, live: r.stamp.live };
  }
  return { status: 'NONE', radiusM: radius };
}

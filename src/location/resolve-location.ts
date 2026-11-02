// 내 위치 받기: 휴대폰 위치(좌표) 또는 직접 입력("강남역") → 좌표 하나.
// 직접 입력은 카카오 장소 검색으로 찾는다. 여러 곳이 나오면 위 3곳을 보여 주고 고르게 한다 (지어내지 않음).
// 10/26: 주소 모양("압구정동", "역삼동 737", "서울 강남구 테헤란로 152")은 카카오 주소 검색 먼저 (SOPHIA ee5ffdc searchAddress).
//   장소 검색은 주소를 이름으로 찾아 엉뚱한 곳("테헤란로 152" → 도봉구 "카페152길")이 나오고, 동 이름은 못 찾았다.
//   이름으로 못 찾은 말도 주소로 한 번 더 찾아 본다.
// 위치는 저장하지 않는다: 이 함수는 받은 것을 그대로 돌려줄 뿐이다.
import { inKorea, type DataFailure, type GeocodedAddress, type GeoPoint, type PlaceRecord } from '../../vendor/sophia/packages/contracts/src/place-contract.ts';
import type { PlaceDataProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';

export type LocationInput = { kind: 'COORDS'; point: GeoPoint } | { kind: 'TEXT'; text: string };

export type LocationResult =
  | { status: 'OK'; point: GeoPoint; label: string; source: 'DEVICE' | 'SEARCH' | 'ADDRESS' }
  | { status: 'CHOOSE'; options: PlaceRecord[] }
  | { status: 'NOT_FOUND' }
  | { status: 'OUTSIDE_KOREA' }
  | { status: 'FAILED'; failure: DataFailure };

export const MAX_CHOICES = 3;

const compact = (s: string) => s.replace(/\s+/g, '');

/** 주소처럼 생긴 말: 시·도·구·군·읍·면·동·리·가·로·길로 끝나는 낱말 (+ 번지). "강남역"·"홍대입구"는 아님 */
export function looksLikeAddress(text: string): boolean {
  const t = text.trim();
  if (/역$|역\s|입구$|사거리$|터미널$/.test(t)) return false;
  return /[가-힣]+(?:특별시|광역시|시|도|구|군|읍|면|동|리|가|로|길)(?:\s*\d+(?:-\d+)?(?:번지)?)?$/.test(t) || /[가-힣]+(?:동|로|길|리)\s*\d+(?:-\d+)?/.test(t);
}

const asPlace = (a: GeocodedAddress): PlaceRecord => ({ place_id: `kakao-address:${a.address_name}`, name: a.address_name, category: '주소', address: a.address_name, point: a.point, phone: null, url: null });

/** 주소로 찾기: 하나면 그 자리, 여럿이면 고르기, 없거나 못 쓰면 null (장소 검색 결과를 그대로 씀) */
async function byAddress(text: string, places: PlaceDataProvider): Promise<LocationResult | null> {
  if (!places.searchAddress) return null;
  const r = await places.searchAddress(text).catch(() => null);
  if (!r || !r.ok) return null;
  const found = r.data.addresses.filter((a) => inKorea(a.point));
  if (!found.length) return null;
  if (found.length === 1 && r.data.complete) return { status: 'OK', point: found[0]!.point, label: found[0]!.address_name, source: 'ADDRESS' };
  return { status: 'CHOOSE', options: found.slice(0, MAX_CHOICES).map(asPlace) };
}

export async function resolveLocation(input: LocationInput, places: PlaceDataProvider): Promise<LocationResult> {
  if (input.kind === 'COORDS') {
    const { lat, lng } = input.point;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKorea(input.point)) return { status: 'OUTSIDE_KOREA' };
    return { status: 'OK', point: { lat, lng }, label: '현재 위치', source: 'DEVICE' };
  }
  const text = input.text.trim().slice(0, 60);
  if (!text) return { status: 'NOT_FOUND' };
  if (looksLikeAddress(text)) {
    const a = await byAddress(text, places);
    if (a) return a;
  }
  const r = await places.search(text, null);
  if (!r.ok) return (await byAddress(text, places)) ?? { status: 'FAILED', failure: r.failure };
  if (!r.data.length) return (await byAddress(text, places)) ?? { status: 'NOT_FOUND' };
  // 이름이 입력과 똑같은 곳이 딱 하나면 바로 쓴다. 아니면 결과가 하나일 때만 바로 쓴다.
  const exact = r.data.filter((p) => compact(p.name) === compact(text));
  const pick = exact.length === 1 ? exact[0]! : r.data.length === 1 ? r.data[0]! : null;
  if (pick) return { status: 'OK', point: pick.point, label: pick.name, source: 'SEARCH' };
  return { status: 'CHOOSE', options: r.data.slice(0, MAX_CHOICES) };
}

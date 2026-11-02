import type { GeocodedAddress, GeoPoint, PlaceRecord } from '../../packages/contracts/src/place-contract.ts';
import { inKorea } from '../../packages/contracts/src/place-contract.ts';
import {
  failed,
  fetchJson,
  HOUR,
  stamp,
  type FetchLike,
  type NearbyKind,
  type NearbyPlace,
  type PlaceDataProvider,
} from './place-data-provider.ts';

// 카카오 로컬 API (https://developers.kakao.com/docs/latest/ko/local/dev-guide): place search and places around a
// point by category. Key: SOPHIA_KAKAO_REST_API_KEY (server only, header "KakaoAK …"). Opening hours and prices are
// not in this data: the screen asks people to check them.
const BASE = 'https://dapi.kakao.com/v2/local/search';
// 술집, 공연장 and 영화관 have no category group of their own: a keyword within 음식점 (FD6) or 문화시설 (CT1).
const KEYWORD: Partial<Record<NearbyKind, { query: string; group: string }>> = {
  BAR: { query: '술집', group: 'FD6' },
  THEATER: { query: '공연장', group: 'CT1' },
  CINEMA: { query: '영화관', group: 'CT1' },
};
const CATEGORY: Record<Exclude<NearbyKind, 'BAR' | 'THEATER' | 'CINEMA'>, string> = {
  SUBWAY: 'SW8',
  PARKING: 'PK6',
  FOOD: 'FD6',
  CAFE: 'CE7',
};
const PLACE_TTL = 7 * 24 * HOUR;

interface KakaoDocument {
  id?: unknown;
  place_name?: unknown;
  category_name?: unknown;
  address_name?: unknown;
  road_address_name?: unknown;
  phone?: unknown;
  place_url?: unknown;
  x?: unknown;
  y?: unknown;
  distance?: unknown;
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
function toPlace(d: KakaoDocument): NearbyPlace | null {
  const id = str(d.id);
  const name = str(d.place_name);
  const point = { lat: Number(d.y), lng: Number(d.x) };
  if (!id || !/^[0-9]{1,20}$/.test(id) || !name || !Number.isFinite(point.lat) || !Number.isFinite(point.lng))
    return null;
  if (!inKorea(point)) return null;
  const url = str(d.place_url);
  const distance = str(d.distance);
  return {
    place_id: `kakao:${id}`,
    name: name.slice(0, 80),
    category: str(d.category_name)?.slice(0, 100) ?? null,
    address: (str(d.road_address_name) ?? str(d.address_name))?.slice(0, 120) ?? null,
    point,
    phone: str(d.phone)?.slice(0, 30) ?? null,
    // Kakao gives http:// links; the same page is served over https.
    url: url ? url.replace(/^http:\/\//, 'https://').slice(0, 300) : null,
    distance_m: distance !== null && /^\d+$/.test(distance) ? Number(distance) : null,
  };
}

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
function toAddress(value: unknown): GeocodedAddress | null {
  const d = record(value);
  if (!d) return null;
  const addressName = str(d.address_name);
  const addressType = d.address_type;
  const point = { lat: Number(d.y), lng: Number(d.x) };
  if (
    !addressName ||
    addressName.length > 200 ||
    !['REGION', 'ROAD', 'REGION_ADDR', 'ROAD_ADDR'].includes(String(addressType)) ||
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    !inKorea(point)
  )
    return null;
  const address = record(d.address);
  const road = record(d.road_address);
  const region3 = [str(address?.region_3depth_name), str(address?.region_3depth_h_name)].filter(
    (v): v is string => !!v,
  );
  const deepest = region3.length
    ? region3
    : [str(address?.region_2depth_name) ?? str(address?.region_1depth_name)].filter((v): v is string => !!v);
  return {
    address_name: addressName,
    address_type: addressType as GeocodedAddress['address_type'],
    point,
    region_names: [...new Set(deepest)],
    address_aliases: [
      ...new Set([addressName, str(address?.address_name), str(road?.address_name)].filter((v): v is string => !!v)),
    ],
  };
}

export function createKakaoLocalProvider(options: {
  api_key: string;
  fetcher?: FetchLike;
  clock?: () => number;
}): PlaceDataProvider {
  const fetcher = options.fetcher ?? ((u, i) => fetch(u, i));
  const clock = options.clock ?? Date.now;
  const call = async (path: string, params: Record<string, string>) => {
    const url = `${BASE}/${path}?${new URLSearchParams(params).toString()}`;
    const r = await fetchJson(fetcher, url, { headers: { authorization: `KakaoAK ${options.api_key}` } });
    if (!r.ok) return r;
    const docs = (r.body as { documents?: unknown }).documents;
    if (!Array.isArray(docs)) return failed('INVALID_RESPONSE');
    const places = (docs as KakaoDocument[]).map(toPlace).filter((p): p is NearbyPlace => p !== null);
    return { ok: true as const, data: places, stamp: stamp('kakao-local', true, clock(), PLACE_TTL) };
  };
  const around = (p: GeoPoint, radius: number) => ({
    x: String(p.lng),
    y: String(p.lat),
    radius: String(Math.min(20_000, Math.max(100, Math.round(radius)))),
  });
  return {
    name: 'kakao-local',
    async search(query, near) {
      const r = await call('keyword.json', {
        query,
        size: '10',
        ...(near ? { x: String(near.lng), y: String(near.lat) } : {}),
      });
      if (!r.ok) return r;
      return { ...r, data: r.data.map(({ distance_m: _d, ...p }): PlaceRecord => p) };
    },
    // Same Local REST key and documented address endpoint. REGION gives a named area's coordinate;
    // it must not be fabricated from a keyword result such as an area's station or shop.
    // https://developers.kakao.com/docs/latest/ko/local/dev-guide#address-coord
    async searchAddress(query) {
      const url = `${BASE}/address.json?${new URLSearchParams({ query, analyze_type: 'exact', size: '30', page: '1' })}`;
      const r = await fetchJson(fetcher, url, { headers: { authorization: `KakaoAK ${options.api_key}` } });
      if (!r.ok) return r;
      const body = record(r.body);
      const meta = record(body?.meta);
      const docs = body?.documents;
      if (
        !Array.isArray(docs) ||
        !meta ||
        typeof meta.is_end !== 'boolean' ||
        !Number.isInteger(meta.total_count) ||
        Number(meta.total_count) < docs.length
      )
        return failed('INVALID_RESPONSE');
      const addresses = docs.map(toAddress).filter((v): v is GeocodedAddress => v !== null);
      return {
        ok: true as const,
        data: {
          addresses,
          complete: meta.is_end && Number(meta.total_count) === docs.length && addresses.length === docs.length,
        },
        stamp: stamp('kakao-local-address', true, clock(), PLACE_TTL),
      };
    },
    nearby(kind, center, radiusM, menu) {
      const base = { ...around(center, radiusM), sort: 'distance', size: '15' };
      const keyword = kind === 'FOOD' && menu?.trim() ? { query: menu.trim(), group: 'FD6' } : KEYWORD[kind];
      return keyword
        ? call('keyword.json', { query: keyword.query, category_group_code: keyword.group, ...base })
        : call('category.json', {
            category_group_code: CATEGORY[kind as Exclude<NearbyKind, 'BAR' | 'THEATER' | 'CINEMA'>],
            ...base,
          });
    },
  };
}

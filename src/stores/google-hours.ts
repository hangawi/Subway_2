// 매장 영업시간 (Google Places API (New) Text Search) — 매장마다 따로.
// SOPHIA google-places-provider.ts 방식 그대로 (이름이 같고 150m 안의 한 곳만 같은 매장으로 침) +
// "이번 주 실제 영업시간"(currentOpeningHours)을 먼저 쓴다: 매장 주인이 등록한 공휴일·임시 휴무·브레이크타임이 반영된 앞으로 7일치.
// 없으면 평소 영업시간(regularOpeningHours). 둘 다 없으면 null → "영업시간 확인 필요".
// SOPHIA 파일은 그대로 두고(vendor) 써브웨이에서 요청 항목만 늘린 것이다.
import { distanceM, type GeoPoint, type OpeningPeriod, type VenueHours } from '../../vendor/sophia/packages/contracts/src/place-contract.ts';
import { failed, fetchJson, HOUR, stamp, type FetchLike, type HoursProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';

const URL_SEARCH = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = [
  'places.displayName', 'places.location', 'places.businessStatus',
  'places.regularOpeningHours.periods', 'places.currentOpeningHours.periods', 'places.currentOpeningHours.specialDays',
].join(',');
const SAME_PLACE_M = 150;
// 실제 영업시간은 매장이 바꿀 수 있어 평소(24시간)보다 짧게 보관
const HOURS_TTL = 6 * HOUR;
const STATUS = new Set(['OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY']);
const normalizedName = (v: string) => v.normalize('NFC').toLocaleLowerCase('ko-KR').replace(/[\s\p{P}\p{S}]/gu, '');

/** 써브웨이 영업시간: 어디서 왔는지와 특별 영업일을 같이 */
export interface StoreHours extends VenueHours {
  source: 'CURRENT' | 'REGULAR';
  /** 매장이 특별 영업시간을 등록한 날 (YYYY-MM-DD) — 공휴일·임시 휴무 등 */
  specialDates: string[];
}

interface GooglePoint { day?: unknown; hour?: unknown; minute?: unknown }
const minuteOf = (p: GooglePoint | undefined) => {
  const day = Number(p?.day), hour = Number(p?.hour ?? 0), minute = Number(p?.minute ?? 0);
  if (![day, hour, minute].every(Number.isInteger) || day < 0 || day > 6 || hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  return { day, minute: Math.min(hour * 60 + minute, 1440) };
};
export function periodsOf(raw: unknown): OpeningPeriod[] | null {
  if (!Array.isArray(raw)) return null;
  const out: OpeningPeriod[] = [];
  for (const p of raw as Array<{ open?: GooglePoint; close?: GooglePoint }>) {
    const open = minuteOf(p.open);
    if (!open) return null;
    const close = p.close === undefined ? null : minuteOf(p.close);
    if (p.close !== undefined && !close) return null;
    out.push({ open, close });
  }
  return out;
}
const dateOf = (d: unknown) => {
  const x = d as { year?: unknown; month?: unknown; day?: unknown } | undefined;
  if (![x?.year, x?.month, x?.day].every((n) => Number.isInteger(n))) return null;
  return `${x!.year}-${String(x!.month).padStart(2, '0')}-${String(x!.day).padStart(2, '0')}`;
};

export function createGoogleHoursProvider(options: { api_key: string; fetcher?: FetchLike; clock?: () => number }): HoursProvider {
  const fetcher = options.fetcher ?? ((u, i) => fetch(u, i));
  const clock = options.clock ?? Date.now;
  return {
    name: 'google-places',
    async hours(name: string, near: GeoPoint) {
      const r = await fetchJson(fetcher, URL_SEARCH, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', 'x-goog-api-key': options.api_key, 'x-goog-fieldmask': FIELDS },
        body: JSON.stringify({
          textQuery: name.normalize('NFC'), languageCode: 'ko', regionCode: 'KR', maxResultCount: 3,
          locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 300 } },
        }),
      });
      if (!r.ok) return r;
      if (!r.body || typeof r.body !== 'object') return failed('INVALID_RESPONSE');
      const places = (r.body as { places?: unknown }).places;
      if (places !== undefined && !Array.isArray(places)) return failed('INVALID_RESPONSE');
      const matches = ((places ?? []) as Array<Record<string, unknown>>).filter((p) => {
        const loc = p?.location as { latitude?: unknown; longitude?: unknown } | undefined;
        const title = (p?.displayName as { text?: unknown } | undefined)?.text;
        return typeof title === 'string' && normalizedName(title) === normalizedName(name) && typeof loc?.latitude === 'number' && typeof loc.longitude === 'number' &&
          distanceM({ lat: loc.latitude, lng: loc.longitude }, near) <= SAME_PLACE_M;
      });
      const at = stamp('google-places', true, clock(), HOURS_TTL);
      const here = matches.length === 1 ? matches[0]! : undefined;
      if (!here) return { ok: true as const, data: null, stamp: at };
      const status = typeof here.businessStatus === 'string' && STATUS.has(here.businessStatus) ? (here.businessStatus as VenueHours['status']) : null;
      const current = here.currentOpeningHours as { periods?: unknown; specialDays?: unknown } | undefined;
      const regular = here.regularOpeningHours as { periods?: unknown } | undefined;
      const specialDates = Array.isArray(current?.specialDays) ? (current!.specialDays as Array<{ date?: unknown }>).map((s) => dateOf(s.date)).filter((d): d is string => !!d) : [];
      const pick = current?.periods !== undefined ? { raw: current.periods, source: 'CURRENT' as const } : regular?.periods !== undefined ? { raw: regular.periods, source: 'REGULAR' as const } : null;
      if (!pick) {
        // 영업시간을 등록하지 않은 매장 (상태만 있음)
        const hours: StoreHours = { periods: [], status, source: 'REGULAR', specialDates };
        return { ok: true as const, data: hours, stamp: at };
      }
      const periods = periodsOf(pick.raw);
      if (periods === null) return failed('INVALID_RESPONSE');
      const hours: StoreHours = { periods, status, source: pick.source, specialDates };
      return { ok: true as const, data: hours, stamp: at };
    },
  };
}

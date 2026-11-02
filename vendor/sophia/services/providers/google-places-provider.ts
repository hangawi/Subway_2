import {
  distanceM,
  type GeoPoint,
  type OpeningPeriod,
  type VenueHours,
} from '../../packages/contracts/src/place-contract.ts';
import { failed, fetchJson, HOUR, stamp, type FetchLike, type HoursProvider } from './place-data-provider.ts';

// Google Places API (New) Text Search (https://developers.google.com/maps/documentation/places/web-service/text-search)
// for one thing the Kakao data lacks: a venue's weekly opening hours and whether it is still in business. The venue
// is looked up by its name with a bias around its point, and only one name match within 150 m is taken as the same place
// (otherwise "not found" — never another shop's hours). Key: SOPHIA_GOOGLE_PLACES_API_KEY (server only, sent in the
// X-Goog-Api-Key header; restrict it to the Places API (New) and the server's address). The query goes as UTF-8 JSON
// (a non-UTF-8 query returns unrelated places). The screen names Google as the source of the hours.
const URL_SEARCH = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = 'places.displayName,places.location,places.regularOpeningHours.periods,places.businessStatus';
const SAME_PLACE_M = 150;
const HOURS_TTL = 24 * HOUR;
const STATUS = new Set(['OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY']);
const normalizedName = (v: string) =>
  v
    .normalize('NFC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[\s\p{P}\p{S}]/gu, '');
const won = (v: unknown): number | null => {
  if (!v || typeof v !== 'object') return null;
  const m = v as { currencyCode?: unknown; units?: unknown; nanos?: unknown };
  if (
    m.currencyCode !== 'KRW' ||
    (m.nanos !== undefined && m.nanos !== 0) ||
    (typeof m.units !== 'string' && typeof m.units !== 'number') ||
    !/^\d+$/.test(String(m.units))
  )
    return null;
  const n = Number(m.units);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

interface GooglePoint {
  day?: unknown;
  hour?: unknown;
  minute?: unknown;
}
const minuteOf = (p: GooglePoint | undefined) => {
  const day = Number(p?.day);
  const hour = Number(p?.hour ?? 0);
  const minute = Number(p?.minute ?? 0);
  if (
    ![day, hour, minute].every(Number.isInteger) ||
    day < 0 ||
    day > 6 ||
    hour < 0 ||
    hour > 24 ||
    minute < 0 ||
    minute > 59
  )
    return null;
  return { day, minute: Math.min(hour * 60 + minute, 1440) };
};
function periodsOf(raw: unknown): OpeningPeriod[] | null {
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

export function createGooglePlacesProvider(options: {
  api_key: string;
  fetcher?: FetchLike;
  clock?: () => number;
}): HoursProvider {
  const fetcher = options.fetcher ?? ((u, i) => fetch(u, i));
  const clock = options.clock ?? Date.now;
  return {
    name: 'google-places',
    async restaurantFacts(name, near) {
      const r = await fetchJson(fetcher, URL_SEARCH, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-goog-api-key': options.api_key,
          'x-goog-fieldmask':
            'places.displayName,places.location,places.priceRange,places.servesVegetarianFood,places.goodForGroups,places.reservable',
        },
        body: JSON.stringify({
          textQuery: name.normalize('NFC'),
          languageCode: 'ko',
          regionCode: 'KR',
          maxResultCount: 3,
          locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 300 } },
        }),
      });
      if (!r.ok) return r;
      if (!r.body || typeof r.body !== 'object') return failed('INVALID_RESPONSE');
      const raw = (r.body as { places?: unknown }).places;
      if (raw !== undefined && !Array.isArray(raw)) return failed('INVALID_RESPONSE');
      // Coordinates alone can point to a different restaurant on the same floor. Ambiguous matches stay unknown.
      const matches = ((raw ?? []) as Array<Record<string, unknown>>).filter((p) => {
        const loc = p?.location as { latitude?: unknown; longitude?: unknown } | undefined;
        const title = (p?.displayName as { text?: unknown } | undefined)?.text;
        return (
          typeof title === 'string' &&
          normalizedName(title) === normalizedName(name) &&
          typeof loc?.latitude === 'number' &&
          typeof loc.longitude === 'number' &&
          distanceM({ lat: loc.latitude, lng: loc.longitude }, near) <= SAME_PLACE_M
        );
      });
      const at = stamp('google-places', true, clock(), HOURS_TTL);
      if (matches.length !== 1) return { ok: true as const, data: null, stamp: at };
      const p = matches[0]!;
      const range = p.priceRange as { startPrice?: unknown; endPrice?: unknown } | undefined;
      let min = won(range?.startPrice),
        max = won(range?.endPrice);
      if (min !== null && max !== null && min > max) {
        min = null;
        max = null;
      }
      const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
      return {
        ok: true as const,
        stamp: at,
        data: {
          price_min_won: min,
          price_max_won: max,
          vegetarian: bool(p.servesVegetarianFood),
          groups: bool(p.goodForGroups),
          reservable: bool(p.reservable),
        },
      };
    },
    async hours(name: string, near: GeoPoint) {
      const r = await fetchJson(fetcher, URL_SEARCH, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-goog-api-key': options.api_key,
          'x-goog-fieldmask': FIELDS,
        },
        body: JSON.stringify({
          textQuery: name.normalize('NFC'),
          languageCode: 'ko',
          regionCode: 'KR',
          maxResultCount: 3,
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
        const point = { lat: Number(loc?.latitude), lng: Number(loc?.longitude) };
        return (
          typeof title === 'string' &&
          normalizedName(title) === normalizedName(name) &&
          typeof loc?.latitude === 'number' &&
          typeof loc.longitude === 'number' &&
          distanceM(point, near) <= SAME_PLACE_M
        );
      });
      const here = matches.length === 1 ? matches[0] : undefined;
      const at = stamp('google-places', true, clock(), HOURS_TTL);
      if (!here) return { ok: true as const, data: null, stamp: at };
      const status =
        typeof here.businessStatus === 'string' && STATUS.has(here.businessStatus) ? here.businessStatus : null;
      const opening = here.regularOpeningHours as { periods?: unknown } | undefined;
      const periods = opening === undefined ? [] : periodsOf(opening.periods);
      if (periods === null) return failed('INVALID_RESPONSE');
      const hours: VenueHours = { periods, status: status as VenueHours['status'] };
      return { ok: true as const, data: hours, stamp: at };
    },
  };
}

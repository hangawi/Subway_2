import type { TransitSchedule } from '../../packages/contracts/src/transit-contract.ts';
import type {
  AddressSearchResult,
  BikeRoad,
  DataFailure,
  DataStamp,
  GeoPoint,
  MovieNowShowing,
  Performance,
  PlaceRecord,
  PublicParkingLot,
  StageWeather,
  TrailNetwork,
  TravelMode,
  VenueHours,
} from '../../packages/contracts/src/place-contract.ts';
import type { RestaurantFacts } from '../../packages/contracts/src/dinner-conditions.ts';

// M07.04·05 outside data for places, routes and weather (U1.3 B16·B17·B29: Core → Interface → Adapter → Provider).
// Every answer carries a stamp (source, live, read at, expires at) or a failure; nothing is ever filled in. Without
// configuration an adapter answers CONFIG_NOT_READY, so the app keeps working and says the data is not connected.
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type DataOutcome<T> = { ok: true; data: T; stamp: DataStamp } | { ok: false; failure: DataFailure };
// 10/7 THEATER: 공연장 (stage performances); CINEMA: 영화관.
export type NearbyKind = 'SUBWAY' | 'PARKING' | 'FOOD' | 'CAFE' | 'BAR' | 'THEATER' | 'CINEMA';
export interface NearbyPlace extends PlaceRecord {
  distance_m: number | null;
}
export interface PlaceDataProvider {
  name: string;
  search(query: string, near: GeoPoint | null): Promise<DataOutcome<PlaceRecord[]>>;
  searchAddress?(query: string): Promise<DataOutcome<AddressSearchResult>>;
  nearby(kind: NearbyKind, center: GeoPoint, radiusM: number, menu?: string): Promise<DataOutcome<NearbyPlace[]>>;
}
export interface RouteResult {
  schedule?: TransitSchedule;
  // null when the provider found no route.
  minutes: number | null;
  distance_m: number | null;
  // The two points are too close for this kind of route (e.g. transit within 700 m): a short walk.
  too_close: boolean;
}
export interface RouteProvider {
  name: string;
  modes: readonly TravelMode[];
  route(
    from: GeoPoint,
    to: GeoPoint,
    departAt: string | null,
    budget?: { max_calls: number },
  ): Promise<DataOutcome<RouteResult>>;
  // 10/6 calls used today and the day's limit, for a provider with a daily limit.
  usage?: () => { used: number; limit: number };
}
export interface WeatherProvider {
  name: string;
  // null data: the time is outside the forecast published now (too far ahead, or past).
  forecast(at: GeoPoint, when: string): Promise<DataOutcome<StageWeather | null>>;
}
// 10/6 a venue's weekly opening hours, found by its name near its point (null data: no venue there found).
export interface HoursProvider {
  name: string;
  hours(name: string, near: GeoPoint): Promise<DataOutcome<VenueHours | null>>;
  // Separate opt-in lookup: avoid billing for restaurant attributes on ordinary opening-hours requests.
  restaurantFacts?(name: string, near: GeoPoint): Promise<DataOutcome<RestaurantFacts | null>>;
}
// 10/6 published hiking trails of the mountains with a trail within radiusM of a point (empty: none near).
export interface TrailProvider {
  name: string;
  near(point: GeoPoint, radiusM: number): Promise<DataOutcome<TrailNetwork[]>>;
}
// 10/6 published bicycle road sections with an end within radiusM of a point (empty: none near).
export interface BikeRoadProvider {
  name: string;
  near(point: GeoPoint, radiusM: number): Promise<DataOutcome<BikeRoad[]>>;
}
// 10/6 published parking lots within radiusM of a point, nearest first (empty: none near).
export interface ParkingLotProvider {
  name: string;
  near(point: GeoPoint, radiusM: number): Promise<DataOutcome<PublicParkingLot[]>>;
}
// 10/7 performances on a day (YYYY-MM-DD) at a theatre, found by the theatre's name; only a theatre whose published
// point is near `near` counts as the same one (empty: none there that day).
export interface ShowProvider {
  name: string;
  performances(venue: string, near: GeoPoint, day: string): Promise<DataOutcome<Performance[]>>;
}
// 10/7 films now showing (the latest published day), highest audience first.
export interface MovieProvider {
  name: string;
  nowShowing(): Promise<DataOutcome<MovieNowShowing[]>>;
}
export interface PlaceProviders {
  places: PlaceDataProvider;
  routes: RouteProvider[];
  weather: WeatherProvider;
  hours: HoursProvider;
  trails: TrailProvider;
  bikeRoads: BikeRoadProvider;
  parkingLots: ParkingLotProvider;
  shows: ShowProvider;
  movies: MovieProvider;
  // At least places and one route source are connected.
  ready: boolean;
}

export const HOUR = 3600_000;
export const stamp = (provider: string, live: boolean, now: number, ttlMs: number): DataStamp => ({
  provider,
  live,
  as_of: new Date(now).toISOString(),
  expires_at: new Date(now + ttlMs).toISOString(),
});
export const failed = (failure: DataFailure): { ok: false; failure: DataFailure } => ({ ok: false, failure });

// One HTTP call with a timeout, mapped to the shared failure codes. Response bodies are never logged.
export async function fetchJson(
  fetcher: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs = 6000,
): Promise<{ ok: true; body: unknown } | { ok: false; failure: DataFailure }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetcher(url, { ...init, signal: controller.signal });
    if (r.status === 401 || r.status === 403) return failed('AUTH_FAILED');
    if (r.status === 429) return failed('RATE_LIMITED');
    if (r.status >= 500) return failed('PROVIDER_DOWN');
    if (!r.ok) return failed('INVALID_RESPONSE');
    try {
      return { ok: true, body: await r.json() };
    } catch {
      return failed('INVALID_RESPONSE');
    }
  } catch {
    return failed(controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_DOWN');
  } finally {
    clearTimeout(timer);
  }
}

// The same for a text (XML) answer.
export async function fetchText(
  fetcher: FetchLike,
  url: string,
  timeoutMs = 6000,
): Promise<{ ok: true; body: string } | { ok: false; failure: DataFailure }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetcher(url, { signal: controller.signal });
    if (r.status === 401 || r.status === 403) return failed('AUTH_FAILED');
    if (r.status === 429) return failed('RATE_LIMITED');
    if (r.status >= 500) return failed('PROVIDER_DOWN');
    if (!r.ok) return failed('INVALID_RESPONSE');
    return { ok: true, body: await r.text() };
  } catch {
    return failed(controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_DOWN');
  } finally {
    clearTimeout(timer);
  }
}

// Not configured: every call says so.
export const placesNotReady: PlaceDataProvider = {
  name: 'places-not-configured',
  search: async () => failed('CONFIG_NOT_READY'),
  nearby: async () => failed('CONFIG_NOT_READY'),
};
export const weatherNotReady: WeatherProvider = {
  name: 'weather-not-configured',
  forecast: async () => failed('CONFIG_NOT_READY'),
};
export const hoursNotReady: HoursProvider = {
  name: 'hours-not-configured',
  hours: async () => failed('CONFIG_NOT_READY'),
};

export const trailsNotReady: TrailProvider = {
  name: 'trails-not-configured',
  near: async () => failed('CONFIG_NOT_READY'),
};

export const bikeRoadsNotReady: BikeRoadProvider = {
  name: 'bike-roads-not-configured',
  near: async () => failed('CONFIG_NOT_READY'),
};

export const parkingLotsNotReady: ParkingLotProvider = {
  name: 'parking-lots-not-configured',
  near: async () => failed('CONFIG_NOT_READY'),
};

export const showsNotReady: ShowProvider = {
  name: 'shows-not-configured',
  performances: async () => failed('CONFIG_NOT_READY'),
};

export const moviesNotReady: MovieProvider = {
  name: 'movies-not-configured',
  nowShowing: async () => failed('CONFIG_NOT_READY'),
};

// Runs tasks with at most `limit` at a time, keeping the order of results.
export async function limited<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

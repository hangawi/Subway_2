import {
  odsaySearchTime,
  readMaasRoute,
  unknownSchedule,
  maasSubwayAccess,
  possibleSubwayDays,
  readSubwayRoute,
  combineSubwayDays,
  unknownTransit,
} from './odsay-schedule.ts';
import { distanceM } from '../../packages/contracts/src/place-contract.ts';
import { failed, fetchJson, HOUR, stamp, type FetchLike, type RouteProvider } from './place-data-provider.ts';
import type { DailyQuota } from './daily-quota.ts';

// ODsay 대중교통 길찾기 (https://lab.odsay.com, searchPubTransPathT): bus and subway time of the best path. Key:
// SOPHIA_ODSAY_API_KEY (server only). Untimed requests use basic estimates; timed requests use maasRP for access routes, then subwayPathSchedule for verified rail service.
// Failed timetable lookups never silently fall back to an ordinary duration.
const BASE = 'https://api.odsay.com/v1/api/searchPubTransPathT';
const ROUTE_TTL = 24 * HOUR;
// ODsay answers -98 (a walk) for points within 700 m: said here without spending a call.
const WALK_M = 700;

export function createOdsayTransitProvider(options: {
  api_key: string;
  fetcher?: FetchLike;
  clock?: () => number;
  // 10/6 the plan's calls per day (place-providers.ts sets it from SOPHIA_ODSAY_DAILY_LIMIT).
  quota?: DailyQuota;
}): RouteProvider {
  const fetcher = options.fetcher ?? ((u, i) => fetch(u, i));
  const clock = options.clock ?? Date.now;
  return {
    name: 'odsay',
    modes: ['TRANSIT'],
    ...(options.quota ? { usage: () => ({ used: options.quota!.used(), limit: options.quota!.limit }) } : {}),
    async route(from, to, departAt, budget) {
      let calls = 0;
      const take = () => calls < (budget?.max_calls ?? 7) && (!options.quota || options.quota.take()) && ++calls > 0;
      if (departAt && !Number.isFinite(Date.parse(departAt))) return failed('INVALID_RESPONSE');
      if (distanceM(from, to) < WALK_M)
        return {
          ok: true,
          data: {
            minutes: null,
            distance_m: null,
            too_close: true,
            ...(departAt ? { schedule: unknownSchedule(departAt) } : {}),
          },
          stamp: stamp('odsay', true, clock(), ROUTE_TTL),
        };
      if (!take()) return failed('QUOTA_EXCEEDED');
      const params = new URLSearchParams({
        SX: String(from.lng),
        SY: String(from.lat),
        EX: String(to.lng),
        EY: String(to.lat),
        apiKey: options.api_key,
      });
      if (departAt) {
        params.set('SearchTime', odsaySearchTime(departAt));
        params.set('SearchMethod', '2');
      }
      const endpoint = departAt ? 'https://api.odsay.com/v1/api/maasRP' : BASE;
      const r = await fetchJson(fetcher, `${endpoint}?${params}`, {});
      if (!r.ok) return r;
      const body = r.body as {
        result?: { path?: Array<{ info?: { totalTime?: unknown; totalDistance?: unknown } }> };
        error?: unknown;
      };
      const s = stamp('odsay', true, clock(), departAt ? 5 * 60_000 : ROUTE_TTL);
      if (body.error) {
        const list = Array.isArray(body.error) ? body.error : [body.error];
        const code = String((list[0] as { code?: unknown } | undefined)?.code ?? '');
        if (departAt && ['400', '-99', '-98'].includes(code))
          return { ok: true, data: readMaasRoute({}, departAt), stamp: s };
        // -98: origin and destination are within 700 m (a walk); -99: no path found.
        if (code === '-98') return { ok: true, data: { minutes: null, distance_m: null, too_close: true }, stamp: s };
        if (code === '-99') return { ok: true, data: { minutes: null, distance_m: null, too_close: false }, stamp: s };
        if (code === '500' || code === '-8') return failed('PROVIDER_DOWN');
        return failed(/key|auth|apikey/i.test(JSON.stringify(list[0] ?? '')) ? 'AUTH_FAILED' : 'INVALID_RESPONSE');
      }
      if (departAt) {
        const access = maasSubwayAccess(body);
        const outcomes = [];
        for (const route of access.options.slice(0, 2)) {
          const stationAt = new Date(Date.parse(departAt) + route.access_min * 60_000).toISOString();
          const days = possibleSubwayDays(stationAt);
          const results = [];
          for (const day of days) {
            if (!take()) {
              results.push(unknownTransit(departAt));
              break;
            }
            const query = new URLSearchParams({
              apiKey: options.api_key,
              SID: String(route.sid),
              EID: String(route.eid),
              MODE: '1',
              DAY: String(day),
              TIME: odsaySearchTime(stationAt).slice(-4),
            });
            const schedule = await fetchJson(fetcher, `https://api.odsay.com/v1/api/subwayPathSchedule?${query}`, {});
            if (!schedule.ok) return schedule;
            const error = (schedule.body as { error?: unknown }).error;
            if (error)
              return failed(/key|auth|apikey/i.test(JSON.stringify(error)) ? 'AUTH_FAILED' : 'INVALID_RESPONSE');
            results.push(readSubwayRoute(schedule.body, departAt, route, day));
          }
          const result =
            results.length === days.length ? combineSubwayDays(results, departAt) : unknownTransit(departAt);
          outcomes.push(result);
          if (result.schedule?.status === 'AVAILABLE') return { ok: true, data: result, stamp: s };
        }
        const unavailable =
          access.complete &&
          access.options.length > 0 &&
          outcomes.length === access.options.length &&
          outcomes.every((r) => r.schedule?.status === 'NO_SERVICE');
        return {
          ok: true,
          data: {
            ...unknownTransit(departAt),
            schedule: {
              ...unknownSchedule(departAt),
              status: unavailable ? 'NO_SERVICE' : 'UNKNOWN',
              ...(!unavailable && outcomes.some((r) => r.schedule?.status === 'NO_SERVICE')
                ? { notice: 'SUBWAY_SERVICE_UNAVAILABLE' as const }
                : {}),
            },
          },
          stamp: s,
        };
      }
      const info = body.result?.path?.[0]?.info;
      if (!info) return { ok: true, data: { minutes: null, distance_m: null, too_close: false }, stamp: s };
      const minutes = Number(info.totalTime);
      if (!Number.isFinite(minutes) || minutes < 0) return failed('INVALID_RESPONSE');
      const distance = Number(info.totalDistance);
      return {
        ok: true,
        data: {
          minutes: Math.round(minutes),
          distance_m: Number.isFinite(distance) ? distance : null,
          too_close: false,
        },
        stamp: s,
      };
    },
  };
}

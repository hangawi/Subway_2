import type { TransitSchedule } from '../../packages/contracts/src/transit-contract.ts';
import type { RouteResult } from './place-data-provider.ts';

const MIN = 60_000;
export const TRANSIT_MAX_WAIT_MIN = 60;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function odsaySearchTime(at: string): string {
  const n = Date.parse(at);
  if (!Number.isFinite(n)) throw new Error('INVALID_TRANSIT_TIME');
  return new Date(n + 9 * 3600_000).toISOString().slice(0, 16).replace(/[-T:]/g, '');
}
export function unknownSchedule(at: string): TransitSchedule {
  return {
    status: 'UNKNOWN',
    requested_departure: at,
    departure_at: null,
    arrival_at: null,
    transfers: null,
    basis: 'TIMETABLE',
    realtime: false,
  };
}
export const unknownTransit = (at: string): RouteResult => ({
  minutes: null,
  distance_m: null,
  too_close: false,
  schedule: unknownSchedule(at),
});
// Live verification on 2026-10-08: maasRP returned subway trips at 03:00 with zero waiting time while
// subwayPathSchedule reported first-train fallback. Absolute timestamps alone are NOT timetable evidence.
export function readMaasRoute(_body: unknown, at: string): RouteResult {
  return unknownTransit(at);
}
export interface SubwayAccess {
  sid: number;
  eid: number;
  access_min: number;
  egress_min: number;
}
export function maasSubwayAccess(body: unknown): { options: SubwayAccess[]; complete: boolean } {
  if (!object(body) || !object(body.result) || !Array.isArray(body.result.paths) || !body.result.paths.length)
    return { options: [], complete: false };
  const options: SubwayAccess[] = [];
  let complete = true;
  for (const path of body.result.paths) {
    if (
      !object(path) ||
      path.pathType !== 2 ||
      !Array.isArray(path.rps) ||
      !path.rps.length ||
      path.rps.some(
        (p: unknown) =>
          !object(p) ||
          ![1, 3].includes(Number(p.trafficType)) ||
          typeof p.duration !== 'number' ||
          !Number.isInteger(p.duration) ||
          p.duration < 0 ||
          p.duration > 240,
      )
    ) {
      complete = false;
      continue;
    }
    const parts = path.rps as Record<string, unknown>[];
    const first = parts.findIndex((p) => p.trafficType === 1);
    const reverseIndex = [...parts].reverse().findIndex((p) => p.trafficType === 1);
    const last = reverseIndex < 0 ? -1 : parts.length - 1 - reverseIndex;
    const sid = parts[first]?.startID,
      eid = parts[last]?.endID;
    if (
      first < 0 ||
      typeof sid !== 'number' ||
      typeof eid !== 'number' ||
      !Number.isInteger(sid) ||
      !Number.isInteger(eid) ||
      sid <= 0 ||
      eid <= 0
    ) {
      complete = false;
      continue;
    }
    const access_min = parts.slice(0, first).reduce((n, p) => n + (p.duration as number), 0);
    const egress_min = parts.slice(last + 1).reduce((n, p) => n + (p.duration as number), 0);
    // The whole station-to-station route (including transfers) is searched again by the timetable API.
    if (
      !options.some((p) => p.sid === sid && p.eid === eid && p.access_min === access_min && p.egress_min === egress_min)
    )
      options.push({ sid, eid, access_min, egress_min });
  }
  return { options, complete };
}
// We have no verified Korean holiday calendar. Compare every possible service-day timetable and use the
// conservative envelope only when all allow the journey. Ambiguous midnight service dates include the prior day.
export function possibleSubwayDays(at: string): number[] {
  const date = new Date(Date.parse(at) + 9 * 3600_000);
  const kind = (d: number) => (d === 0 ? 3 : d === 6 ? 2 : 1);
  return [
    ...new Set([kind(date.getUTCDay()), 3, ...(date.getUTCHours() < 4 ? [kind((date.getUTCDay() + 6) % 7)] : [])]),
  ].sort();
}
const clockSeconds = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const [h, m, s] = value.split(':').map(Number) as [number, number, number];
  return h <= 26 && m < 60 && s < 60 ? h * 3600 + m * 60 + s : null;
};
export function readSubwayRoute(body: unknown, at: string, access: SubwayAccess, day: number): RouteResult {
  const unknown = unknownTransit(at);
  if (!object(body) || !object(body.result)) return unknown;
  const result = body.result;
  // First/last-train fallbacks are not trips for the requested time. Do not silently shift the meeting.
  if (result.notificationCode === 2 || result.notificationCode === 3)
    return { ...unknown, schedule: { ...unknown.schedule!, status: 'NO_SERVICE' } };
  if (result.notificationCode !== 0 || !Array.isArray(result.path) || !result.path.length) return unknown;
  const requested = Date.parse(at);
  const stationAt = requested + access.access_min * MIN;
  const seoul = new Date(stationAt + 9 * 3600_000);
  const midnight = Date.parse(`${seoul.toISOString().slice(0, 10)}T00:00:00+09:00`);
  const candidates: Array<{ end: number; transfers: number }> = [];
  let incomplete = false,
    late = false;
  for (const path of result.path) {
    if (
      !object(path) ||
      !object(path.info) ||
      path.info.day !== day ||
      !Array.isArray(path.subPath) ||
      !path.subPath.length
    ) {
      incomplete = true;
      continue;
    }
    const startS = clockSeconds(path.info.departureTime),
      endS = clockSeconds(path.info.arrivalTime);
    if (startS === null || endS === null) {
      incomplete = true;
      continue;
    }
    // 24:xx and 00:xx both occur in service-day feeds. Pick only a departure at/after the requested station time.
    const possible = [-1, 0, 1].map((d) => midnight + d * 86400_000 + startS * 1000).filter((n) => n >= stationAt);
    const start = Math.min(...possible);
    let end = midnight + endS * 1000 + Math.round((start - (midnight + startS * 1000)) / 86400_000) * 86400_000;
    if (end < start) end += 86400_000;
    if (end - start > 8 * 3600_000) {
      incomplete = true;
      continue;
    }
    if (start - stationAt > TRANSIT_MAX_WAIT_MIN * MIN) {
      late = true;
      continue;
    }
    let previous = start,
      rides = 0,
      valid = true,
      first = true;
    for (const part of path.subPath) {
      if (!object(part) || ![1, 2, 3].includes(Number(part.movingType))) {
        valid = false;
        break;
      }
      const a = clockSeconds(part.departureTime),
        b = clockSeconds(part.arrivalTime);
      if (a === null || b === null) {
        valid = false;
        break;
      }
      const starts = [-1, 0, 1]
        .map((d) => midnight + d * 86400_000 + a * 1000)
        .filter((n) => n >= previous && n <= end);
      const ps = Math.min(...starts);
      const ends = [-1, 0, 1].map((d) => midnight + d * 86400_000 + b * 1000).filter((n) => n >= ps && n <= end);
      const pe = Math.min(...ends);
      if (
        !Number.isFinite(ps) ||
        !Number.isFinite(pe) ||
        (first && ps !== start) ||
        ps - previous > TRANSIT_MAX_WAIT_MIN * MIN
      ) {
        valid = false;
        break;
      }
      if (part.movingType === 1) rides++;
      previous = pe;
      first = false;
    }
    if (!valid || !rides || previous !== end) {
      incomplete = true;
      continue;
    }
    candidates.push({ end: end + access.egress_min * MIN, transfers: rides - 1 });
  }
  const best = candidates.sort((a, b) => a.end - b.end)[0];
  if (!best)
    return !incomplete && late ? { ...unknown, schedule: { ...unknown.schedule!, status: 'NO_SERVICE' } } : unknown;
  return {
    minutes: Math.ceil((best.end - requested) / MIN),
    distance_m: null,
    too_close: false,
    schedule: {
      ...unknown.schedule!,
      status: 'AVAILABLE',
      departure_at: at,
      arrival_at: new Date(best.end).toISOString(),
      transfers: best.transfers,
    },
  };
}
// A holiday calendar is not guessed. Only outcomes valid for every possible day kind count as available.
export function combineSubwayDays(results: RouteResult[], at: string): RouteResult {
  const unknown = unknownTransit(at);
  if (!results.length) return unknown;
  if (results.every((r) => r.schedule?.status === 'NO_SERVICE'))
    return { ...unknown, schedule: { ...unknown.schedule!, status: 'NO_SERVICE' } };
  if (!results.every((r) => r.schedule?.status === 'AVAILABLE' && r.schedule.arrival_at && r.minutes !== null))
    return unknown;
  return results.reduce((a, b) => ((a.minutes ?? 0) > (b.minutes ?? 0) ? a : b));
}

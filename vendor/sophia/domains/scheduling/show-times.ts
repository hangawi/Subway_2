import type { ShowSchedule } from '../../packages/contracts/src/place-contract.ts';

// 10/7 공연 시각 (KOPIS "공연시간", U1.3 B17 상영·공연 시각): the published text read into start minutes by weekday,
// and the showing of a performance that fits an activity's time. Code only — a text that does not read cleanly gives
// no times (shown as written, checked by a person), never a guessed time.
//   "화요일 ~ 금요일(20:00), 토요일 ~ 일요일(15:00,19:00), HOL(15:00)"
const DAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const PART = /^(?:([월화수목금토일])요일(?:\s*~\s*([월화수목금토일])요일)?|(HOL))\s*\(([^()]*)\)$/;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function readShowSchedule(text: string | null): ShowSchedule | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\)\s*,\s*/).map((p, i, all) => (i < all.length - 1 ? `${p})` : p).trim());
  const weekly = new Map<string, { day: number; minute: number }>();
  const holiday = new Set<number>();
  for (const part of parts) {
    const m = PART.exec(part);
    if (!m) return null;
    const minutes: number[] = [];
    for (const t of m[4]!.split(',').map((x) => x.trim())) {
      const tm = TIME.exec(t);
      if (!tm) return null;
      minutes.push(Number(tm[1]) * 60 + Number(tm[2]));
    }
    if (!minutes.length) return null;
    if (m[3]) {
      for (const min of minutes) holiday.add(min);
      continue;
    }
    const from = DAYS.indexOf(m[1] as (typeof DAYS)[number]);
    const to = m[2] ? DAYS.indexOf(m[2] as (typeof DAYS)[number]) : from;
    // A range runs forward through the week from Monday ("월요일 ~ 일요일" is the whole week).
    const order = (d: number) => (d + 6) % 7;
    if (order(to) < order(from)) return null;
    for (let o = order(from); o <= order(to); o++) {
      const day = (o + 1) % 7;
      for (const minute of minutes) weekly.set(`${day}:${minute}`, { day, minute });
    }
  }
  return {
    weekly: [...weekly.values()].sort((a, b) => a.day - b.day || a.minute - b.minute),
    holiday: [...holiday].sort((a, b) => a - b),
  };
}

// Seoul calendar day and minute of an instant (Korea has no daylight saving time).
const SEOUL_MS = 9 * 3600_000;
export function seoulDay(iso: string): { date: string; weekday: number; minute: number } {
  const t = new Date(Date.parse(iso) + SEOUL_MS);
  return {
    date: t.toISOString().slice(0, 10),
    weekday: t.getUTCDay(),
    minute: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

export type ShowingFit =
  | { fit: 'YES'; starts_at: string; wait_min: number }
  // The day is outside the running period; no showing that day; none starts within the activity's time; the
  // earliest one that starts in time runs past the activity's end.
  | { fit: 'NOT_ON_DATE' | 'NO_SHOWING_THAT_DAY' | 'NOT_AT_TIME' | 'LONGER_THAN_STAGE' }
  // The times (or the activity's time) are not known.
  | { fit: 'UNKNOWN' };

// The showing on the activity's day that starts within its time, earliest first, and ends by its end when the
// running time is known. Public holidays are not in any connected calendar: a weekday's published times are used.
export function showingFor(
  show: { from: string; to: string; runtime_min: number | null; schedule: ShowSchedule | null },
  startsAt: string | null,
  endsAt: string | null,
): ShowingFit {
  if (!startsAt) return { fit: 'UNKNOWN' };
  const day = seoulDay(startsAt);
  if (day.date < show.from || day.date > show.to) return { fit: 'NOT_ON_DATE' };
  if (!show.schedule) return { fit: 'UNKNOWN' };
  const times = show.schedule.weekly.filter((w) => w.day === day.weekday).map((w) => w.minute);
  if (!times.length) return { fit: 'NO_SHOWING_THAT_DAY' };
  const endMin = endsAt ? day.minute + Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000) : null;
  const inTime = times.filter((m) => m >= day.minute && (endMin === null || m < endMin));
  if (!inTime.length) return { fit: 'NOT_AT_TIME' };
  const fits = inTime.filter((m) => endMin === null || show.runtime_min === null || m + show.runtime_min <= endMin);
  if (!fits.length) return { fit: 'LONGER_THAN_STAGE' };
  const minute = fits[0]!;
  return {
    fit: 'YES',
    starts_at: new Date(Date.parse(startsAt) + (minute - day.minute) * 60_000).toISOString(),
    wait_min: minute - day.minute,
  };
}

// Films that end within the activity's time: running time plus the trailers before it (about 10 minutes) within the
// planned minutes. Unknown running times are left out; an activity without both times keeps every film.
export const MOVIE_TRAILER_MIN = 10;
export function moviesFitting<T extends { runtime_min: number | null }>(
  movies: readonly T[],
  startsAt: string | null,
  endsAt: string | null,
): T[] {
  if (!startsAt || !endsAt) return [...movies];
  const planned = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
  return movies.filter((m) => m.runtime_min !== null && m.runtime_min + MOVIE_TRAILER_MIN <= planned);
}

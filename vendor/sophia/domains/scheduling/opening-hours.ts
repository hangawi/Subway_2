import type { VenueHours } from '../../packages/contracts/src/place-contract.ts';

// 10/6 영업시간: is a venue open for the whole of an activity, by its published weekly hours (Korean venues, so
// Seoul time)? true / false, or null when it cannot be said (no hours, no time). Never guessed: no hours is null,
// not "open". An activity without an end is checked at its start only (no length is assumed).
const WEEK = 7 * 1440;
const SEOUL = 9 * 3_600_000;
function weekMinute(iso: string): number {
  const t = new Date(Date.parse(iso) + SEOUL);
  return t.getUTCDay() * 1440 + t.getUTCHours() * 60 + t.getUTCMinutes();
}
export function openDuring(hours: VenueHours | null, startsAt: string | null, endsAt: string | null): boolean | null {
  if (!hours || !startsAt) return null;
  if (hours.status === 'CLOSED_PERMANENTLY' || hours.status === 'CLOSED_TEMPORARILY') return false;
  if (!hours.periods.length) return null;
  const start = weekMinute(startsAt);
  const length = endsAt ? Math.max(0, Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000)) : 0;
  if (length >= WEEK) return null;
  for (const p of hours.periods) {
    if (!p.close) return true;
    const from = p.open.day * 1440 + p.open.minute;
    let to = p.close.day * 1440 + p.close.minute;
    if (to <= from) to += WEEK;
    // The activity, also seen one week later (a period that runs past Saturday into Sunday).
    for (const t of [start, start + WEEK]) if (t >= from && t + length <= to && (length > 0 || t < to)) return true;
  }
  return false;
}

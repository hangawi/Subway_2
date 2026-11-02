// Korean date words built from numbers. Intl output depends on the runtime's ICU data (a server Node printed
// "PM 6:40" where browsers print "오후 6:40"), so screens and tests would differ by device. Korea has no
// daylight saving time, so Seoul time is always UTC+9.
function seoul(iso: string) {
  const t = new Date(Date.parse(iso) + 9 * 3600_000);
  const hour = t.getUTCHours();
  return {
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    half: hour < 12 ? '오전' : '오후',
    hour12: hour % 12 || 12,
    minute: String(t.getUTCMinutes()).padStart(2, '0'),
  };
}
// "9월 28일"
export function seoulDay(iso: string): string {
  const s = seoul(iso);
  return `${s.month}월 ${s.day}일`;
}
// "9월 28일 오후 6:40"
export function seoulDayTime(iso: string): string {
  const s = seoul(iso);
  return `${s.month}월 ${s.day}일 ${s.half} ${s.hour12}:${s.minute}`;
}
// "10월 30일 오전 12시"
export function seoulDayHour(iso: string): string {
  const s = seoul(iso);
  return `${s.month}월 ${s.day}일 ${s.half} ${s.hour12}시`;
}
// 10/24 "10월 25일 (일) 오후 2:00" (a single moment with its weekday).
export function seoulDayWeekTime(iso: string): string {
  const s = seoul(iso);
  return `${s.month}월 ${s.day}일 (${'일월화수목금토'[new Date(Date.parse(iso) + 9 * 3600_000).getUTCDay()]}) ${s.half} ${s.hour12}:${s.minute}`;
}
// 10/24 "10월 25일 (일) 오후 2:00～3:00" (one day), or both ends in full when it runs into another day.
export function seoulDayTimeRange(start: string, end: string): string {
  const sameDay = seoulYmd(start) === seoulYmd(end);
  return sameDay
    ? `${seoulDayWeekTime(start)}～${seoulTime(end)}`
    : `${seoulDayWeekTime(start)} ～ ${seoulDayWeekTime(end)}`;
}
// "오전 9:00" (time only, for activities on the same day)
export function seoulTime(iso: string): string {
  const s = seoul(iso);
  return `${s.half} ${s.hour12}:${s.minute}`;
}
// "10월 10일 오전 6:00～오후 12:00", "10월 10일 오후 7:00～자정", "10월 10일 하루 종일" (within one Seoul day).
export function seoulRange(start: string, end: string): string {
  const midnight = (Date.parse(end) + 9 * 3600_000) % 86_400_000 === 0;
  const fromMidnight = (Date.parse(start) + 9 * 3600_000) % 86_400_000 === 0;
  if (midnight && fromMidnight) return `${seoulDay(start)} 하루 종일`;
  return `${seoulDay(start)} ${seoulTime(start)}～${midnight ? '자정' : seoulTime(end)}`;
}
// <input type="datetime-local"> works in Seoul wall time: "2026-10-12T09:00" ↔ an instant with +09:00.
export function seoulInput(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16);
}
export function fromSeoulInput(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+09:00` : null;
}
// Calendar days in Seoul as "2026-10-08" strings (M04.01). A day runs from 00:00 to 24:00 Seoul time.
const WEEKDAYS = '일월화수목금토';
export function seoulYmd(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
}
export function ymdStart(ymd: string): string {
  return new Date(`${ymd}T00:00:00+09:00`).toISOString();
}
export function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
}
// "목"
export function ymdWeekday(ymd: string): string {
  return WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()]!;
}
// "10월 8일 (목)"
export function ymdLabel(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}월 ${d}일 (${ymdWeekday(ymd)})`;
}

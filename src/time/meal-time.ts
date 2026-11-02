// 지금 시각 → 서울 기준 날짜·요일·시간대. 같은 기준 시각이면 늘 같은 결과 (기기 시간대와 상관없음).
// 시간대 경계는 처음 정한 값이다 (설계값): 아침 07:00~10:59 · 점심 11:00~14:59 · 오후 15:00~16:59 ·
// 저녁 17:00~20:59 · 야식 21:00~06:59 (자정을 넘김).
// 공휴일은 src/time/holidays.ts (2026·2027). 표 밖의 해는 모른다(null). 모르는 걸 평일이라고 치지 않는다.
// 써브웨이는 대부분 공휴일에도 열고 매장마다 달라서, 공휴일은 영업 판단에 쓰지 않고 안내로만 쓴다
// (영업 여부는 매장이 Google에 등록한 이번 주 실제 영업시간으로 — src/stores/google-hours.ts).

import { holidayName } from './holidays.ts';

export type MealTime = 'BREAKFAST' | 'LUNCH' | 'AFTERNOON' | 'DINNER' | 'LATE_NIGHT';

export interface MealMoment {
  /** 서울 날짜 YYYY-MM-DD */
  seoulDate: string;
  /** 0=일 … 6=토 (서울) */
  weekday: number;
  /** 서울 자정부터 지난 분 */
  minuteOfDay: number;
  meal: MealTime;
  weekend: boolean;
  /** 공휴일인지 (표 밖의 해는 null) */
  holiday: boolean | null;
  /** 공휴일 이름 */
  holidayName: string | null;
}

export const MEAL_LABEL_KO: Record<MealTime, string> = {
  BREAKFAST: '아침',
  LUNCH: '점심',
  AFTERNOON: '오후',
  DINNER: '저녁',
  LATE_NIGHT: '야식',
};

const SEOUL_OFFSET_MS = 9 * 3_600_000;

export function mealTimeOf(referenceAt: string): MealMoment {
  const t = Date.parse(referenceAt);
  if (!Number.isFinite(t)) throw new Error(`INVALID_REFERENCE_AT:${referenceAt}`);
  const seoul = new Date(t + SEOUL_OFFSET_MS);
  const minuteOfDay = seoul.getUTCHours() * 60 + seoul.getUTCMinutes();
  const weekday = seoul.getUTCDay();
  const seoulDate = seoul.toISOString().slice(0, 10);
  const hName = holidayName(seoulDate);
  return {
    seoulDate,
    weekday,
    minuteOfDay,
    meal: mealOfMinute(minuteOfDay),
    weekend: weekday === 0 || weekday === 6,
    holiday: hName === undefined ? null : hName !== null,
    holidayName: hName ?? null,
  };
}

export function mealOfMinute(minute: number): MealTime {
  if (minute >= 7 * 60 && minute < 11 * 60) return 'BREAKFAST';
  if (minute >= 11 * 60 && minute < 15 * 60) return 'LUNCH';
  if (minute >= 15 * 60 && minute < 17 * 60) return 'AFTERNOON';
  if (minute >= 17 * 60 && minute < 21 * 60) return 'DINNER';
  return 'LATE_NIGHT';
}

// 써브웨이 아침 메뉴 판매 시간: 06:00~11:00 (공식 주문 시스템·홈페이지, 2026-10-08 확인).
export const BREAKFAST_SALE = { fromMinute: 6 * 60, untilMinute: 11 * 60 } as const;

export function breakfastOnSale(moment: MealMoment): boolean {
  return moment.minuteOfDay >= BREAKFAST_SALE.fromMinute && moment.minuteOfDay < BREAKFAST_SALE.untilMinute;
}

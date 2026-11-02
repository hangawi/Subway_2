import { describe, expect, it } from 'vitest';
import { breakfastOnSale, mealTimeOf } from '../../src/time/meal-time.ts';

// 서울 시각 hh:mm (2026-10-12 월요일) → UTC ISO
const seoul = (hhmm: string, ymd = '2026-10-12') => new Date(`${ymd}T${hhmm}:00+09:00`).toISOString();

describe('지금 시각 → 시간대', () => {
  it.each([
    ['06:59', 'LATE_NIGHT'],
    ['07:00', 'BREAKFAST'],
    ['10:59', 'BREAKFAST'],
    ['11:00', 'LUNCH'],
    ['14:59', 'LUNCH'],
    ['15:00', 'AFTERNOON'],
    ['17:00', 'DINNER'],
    ['20:59', 'DINNER'],
    ['21:00', 'LATE_NIGHT'],
    ['00:30', 'LATE_NIGHT'],
  ])('서울 %s → %s', (hhmm, meal) => {
    expect(mealTimeOf(seoul(hhmm)).meal).toBe(meal);
  });

  it('서울 날짜·요일은 UTC가 아니라 서울 기준 (자정 넘김)', () => {
    const m = mealTimeOf('2026-10-11T15:30:00Z'); // 서울 10/12 00:30
    expect([m.seoulDate, m.weekday, m.weekend]).toEqual(['2026-10-12', 1, false]);
    expect(mealTimeOf(seoul('12:00', '2026-10-11')).weekend).toBe(true);
  });

  it('공휴일: 표에 있으면 이름, 아니면 평일, 표 밖의 해는 모름', () => {
    expect(mealTimeOf(seoul('12:00', '2026-10-09'))).toMatchObject({ holiday: true, holidayName: '한글날' });
    expect(mealTimeOf(seoul('12:00', '2026-10-05'))).toMatchObject({ holiday: true, holidayName: '개천절 대체공휴일' });
    expect(mealTimeOf(seoul('12:00', '2026-10-13'))).toMatchObject({ holiday: false, holidayName: null });
    expect(mealTimeOf(seoul('12:00', '2028-01-01'))).toMatchObject({ holiday: null, holidayName: null });
  });

  it('아침 메뉴 판매: 06:00부터 11:00 전까지', () => {
    expect(breakfastOnSale(mealTimeOf(seoul('05:59')))).toBe(false);
    expect(breakfastOnSale(mealTimeOf(seoul('06:00')))).toBe(true);
    expect(breakfastOnSale(mealTimeOf(seoul('10:59')))).toBe(true);
    expect(breakfastOnSale(mealTimeOf(seoul('11:00')))).toBe(false);
  });

  it('같은 입력이면 같은 결과, 잘못된 시각은 오류', () => {
    expect(mealTimeOf(seoul('12:10'))).toEqual(mealTimeOf(seoul('12:10')));
    expect(() => mealTimeOf('not-a-date')).toThrow('INVALID_REFERENCE_AT');
  });
});

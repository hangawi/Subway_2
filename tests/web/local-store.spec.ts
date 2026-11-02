import { beforeEach, describe, expect, it } from 'vitest';
import { addOrder, clearAll, consented, load, markOnboarded, MAX_ORDERS, orders, rememberAllergies, removeOrder, savedAllergies, setConsent } from '../../src/web/local-store.ts';

// 시험 환경엔 localStorage가 없다 → 저장이 막힌 브라우저처럼 이 화면 동안만 기억 (그래도 돌아가야 함)
const order = (n: number) => ({ menuId: `m${n}`, menuName: `메뉴${n}`, choices: {}, text: '주문서', store: null, totalWon: 8000 });

describe('휴대폰 저장소 (동의한 것만)', () => {
  beforeEach(() => clearAll());

  it('동의 기록은 목적·받는 쪽·맥락·유효기간·계정 칸과 함께', () => {
    setConsent('voice', true, new Date('2026-10-15T10:00:00Z'));
    expect(load().consents.voice).toEqual({ kind: 'voice', purpose: 'subway_food_recommendation', recipient: 'openai', context: { app: 'subway' }, granted: true, at: '2026-10-15T10:00:00.000Z', valid_until: null, account_id: null });
    setConsent('orders', true);
    expect(load().consents.orders?.recipient).toBe('this_device');
    expect(load().deviceId).toBeTruthy();
  });

  it('주문 기록: 동의 안 하면 저장 안 함, 동의하면 최근 10개만', () => {
    expect(addOrder(order(0))).toBeNull();
    expect(orders()).toEqual([]);
    setConsent('orders', true);
    for (let i = 1; i <= 12; i++) addOrder(order(i));
    expect(orders()).toHaveLength(MAX_ORDERS);
    expect(orders()[0]!.menuId).toBe('m12');
    expect(orders()[0]!.account_id).toBeNull();
  });

  it('하나 지우기, 동의 끄면 기록도 지워짐', () => {
    setConsent('orders', true);
    const a = addOrder(order(1))!;
    addOrder(order(2));
    removeOrder(a.id);
    expect(orders().map((o) => o.menuId)).toEqual(['m2']);
    setConsent('orders', false);
    expect(orders()).toEqual([]);
    setConsent('orders', true);
    expect(orders()).toEqual([]); // 다시 켜도 지운 건 안 돌아옴
  });

  it('알레르기는 따로 동의해야 기억, 끄면 지움', () => {
    rememberAllergies(['우유']);
    expect(savedAllergies()).toEqual([]);
    setConsent('allergy', true);
    rememberAllergies(['우유', '새우', '우유']);
    expect(savedAllergies()).toEqual(['우유', '새우']);
    setConsent('allergy', false);
    expect(savedAllergies()).toEqual([]);
  });

  it('처음 안내 봤는지, 유효기간 지난 동의는 꺼진 것으로', () => {
    expect(load().onboarded).toBe(false);
    markOnboarded();
    expect(load().onboarded).toBe(true);
    setConsent('voice', true);
    load().consents.voice!.valid_until = '2026-01-01T00:00:00Z';
    expect(consented('voice', new Date('2026-10-15T00:00:00Z'))).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { addTalkLog, clearAll, clearTalkLog, hasRecords, MAX_TALK_LOG, setConsent, talkLog, type TalkLogEntry } from '../../src/web/local-store.ts';
import { tasteGraph, type OrderLike, type TasteRecord } from '../../src/web/taste.ts';

// 10/22 예형님: 아래 [취향 그래프] 탭 — 주로 먹는 메뉴·좋아하는 재료·싫어하는 것·소스·빼는 야채·알레르기, 그리고 말 기록
const order = (menuId: string, menuName: string, choices: Record<string, unknown> = {}): OrderLike => ({ menuId, menuName, choices });
const rec = (over: Partial<TasteRecord>): TasteRecord => ({ id: Math.random().toString(16), scope: 'LASTING', target: { type: 'main', id: '쇠고기' }, sign: 1, at: '2026-10-22T03:00:00.000Z', valid_until: null, policy: null, account_id: null, ...over });
const now = new Date('2026-10-22T05:00:00Z');
const group = (g: ReturnType<typeof tasteGraph>, key: string) => g.find((x) => x.key === key)!;

describe('취향 그래프 (10/22)', () => {
  it('아무것도 없으면 묶음은 있고 막대는 비어 있음', () => {
    const g = tasteGraph([], [], [], [], now);
    expect(g.map((x) => x.key)).toEqual(['menus', 'likes', 'dislikes', 'sauces', 'removed', 'allergies']);
    expect(g.every((x) => x.bars.length === 0)).toBe(true);
  });

  it('주문 기록: 메뉴·메인 재료·소스·빼는 야채를 센다 (많은 순)', () => {
    const orders = [
      order('m1', '스테이크 & 치즈', { sauces: ['sauce:랜치', 'sauce:핫 칠리'], removeVegetables: ['vegetable:양파'] }),
      order('m1', '스테이크 & 치즈', { sauces: ['sauce:랜치'], removeVegetables: ['vegetable:양파'] }),
      order('m2', '로스트 치킨', { sauces: ['sauce:랜치'] }),
    ];
    const g = tasteGraph(orders, [], [], [], now);
    expect(group(g, 'menus').bars).toEqual([{ label: '스테이크 & 치즈', n: 2, from: 'orders' }, { label: '로스트 치킨', n: 1, from: 'orders' }]);
    expect(group(g, 'likes').bars[0]).toEqual({ label: '쇠고기', n: 2, from: 'orders' });
    expect(group(g, 'sauces').bars.map((b) => [b.label, b.n])).toEqual([['랜치', 3], ['핫 칠리', 1]]);
    expect(group(g, 'removed').bars).toEqual([{ label: '양파', n: 2, from: 'orders' }]);
  });

  it('말로 한 취향: 좋아해 → 좋아하는 재료(말함), 피해 → 싫어하는 것, 싫어함이 좋아함을 이김', () => {
    const orders = [order('m1', '스테이크 & 치즈'), order('m3', '풀드포크 바비큐')];
    const g = tasteGraph(orders, [rec({ target: { type: 'main', id: '닭고기' } }), rec({ target: { type: 'main', id: '돼지고기' }, sign: -1, scope: 'TODAY', valid_until: '2026-10-22T19:00:00.000Z' })], [], [], now);
    const likes = group(g, 'likes').bars;
    expect(likes.find((b) => b.label === '닭고기')).toEqual({ label: '닭고기', n: 0, from: 'said', scope: 'LASTING' });
    expect(likes.some((b) => b.label === '돼지고기')).toBe(false);
    expect(group(g, 'dislikes').bars).toEqual([{ label: '돼지고기', n: 0, from: 'said', scope: 'TODAY' }]);
  });

  it('지난 오늘 상태는 안 그림, 지운 것(suppressed)도 안 그림, 알레르기는 그대로', () => {
    const old = rec({ target: { type: 'main', id: '새우' }, sign: -1, scope: 'TODAY', valid_until: '2026-10-21T19:00:00.000Z' });
    const orders = [order('m1', '스테이크 & 치즈', { sauces: ['sauce:랜치'] }), order('m1', '스테이크 & 치즈', { sauces: ['sauce:랜치'] })];
    const g = tasteGraph(orders, [old], ['menu:m1', 'sauce:sauce:랜치'], ['우유', '우유', '대두'], now);
    expect(group(g, 'dislikes').bars).toEqual([]);
    expect(group(g, 'menus').bars).toEqual([]);
    expect(group(g, 'sauces').bars).toEqual([]);
    expect(group(g, 'allergies').bars.map((b) => b.label)).toEqual(['우유', '대두']);
  });
});

describe('말 기록 (10/22)', () => {
  beforeEach(() => clearAll());
  const entry = (n: number): TalkLogEntry => ({ at: new Date(Date.UTC(2026, 9, 22, 3, n)).toISOString(), text: `말 ${n}`, via: n % 2 ? 'voice' : 'text', understood: ['매운 것 넣기'], by: 'RULES' });

  it('"취향 기억하기"를 안 켰으면 저장 안 함', () => {
    expect(addTalkLog(entry(1))).toBe(false);
    expect(talkLog()).toEqual([]);
  });

  it('켜면 최근 30개, 새것이 위, 지우기·동의 끄면 지워짐', () => {
    setConsent('taste', true);
    for (let i = 1; i <= MAX_TALK_LOG + 3; i++) addTalkLog(entry(i));
    expect(talkLog()).toHaveLength(MAX_TALK_LOG);
    expect(talkLog()[0]!.text).toBe(`말 ${MAX_TALK_LOG + 3}`);
    expect(hasRecords()).toBe(true);
    clearTalkLog();
    expect(talkLog()).toEqual([]);
    addTalkLog(entry(1));
    setConsent('taste', false);
    setConsent('taste', true);
    expect(talkLog()).toEqual([]);
  });
});

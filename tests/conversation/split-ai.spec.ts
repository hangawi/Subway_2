import { describe, expect, it } from 'vitest';
import { aiSplit } from '../../src/conversation/split-ai.ts';

// 10/26 여러 개 주문 나누기: AI가 준 줄은 원래 문장에 있는 말일 때만, 2~5줄, 줄마다 1~10개
const fake = (output: unknown, code = 'SUCCESS') => ({ route: async () => ({ code, output }) }) as never;

describe('AI로 여러 개 나누기 (10/26)', () => {
  it('문장에 있는 말로 나누면 그대로', async () => {
    expect(await aiSplit(fake({ items: [{ text: '든든한 거', qty: 1 }, { text: '가벼운 거', qty: 2 }] }), '음 든든한 거 하나랑 가벼운 거 두 개 줘')).toEqual([{ text: '든든한 거', qty: 1 }, { text: '가벼운 거', qty: 2 }]);
  });
  it('지어낸 말·한 줄·이상한 개수·실패는 버림 (null)', async () => {
    expect(await aiSplit(fake({ items: [{ text: '로스트 치킨', qty: 1 }, { text: '가벼운 거', qty: 1 }] }), '든든한 거 하나 가벼운 거 하나')).toBeNull();
    expect(await aiSplit(fake({ items: [{ text: '든든한 거', qty: 1 }] }), '든든한 거 하나')).toBeNull();
    expect(await aiSplit(fake({ items: [{ text: '든든한 거', qty: 0 }, { text: '가벼운 거', qty: 1 }] }), '든든한 거 가벼운 거')).toBeNull();
    expect(await aiSplit(fake({ items: [{ text: '든든한 거', qty: 1 }, { text: '가벼운 거', qty: 1 }] }, 'FAILED'), '든든한 거 가벼운 거')).toBeNull();
    expect(await aiSplit(fake({ items: [] }), '로스트 치킨 하나')).toBeNull();
  });
  it('늦으면 기다리지 않음', async () => {
    const slow = { route: () => new Promise(() => undefined) } as never;
    expect(await aiSplit(slow, '든든한 거 가벼운 거', 30)).toBeNull();
  });
});

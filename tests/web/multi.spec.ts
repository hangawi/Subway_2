import { describe, expect, it } from 'vitest';
import { condPiece, listIsMulti, MAX_SLOTS, parseCount, splitEach, splitEdits, splitList } from '../../src/web/multi.ts';
import { selfCount } from '../../src/web/multi.ts';

// 8단계 여러 개 주문 (10/22·10/23 예형님): 말을 칸으로 나누기. 하나만 살 때는 전부 null (지금 흐름 그대로)
describe('여러 개 주문 말 나누기', () => {
  it('하나만 사는 말은 아무것도 안 나눔', () => {
    for (const t of [
      '강남역에서 로스트 치킨 먹을 건데 양파 빼고 피클 추가, 우유 알레르기',
      '참치 양파 오이 빼주세요 소스는 마요네즈랑 스위트어니언',
      '로스트 치킨에 콜라랑 초코칩 쿠키',
      '나 지금 배고픔 매운거 넣고 콜라는 제로콜라로 먹고 싶어 그리고 쇠고기 종류로 먹고싶은데 추천해줘바',
      '로스트 치킨이랑 이탈리안 비엠티 중에 뭐가 나아',
      '로스트 치킨, 아니 비엠티',
      '콜라 2개',
      '초코칩 쿠키 3개',
    ]) {
      expect(parseCount(t), t).toBeNull();
      expect(splitEach(t), t).toBeNull();
      expect(splitList(t), t).toBeNull();
    }
  });

  it('개수: "로스트 치킨 2개", "샌드위치 세 개"', () => {
    expect(parseCount('로스트 치킨 2개')).toBe(2);
    expect(parseCount('샌드위치 세 개 주세요')).toBe(3);
    expect(parseCount('에그마요 다섯개')).toBe(5);
    expect(parseCount('로스트 치킨 1개')).toBeNull();
  });

  it('칸마다 따로: "하나는 해장할 거, 하나는 가벼운 거"', () => {
    expect(splitEach('하나는 해장할 거, 하나는 가벼운 거')).toEqual(['해장할 거', '가벼운 거']);
    expect(splitEach('한 개는 로스트 치킨 다른 하나는 매운 거로 해줘')).toEqual(['로스트 치킨', '매운 거']);
    expect(splitEach('하나는 가볍게')).toBeNull();
  });

  it('짧은 이름 목록: "잠봉, 치킨, 스파이시" (10개까지, 10/27)', () => {
    expect(splitList('잠봉, 치킨, 스파이시')).toEqual(['잠봉', '치킨', '스파이시']);
    expect(splitList('잠봉이랑 로스트 치킨이랑 이탈리안 비엠티 주세요')).toEqual(['잠봉', '로스트 치킨', '이탈리안 비엠티']);
    expect(splitList('a, b, c, d, e, f, g, h, i, j, k, l')!.length).toBe(MAX_SLOTS);
  });

  it('담은 칸 고치기: "5개 전부 토마토 빼, 1번은 제로콜라, 2번은 콜라"', () => {
    expect(splitEdits('5개 전부 토마토 빼, 1번은 제로콜라, 2번은 콜라', 5)).toEqual({ all: '토마토 빼', byNo: { 1: '제로콜라', 2: '콜라' }, sameAll: false });
    expect(splitEdits('두 번째 거는 양파 빼줘', 3)).toEqual({ all: null, byNo: { 2: '양파 빼줘' }, sameAll: false });
    expect(splitEdits('다 같은 걸로', 3)).toMatchObject({ sameAll: true });
    expect(splitEdits('4번은 콜라', 3)).toBeNull(); // 없는 칸
    expect(splitEdits('양파 빼줘', 3)).toBeNull();
  });

  it('목록이 정말 여러 개인지: 메뉴 + 짧은 이름 낱말만 (꾸미는 말·음료·알레르기는 한 사람)', () => {
    expect(condPiece('치킨', { wantMains: ['닭고기'] })).toBe(true);
    expect(condPiece('스파이시', {})).toBe(true);
    expect(condPiece('매콤하게', { wantSpicy: true })).toBe(false);
    expect(condPiece('살 안 찌는 거', { goal: 'LIGHT' })).toBe(false);
    expect(listIsMulti([{ menu: true, singles: false, cond: false }, { menu: false, singles: false, cond: true }])).toBe(true);
    expect(listIsMulti([{ menu: true, singles: true, cond: false }, { menu: true, singles: true, cond: false }])).toBe(false);
    expect(listIsMulti([{ menu: false, singles: false, cond: true }, { menu: false, singles: false, cond: true }])).toBe(false);
  });
});

describe('사람 수·이름 (8단계 61·62-2)', () => {
  it('"3명이야" → 3, "한 명 더 와" → 하나 더, 한 사람 말은 null', async () => {
    const { parsePeople } = await import('../../src/web/multi.ts');
    expect(parsePeople('3명이야').people).toBe(3);
    expect(parsePeople('우리 네 명이서 먹을 거야').people).toBe(4);
    expect(parsePeople('한 명 더 와').moreOne).toBe(true);
    expect(parsePeople('일곱 명').people).toBeNull();
    expect(parsePeople('로스트 치킨 하나').people).toBeNull();
  });
  it('"민수는 매운 거 못 먹어, 지은이는 새우 알레르기", "민수 거 소스 빼 줘"', async () => {
    const { splitNames } = await import('../../src/web/multi.ts');
    expect(splitNames('민수는 매운 거 못 먹어, 지은이는 새우 알레르기')).toEqual([{ name: '민수', text: '매운 거 못 먹어' }, { name: '지은', text: '새우 알레르기' }]);
    expect(splitNames('민수 거 소스 빼 줘')).toEqual([{ name: '민수', text: '소스 빼 줘' }]);
    for (const t of ['나는 매운 거 좋아해', '소스는 랜치로', '하나는 해장할 거', '오늘은 가볍게', '토마토는 빼줘']) expect(splitNames(t), t).toBeNull();
  });
});

describe('개수로 나눈 말 (10/26 장바구니)', () => {
  it('"든든한 거 하나 가벼운 거 하나 매운 거 하나" 등', async () => {
    const { splitCounted } = await import('../../src/web/multi.ts');
    expect(splitCounted('든든한 거 하나 가벼운 거 하나 매운 거 하나')).toEqual([{ text: '든든한 거', qty: 1 }, { text: '가벼운 거', qty: 1 }, { text: '매운 거', qty: 1 }]);
    expect(splitCounted('든든한거 한개랑 가벼운거 한개')).toEqual([{ text: '든든한거', qty: 1 }, { text: '가벼운거', qty: 1 }]);
    expect(splitCounted('든든한 거 둘 가벼운 거 하나 주세요')).toEqual([{ text: '든든한 거', qty: 2 }, { text: '가벼운 거', qty: 1 }]);
    expect(splitCounted('이거 하나 저거 하나')).toEqual([{ text: '이거', qty: 1 }, { text: '저거', qty: 1 }]);
    expect(splitCounted('매운 거랑 안 매운 거 하나씩')).toEqual([{ text: '매운 거', qty: 1 }, { text: '안 매운 거', qty: 1 }]);
    expect(splitCounted('나는 두 개 민수는 하나')).toEqual([{ text: '나는', qty: 2 }, { text: '민수는', qty: 1 }]);
  });
  it('한 사람 말은 안 나눔', async () => {
    const { splitCounted } = await import('../../src/web/multi.ts');
    for (const t of ['로스트 치킨 하나', '콜라 하나', '로스트 치킨 하나 주세요 양파 빼고', '쿠키 하나만', '로스트 치킨이랑 비엠티 중에 뭐가 나아']) expect(splitCounted(t), t).toBeNull();
  });
});

describe('비교 질문은 고치기 아님 (10/26)', () => {
  it('"1번이랑 2번 뭐가 달라"', async () => {
    const { splitEdits } = await import('../../src/web/multi.ts');
    expect(splitEdits('1번이랑 2번 뭐가 달라', 3)).toBeNull();
    expect(splitEdits('1번이랑 2번 차이 알려줘', 3)).toBeNull();
    expect(splitEdits('1번은 콜라', 3)).not.toBeNull();
  });
});

describe('한 사람이 여러 개 (10/27)', () => {
  it('"나는 두 개 먹을 거야" → 2, 메뉴·다른 말이면 null', () => {
    expect(selfCount('나는 두 개 먹을 거야')).toBe(2);
    expect(selfCount('난 세 개 먹을래')).toBe(3);
    expect(selfCount('저는 2개요')).toBe(2);
    expect(selfCount('나는 두 개 민수는 하나')).toBeNull();
    expect(selfCount('나는 로스트 치킨 두 개')).toBeNull();
    expect(selfCount('두 개 주세요')).toBeNull();
  });
});

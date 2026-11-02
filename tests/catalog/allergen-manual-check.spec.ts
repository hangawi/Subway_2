import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 점검 3: 알레르기 표 두 번 읽기.
// 아래 줄은 사람이 공식 알레르기 표 이미지를 크게 확대해서 눈으로 옮겨 적은 것이다 (자동 판독과 따로).
// 19칸 순서: 난류 우유 메밀 땅콩 대두 밀 고등어 게 새우 돼지고기 복숭아 토마토 아황산류 호두 닭고기 쇠고기 오징어 조개류 잣
// o = ● 포함, * = ★ 포함 가능성, . = 없음
const MANUAL: Array<[string, string]> = [
  ['샌드위치/비엘티', '**..oo...o.o.......'],
  ['샌드위치/에그마요', 'o*..oo.....o.....*.'],
  ['샌드위치/쉬림프', '**..oo..o..o.......'],
  ['샌드위치/스테이크&치즈(아메리칸치즈포함)', '*o..oo.....o...o...'],
  ['샌드위치/스파이시 쉬림프', '*o..oo..o..o.......'],
  ['샌드위치/안창 비프&New 머쉬룸(S)', '*.**oo*****o***o***'],
  ['샌드위치/New 머쉬룸(S)', '*.**oo*****o***.***'],
  ['샌드위치/피자썹', 'oo**oo***o*o*******'],
  ['샌드위치/아기맹새우', 'oo**oo**o**oo******'],
  ['샌드위치/로스트 치킨 아보카도', '....oo.....o..oo...'],
  ['아침 메뉴 샌드위치/잠봉, 에그&치즈', 'oo**oo***o*********'],
  ['치즈/아메리칸 치즈', '.o..o..............'],
  ['샐러드/그린', '*o..**.....o.......'],
  ['샐러드/로티세리 치킨 타코', 'oo**oo*****o**o****'],
  ['샐러드/그레인 믹스', '****o**************'],
  ['랩, 그릴드 랩/쉬림프 에그마요 랩', 'oo..*o..o..o.......'],
  ['빵/통밀 랩', '.....o.............'],
  ['빵/그레인', '**..oo......*......'],
  ['야채/토마토', '...........o.......'],
  ['소스&드레싱/레드와인 식초', '............o......'],
  ['소스&드레싱/스모크 바비큐', '....oo.....oo....o.'],
  ['소스&드레싱/저칼로리 오리엔탈', '****oo*************'],
  ['미트류/에그마요', 'o*..**...........*.'],
  ['미트류/스파이시 쉬림프', '.o......o..........'],
  ['미트류/머쉬룸', '.*..**.....*...*.*.'],
  ['스마일 썹/머쉬룸 수프(M)', '.o...o...........o.'],
  ['스마일 썹/초코칩 쿠키', 'oo.*oo.......*.....'],
];

interface Row {
  section: string;
  name: string;
  contains: string[];
  mayContain: string[];
}
const doc = JSON.parse(readFileSync('data/official/allergens.json', 'utf8')) as { allergens: string[]; rows: Row[] };

describe('알레르기 표: 자동 판독 = 사람이 눈으로 읽은 값', () => {
  it.each(MANUAL)('%s', (key, pattern) => {
    const row = doc.rows.find((r) => `${r.section}/${r.name}` === key);
    expect(row, key).toBeDefined();
    const auto = doc.allergens
      .map((a) => (row!.contains.includes(a) ? 'o' : row!.mayContain.includes(a) ? '*' : '.'))
      .join('');
    expect(auto).toBe(pattern);
  });

  it('구역별 줄 수가 공식 표와 같다', () => {
    const count = (s: string) => doc.rows.filter((r) => r.section === s).length;
    expect(doc.rows).toHaveLength(136);
    expect(count('샌드위치')).toBe(33);
    expect(count('샐러드')).toBe(21);
    expect(count('빵')).toBe(8);
    expect(count('야채')).toBe(8);
    expect(count('소스&드레싱')).toBe(15);
    expect(count('미트류')).toBe(21);
  });
});

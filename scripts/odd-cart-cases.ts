// 예상 밖 장바구니 말 100문장 (10/26 예형님 "ChatGPT처럼 아무 말이나"): 규칙에 맞춰 만들지 않은 말투 10틀 × 10.
// 문장마다 시작 장바구니(cart)와 말한 뒤 있어야 할 줄(lines) — 적은 칸만 본다. 알레르기는 적지 않았으면 비어 있어야 함.
// ai-command-eval.ts(AI 비교)와 odd-cart-check(화면, 지금 규칙)가 같이 씀
import type { SubwayCatalog } from '../src/catalog/subway-catalog.ts';

export interface GoldLine {
  menu?: string | null;
  qty?: number;
  owner?: 'ME' | 'GUEST';
  name?: string;
  /** 이 줄 알레르기 (정확히 이것만). 적지 않으면 빈 목록이어야 함 */
  allergies?: string[];
  remove?: string[];
  /** 빼면 안 되는 야채 (다른 줄만 뺐을 때) */
  keep?: string[];
  bread?: string;
  size?: '15cm' | '30cm';
  noCheese?: boolean;
  /** 치즈를 빼면 안 됨 */
  hasCheese?: boolean;
  noSauce?: boolean;
  sauces?: string[];
}
export interface SeedLine {
  menu: string;
  qty?: number;
  owner?: 'ME' | 'GUEST';
  name?: string;
}
export interface OddCase {
  id: string;
  group: string;
  text: string;
  cart: SeedLine[];
  lines: GoldLine[];
}

const MENUS = ['로스트 치킨', '이탈리안 비엠티', '에그마요', '참치', '스테이크 & 치즈', '써브웨이 클럽', '치킨 데리야끼', '풀드포크 바비큐', '쉬림프', '비엘티'];
const BREADS = ['허니오트', '위트', '화이트', '파마산 오레가노', '플랫브레드'];
const VEGS = ['양파', '오이', '피클', '올리브', '할라피뇨', '토마토', '피망(파프리카)'];
const VEG_SAY: Record<string, string> = { '피망(파프리카)': '피망' };
const SAUCES = ['랜치', '스위트 어니언', '마요네즈', '스위트 칠리', '허니 머스터드', '스모크 바비큐'];
const NAMES = ['민수', '영희', '철수', '지우', '서희'];
// [말, 알레르기 이름]
const ALLERGY: Array<[string, string]> = [['땅콩', '땅콩'], ['복숭아', '복숭아'], ['호두', '호두'], ['메밀', '메밀'], ['오징어', '오징어'], ['잣', '잣'], ['게', '게'], ['새우', '새우']];

const hasBatchim = (w: string) => {
  const c = w.charCodeAt(w.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
};
const ro = (w: string) => (hasBatchim(w) && (w.charCodeAt(w.length - 1) - 0xac00) % 28 !== 8 ? `${w}으로` : `${w}로`);
const rang = (w: string) => (hasBatchim(w) ? `${w}이랑` : `${w}랑`);
const eun = (w: string) => (hasBatchim(w) ? `${w}은` : `${w}는`);
const say = (v: string) => VEG_SAY[v] ?? v;

export function makeOdd(catalog: SubwayCatalog): OddCase[] {
  const out: OddCase[] = [];
  const at = <T>(xs: readonly T[], i: number) => xs[i % xs.length]!;
  // 그 메뉴에 들어 있지 않은 알레르기 (메뉴가 걸려서 다른 메뉴로 바뀌는 건 이 시험에서 보지 않음)
  const freeAllergy = (menu: string, i: number): [string, string] => {
    const m = catalog.menus.find((x) => x.name === menu)!;
    const bad = new Set(m.allergens?.contains ?? []); // 비엠티·클럽은 "들어 있을 수 있음"이 거의 다라 들어 있는 것만 피함
    const ok = ALLERGY.filter(([, a]) => !bad.has(a));
    return at(ok, i);
  };
  const add = (group: string, text: string, cart: SeedLine[], lines: GoldLine[]) => out.push({ id: `${group}-${String(out.filter((c) => c.group === group).length + 1).padStart(2, '0')}`, group, text, cart, lines });
  for (let i = 0; i < 10; i++) {
    const m1 = at(MENUS, i), m2 = at(MENUS, i + 3), m3 = at(MENUS, i + 6);
    const b = at(BREADS, i), v = at(VEGS, i), s = at(SAUCES, i), nm = at(NAMES, i);
    const [aSay, a] = freeAllergy(m1, i);
    const [a2Say, a2] = freeAllergy(m2, i + 1);
    // 1) 빈 장바구니: 메뉴마다 다른 옵션
    add('메뉴마다옵션', at([
      `${m1} 하나는 ${b}빵으로, ${m2} 하나는 ${say(v)} 빼고`,
      `${m1} ${b}빵에 하나, ${m2}는 ${say(v)} 없이 하나`,
      `${m2} ${say(v)} 빼서 하나 ${m1} 빵 ${ro(b)} 하나`,
      `${rang(m1)} ${m2} 시킬게 앞에 건 ${b}빵 뒤에 건 ${say(v)} 빼고`,
      `${m1}(${b}빵) 하나랑 ${m2}(${say(v)} 빼고) 하나요`,
      `${m1}는 빵을 ${ro(b)} 해 주시고 ${m2}는 ${say(v)} 넣지 마세요`,
      `하나는 ${m1} ${b}, 다른 하나는 ${m2} ${say(v)} 노노`,
      `${m1} ${b}빵 / ${m2} ${say(v)} x`,
      `${m1} 1개 빵은 ${b}, ${m2} 1개 ${say(v)}만 빼고`,
      `음 ${m1} ${b}빵이랑 ${m2}에서 ${say(v)} 빼고 그렇게 두 개`,
    ], i), [], [{ menu: m1, qty: 1, bread: b }, { menu: m2, qty: 1, remove: [v] }]);
    // 2) 같은 메뉴 둘 중 하나만
    add('둘중하나만', at([
      `${m1} 두 개 시킬 건데 하나만 ${say(v)} 빼줘`,
      `${m1} 2개 중에 1개는 ${say(v)} 빼 주세요`,
      `${m1} 두 개, 근데 하나는 ${say(v)} 없이`,
      `${m1} 둘 하나는 그냥 하나는 ${say(v)} 빼고`,
      `${m1} 두 개 주는데 한 개만 ${say(v)} 넣지 마`,
      `${m1} 2개요 1개는 ${say(v)} 제외`,
      `${m1} 두 개 할 건데 한 개에만 ${say(v)} 빼줘`,
      `${m1} 하나는 기본으로 하나는 ${say(v)} 빼서`,
      `${m1} 두 개 하나는 ${say(v)} 빼고 나머진 그대로`,
      `${m1} 두개 한개만 ${say(v)}빼`,
    ], i), [], [{ menu: m1, qty: 1, remove: [v] }, { menu: m1, qty: 1, keep: [v] }]);
    // 3) 다른 사람 알레르기 + 나
    add('사람알레르기', at([
      `${eun(nm)} ${m1}에 ${aSay} 알레르기, 나는 ${m2}`,
      `${nm} 거는 ${m1}인데 ${aSay} 알레르기 있어 내 건 ${m2}`,
      `나 ${m2} 먹고 ${eun(nm)} ${m1} 먹는데 걔가 ${aSay} 못 먹어`,
      `${m1} 하나는 ${nm} 거고 ${aSay} 알레르기 있어요, 제 건 ${m2}요`,
      `${eun(nm)} ${aSay} 알레르기라 ${m1}, 난 ${m2}`,
      `내 거 ${m2}, ${nm} 거 ${m1} (${aSay} 알레르기)`,
      `${m2}는 제 거예요 ${m1}는 ${nm} 건데 ${aSay} 먹으면 안 돼요`,
      `${nm}한테 ${m1} 줄 건데 ${aSay} 알레르기가 있어 그리고 나는 ${m2}`,
      `${eun(nm)} ${m1} ${aSay} 알러지 있음 나는 ${m2}`,
      `저는 ${m2} 하나 ${nm}는 ${aSay} 알레르기 있어서 ${m1} 하나`,
    ], i), [], [{ menu: m1, owner: 'GUEST', name: nm, allergies: [a] }, { menu: m2, owner: 'ME' }]);
    // 4) 둘 다 + 하나만
    add('둘다하나만', at([
      `${rang(m1)} ${m2} 둘 다 30cm로, ${m1}만 치즈 빼`,
      `${m1} ${m2} 다 30센치로 하고 ${m1}는 치즈 빼줘`,
      `${m1}랑 ${m2} 둘 다 큰 걸로, 치즈는 ${m1}만 빼고`,
      `${m1}, ${m2} 둘 다 30cm 근데 ${m1}에 치즈 넣지 마`,
      `${m2}랑 ${m1} 둘 다 30센치요 ${m1}는 치즈 없이`,
      `${m1} 하나 ${m2} 하나 둘 다 30cm로 해주시고 ${m1}만 노치즈`,
      `${rang(m1)} ${m2} 전부 30센티 ${m1}는 치즈 빼`,
      `${m1}랑 ${m2} 30cm 두 개 ${m1} 쪽만 치즈 X`,
      `둘 다 30cm로 ${m1}랑 ${m2}, 치즈는 ${m1}에서만 빼줘`,
      `${m1}${m2} 30센치씩 ${m1}는 치즈뺴고`,
    ], i), [], [{ menu: m1, size: '30cm', noCheese: true }, { menu: m2, size: '30cm', hasCheese: true }]);
    // 5) 메뉴마다 소스
    add('메뉴마다소스', at([
      `${m1} 하나 ${s} 소스로 ${m2} 하나 소스 없이`,
      `${m1}는 ${s}만 뿌려 주시고 ${m2}는 소스 빼 주세요`,
      `${m2} 소스 없이 하나, ${m1} 소스는 ${s} 하나`,
      `${m1} ${s} 소스, ${m2} 노소스`,
      `${m1}에 소스는 ${ro(s)}, ${m2}엔 아무 소스도 넣지 마`,
      `${m1} 하나랑 ${m2} 하나 앞에 건 ${s} 뒤에 건 소스 없이`,
      `${m1} ${s} 소스로 1개 ${m2} 소스 빼고 1개`,
      `${m2}는 소스 안 넣고 ${m1}는 ${s}로 해줘`,
      `${m1} 소스 ${s}만, ${m2} 소스 X`,
      `${m1}(${s}) ${m2}(소스 없음)`,
    ], i), [], [{ menu: m1, sauces: [s] }, { menu: m2, noSauce: true }]);
    // 6) 담은 두 줄을 따로 고치기
    const cart2: SeedLine[] = [{ menu: m1 }, { menu: m2 }];
    add('줄마다고치기', at([
      `1번 빵은 ${ro(b)} 바꾸고 2번은 ${a2Say} 알레르기 있어`,
      `첫 번째 거 빵 ${b}, 두 번째 거 먹는 사람 ${a2Say} 알레르기야`,
      `1번 ${b}빵으로 해 주고 2번 먹을 사람이 ${a2Say} 못 먹어`,
      `위에 거는 ${b}빵 아래 거는 ${a2Say} 알레르기 있는 사람 거`,
      `1번은 빵만 ${ro(b)}, 2번 거는 ${a2Say} 알러지`,
      `${m1} 빵 ${ro(b)} 바꾸고 ${m2} 먹는 친구 ${a2Say} 알레르기 있어`,
      `1번 ${b}로 변경 2번 ${a2Say} 알레르기 체크해줘`,
      `첫째 ${b}빵 둘째 ${a2Say} 먹으면 안 돼`,
      `1번 빵 바꿔줘 ${ro(b)}, 그리고 2번은 ${a2Say} 알레르기 있는 사람이 먹어`,
      `${m1}는 ${b}빵으로 하고 ${m2}는 ${a2Say} 알레르기 있는 애 거야`,
    ], i), cart2, [{ menu: m1, bread: b, allergies: [] }, { menu: m2, allergies: [a2] }]);
    // 7) 담은 것 전부 고치기
    add('전부고치기', at([
      `둘 다 ${say(v)} 빼고 30cm로`,
      `전부 ${say(v)} 빼 주시고 30센치로 바꿔 주세요`,
      `두 개 다 ${say(v)} 없이 큰 사이즈로`,
      `다 ${say(v)} 빼고 30cm`,
      `${say(v)}는 전부 빼고 둘 다 30센치요`,
      `모두 30cm로 하고 ${say(v)} 빼줘`,
      `두 개 전부 ${say(v)} X 30cm`,
      `둘 다 30센티로 바꾸고 ${say(v)} 넣지 마`,
      `담은 거 전부 ${say(v)} 빼고 사이즈 30`,
      `둘다 ${say(v)}빼고 30센치`,
    ], i), cart2, [{ menu: m1, remove: [v], size: '30cm' }, { menu: m2, remove: [v], size: '30cm' }]);
    // 8) 하나 더
    add('하나더', at([
      '첫 번째 거 하나 더', '1번 하나 더 추가해줘', '맨 위에 거 하나 더 줘', '1번 거 한 개 더', '첫 번째 메뉴 하나 더 담아줘',
      `${m1} 하나 더`, '1번 두 개로 해줘', '첫째 거 개수 2개로', '위에 거 하나만 더요', '1번 +1',
    ], i), cart2, [{ menu: m1, qty: 2 }, { menu: m2, qty: 1 }]);
    // 9) 빼기
    const cart3: SeedLine[] = [{ menu: m1 }, { menu: m2 }, { menu: m3 }];
    add('빼기', at([
      '두 번째는 빼줘', '2번 삭제', '2번 거 취소할게', `${m2}는 빼 주세요`, '가운데 거 빼줘',
      '두 번째 메뉴 지워줘', '2번은 안 먹을래', `${m2} 취소`, '2번 거 없애줘', '두번째꺼 빼',
    ], i), cart3, [{ menu: m1 }, { menu: m3 }]);
    // 10) 메뉴 바꾸기
    add('메뉴바꾸기', at([
      `2번 ${ro(m3)} 바꿔줘`, `두 번째 거 ${ro(m3)} 변경`, `2번은 ${m2} 말고 ${ro(m3)} 할래`, `${m2} 대신 ${m3}`, `아래 거 ${ro(m3)} 바꿔 주세요`,
      `2번 메뉴를 ${ro(m3)}`, `두 번째는 ${m3}가 좋겠다 바꿔줘`, `${m2} 빼고 그 자리에 ${m3}`, `2번 ${m3}로 교체`, `두번째꺼 ${m3}로`,
    ], i), cart2, [{ menu: m1 }, { menu: m3 }]);
  }
  return out;
}

/** 말한 뒤 줄(이름 모양)이 정답과 맞는지 — 틀린 것 목록. 줄 순서는 상관없이 짝지음 */
export interface GotLine {
  menu: string | null;
  qty: number;
  owner: 'ME' | 'GUEST';
  name?: string;
  allergies: string[];
  remove: string[];
  bread?: string;
  size?: string;
  cheese?: string | null;
  sauces?: string[];
}
export function judgeLines(gold: GoldLine[], got: GotLine[]): { bad: string[]; allergyMistake: boolean } {
  const bad: string[] = [];
  let allergyMistake = false;
  if (got.length !== gold.length) bad.push(`줄 ${got.length}개 / 기대 ${gold.length}개`);
  const fit = (g: GoldLine, l: GotLine): string[] => {
    const e: string[] = [];
    if (g.menu !== undefined && l.menu !== g.menu) e.push(`메뉴 ${l.menu}`);
    if (g.qty !== undefined && l.qty !== g.qty) e.push(`개수 ${l.qty}`);
    if (g.owner && l.owner !== g.owner) e.push(`누구 ${l.owner}`);
    if (g.name && l.name !== g.name) e.push(`이름 ${l.name ?? '-'}`);
    const want = [...(g.allergies ?? [])].sort().join(',');
    if (want !== [...l.allergies].sort().join(',')) e.push(`알레르기 [${l.allergies.join(',')}]`);
    if (g.remove && !g.remove.every((v) => l.remove.includes(v))) e.push(`빼기 [${l.remove.join(',')}]`);
    if (g.keep && g.keep.some((v) => l.remove.includes(v))) e.push(`빼면 안 되는 걸 뺌`);
    if (g.bread && l.bread !== g.bread) e.push(`빵 ${l.bread ?? '-'}`);
    if (g.size && (l.size ?? '15cm') !== g.size) e.push(`크기 ${l.size ?? '15cm'}`);
    if (g.noCheese && l.cheese !== null) e.push(`치즈 ${l.cheese ?? '기본'}`);
    if (g.hasCheese && l.cheese === null) e.push(`치즈를 뺌`);
    if (g.noSauce && !(Array.isArray(l.sauces) && l.sauces.length === 0)) e.push(`소스 ${JSON.stringify(l.sauces ?? '기본')}`);
    if (g.sauces && !(l.sauces && g.sauces.every((s) => l.sauces!.includes(s)))) e.push(`소스 ${JSON.stringify(l.sauces ?? '기본')}`);
    return e;
  };
  const used = new Set<number>();
  for (const g of gold) {
    let best = -1;
    let bestErr: string[] | null = null;
    got.forEach((l, i) => {
      if (used.has(i)) return;
      const e = fit(g, l);
      if (!bestErr || e.length < bestErr.length) (best = i), (bestErr = e);
    });
    if (best < 0) continue;
    used.add(best);
    if (bestErr!.length) bad.push(`${g.menu ?? '?'}: ${bestErr!.join(' · ')}`);
    if (bestErr!.some((x) => x.startsWith('알레르기'))) allergyMistake = true;
  }
  // 정답에 없는 줄에 알레르기가 붙었으면 그것도 알레르기 실수
  got.forEach((l, i) => !used.has(i) && l.allergies.length && (allergyMistake = true));
  return { bad, allergyMistake };
}

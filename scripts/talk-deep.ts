// 문장마다 깊게 보기 (10/20 2차, 예형님 요청): 알아들은 값만이 아니라 그 결과물까지
//  1 주문서가 거절 없이 만들어짐  2 말한 알레르기 성분이 주문서(메뉴·세트 구성품·단품)에 없음 (있으면 안내가 있어야)
//  3 금액 = 공식 가격표(data/official/prices.json) 메뉴 + 세트 + 토핑 + 단품  4 매장에 넘기는 글이 주문서와 같음
//  5 메뉴를 안 골랐으면 추천 Top3가 조건(알레르기·예산·메인 재료·종류·안 맵게)과 시간(아침 메뉴)을 지킴
import { readFileSync } from 'node:fs';
import type { CatalogMenu, SubwayCatalog } from '../src/catalog/subway-catalog.ts';
import { avoidAllergens } from '../src/order-sheet/composition.ts';
import { orderText } from '../src/order-sheet/handoff.ts';
import { buildOrderSheet, buildSinglesSheet, SINGLES_ID, type OrderChoices } from '../src/order-sheet/order-sheet.ts';
import { isSpicyMenu, mainKindsOf, type MainKind } from '../src/subway-menu/menu-domain.ts';
import type { Want } from './talk-cases.ts';

const PRICES = JSON.parse(readFileSync('data/official/prices.json', 'utf8')) as {
  menus: Array<{ name: string; price15cm: number | null; price30cm: number | null; priceOne: number | null; category: string }>;
  sets: Array<{ name: string; addPrice: number }>;
};
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export interface DeepInput {
  want: Want;
  top?: 'BREAKFAST' | 'NO_BREAKFAST' | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r: any;
  /** 주문서에 쓸 메뉴 (사용자가 고른 것 — 없으면 null) */
  menuId: string | null;
  choices: OrderChoices | null;
  /** 메뉴를 안 골랐을 때 추천 결과 (규칙만 시험에서만) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec?: any | undefined;
  /** 메뉴를 사용자가 안 고르고 시험용 메뉴로 채웠을 때 — 메뉴 알레르기는 안 봄 */
  skipMenuAllergy?: boolean;
}

export function deepCheck(catalog: SubwayCatalog, x: DeepInput): string[] {
  const bad: string[] = [];
  const allergies: string[] = x.r.prefs?.allergies ?? [];
  const refusals: string = (x.r.refusals ?? []).join(' ');
  const expectProblem = !!x.want.refuse || !!x.want.question || !!x.r.question;
  const byName = (n: string) => catalog.menus.find((m) => m.name === n);
  if (x.menuId && x.choices) {
    const menu = catalog.menus.find((m) => m.id === x.menuId);
    // 화면처럼: 메뉴를 고르면 알레르기 재료(메인 재료가 아닌 야채·빵)를 자동으로 빼고 바꾼다 (app.ts refreshSheet → allergyAvoid)
    let choices = x.choices;
    let blocked: string[] = [];
    if (menu && allergies.length) {
      const av = avoidAllergens(menu, catalog, allergies, choices);
      blocked = av.blocked;
      if (!blocked.length) choices = { ...choices, removeVegetables: [...new Set([...(choices.removeVegetables ?? []), ...av.removeVegetables])], ...(av.bread && !choices.bread ? { bread: av.bread } : {}), addVegetables: (choices.addVegetables ?? []).filter((v) => !av.removeVegetables.includes(v)) };
    }
    if (blocked.length && !x.skipMenuAllergy && !refusals.includes('다른 메뉴')) bad.push(`알레르기 위험: ${menu!.name}에 ${blocked.join('·')} — 뺄 수 없는데 안내 없음`);
    const res = x.menuId === SINGLES_ID ? buildSinglesSheet(choices, catalog) : menu ? buildOrderSheet(menu, choices, catalog) : null;
    if (!res) bad.push(`메뉴 없음 ${x.menuId}`);
    else if (!res.ok) {
      if (!expectProblem) bad.push(`주문서 거절: ${res.errors.join(',')}`);
    } else {
      const s = res.sheet;
      // 2 알레르기: 메뉴(바꾼 재료 포함) + 세트 구성품 + 단품
      const parts: Array<[string, readonly string[]]> = x.skipMenuAllergy || blocked.length ? [] : [[s.menu.name, s.allergens.contains]];
      if (s.setItem) {
        const it = byName(s.setItem) ?? catalog.menus.find((m) => m.name === `${s.setItem}`);
        const single = catalog.singles?.find((y) => y.name === s.setItem || y.name === `${s.setItem} 쿠키`);
        // 오늘의 수프 = 그날 수프 (세 수프 중 하나) → 셋의 성분을 합쳐서 봄
        const soups = s.setItem === '오늘의 수프' ? catalog.menus.filter((m) => ['포테이토 베이컨 수프', '콘 수프', '머쉬룸 수프'].includes(m.name)).flatMap((m) => m.allergens.contains) : null;
        parts.push([s.setItem, soups ?? it?.allergens.contains ?? single?.allergens.contains ?? []]);
      }
      for (const e of s.extras ?? []) parts.push([e.name, catalog.singles?.find((y) => y.id === e.id)?.allergens.contains ?? []]);
      for (const [what, contains] of parts) {
        const hit = allergies.filter((a) => contains.includes(a));
        if (hit.length && !refusals.includes(hit[0]!) && !refusals.includes('알레르기')) bad.push(`알레르기 위험: ${what}에 ${hit.join('·')} (안내 없음)`);
      }
      // 3 금액
      if (s.menu.id !== SINGLES_ID) {
        const p = PRICES.menus.find((m) => m.name === s.menu.name);
        const base = p ? (s.size === '30cm' ? p.price30cm : (p.price15cm ?? p.priceOne)) : null;
        if (base != null && !s.price.needsCheck.length) {
          let want = base + (s.set ? (PRICES.sets.find((y) => y.name === s.set)?.addPrice ?? NaN) : 0);
          for (const t of s.toppings) {
            const tp = catalog.toppings.find((y) => y.name === t)?.price;
            want += (s.size === '30cm' ? tp?.price30cm : tp?.price15cm) ?? NaN;
          }
          for (const e of s.extras ?? []) want += e.won;
          if (Number.isFinite(want) && want !== s.price.total) bad.push(`금액: 공식 ${won(want)} / 주문서 ${won(s.price.total)}`);
        }
      }
      // 4 매장에 넘기는 글
      const t = orderText(s, null, allergies);
      const must = [
        ...(s.menu.id === SINGLES_ID ? [] : [`${s.menu.name} ${s.size}`]),
        ...s.vegetables.removed, ...s.vegetables.added, ...s.sauces, ...s.toppings,
        ...(s.set ? [s.set] : []), ...(s.setItem ? [s.setItem] : []), ...(s.drink ? [s.drink] : []),
        ...(s.extras ?? []).map((e) => e.name), won(s.price.total), ...allergies,
      ];
      const miss = must.filter((m) => !t.includes(m));
      if (miss.length) bad.push(`매장 글에 없음: ${miss.join(', ')}`);
    }
  }
  // 5 추천 Top3
  if (x.rec) {
    const top: CatalogMenu[] = (x.rec.menus?.top ?? []).map((y: { name: string }) => byName(y.name)).filter(Boolean);
    const pr = x.r.prefs ?? {};
    const names = top.map((m) => m.name).join(', ');
    for (const m of top) {
      // 야채·빵에서 오는 알레르기는 빼고 바꾸면 되니 괜찮음 — 뺄 수 없는 것(메인 재료·소스 고정 메뉴)만 문제
      const hit = allergies.length ? avoidAllergens(m, catalog, allergies).blocked : [];
      if (hit.length) bad.push(`추천에 알레르기 메뉴: ${m.name}(${hit.join('·')})`);
      if (pr.budgetKrw != null && (m.price.price15cm ?? 0) > pr.budgetKrw) bad.push(`추천이 예산 넘음: ${m.name}`);
      if (pr.wantMains?.length && !mainKindsOf(m).some((k: MainKind) => pr.wantMains.includes(k))) bad.push(`추천이 메인 재료 안 맞음: ${m.name}`);
      if (pr.avoidMains?.length && mainKindsOf(m).some((k: MainKind) => pr.avoidMains.includes(k))) bad.push(`추천에 뺀 재료: ${m.name}`);
      if (pr.kinds?.length && !pr.kinds.includes(m.kind)) bad.push(`추천 종류 안 맞음: ${m.name}`);
      if (pr.avoidSpicy && isSpicyMenu(m)) bad.push(`추천에 매운 메뉴: ${m.name}`);
    }
    // 가볍게인데 "든든한 편이에요" (10/21 예형님 화면)
    if (pr.goal === 'LIGHT') for (const y of x.rec.menus?.top ?? []) if ((y.why ?? []).includes('든든한 편이에요')) bad.push(`가볍게인데 "든든한 편이에요": ${y.name}`);
    if (x.top === 'BREAKFAST' && !top.some((m) => m.kind.startsWith('MORNING'))) bad.push(`아침인데 Top3에 아침 메뉴 없음: ${names}`);
    if (x.top === 'NO_BREAKFAST' && top.some((m) => m.kind.startsWith('MORNING'))) bad.push(`11시 지났는데 아침 메뉴: ${names}`);
    // 조건에 맞는 메뉴가 정말 없으면(알레르기·예산·재료가 겹침) 없다고 하는 게 맞음
    const hard = !!(allergies.length || pr.budgetKrw != null || pr.wantMains?.length || pr.kinds?.length || pr.maxSodiumMg != null || pr.maxEnergyKcal != null);
    if (!top.length && !expectProblem && !x.want.refuse && !(hard && x.rec.menus?.status === 'NO_FEASIBLE_CANDIDATE')) bad.push(`추천 없음 (${x.rec.menus?.status ?? x.rec.error ?? ''})`);
  }
  return bad;
}

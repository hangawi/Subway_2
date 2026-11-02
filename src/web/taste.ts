// 내 취향 계산 (10/16, 로드맵 42~46번). 휴대폰 안에서만 — 서버에는 계산한 점수(-1 ~ 1)만 보낸다.
//  - 평소 취향 LASTING: 유효기간 없음. 주문 기록에서(자주 고른 메뉴·메인 재료·늘 뺀 야채 등) + 말로("평소에 소고기 좋아해")
//  - 오늘 상태 TODAY: 유효기간 있음. SOPHIA state/emotion/time-dynamics.ts의 validity.day_end@1과 같은 규칙
//    ("오늘 ~" = 말한 날 다음 날 새벽 4시(서울)까지). 지난 것은 쓰지 않는다
//  - 같은 대상이면 오늘이 이긴다 (예: 평소 소고기 +, 오늘 소고기 피함 → 오늘은 −)
//  - 기록마다 account_id: null — 8단계(10/20~)에 SOPHIA 공통 상태와 주고받을 칸
import { mainKindsOf, type MainKind, type Taste } from '../subway-menu/menu-domain.ts';
import type { CatalogMenu } from '../catalog/subway-catalog.ts';

export const DAY_END_POLICY = 'validity.day_end@1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DAY_ENDS_AT_HOUR = 4;

/** SOPHIA validUntil과 같은 계산: 말한 서울 날짜(새벽 4시 기준)의 다음 날 새벽 4시 */
export function dayEndValidUntil(at: Date): string {
  const t = at.getTime();
  const shifted = t + 9 * HOUR - DAY_ENDS_AT_HOUR * HOUR;
  const dayStart = Math.floor(shifted / DAY) * DAY - 9 * HOUR + DAY_ENDS_AT_HOUR * HOUR;
  return new Date(dayStart + DAY).toISOString();
}

export interface TasteRecord {
  id: string;
  scope: 'LASTING' | 'TODAY';
  /** 메인 재료 취향 또는 오늘 상태(피곤함) */
  target: { type: 'main'; id: MainKind } | { type: 'mood'; id: 'TIRED' };
  sign: 1 | -1;
  at: string;
  /** TODAY만 (LASTING은 null = 지울 때까지) */
  valid_until: string | null;
  policy: string | null;
  account_id: null;
}

export interface OrderLike {
  menuId: string;
  menuName: string;
  choices: Record<string, unknown>;
}

const live = (r: TasteRecord, now: Date) => r.valid_until === null || Date.parse(r.valid_until) > now.getTime();

/** 주문 기록에서 배운 것 */
export function habitsOf(orders: readonly OrderLike[]) {
  const count = <K extends string>(keys: K[]) => keys.reduce<Record<string, number>>((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {});
  const menus = count(orders.map((o) => o.menuId));
  const mains = count(orders.flatMap((o) => mainKindsOf({ name: o.menuName } as CatalogMenu)));
  const list = (k: string) => orders.flatMap((o) => (Array.isArray(o.choices[k]) ? (o.choices[k] as string[]) : []));
  const removed = count(list('removeVegetables'));
  const added = count(list('addVegetables'));
  const sauces = count(list('sauces'));
  const breads = count(orders.map((o) => (typeof o.choices.bread === 'string' ? o.choices.bread : '')).filter(Boolean));
  // "늘" = 2번 넘게 + 절반 넘게
  const usual = (c: Record<string, number>) => Object.entries(c).filter(([, n]) => n >= 2 && n * 2 >= orders.length).map(([k]) => k);
  return { menus, mains, removeVegetables: usual(removed), addVegetables: usual(added), sauces: usual(sauces).slice(0, 3), bread: usual(breads)[0] ?? null, orders: orders.length };
}

export interface TasteItem {
  key: string;
  text: string;
  /** 주문 기록에서 배운 것인지 (지우면 다시 안 배움), 말로 한 것인지 */
  from: 'orders' | 'record';
  recordId?: string;
}

/** 엔진에 보낼 취향 점수 + 화면에 보일 목록. suppressed: 사용자가 지운 "주문 기록에서 배운 것" */
export function buildTaste(orders: readonly OrderLike[], records: readonly TasteRecord[], suppressed: readonly string[], now = new Date()): { taste: Taste; items: TasteItem[]; tired: TasteRecord | null } {
  const h = habitsOf(orders);
  const hidden = new Set(suppressed);
  const items: TasteItem[] = [];
  const menus: Record<string, number> = {};
  const mains: Partial<Record<MainKind, number>> = {};
  const mainsFrom: Partial<Record<MainKind, 'LASTING' | 'TODAY'>> = {};
  const nameOf = new Map(orders.map((o) => [o.menuId, o.menuName]));
  // 자주 고른 메뉴: 2번부터, 3번이면 최대
  for (const [id, n] of Object.entries(h.menus)) {
    if (n < 2 || hidden.has(`menu:${id}`)) continue;
    menus[id] = Math.min(1, n / 3);
    items.push({ key: `menu:${id}`, text: `자주 고른 메뉴: ${nameOf.get(id) ?? id} (${n}번)`, from: 'orders' });
  }
  // 주문 기록 절반 넘게 같은 메인 재료 (3번 넘게 주문했을 때)
  if (h.orders >= 3)
    for (const [k, n] of Object.entries(h.mains) as Array<[MainKind, number]>) {
      if (n * 2 < h.orders || hidden.has(`main:${k}`)) continue;
      mains[k] = 0.5;
      mainsFrom[k] = 'LASTING';
      items.push({ key: `main:${k}`, text: `자주 먹는 ${k} 메뉴 (주문 ${h.orders}번 중 ${n}번)`, from: 'orders' });
    }
  // 말로 한 것: 평소 먼저, 오늘이 덮음
  const alive = records.filter((r) => live(r, now));
  for (const scope of ['LASTING', 'TODAY'] as const)
    for (const r of alive.filter((x) => x.scope === scope && x.target.type === 'main')) {
      const k = r.target.id as MainKind;
      mains[k] = r.sign;
      mainsFrom[k] = scope;
    }
  for (const r of alive) {
    const until = r.valid_until ? ` (${new Date(r.valid_until).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric' })}까지)` : '';
    const text = r.target.type === 'mood' ? `오늘 피곤함 → 든든한 쪽${until}` : `${r.scope === 'TODAY' ? '오늘은' : '평소'} ${r.target.id} ${r.sign > 0 ? '좋아함' : '피함'}${until}`;
    items.push({ key: `record:${r.id}`, text, from: 'record', recordId: r.id });
  }
  for (const v of h.removeVegetables) if (!hidden.has(`remove:${v}`)) items.push({ key: `remove:${v}`, text: `늘 ${v.replace('vegetable:', '')} 빼기`, from: 'orders' });
  for (const v of h.addVegetables) if (!hidden.has(`add:${v}`)) items.push({ key: `add:${v}`, text: `늘 ${v.replace('vegetable:', '')} 더`, from: 'orders' });
  // 10/21: 늘 고르는 소스·빵도 보여 주고 지울 수 있게 (전엔 배우기만 하고 목록에 없었음)
  const sauces = h.sauces.filter((x) => !sauceHidden(x, suppressed));
  if (sauces.length) items.push({ key: `sauce:${sauces.join(',')}`, text: `늘 고르는 소스: ${sauces.map((x) => x.replace(/^sauce:/, '')).join('·')}`, from: 'orders' });
  if (h.bread && !hidden.has(`bread:${h.bread}`)) items.push({ key: `bread:${h.bread}`, text: `늘 고르는 빵: ${h.bread.replace(/^bread:/, '')}`, from: 'orders' });
  const tired = alive.find((r) => r.target.type === 'mood' && r.target.id === 'TIRED') ?? null;
  const taste: Taste = {};
  if (Object.keys(menus).length) taste.menus = menus;
  if (Object.keys(mains).length) (taste.mains = mains), (taste.mainsFrom = mainsFrom);
  return { taste, items, tired };
}

/** 지운 "늘 고르는 소스" (목록 한 줄 = 소스 여러 개, 키 sauce:<id,id>) */
const sauceHidden = (x: string, suppressed: readonly string[]) => suppressed.some((k) => k === `sauce:${x}` || (k.startsWith('sauce:') && k.slice(6).split(',').includes(x)));

/** "평소처럼" 옵션 (늘 뺀 야채·늘 더한 야채·늘 고른 소스·빵) — 지운 것은 빼고 */
export function usualChoices(orders: readonly OrderLike[], suppressed: readonly string[]) {
  const h = habitsOf(orders);
  const hidden = new Set(suppressed);
  return {
    removeVegetables: h.removeVegetables.filter((v) => !hidden.has(`remove:${v}`)),
    addVegetables: h.addVegetables.filter((v) => !hidden.has(`add:${v}`)),
    sauces: h.sauces.filter((x) => !sauceHidden(x, suppressed)),
    bread: h.bread && !hidden.has(`bread:${h.bread}`) ? h.bread : null,
  };
}

// ── 취향 그래프 (10/22 예형님: 아래 [취향 그래프] 탭) ── 주문 기록·말한 취향·알레르기를 묶음별 막대로
export interface GraphBar {
  label: string;
  /** 주문에서 센 횟수 (말로만 한 것은 0) */
  n: number;
  /** 어디서 왔는지: 주문 기록 / 말로 함 / 저장한 알레르기 */
  from: 'orders' | 'said' | 'saved';
  /** 말로 한 것: 평소 / 오늘 */
  scope?: 'LASTING' | 'TODAY';
}
export interface GraphGroup {
  key: 'menus' | 'likes' | 'dislikes' | 'sauces' | 'removed' | 'allergies';
  title: string;
  bars: GraphBar[];
}
const strip = (id: string) => id.replace(/^[a-z]+:/, '');

export function tasteGraph(orders: readonly OrderLike[], records: readonly TasteRecord[], suppressed: readonly string[], allergies: readonly string[], now = new Date()): GraphGroup[] {
  const h = habitsOf(orders);
  const hidden = new Set(suppressed);
  const nameOf = new Map(orders.map((o) => [o.menuId, o.menuName]));
  const sorted = (bars: GraphBar[]) => bars.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'ko')).slice(0, 6);
  const count = (key: string) => {
    const c: Record<string, number> = {};
    for (const o of orders) for (const x of Array.isArray(o.choices[key]) ? (o.choices[key] as string[]) : []) c[x] = (c[x] ?? 0) + 1;
    return c;
  };
  const alive = records.filter((r) => live(r, now) && r.target.type === 'main');
  // 좋아하는 재료: 주문한 메뉴의 메인 재료 + 말로 "좋아해"
  const likes = new Map<string, GraphBar>();
  for (const [k, n] of Object.entries(h.mains)) if (!hidden.has(`main:${k}`)) likes.set(k, { label: k, n, from: 'orders' });
  for (const r of alive.filter((x) => x.sign > 0)) {
    const k = r.target.id;
    const was = likes.get(k);
    likes.set(k, { label: k, n: was?.n ?? 0, from: 'said', scope: r.scope });
  }
  // 싫어하는 것: 말로 "피해·싫어" (오늘만이면 오늘), 좋아함과 겹치면 싫어함이 이김
  const dislikes = alive.filter((x) => x.sign < 0).map((r): GraphBar => ({ label: r.target.id, n: 0, from: 'said', scope: r.scope }));
  for (const d of dislikes) likes.delete(d.label);
  const sauceCount = count('sauces');
  const removedCount = count('removeVegetables');
  return [
    { key: 'menus', title: '주로 먹는 메뉴', bars: sorted(Object.entries(h.menus).filter(([id]) => !hidden.has(`menu:${id}`)).map(([id, n]) => ({ label: nameOf.get(id) ?? id, n, from: 'orders' as const }))) },
    { key: 'likes', title: '좋아하는 재료', bars: sorted([...likes.values()]) },
    { key: 'dislikes', title: '싫어하는 것', bars: dislikes },
    { key: 'sauces', title: '좋아하는 소스', bars: sorted(Object.entries(sauceCount).filter(([x]) => !sauceHidden(x, suppressed)).map(([x, n]) => ({ label: strip(x), n, from: 'orders' as const }))) },
    { key: 'removed', title: '자주 빼는 야채', bars: sorted(Object.entries(removedCount).filter(([x]) => !hidden.has(`remove:${x}`)).map(([x, n]) => ({ label: strip(x), n, from: 'orders' as const }))) },
    { key: 'allergies', title: '알레르기', bars: [...new Set(allergies)].map((a) => ({ label: a, n: 0, from: 'saved' as const })) },
  ];
}

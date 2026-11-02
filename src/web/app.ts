// 써브웨이 추천 화면. 판단은 서버(김민지 엔진)가 하고, 이 파일은 보여 주기·입력 받기만 한다.
// 글자는 모두 textContent 로 넣는다 (서버·사용자 글이 HTML로 실행되지 않게).
// 키는 화면에 없다 (지도·AI는 서버가 부름).
// 기록(주문·알레르기·동의)은 휴대폰에만 둔다 (local-store.ts). 서버로 보내는 건 지금 고른 조건뿐.
import { cheeseText, kakaoRouteLink, orderText, telLink } from '../order-sheet/handoff.ts';
import type { OrderSheet } from '../order-sheet/order-sheet.ts';
import { allergyMark, markLabel, sheetWarning, type AllergenInfo, type AllergyMark } from './allergy-marks.ts';
import { installView, isStandalone } from './install-banner.ts';
import { isKakaoInApp, openInChrome, stayInKakao, staysInKakao } from './kakao-handoff.ts';
import * as store from './local-store.ts';
import { buildTaste, dayEndValidUntil, DAY_END_POLICY, tasteGraph, usualChoices, type GraphGroup, type TasteRecord } from './taste.ts';
import { BREAKFAST_SALE } from '../time/meal-time.ts';
import { condPiece, countedIsMulti, countWord, DEICTIC, DEICTIC_QTY, listIsMulti, MAX_SLOTS, MAYBE_MANY, OWNER_ONLY, parseCount, parsePeople, selfCount, splitCounted, splitEach, splitEdits, splitList, splitNames } from './multi.ts';

type Json = any; // 서버 응답 (server.ts 모양)
interface Prefs {
  allergies: string[];
  budgetKrw: number | null;
  goal: 'PROTEIN' | 'LIGHT' | 'FILLING' | null;
  /** "쇠고기 종류로" */
  wantMains?: string[];
  /** "돼지고기 빼고" (10/19) */
  avoidMains?: string[];
  /** 짜게·싱겁게 (10/20) */
  salty?: 'MORE' | 'LESS';
  lowFat?: boolean;
  kinds: string[] | null;
  avoidSpicy?: boolean;
  wantSpicy?: boolean;
  maxEnergyKcal: number | null;
  maxSodiumMg: number | null;
  removeVegetables: string[];
}
interface Choices {
  size?: '15cm' | '30cm';
  bread?: string;
  cheese?: string | null;
  removeVegetables?: string[];
  addVegetables?: string[];
  sauces?: string[];
  toppings?: string[];
  set?: string | null;
  toasted?: boolean;
  drink?: string | undefined;
  setItem?: string | undefined;
  /** 단품 (10/19): 음료·쿠키·칩·웨지·수프 */
  extras?: Array<{ id: string; qty: number }> | undefined;
}

/** 샌드위치 없이 단품만 주문할 때의 "메뉴" (서버 SINGLES_ID와 같음, 10/19 "콜라만 줘") */
const SINGLES_MENU = { id: 'singles', name: '음료·사이드만', kind: 'SINGLES', image: null, price15cm: null, price30cm: null } as const;
const GROUP_KO: Record<string, string> = { DRINK: '음료', COOKIE: '쿠키', CHIP: '칩', WEDGE: '웨지 (오전 11시부터)', SOUP: '수프' };

/** 단품 고르기: 묶음별로 누르면 1개 담기, 담은 것은 −/+ 로 개수 (10/19) */
function extrasPicker(o: Json, c: Choices, set: (p: Partial<Choices>) => void, mark: (x: AllergenInfo | undefined) => AllergyMark | undefined, open: boolean) {
  const list = c.extras ?? [];
  const qtyOf = (id: string) => list.find((e) => e.id === id)?.qty ?? 0;
  const setQty = (id: string, q: number) => {
    const rest = list.filter((e) => e.id !== id);
    set({ extras: q > 0 ? [...rest, { id, qty: Math.min(20, q) }] : rest.length ? rest : undefined });
  };
  const singles: Json[] = o.singles ?? [];
  const groups = ['DRINK', 'COOKIE', 'CHIP', 'WEDGE', 'SOUP'].map((g) => [g, singles.filter((x) => x.group === g)] as const).filter(([, xs]) => xs.length);
  const box = h('details', { class: 'extras', id: 'extras', open: open || list.length > 0 },
    h('summary', {}, `음료·사이드 단품 더하기${list.length ? ` (${list.reduce((a, e) => a + e.qty, 0)}개)` : ''}`),
    ...groups.map(([g, xs]) => segment(GROUP_KO[g]!, xs.map((x) => ({
      label: `${x.name} ${x.price.toLocaleString('ko-KR')}${qtyOf(x.id) > 1 ? ` ×${qtyOf(x.id)}` : ''}`,
      on: qtyOf(x.id) > 0,
      mark: mark({ allergens: x.allergens, mayContain: x.mayContain, allergenStatus: x.allergenStatus }),
      click: () => setQty(x.id, qtyOf(x.id) ? 0 : 1),
    })))),
  );
  if (list.length) {
    box.append(h('ul', { class: 'extras-qty' }, ...list.map((e) => {
      const x = singles.find((y) => y.id === e.id);
      const minus = h('button', { type: 'button', class: 'qty', 'aria-label': `${x?.name ?? e.id} 하나 빼기` }, '−');
      const plus = h('button', { type: 'button', class: 'qty', 'aria-label': `${x?.name ?? e.id} 하나 더` }, '+');
      minus.addEventListener('click', () => setQty(e.id, e.qty - 1));
      plus.addEventListener('click', () => setQty(e.id, e.qty + 1));
      return h('li', {}, h('span', {}, `${x?.name ?? e.id} × ${e.qty}`), minus, plus);
    })));
  }
  // 웨지는 오전 11시부터 (공식 홈페이지)
  if (list.some((e) => singles.find((y) => y.id === e.id)?.fromMinute) && seoulMinute() < 660) box.append(h('p', { class: 'notice warn' }, '웨지 포테이토는 오전 11시부터 나와요'));
  return box;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...kids: Array<Node | string | null | undefined | false>) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k) el.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return el;
}
const put = (el: HTMLElement, ...kids: Array<Node | string | null | undefined | false>) => el.replaceChildren(...(kids.filter(Boolean) as Array<Node | string>));
const won = (n: number | null | undefined) => (n == null ? '가격 확인 필요' : `${n.toLocaleString('ko-KR')}원`);

const state = {
  location: null as null | { lat: number; lng: number; label: string },
  prefs: { allergies: [], budgetKrw: null, goal: null, kinds: null, maxEnergyKcal: null, maxSodiumMg: null, removeVegetables: [] } as Prefs,
  options: null as Json,
  result: null as Json,
  menu: null as Json, // 고른 메뉴 (추천 카드 데이터)
  choices: {} as Choices,
  /** 서버가 마지막으로 받아 준 선택 (거절되면 여기로 되돌림 — 10/14 보안 검토) */
  goodChoices: {} as Choices,
  sheet: null as Json,
  /** 주문서를 넘길 매장 (기본: 1번 매장) */
  store: null as Json,
  /** 알레르기로 재료를 자동으로 뺄 차례인지 (메뉴를 새로 골랐거나 알레르기를 바꿨을 때 한 번) — 10/16 */
  allergyPending: false,
  /** "토마토 알레르기라서 토마토를 뺐어요" */
  allergyNotes: [] as string[],
  /** 메뉴를 누가 골랐는지 — 직접 고른 메뉴는 말로 조건만 바꿔도 그대로 둔다 */
  menuBy: null as null | 'user' | 'talk' | 'ai',
  /** 말한 취향·오늘 상태 중 저장하지 않은 것 ('취향 기억하기'를 안 켰을 때 이 화면 동안만) — 10/17 */
  sessionTastes: [] as TasteRecord[],
  /** 메뉴 이름 없이 말했을 때 그 말 (10/21 예형님: 1위를 알아서 고르지 않고 ③에서 직접 고르게 — 고른 메뉴에 같은 말의 옵션을 넣음) */
  talkForPick: null as string | null,
  /** 젬마가 읽은 손님 상황 한 줄 ("감기라서 따뜻하고 자극 적은 것") — 화면과 AI 한마디에 (10/27) */
  situation: null as string | null,
  /** 젬마가 정한 한 사람 추천의 옵션 (③에서 메뉴를 고르면 넣음, 예: 감기 → 수프 세트) */
  aiPickChoices: null as Json,
  /** 메뉴를 고를 때 평소대로 넣은 것 (10/21) — [되돌리기]하면 이 전으로 */
  usualApplied: null as null | { before: Choices; text: string[] },
  /** ②에서 말하거나 조건을 골랐는지 (10/22 예형님: 처음엔 추천을 접어 두고 고른 뒤에 보이게) */
  engaged: false,
  /** 말 기록 — '취향 기억하기'를 안 켰으면 이 화면 동안만 (10/22) */
  sessionTalkLog: [] as store.TalkLogEntry[],
  /** "지난번처럼"·다시 주문으로 불렀을 때 알림 (아침 메뉴 시간·가격 바뀜) */
  reorderNotes: [] as string[],
};

// ── 내 취향 (10/17, taste.ts): 주문 기록 + 말한 취향 → 엔진에 점수만 보냄 ──
function myTaste(now = new Date()) {
  return buildTaste(store.orders(), [...store.tasteRecords(), ...state.sessionTastes], store.suppressedKeys(), now);
}
/** 추천에 보낼 조건 = 고른 조건 + 취향 점수 (취향이 없으면 안 보냄 — 처음 쓰는 사람은 전과 같음) */
function prefsToSend(): Prefs & { taste?: unknown } {
  const t = myTaste().taste;
  return t.menus || t.mains ? { ...state.prefs, taste: t } : state.prefs;
}
/** 말한 취향·피곤함 저장 ('취향 기억하기' 켰으면 휴대폰에, 아니면 이 화면 동안만) */
function rememberTalk(r: Json, now = new Date()) {
  const recs: TasteRecord[] = [];
  const rec = (scope: 'LASTING' | 'TODAY', target: TasteRecord['target'], sign: 1 | -1): TasteRecord => ({
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    scope, target, sign, at: now.toISOString(),
    valid_until: scope === 'TODAY' ? dayEndValidUntil(now) : null,
    policy: scope === 'TODAY' ? DAY_END_POLICY : null,
    account_id: null,
  });
  for (const t of (r.tastes ?? []) as Array<{ main: string; sign: 1 | -1; scope: 'LASTING' | 'TODAY' }>) recs.push(rec(t.scope, { type: 'main', id: t.main as never }, t.sign));
  if (r.mood === 'TIRED') recs.push(rec('TODAY', { type: 'mood', id: 'TIRED' }, 1));
  for (const x of recs) {
    if (store.addTaste(x)) continue;
    const same = (y: TasteRecord) => y.scope === x.scope && y.target.type === x.target.type && y.target.id === x.target.id;
    state.sessionTastes = [x, ...state.sessionTastes.filter((y) => !same(y))];
  }
  if (recs.length) renderTastes();
  return recs.length;
}

// http: 연결 결과 (0 = 끊김). 응답 안의 status(예: CHOOSE·NONE)와 이름을 나눔 — 같은 이름이라 서로 덮던 10/14 문제
async function api(path: string, body?: unknown): Promise<Json> {
  let r: Response;
  try {
    r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    $('offline').hidden = false; // 실제로 못 닿았을 때도 끊김 안내 (onLine 값만으로는 못 잡는 경우가 있음)
    return { http: 0, error: 'NETWORK' };
  }
  $('offline').hidden = navigator.onLine;
  const j = await r.json().catch(() => ({ error: 'BAD_RESPONSE' }));
  return { ...j, http: r.status };
}

let busyTimer = 0;
/** later: 조금 지나도 안 끝나면 바꿔 보여 줄 말 (10/21: AI를 부르면 3~4초 — "AI에게 물어보고 있어요") */
function busy(on: boolean, text = '찾고 있어요', later?: string) {
  const b = $('busy');
  b.hidden = !on;
  $('busy-text').textContent = text;
  clearTimeout(busyTimer);
  if (on && later) busyTimer = window.setTimeout(() => {
    $('busy-text').textContent = later;
    busyTimer = window.setTimeout(() => ($('busy-text').textContent = '평소보다 오래 걸리고 있어요'), 6000);
  }, 2000);
  else if (on) busyTimer = window.setTimeout(() => ($('busy-text').textContent = '평소보다 오래 걸리고 있어요'), 8000);
  for (const id of ['talk-send', 'use-gps']) ($(id) as HTMLButtonElement).disabled = on;
}

// ── 지금 시간 ──
function mealNow(d = new Date()) {
  const seoul = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60000);
  const m = seoul.getHours() * 60 + seoul.getMinutes();
  return m >= 420 && m < 660 ? '아침' : m < 900 && m >= 660 ? '점심' : m >= 900 && m < 1020 ? '오후' : m >= 1020 && m < 1260 ? '저녁' : '야식';
}
/** "뭐 먹지?"에 붙이는 한마디 — 취향이 있으면 취향, 없으면 지금 시간 */
function vagueLine(d = new Date()): string {
  const mains = myTaste(d).taste.mains ?? {};
  const liked = Object.entries(mains).filter(([, v]) => (v ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0];
  const when = mealNow(d);
  const head = liked
    ? `평소 좋아하시는 ${liked} 메뉴로 골라 봤어요`
    : when === '아침' ? '아침 메뉴로 골라 봤어요'
    : when === '점심' ? '점심이니까 든든한 걸로 골라 봤어요'
    : when === '오후' ? '출출할 때 먹기 좋은 걸로 골라 봤어요'
    : when === '저녁' ? '저녁이라 가볍게 골라 봤어요'
    : '밤이라 가볍게 골라 봤어요';
  return `${head}. "매운 거", "만 원 이하"처럼 말해 주시면 더 맞춰 드려요`;
}
function seoulMinute(d = new Date()) {
  const seoul = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60000);
  return seoul.getHours() * 60 + seoul.getMinutes();
}
function showNow() {
  $('now').textContent = `지금 ${mealNow()}${state.location ? ` · ${state.location.label}` : ''}`;
}

// ── 조건 버튼 (AI 없이도 같은 추천) ──
function syncConditionUi() {
  document.querySelectorAll<HTMLButtonElement>('[data-goal]').forEach((b) => b.setAttribute('aria-pressed', String(state.prefs.goal === b.dataset.goal)));
  const kinds = state.prefs.kinds ?? [];
  document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => {
    const k = b.dataset.kind!;
    const on = k === 'MORNING' ? kinds.includes('MORNING_SANDWICH') : k === 'SALAD' ? kinds.includes('SALAD') : kinds.includes(k);
    b.setAttribute('aria-pressed', String(on));
  });
  $('spicy').setAttribute('aria-pressed', String(!!state.prefs.avoidSpicy));
  // 말로 정한 예산(예: 12,000원)이 목록에 없으면 목록에 더해서 보여 줌 (안 그러면 칸이 비어 "상관없음"처럼 보임)
  const budget = $('budget') as HTMLSelectElement;
  const want = state.prefs.budgetKrw ? String(state.prefs.budgetKrw) : '';
  if (want && ![...budget.options].some((o) => o.value === want)) budget.append(h('option', { value: want }, `${Number(want).toLocaleString('ko-KR')}원 이하`));
  budget.value = want;
  document.querySelectorAll<HTMLButtonElement>('#allergy-chips .chip').forEach((b) => b.setAttribute('aria-pressed', String(state.prefs.allergies.includes(b.dataset.a!))));
  $('allergy-count').textContent = state.prefs.allergies.length ? `(${state.prefs.allergies.join('·')})` : '';
}
function kindValues(k: string) {
  return k === 'MORNING' ? ['MORNING_SANDWICH', 'MORNING_WRAP'] : k === 'SALAD' ? ['SALAD', 'GRAIN_SALAD'] : [k];
}
function bindConditions() {
  document.querySelectorAll<HTMLButtonElement>('[data-goal]').forEach((b) =>
    b.addEventListener('click', () => {
      const g = b.dataset.goal as Prefs['goal'];
      // 피곤함으로 켜진 [든든하게]를 끄거나 다른 목표를 고르면 오늘 피곤함도 지움 (다시 열 때 또 켜지지 않게 — 10/17)
      const tired = myTaste().tired;
      if (tired && state.prefs.goal === 'FILLING') {
        store.removeTaste(tired.id);
        state.sessionTastes = state.sessionTastes.filter((x) => x.id !== tired.id);
        document.getElementById('tired-note')?.remove();
        renderTastes();
      }
      state.prefs.goal = state.prefs.goal === g ? null : g;
      changed();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) =>
    b.addEventListener('click', () => {
      const vals = kindValues(b.dataset.kind!);
      const cur = new Set(state.prefs.kinds ?? []);
      const on = vals.every((v) => cur.has(v));
      for (const v of vals) on ? cur.delete(v) : cur.add(v);
      state.prefs.kinds = cur.size ? [...cur] : null;
      changed();
    }),
  );
  $('spicy').addEventListener('click', () => {
    state.prefs.avoidSpicy = !state.prefs.avoidSpicy;
    if (!state.prefs.avoidSpicy) delete state.prefs.avoidSpicy;
    else delete state.prefs.wantSpicy; // 빼기를 누르면 말로 한 '매운 것 넣기'는 끔
    changed();
  });
  $('budget').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    state.prefs.budgetKrw = v ? Number(v) : null;
    changed();
  });
}
function renderAllergyChips(list: string[], groups?: { main: string[]; other: string[] }) {
  const box = $('allergy-chips');
  const chip = (a: string) => {
      const b = h('button', { type: 'button', class: 'chip', 'data-a': a, 'aria-pressed': 'false' }, a);
      b.addEventListener('click', () => {
        const s = new Set(state.prefs.allergies);
        s.has(a) ? s.delete(a) : s.add(a);
        state.prefs.allergies = [...s];
        changed();
      });
      return b;
  };
  // 고기·해산물은 메인 재료라 보통 메뉴를 빼고, 그 밖은 뺄 수 있으면 그 재료만 뺀다 (10/16)
  if (!groups) return box.replaceChildren(...list.map(chip));
  box.replaceChildren(
    h('p', { class: 'meta allergy-group' }, '고기·해산물 — 들어간 메뉴를 빼요'),
    h('div', { class: 'chips' }, ...groups.main.map(chip)),
    h('p', { class: 'meta allergy-group' }, '그 밖 재료 — 야채·빵이면 그 재료만 빼고 메뉴는 남겨요'),
    h('div', { class: 'chips' }, ...groups.other.map(chip)),
  );
}
function changed() {
  state.engaged = true;
  store.rememberAllergies(state.prefs.allergies); // 알레르기 동의했을 때만 저장됨
  syncConditionUi();
  // 고른 메뉴가 있으면 옵션의 알레르기 표시·주문서 경고도 새 조건으로 (자동으로 뺄 재료도 다시 한 번)
  if (state.menu && state.sheet) {
    state.allergyPending = true;
    renderOptions();
    void refreshSheet();
  }
  if (state.location) void recommend();
  else $('cond-hint').hidden = false; // 위치 전에 조건만 넣었을 때: 아무 일도 안 일어나는 것처럼 보이지 않게
}

// ── ① 위치 ──
/** auto: 화면을 열 때 저절로 부른 것 — 실패해도 입력칸으로 커서를 옮기지 않음 (휴대폰 자판이 갑자기 뜨지 않게) */
function useGps(auto = false): Promise<boolean> {
  return new Promise((done) => {
    if (!('geolocation' in navigator)) {
      locNotice('이 브라우저는 위치를 쓸 수 없어요. 장소를 직접 입력해 주세요', 'warn');
      return done(false);
    }
    busy(true, '위치를 확인하고 있어요');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        busy(false);
        state.location = { lat: p.coords.latitude, lng: p.coords.longitude, label: '현재 위치' };
        put($('loc-result'), auto ? h('p', { class: 'ai-pick' }, h('span', { class: 'ai-badge' }, 'AI가 추천했어요!'), ' 지금 위치로 찾았어요. 다른 곳이면 아래에 입력하세요') : null);
        void recommend().then(() => done(true));
      },
      () => {
        busy(false);
        locNotice('위치를 쓸 수 없어요. 아래에 장소를 직접 입력해 주세요 (위치는 저장하지 않아요)', 'warn');
        if (!auto) ($('place-input') as HTMLInputElement).focus();
        done(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });
}
/** 버튼을 누르지 않아도 지금 위치로 (10/16 요청). 처음 동의를 마친 뒤, 또는 다시 열 때. 이미 위치가 있으면 안 함 */
function autoLocate() {
  if (state.location) return;
  void useGps(true);
}
function locNotice(text: string, kind = '') {
  $('loc-result').replaceChildren(h('p', { class: `notice ${kind}` }, text));
}
async function searchPlace(q: string): Promise<'OK' | 'CHOOSE' | 'FAIL'> {
  busy(true, '장소를 찾고 있어요');
  const r = await api('/api/stores?q=' + encodeURIComponent(q));
  busy(false);
  ($('place-input') as HTMLInputElement).value = q; // 말로 한 장소도 입력칸에 보이게 (고칠 수 있게)
  if (r.http !== 200) {
    locNotice(r.http === 0 ? '인터넷 연결을 확인하고 다시 시도해 주세요' : '장소를 찾지 못했어요. 다시 시도해 주세요', 'bad');
    return 'FAIL';
  }
  if (r.step === 'LOCATION') {
    if (r.status === 'CHOOSE' || r.options?.length) {
      const list = h('div', { class: 'option-list' });
      for (const o of r.options) {
        const b = h('button', { type: 'button', class: 'pick' }, o.name, o.address ? h('span', { class: 'meta' }, ` ${o.address}`) : null);
        b.addEventListener('click', async () => {
          state.location = { lat: o.lat, lng: o.lng, label: o.name };
          $('loc-result').replaceChildren();
          document.getElementById('place-wait')?.remove(); // 골랐으니 "여러 곳이에요" 안내는 지움
          await recommend();
          // 말로 한 주문이 장소 고르기를 기다리고 있었으면 이어서 (메뉴 고르기까지)
          const p = pendingTalk;
          pendingTalk = null;
          if (p) await afterRecommend(p.text, p.r);
        });
        list.append(b);
      }
      $('loc-result').replaceChildren(h('p', {}, '어느 곳인가요?'), list);
      return 'CHOOSE';
    }
    locNotice(r.status === 'NOT_FOUND' ? `"${q}"을(를) 찾지 못했어요. 역 이름이나 동 이름으로 다시 입력해 주세요` : '이 장소는 쓸 수 없어요', 'warn');
    return 'FAIL';
  }
  state.location = { lat: r.point.lat, lng: r.point.lng, label: r.label };
  await recommend();
  return 'OK';
}

// ── 추천 (② 매장 + ③ 메뉴) ──
// 버튼을 빨리 여러 번 누르면 응답이 뒤바뀌어 올 수 있다 → 마지막 요청의 응답만 그린다 (10/15 점검)
let recommendSeq = 0;
let sheetSeq = 0;
async function recommend() {
  if (!state.location) return;
  $('cond-hint').hidden = true;
  const seq = ++recommendSeq;
  busy(true);
  const location = { lat: state.location.lat, lng: state.location.lng };
  const r = await api('/api/menus/recommend', { location, prefs: slotPrefs() });
  if (seq !== recommendSeq) return;
  busy(false);
  showNow();
  if (r.http !== 200) return locNotice(r.http === 0 ? '인터넷 연결을 확인하고 다시 시도해 주세요' : r.error === 'INVALID_ALLERGIES' ? '알레르기 이름을 확인해 주세요' : '추천을 받지 못했어요. 잠시 뒤 다시 시도해 주세요', 'bad');
  if (r.step === 'LOCATION') return locNotice('위치를 다시 정해 주세요', 'warn');
  if (r.step === 'STORES') {
    state.store = null; // 다른 동네의 옛 매장으로 주문서가 넘어가지 않게
    $('step-store').hidden = false;
    $('store-list').replaceChildren(h('p', { class: 'notice warn' }, r.status === 'NONE' ? '3km 안에 써브웨이가 없어요. 다른 장소를 입력해 주세요' : '매장을 찾지 못했어요. 잠시 뒤 다시 시도해 주세요'));
    $('step-menu').hidden = true;
    return;
  }
  state.result = r;
  renderStores(r.stores);
  renderMenus(r.menus);
  void explainTop(r.menus?.top ?? []);
}

function renderStores(s: Json) {
  $('step-store').hidden = false;
  if (!s.top.length) {
    state.store = null;
    $('store-list').replaceChildren(h('p', { class: 'notice warn' }, '지금 갈 수 있는 매장이 없어요'), ...s.rejected.slice(0, 3).map((x: Json) => h('p', { class: 'meta' }, x.why.join(', '))));
    return;
  }
  // 고른 매장이 새 목록에 없으면 1번 매장으로
  if (!s.top.some((st: Json) => st.id === state.store?.id)) state.store = s.top[0];
  let shown = Math.max(1, s.top.findIndex((st: Json) => st.id === state.store.id) + 1);
  const draw = () => {
    put($('store-list'),
      ...s.top.slice(0, shown).map((st: Json) => {
        const chosen = st.id === state.store.id;
        const tel = telLink(st.phone);
        const choose = chosen ? h('span', { class: 'store-chosen' }, '✓ 주문할 매장') : h('button', { type: 'button', class: 'btn-primary store-choose' }, '이 매장으로 주문');
        if (!chosen) choose.addEventListener('click', () => {
          state.store = st;
          draw();
          if (state.sheet) void refreshSheet();
        });
        return h('article', { class: `store ${chosen ? 'first' : ''}`, 'aria-current': chosen ? 'true' : undefined },
          h('h3', {}, st.name),
          h('p', { class: 'why' }, st.why.join(' · ')),
          h('p', { class: 'meta' }, `${st.distanceM < 1000 ? `${st.distanceM}m` : `${(st.distanceM / 1000).toFixed(1)}km`}${st.address ? ` · ${st.address}` : ''}`),
          h('div', { class: 'actions' },
            choose,
            tel ? h('a', { class: 'btn-text', href: tel }, '전화') : null,
            h('a', { class: 'btn-text', href: kakaoRouteLink(st), target: '_blank', rel: 'noopener' }, '길찾기'),
          ),
        );
      }),
      shown < s.top.length ? (() => {
        const b = h('button', { type: 'button', class: 'btn-ghost wide', id: 'more-stores' }, '다른 매장 더 보기');
        b.addEventListener('click', () => { shown = s.top.length; draw(); });
        return b;
      })() : null,
    );
  };
  draw();
}

const PART_NAME: Record<string, string> = { protein: '단백질', sodium: '나트륨', calorie: '열량', budget: '예산', satiety: '포만감', emotion: '기분', health: '건강', confidence: '정보 확실성', preference: '취향', mealTime: '시간대', allergyRisk: '알레르기 위험', spicy: '매운맛' };

/** 메뉴 사진 (10/17, 공식 홈페이지 사진을 우리 서버에 둔 것). 없거나 못 불러오면 아무것도 안 그림 (이름만) */
function menuImage(m: Json, cls: string) {
  if (!m?.image) return null;
  const img = h('img', { class: cls, src: m.image, alt: '', width: '360', height: '240', loading: 'lazy', decoding: 'async' }) as HTMLImageElement;
  img.addEventListener('error', () => img.remove());
  return img;
}

function menuCard(m: Json, first: boolean) {
  const n = m.nutrition15cm;
  const why = h('ul', { class: 'reasons' }, ...m.why.map((w: string) => h('li', { class: w.startsWith('⚠') ? 'warn' : '' }, w)));
  const parts = h('p', { class: 'parts', hidden: true },
    '점수: ' + Object.entries(m.parts as Record<string, number>).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${PART_NAME[k] ?? k} ${v.toFixed(2)}`).join(' · ') + ` = ${m.score.toFixed(2)}`);
  const whyBtn = h('button', { type: 'button', class: 'btn-ghost', 'aria-expanded': 'false', 'aria-label': '왜 이 메뉴인지 점수 보기' }, 'Why?');
  whyBtn.addEventListener('click', () => {
    parts.hidden = !parts.hidden;
    whyBtn.setAttribute('aria-expanded', String(!parts.hidden));
  });
  // 10/27 예형님: [담기]를 누르면 ④ 옵션 고르기로 내려감 (10/26엔 ③에 그대로였음) — 위 🛒 개수도 늘어남
  const pick = h('button', { type: 'button', class: 'btn-primary', 'data-add': m.id }, '담기');
  pick.addEventListener('click', () => void pickWithTalk(m).then(() => (toast(`담았어요 · 장바구니 ${cartCount()}개`), goTo('step-order'))));
  return h('article', { class: `menu ${first ? 'first' : ''}`, 'data-menu-id': m.id },
    menuImage(m, 'menu-img'),
    h('h3', {}, h('span', { class: 'rank' }, String(m.rank)), m.name),
    h('p', { class: 'price' }, won(m.price15cm), m.priceStatus !== 'KNOWN' ? h('span', { class: 'estimate' }, '확인 필요') : null, h('span', { class: 'meta' }, ' 15cm')),
    n ? h('ul', { class: 'facts' }, h('li', {}, `${n.energyKcal}kcal`), h('li', {}, `단백질 ${n.proteinG}g`), h('li', {}, `나트륨 ${n.sodiumMg}mg`)) : h('p', { class: 'meta' }, '영양 정보 확인 필요'),
    why, h('p', { class: 'ai-line', hidden: true }), parts,
    h('div', { class: 'actions' }, whyBtn, pick),
  );
}

/** ③을 접어 둘지 (10/22): ②에서 아직 아무것도 안 했으면 안내만 */
const afterMenus = () => markCards();
function gateRecs() {
  $('recs-gate').hidden = state.engaged;
  $('recs-body').hidden = !state.engaged;
}

function renderMenus(ms: Json) {
  $('step-menu').hidden = false;
  gateRecs();
  if (!ms.top.length) {
    $('menu-list').replaceChildren(h('p', { class: 'notice warn' }, '조건에 맞는 메뉴가 없어요. 조건을 하나 풀어 보세요'));
  } else $('menu-list').replaceChildren(...ms.top.map((m: Json, i: number) => menuCard(m, i === 0)));
  // 조건 때문에 뺀 메뉴를 추천 위에 한 줄로 (전엔 맨 아래 접힌 "뺀 메뉴"를 열어야만 보였음 — 10/16)
  const by = (ms.rejectedByReason ?? {}) as Record<string, number>;
  const parts = [
    by.TOO_SPICY && `매운 것 빼기로 ${by.TOO_SPICY}개`,
    by.NOT_WANTED_MAIN && `${(state.prefs.wantMains ?? []).join('·')} 메뉴가 아니라 ${by.NOT_WANTED_MAIN}개`,
    by.AVOIDED_MAIN && `${(state.prefs.avoidMains ?? []).join('·')} 메뉴라서 ${by.AVOIDED_MAIN}개`,
    (by.ALLERGEN_CONTAINS || by.ALLERGEN_UNKNOWN) && `알레르기로 ${(by.ALLERGEN_CONTAINS ?? 0) + (by.ALLERGEN_UNKNOWN ?? 0)}개`,
    by.OVER_BUDGET && `예산으로 ${by.OVER_BUDGET}개`,
    (by.MAX_ENERGY_EXCEEDED || by.MAX_SODIUM_EXCEEDED) && `열량·나트륨으로 ${(by.MAX_ENERGY_EXCEEDED ?? 0) + (by.MAX_SODIUM_EXCEEDED ?? 0)}개`,
    by.NOT_ON_SALE_NOW && `판매 시간이 아니라 ${by.NOT_ON_SALE_NOW}개`,
  ].filter(Boolean);
  const sum = $('rejected-summary');
  sum.hidden = !parts.length;
  if (parts.length) {
    const see = h('button', { type: 'button', class: 'btn-text' }, '보기');
    see.addEventListener('click', () => {
      const d = $('rejected') as HTMLDetailsElement;
      d.open = true;
      d.scrollIntoView({ block: 'center' });
    });
    put(sum, `${parts.join(', ')} 뺐어요 `, see);
  }
  ($('compare') as HTMLButtonElement).hidden = ms.top.length < 2;
  $('compare-result').replaceChildren();
  const rej = $('rejected') as HTMLDetailsElement;
  rej.hidden = !ms.rejected.length;
  $('rejected-count').textContent = `(${ms.rejectedCount})`;
  $('rejected-list').replaceChildren(...ms.rejected.map((x: Json) => h('li', {}, `${x.name}: ${x.why.join(', ')}`)));
  afterMenus();
}

/** ③에서 고름: 말로 한 옵션(양파 빼기·콜라 등)이 있으면 이 메뉴에 넣어서 (AI는 또 부르지 않음) */
async function pickWithTalk(m: Json) {
  // 칸마다 추천 중이면 그 칸의 말("해장할 거" → 수프 세트)을 고른 메뉴에 (10/26)
  const plan = slots.recFor !== null ? slots.plans.find((p) => p.slot === slots.recFor) : undefined;
  const text = state.talkForPick ?? plan?.label ?? null;
  state.talkForPick = null;
  document.getElementById('pick-hint')?.remove();
  if (plan?.choices && text === plan.label) return pickMenu(m, { ...plan.choices }, 'talk', [], { noScroll: true });
  // 젬마가 정한 옵션 (10/27: "감기 걸렸는데" → 수프 세트) — 말로 한 옵션과 합침 (말로 한 것이 앞)
  const ai = !plan && state.aiPickChoices ? { ...state.aiPickChoices } : {};
  if (!text) return pickMenu(m, ai, Object.keys(ai).length ? 'talk' : 'user', [], { noScroll: true });
  const r2 = await api('/api/interpret', { text, context: { menuId: m.id, choices: {}, prefs: state.prefs, skipAi: true } });
  await pickMenu(m, r2.http === 200 ? { ...ai, ...(r2.choices ?? {}) } : ai, 'talk', [], { ...(r2.http === 200 ? { saucesAdd: r2.saucesAdd, keepVegetables: r2.keepVegetables } : {}), noScroll: true });
  if (r2.http !== 200) return;
  for (const x of (r2.refusals as string[]).filter((x) => !x.startsWith(NEED_MENU))) $('talk-result').append(h('p', { class: 'notice warn' }, x));
  for (const x of (r2.understood as string[]).filter((u) => /알레르기라서/.test(u))) $('talk-result').append(h('p', { class: 'notice', 'data-allergy-note': '' }, `✓ ${x}`));
}

/** Top3 AI 한마디 (10/21 예형님): 추천은 바로 보이고, A100이 3초 안에 답하면 카드마다 한 줄 더함 (안 오면 그냥 없음) */
let explainSeq = 0;
async function explainTop(top: Json[]) {
  if (!top.length) return;
  const seq = ++explainSeq;
  const r = await api('/api/menus/explain', { menuIds: top.slice(0, 3).map((m) => m.id), prefs: slotPrefs(), ...(state.situation ? { situation: state.situation } : {}) });
  if (seq !== explainSeq || r.http !== 200 || !r.lines) return;
  for (const [id, line] of Object.entries(r.lines as Record<string, string>)) {
    const p = document.querySelector<HTMLElement>(`#menu-list .menu[data-menu-id="${CSS.escape(id)}"] .ai-line`);
    if (!p || !line) continue;
    // 바로 위 정해진 이유와 반대되는 한마디는 안 보임 (10/22: "든든한 편이에요" 아래 "가벼운 점심이 돼요")
    const reasons = p.closest('.menu')?.querySelector('.reasons')?.textContent ?? '';
    if ((/든든한 편/.test(reasons) && /가볍|가벼운|가벼워/.test(line)) || (/가벼워요/.test(reasons) && /든든|배부르|배불리|푸짐/.test(line))) continue;
    p.replaceChildren(h('span', { class: 'ai-mark' }, 'AI 한마디'), ` ${line}`);
    p.hidden = false;
  }
}

function showCompare() {
  const lines: string[] = state.result?.menus?.compare12 ?? [];
  $('compare-result').replaceChildren(h('div', { class: 'notice' }, ...lines.map((l) => h('p', {}, l))));
  syncCompareBtn();
}

/** [1번이랑 2번 비교]를 다시 누르면 닫기 (10/22 예형님) */
function toggleCompare() {
  if ($('compare-result').childElementCount) {
    $('compare-result').replaceChildren();
    syncCompareBtn();
  } else showCompare();
}

function syncCompareBtn() {
  const open = $('compare-result').childElementCount > 0;
  $('compare').textContent = open ? '비교 닫기' : '1번이랑 2번 비교';
  $('compare').setAttribute('aria-expanded', String(open));
}

// ── ④ 옵션 → 주문서 ──
/** by: user = 직접 누름, talk = 말로 메뉴 이름을 말함, ai = 말 안 해서 추천 1위를 골라 둠 */
/** 평소 옵션 (10/21 예형님): 이번에 말하지 않은 소스·빵은 평소대로, 야채는 평소 빼기·더에 이번 것을 더함.
 *  소스를 정해서 말하면("랜치로") 말한 것만, "랜치도"면 평소 소스 + 랜치 (최대 3개). 고른 알레르기가 든 것은 넣지 않음 */
function withUsual(m: Json, choices: Choices, said: { saucesAdd?: boolean; keepVegetables?: string[] } = {}): { choices: Choices; text: string[] } {
  if (!store.consented('orders') || m.id === SINGLES_MENU.id) return { choices, text: [] };
  const o = state.options;
  const sandwich = m.kind === 'SANDWICH' || m.kind === 'MORNING_SANDWICH';
  const wrap = m.kind === 'WRAP' || m.kind === 'MORNING_WRAP';
  const allergic = (list: Json[], id: string) => (list.find((x: Json) => x.id === id)?.allergens ?? []).some((a: string) => state.prefs.allergies.includes(a));
  const u = usualChoices(store.orders(), store.suppressedKeys());
  const next: Choices = { ...choices };
  const text: string[] = [];
  const name = (list: Json[], id: string) => list.find((x: Json) => x.id === id)?.name ?? id.replace(/^[a-z]+:/, '');
  if (!wrap && u.sauces.length) {
    const usual = u.sauces.filter((x) => !allergic(o?.sauces ?? [], x));
    if (choices.sauces === undefined && usual.length) (next.sauces = usual.slice(0, 3)), text.push(`소스 ${usual.slice(0, 3).map((x) => name(o?.sauces ?? [], x)).join('·')}`);
    else if (said.saucesAdd && choices.sauces?.length) {
      const merged = [...new Set([...usual, ...choices.sauces])].slice(0, 3);
      if (merged.length > choices.sauces.length) (next.sauces = merged), text.push(`평소 소스 ${usual.filter((x) => merged.includes(x) && !choices.sauces!.includes(x)).map((x) => name(o?.sauces ?? [], x)).join('·')}`);
    }
  }
  if (sandwich && u.bread && choices.bread === undefined && !allergic(o?.breads ?? [], u.bread)) (next.bread = u.bread), text.push(`빵 ${name(o?.breads ?? [], u.bread)}`);
  if (sandwich) {
    const keep = said.keepVegetables ?? [];
    const rm = u.removeVegetables.filter((v) => !keep.includes(v) && !(choices.addVegetables ?? []).includes(v) && !(choices.removeVegetables ?? []).includes(v));
    if (rm.length) (next.removeVegetables = [...(choices.removeVegetables ?? []), ...rm]), text.push(`${rm.map((v) => name(o?.vegetables ?? [], v)).join('·')} 빼기`);
    const add = u.addVegetables.filter((v) => !(next.removeVegetables ?? []).includes(v) && !(choices.addVegetables ?? []).includes(v) && !allergic(o?.vegetables ?? [], v));
    if (add.length) (next.addVegetables = [...(choices.addVegetables ?? []), ...add]), text.push(`${add.map((v) => name(o?.vegetables ?? [], v)).join('·')} 더`);
  }
  return { choices: next, text };
}

function pickMenu(m: Json, choices: Choices, by: 'user' | 'talk' | 'ai' = 'user', notes: string[] = [], said: { saucesAdd?: boolean; keepVegetables?: string[]; noUsual?: boolean; noScroll?: boolean; replace?: boolean } = {}): Promise<void> {
  // 주문서를 넘긴 뒤 다시 담으면 새 장바구니
  if (cartDone) (cartDone = false), (handoffEl = null), (ordering = false), resetSlots();
  slotForPick(said.replace);
  state.menu = m;
  state.menuBy = by;
  // 일행 칸에는 내 평소 옵션을 넣지 않음 (10/23)
  const u = said.noUsual || curSlot()?.owner !== 'me' ? { choices, text: [] } : withUsual(m, choices, said);
  state.usualApplied = u.text.length ? { before: choices, text: u.text } : null;
  choices = u.choices;
  state.choices = choices;
  state.goodChoices = {};
  // 같은 메뉴·같은 옵션이 이미 담겨 있으면 그 줄 수량 +1
  if (mergeIfSame()) {
    saveCart();
    renderSlots();
    put($('picked'), state.menu.name);
    renderOptions();
    return refreshSheet();
  }
  state.allergyPending = true;
  state.allergyNotes = [];
  state.reorderNotes = notes;
  $('step-order').hidden = false;
  const singles = m.id === SINGLES_MENU.id;
  put($('order-title'), h('span', { class: 'num' }, '4'), singles ? '음료·사이드 고르기' : '옵션 고르기');
  $('step-menu').classList.toggle('dimmed', singles);
  ($('recs-body') as HTMLElement & { inert: boolean }).inert = singles;
  $('recs-unlock').hidden = !singles;
  put($('picked'), m.name, by === 'ai' ? h('span', { class: 'ai-badge' }, 'AI 추천') : null);
  renderOptions();
  renderSlots();
  const done = refreshSheet();
  // 칸마다 추천 중이어도 다음 사람으로 저절로 넘어가지 않음 (10/27) — ④ 아래 [다음 사람 고르기]
  if (!said.noScroll) $('step-order').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  return done;
}

/** 지난 주문·즐겨찾기를 그대로 다시 (10/17 "지난번처럼"). 아침 메뉴 시간이 지났거나 가격이 바뀌었으면 알려 줌 (막지는 않음) */
async function reorder(o: { menuId: string; menuName: string; choices: Record<string, unknown>; totalWon?: number }, from: string): Promise<boolean> {
  const m = o.menuId === SINGLES_MENU.id ? SINGLES_MENU : state.options?.menus?.find((x: Json) => x.id === o.menuId);
  if (!m) {
    put($('talk-result'), h('p', { class: 'notice warn' }, `${o.menuName}은(는) 판매가 끝나 지금 메뉴판에 없어요. 다른 메뉴를 골라 주세요`));
    return false;
  }
  const notes: string[] = [`${from} 그대로 불러왔어요`];
  // 판매가 끝난 토핑(10/19 에그 슬라이스 등)이 지난 주문에 있으면 빼고 알려 줌 — 그대로 보내면 주문서가 거절됨
  const saved = { ...(o.choices as Choices) };
  const onSaleTops = new Set((state.options?.toppings ?? []).map((t: Json) => t.id));
  const goneTops = (saved.toppings ?? []).filter((t) => !onSaleTops.has(t));
  if (goneTops.length) {
    saved.toppings = (saved.toppings ?? []).filter((t) => onSaleTops.has(t));
    notes.push('⚠ 판매가 끝난 추가 토핑은 뺐어요');
  }
  const min = seoulMinute();
  if ((m.kind === 'MORNING_SANDWICH' || m.kind === 'MORNING_WRAP') && (min < BREAKFAST_SALE.fromMinute || min >= BREAKFAST_SALE.untilMinute)) notes.push('⚠ 아침 메뉴는 오전 11시까지만 팔아요. 지금은 주문할 수 없을 수 있어요');
  await pickMenu(m, saved, 'user', notes, { noUsual: true });
  const now = state.sheet?.price?.total;
  if (o.totalWon != null && now != null && state.menu?.id === o.menuId && now !== o.totalWon) {
    state.reorderNotes = [...notes, `⚠ 가격이 바뀌었어요: 지난번 ${won(o.totalWon)} → 지금 ${won(now)}`];
    await refreshSheet();
  }
  return true;
}

// ── 즐겨찾기 ★ (주문 기록 동의한 사람만, 최대 10개) ──
function favButton() {
  if (!state.menu) return null;
  const on = !!store.isFavorite(state.menu.id, state.goodChoices as Record<string, unknown>);
  const b = h('button', { type: 'button', class: `fav ${on ? 'on' : ''}`, id: 'fav', 'aria-pressed': String(on), 'aria-label': on ? '즐겨찾기 빼기' : '즐겨찾기에 넣기' }, on ? '★' : '☆');
  b.addEventListener('click', () => {
    if (!store.consented('orders')) {
      b.replaceWith(h('p', { class: 'meta', id: 'fav-need' }, '즐겨찾기는 "주문 기록 저장"을 켜야 쓸 수 있어요 (아래 [취향 그래프] → 내 정보)'));
      return;
    }
    const added = store.toggleFavorite({ menuId: state.menu.id, menuName: state.menu.name, choices: { ...state.goodChoices } });
    b.textContent = added ? '★' : '☆';
    b.classList.toggle('on', added);
    b.setAttribute('aria-pressed', String(added));
    b.setAttribute('aria-label', added ? '즐겨찾기 빼기' : '즐겨찾기에 넣기');
    renderOrders();
  });
  return b;
}

function segment(legend: string, items: Array<{ label: string; on: boolean; click: () => void; off?: boolean; mark?: AllergyMark | undefined }>) {
  return h('fieldset', { class: 'opt' }, h('legend', {}, legend),
    h('div', { class: 'seg' }, ...items.map((it) => {
      // 고른 알레르기가 든 재료: 연한 빨강 바탕 + "우유 들어 있음" (고를 수는 있음)
      const note = it.mark ? markLabel(it.mark) : '';
      const level = it.mark?.hit.length ? 'allergy-hit' : it.mark?.may.length || it.mark?.unknown ? 'allergy-may' : '';
      const b = h('button', { type: 'button', class: `chip ${it.off ? 'off' : ''} ${level}`, 'aria-pressed': String(it.on) }, it.label, note ? h('span', { class: 'amark' }, note) : null);
      b.addEventListener('click', it.click);
      return b;
    })));
}

function renderOptions() {
  const o = state.options;
  const m = state.menu;
  if (!o || !m) return;
  const c = state.choices;
  const mark = (x: AllergenInfo | undefined) => (x ? allergyMark(slotAllergies(), x) : undefined);
  const set = (patch: Partial<Choices>) => {
    state.choices = { ...state.choices, ...patch };
    renderOptions();
    void refreshSheet();
  };
  const sandwich = m.kind === 'SANDWICH' || m.kind === 'MORNING_SANDWICH';
  const salad = m.kind === 'SALAD' || m.kind === 'GRAIN_SALAD';
  const wrap = m.kind === 'WRAP' || m.kind === 'MORNING_WRAP';
  const singlesOnly = m.id === SINGLES_MENU.id;
  // 이 메뉴의 기본 야채 (아침 샌드위치는 공식 안내대로 없음·3가지, 10/19)
  const vegs: string[] = m.defaultVegetables ?? o.defaultVegetables;
  const parts: Node[] = [];
  if (singlesOnly) parts.push(h('p', { class: 'meta' }, '샌드위치 없이 음료·사이드만 주문해요. 아래에서 고르세요'));
  if (sandwich) {
    // 공식 가격표에 30cm가 있는 메뉴만 30cm (아침 메뉴 등은 15cm만 — 10/16 "15cm밖에 못 고르는데?")
    if (m.price30cm != null) parts.push(segment('크기', ['15cm', '30cm'].map((s) => ({ label: s, on: (c.size ?? '15cm') === s, click: () => set({ size: s as '15cm' | '30cm' }) }))));
    else parts.push(h('fieldset', { class: 'opt' }, h('legend', {}, '크기'), h('p', { class: 'meta' }, '이 메뉴는 15cm만 있어요')));
    parts.push(segment('빵', o.breads.map((b: Json) => ({ label: b.name, on: (c.bread ?? 'bread:위트') === b.id, click: () => set({ bread: b.id }), mark: mark(b) }))));
    parts.push(segment('치즈', [{ label: /치즈/.test(m.name) ? '메뉴 기본' : '없음', on: !c.cheese, click: () => set({ cheese: null }) }, ...o.cheeses.map((x: Json) => ({ label: x.name, on: c.cheese === x.id, click: () => set({ cheese: x.id }), mark: mark(x) }))]));
    const removed = new Set(c.removeVegetables ?? []);
    const added = new Set(c.addVegetables ?? []);
    if (!vegs.length) parts.push(h('fieldset', { class: 'opt' }, h('legend', {}, '야채'), h('p', { class: 'meta' }, '이 메뉴는 야채가 들어가지 않아요 (공식 안내)')));
    else parts.push(segment('야채 (누르면 빼기)', vegs.map((id: string) => ({
      label: o.vegetables.find((v: Json) => v.id === id)?.name ?? id, on: !removed.has(id), off: removed.has(id), mark: removed.has(id) ? undefined : mark(o.vegetables.find((v: Json) => v.id === id)),
      click: () => {
        removed.has(id) ? removed.delete(id) : removed.add(id);
        set({ removeVegetables: [...removed] });
      },
    }))));
    if (vegs.length) parts.push(segment('야채 더 넣기', vegs.filter((id: string) => !removed.has(id)).map((id: string) => ({
      label: `${o.vegetables.find((v: Json) => v.id === id)?.name ?? id} 더`, on: added.has(id), mark: mark(o.vegetables.find((v: Json) => v.id === id)),
      click: () => {
        added.has(id) ? added.delete(id) : added.add(id);
        set({ addVegetables: [...added] });
      },
    }))));
  }
  if (!wrap && !singlesOnly) {
    const sauces = new Set(c.sauces ?? []);
    parts.push(segment(`소스 (최대 3개${sauces.size ? `, ${sauces.size}개 고름` : ''})`, o.sauces.map((x: Json) => ({
      label: x.name, on: sauces.has(x.id), mark: mark(x),
      click: () => {
        if (sauces.has(x.id)) sauces.delete(x.id);
        else if (sauces.size < 3) sauces.add(x.id);
        set({ sauces: [...sauces] });
      },
    }))));
    const applies = salad ? m.kind : 'SANDWICH';
    const tops = new Set(c.toppings ?? []);
    parts.push(segment('추가 토핑', o.toppings.filter((t: Json) => t.appliesTo === applies).map((t: Json) => ({
      label: `${t.name} ${t.priceStatus === 'KNOWN' ? `+${(c.size === '30cm' ? t.price30cm ?? t.price15cm * 2 : t.price15cm).toLocaleString('ko-KR')}` : '(가격 확인 필요)'}`,
      on: tops.has(t.id), mark: mark(t),
      click: () => {
        tops.has(t.id) ? tops.delete(t.id) : tops.add(t.id);
        set({ toppings: [...tops] });
      },
    }))));
    parts.push(segment('세트', [{ label: '단품', on: !c.set, click: () => set({ set: null }) }, ...o.sets.map((x: Json) => ({ label: `${x.name}${x.name.startsWith('웨지') ? ' (11시부터)' : ''} +${x.addPrice.toLocaleString('ko-KR')}`, on: c.set === x.name, click: () => set({ set: x.name, setItem: (o.setItems?.[x.name] ?? []).length === 1 ? o.setItems[x.name][0] : undefined }) }))]));
    // 세트에서 고를 것 (공식 사이드 메뉴) — 고르면 그 공식 열량을 주문서에 더함
    const items: string[] = c.set ? (o.setItems?.[c.set] ?? []) : [];
    if (c.set === '수프 음료 세트') parts.push(h('p', { class: 'meta', id: 'soup-note' }, '수프는 그날 매장에서 나오는 오늘의 수프예요 (포테이토 베이컨·콘·머쉬룸 중 하나)'));
    if (items.length > 1) parts.push(segment(`${c.set!.replace(' 음료 세트', '')} 고르기`, items.map((n) => ({ label: n, on: c.setItem === n, click: () => set({ setItem: c.setItem === n ? undefined : n }) }))));
    // 웨지 포테이토는 오전 11시부터 (공식 홈페이지)
    if (c.set?.startsWith('웨지') && seoulMinute() < 660) parts.push(h('p', { class: 'notice warn', id: 'wedge-time' }, '웨지 포테이토는 오전 11시부터 나와요. 지금은 다른 세트를 골라 주세요'));
    if (c.set && o.drinks?.length) {
      parts.push(segment('세트 음료', o.drinks.map((d: string) => ({ label: d, on: c.drink === d, click: () => set({ drink: c.drink === d ? undefined : d }) }))));
      // 세트 음료는 매장 기계 음료 16oz (공식 주문 시스템: "음료(16oz)") — 고른 종류가 있는지는 매장마다 달라 매장 확인 (10/19 고침: 전엔 "탄산음료·커피만"이라고 잘못 안내)
      parts.push(h('p', { class: 'meta' }, state.prefs.goal === 'LIGHT' ? '세트 음료는 매장 기계 음료(16oz)예요. 가볍게 드시려면 아래 단품에서 제로 캔(코카콜라 제로·스프라이트 제로)을 고를 수도 있어요' : '세트 음료는 매장 기계 음료(16oz)예요. 고른 종류가 있는지 매장에서 확인해요'));
    }
  }
  if (wrap) parts.push(h('p', { class: 'meta' }, '랩은 구성이 정해져 있어요'));
  // 단품 더하기 (10/19): 공식 주문 시스템의 음료·쿠키·칩·웨지·수프 — 샌드위치에 더하거나 단품만
  parts.push(extrasPicker(o, c, set, mark, singlesOnly));
  // 샐러드는 빵·치즈·야채를 바꿀 수 없음 (써브웨이 선택 규칙) — 옵션이 갑자기 줄어든 것처럼 보이지 않게 (10/16)
  if (salad) parts.unshift(h('p', { class: 'meta' }, '샐러드는 빵·치즈·야채가 정해져 있어요. 소스·토핑·세트만 고를 수 있어요'));
  // [평소처럼] (10/17): 주문 기록에서 늘 뺀 야채·늘 더한 야채·늘 고른 소스·빵을 한 번에. 이 메뉴에서 바꿀 수 있는 것만
  const u = usualChoices(store.orders(), store.suppressedKeys());
  const usual: Partial<Choices> = {
    ...(sandwich && u.removeVegetables.length ? { removeVegetables: u.removeVegetables.filter((v) => vegs.includes(v)) } : {}),
    ...(sandwich && u.addVegetables.length ? { addVegetables: u.addVegetables.filter((v) => vegs.includes(v) && !u.removeVegetables.includes(v)) } : {}),
    ...(!wrap && !singlesOnly && u.sauces.length ? { sauces: u.sauces.slice(0, 3) } : {}),
    ...(sandwich && u.bread ? { bread: u.bread } : {}),
  };
  const usualText = [
    usual.removeVegetables?.length ? `${usual.removeVegetables.map((v) => o.vegetables.find((x: Json) => x.id === v)?.name ?? v).join('·')} 빼기` : '',
    usual.addVegetables?.length ? `${usual.addVegetables.map((v) => o.vegetables.find((x: Json) => x.id === v)?.name ?? v).join('·')} 더` : '',
    usual.sauces?.length ? `소스 ${usual.sauces.map((v) => o.sauces.find((x: Json) => x.id === v)?.name ?? v).join('·')}` : '',
    usual.bread ? `빵 ${o.breads.find((x: Json) => x.id === usual.bread)?.name ?? usual.bread}` : '',
  ].filter(Boolean);
  if (state.usualApplied) {
    const back = h('button', { type: 'button', class: 'btn-text', id: 'usual-undo' }, '되돌리기');
    const before = state.usualApplied.before;
    back.addEventListener('click', () => {
      state.usualApplied = null;
      state.choices = { ...before };
      renderOptions();
      void refreshSheet();
    });
    parts.unshift(h('p', { class: 'notice', id: 'usual-applied' }, `평소대로 넣었어요: ${state.usualApplied.text.join(', ')} `, back));
  } else if (usualText.length) {
    const b = h('button', { type: 'button', class: 'btn-text', id: 'usual' }, '평소처럼');
    b.addEventListener('click', () => {
      // 알레르기로 자동으로 뺀 야채는 다시 넣지 않음
      const keepRemoved = c.removeVegetables ?? [];
      set({ ...usual, ...(usual.removeVegetables ? { removeVegetables: [...new Set([...keepRemoved, ...usual.removeVegetables])] } : {}), ...(usual.addVegetables ? { addVegetables: usual.addVegetables.filter((v) => !keepRemoved.includes(v)) } : {}) });
    });
    parts.unshift(h('p', { class: 'usual' }, b, h('span', { class: 'meta' }, ` ${usualText.join(', ')}`)));
  }
  $('options').replaceChildren(...parts);
}

async function refreshSheet() {
  if (!state.menu) return;
  const seq = ++sheetSeq;
  // 10/22 예형님: 음료·사이드만에서 마지막 하나를 빼면 주문서 규칙(담은 게 없음)에 거절돼 다시 넣어지던 것 → 비운 채로 안내
  if (state.menu.id === SINGLES_MENU.id && !(state.choices.extras ?? []).length) {
    state.sheet = null;
    state.goodChoices = { ...state.choices };
    put($('sheet'));
    put($('line-notes'), h('p', { class: 'notice', id: 'sheet-empty' }, '아직 담은 음료·사이드가 없어요. ④에서 고르면 주문서가 생겨요'));
    saveActive();
    renderSlots();
    return;
  }
  const al = slotAllergies();
  const r = await api('/api/order-sheet', { menuId: state.menu.id, choices: state.choices, ...(al.length ? { allergies: al } : {}) });
  if (seq !== sheetSeq) return;
  // 알레르기: 메인 재료가 아니면 그 재료를 자동으로 뺌 — 메뉴를 고른 뒤(또는 알레르기를 바꾼 뒤) 한 번만. 사용자가 다시 넣으면 그대로 둠
  if (r.http === 200 && state.allergyPending) {
    state.allergyPending = false;
    const av = r.allergyAvoid;
    state.allergyNotes = av?.notes ?? [];
    if (av && (av.removeVegetables.length || (av.bread && !state.choices.bread))) {
      state.choices = {
        ...state.choices,
        removeVegetables: [...new Set([...(state.choices.removeVegetables ?? []), ...av.removeVegetables])],
        ...(av.bread && !state.choices.bread ? { bread: av.bread } : {}),
        addVegetables: (state.choices.addVegetables ?? []).filter((v: string) => !av.removeVegetables.includes(v)),
      };
      renderOptions();
      return refreshSheet();
    }
  }
  if (r.http !== 200) {
    const msg = r.http === 0 ? '인터넷 연결을 확인해 주세요' : (r.messages ?? r.reasons ?? [r.error]).join(' / ');
    // 거절된 선택은 적용하지 않는다: 마지막으로 맞았던 선택으로 되돌리고 화면도 맞춤
    if (r.http !== 0) {
      state.choices = { ...state.goodChoices };
      renderOptions();
    }
    const old = $('sheet').querySelector('.sheet');
    put($('sheet'), h('p', { class: 'notice bad' }, `${msg}${r.http !== 0 ? ' — 바꾸기 전으로 돌렸어요' : ''}`), old);
    return;
  }
  state.goodChoices = { ...state.choices };
  state.sheet = r;
  saveActive();
  renderSlots();
  const n = r.nutrition;
  const est = n.status === 'ESTIMATE' ? h('span', { class: 'estimate' }, '추정') : null;
  const veg = r.vegetables;
  const row = (k: string, v: string | Node) => [h('dt', {}, k), h('dd', {}, v)];
  const allergy = r.allergens.contains.length ? r.allergens.contains.join('·') : '없음';
  const warning = sheetWarning(slotAllergies(), r.allergens);
  $('sheet').replaceChildren(
    h('section', { class: 'sheet', 'aria-label': '주문서' },
      menuImage(state.menu?.id === r.menu.id ? state.menu : null, 'sheet-img'),
      sheetPics(r),
      h('div', { class: 'sheet-head' }, h('h3', {}, `${slots.list.length > 1 && curSlot() ? `${slotName(curSlot()!, slots.active)} · ` : ''}${r.menu.id === SINGLES_MENU.id ? '주문서 · 음료·사이드' : `주문서 · ${r.menu.name} ${r.size}`}`)),
      h('dl', {},
        ...(r.bread ? row('빵', r.bread) : []),
        ...(r.bread ? row('치즈', cheeseText(r)) : []),
        ...(veg.removed.length || veg.added.length ? row('야채', [veg.removed.length ? `${veg.removed.join('·')} 빼기` : '', veg.added.length ? `${veg.added.join('·')} 더` : ''].filter(Boolean).join(', ')) : []),
        ...(r.menu.id === SINGLES_MENU.id ? [] : row('소스', r.sauces.length ? r.sauces.join('·') : '없음')),
        ...((r.extras ?? []).length ? row('단품', (r.extras as Json[]).map((e) => `${e.name}${e.qty > 1 ? ` ×${e.qty}` : ''}`).join(', ')) : []),
        ...(r.toppings.length ? row('추가 토핑', r.toppings.join('·')) : []),
        ...(r.set ? row('세트', [r.set, r.setItem, r.drink ? `${r.drink} (매장에서 확인)` : null].filter(Boolean).join(' · ')) : []),
        ...(r.toasted === false ? row('토스팅', '안 함') : []),
        ...row('열량', h('span', {}, n.energyKcal == null ? '확인 필요' : `${n.energyKcal}kcal`, est)),
        ...row('알레르기', allergy),
      ),
      r.allergens.mayContain.length ? h('p', { class: 'notice warn' }, `포함 가능(★): ${r.allergens.mayContain.join('·')}`) : null,
      r.allergens.unknownParts.length ? h('p', { class: 'notice warn' }, `알레르기 확인 필요: ${r.allergens.unknownParts.join('·')}`) : null,
      h('p', { class: 'total' }, `참고 금액 ${won(r.price.total)}`, r.price.needsCheck.length ? h('span', { class: 'estimate' }, `${r.price.needsCheck.join('·')} 가격 확인 필요`) : null),
      // 예산은 메뉴 15cm 가격으로 메뉴를 고르는 데 썼다 → 토핑·세트·30cm로 합계가 넘으면 알려 줌 (막지는 않음, 10/16)
      ...n.notes.map((x: string) => h('p', { class: 'meta' }, x)),
      h('p', { class: 'meta' }, '금액은 매장에서 다를 수 있어요. 결제는 매장에서 해요'),
    ),
  );
  // 고르는 동안 봐야 할 것은 ④ 아래에 (10/27: 주문서는 [이대로 주문하기]를 누를 때만 보여서)
  put($('line-notes'),
    h('div', { class: 'line-notes-head' }, h('span', { class: 'meta' }, `참고 금액 ${won(r.price.total)}${n.energyKcal == null ? '' : ` · ${n.energyKcal}kcal`}`), favButton()),
    ...state.reorderNotes.map((x) => h('p', { class: 'notice warn', 'data-reorder-note': '' }, x)),
    warning ? h('p', { class: `notice ${warning.level}`, id: 'sheet-allergy', role: 'alert' }, warning.text) : null,
    missingNotice(r),
    ...state.allergyNotes.map((x) => h('p', { class: 'notice', 'data-allergy-note': '' }, `✓ ${x}`)),
    state.prefs.budgetKrw && r.price.total > state.prefs.budgetKrw
      ? h('p', { class: 'notice warn', id: 'sheet-budget' }, `예산 ${won(state.prefs.budgetKrw)}보다 ${won(r.price.total - state.prefs.budgetKrw)} 넘어요 (토핑·세트·크기 때문)`)
      : null,
    slots.plans.length ? null : h('p', { class: 'meta', id: 'to-cart-hint' }, '다 골랐으면 ⑤ 장바구니에서 [이대로 주문하기]'),
  );
}

/** 아직 안 고른 것 알려 주기 (10/22 예형님: 알려만 주고 막지는 않음) */
function missingNotice(r: Json) {
  const c = state.choices;
  const miss: string[] = [];
  if (r.menu.id !== SINGLES_MENU.id) {
    if (r.bread && c.bread === undefined) miss.push(`빵 (지금은 ${r.bread})`);
    if (c.sauces === undefined) miss.push('소스 (안 고르면 소스 없이)');
  }
  if (r.set && !r.setItem) miss.push('세트 구성품');
  if (r.set && !r.drink) miss.push('세트 음료');
  if (!miss.length) return null;
  return h('div', { class: 'notice missing', id: 'sheet-missing' },
    h('p', {}, '아직 안 고른 것'),
    h('ul', {}, ...miss.map((x) => h('li', {}, x))),
    h('p', { class: 'meta' }, '④ 옵션 고르기에서 고를 수 있어요. 안 골라도 주문서는 그대로 쓸 수 있어요'),
  );
}

/** 주문서에 세트 구성품·세트 음료·단품 사진 (10/21 예형님) — 공식 사진이 있는 것만 (캔 음료·커피·오늘의 수프는 이름만) */
function sheetPics(r: Json) {
  const byName = (n: string) => (state.options?.menus ?? []).find((m: Json) => m.name === n && m.image);
  const sideName = (n: string) => n.replace(/ 쿠키$/, '').replace(/^칩 \(랜덤발송\)$/, '칩');
  const items: Array<{ label: string; m: Json | undefined }> = [];
  if (r.setItem) items.push({ label: r.setItem, m: byName(sideName(r.setItem)) });
  if (r.drink) items.push({ label: `${r.drink} (16oz)`, m: /콜라|사이다/.test(r.drink) ? byName('탄산음료') : undefined });
  for (const e of (r.extras ?? []) as Json[]) items.push({ label: `${e.name}${e.qty > 1 ? ` ×${e.qty}` : ''}`, m: byName(sideName(e.name)) });
  if (!items.length) return null;
  return h('ul', { class: 'sheet-pics', 'aria-label': '함께 담은 것' }, ...items.map((x) => h('li', {}, x.m ? menuImage(x.m, 'pic') : h('span', { class: 'pic none', 'aria-hidden': 'true' }, '🥤'), h('span', { class: 'cap' }, x.label))));
}

// ── 장바구니 (8단계 + 10/26 예형님 "배민처럼") ──
// ③ 카드 [담기] → 장바구니에 한 줄 (화면은 그대로라 계속 고름). 같은 메뉴·같은 옵션은 한 줄 + 수량.
// 지금 화면의 ④ 옵션(state.menu·choices·sheet)은 "지금 연 줄". ⑤ 장바구니 → [이대로 주문하기] → ⑥ 주문서(모든 줄). 위 🛒 + 개수, 아래 "○○원 · 주문하기 N".
// 줄마다 [내 거] [같이 먹는 사람 거]: 같이 먹는 사람 줄은 내 평소 옵션·내 알레르기 없이 그 사람이 말한 알레르기만. 기록·취향은 내 줄만.
// 장바구니는 이 휴대폰에만, 주문하거나 비우거나 3시간이 지나면 사라짐.
interface Slot {
  menu: Json | null;
  choices: Choices;
  goodChoices: Choices;
  sheet: Json | null;
  menuBy: null | 'user' | 'talk' | 'ai';
  usualApplied: null | { before: Choices; text: string[] };
  allergyNotes: string[];
  reorderNotes: string[];
  owner: 'me' | 'guest';
  /** 말로 붙인 이름 ("민수") */
  name?: string;
  /** 이름 없는 같이 먹는 사람 번호 (10/27 예형님: 3명인데 "같이 먹는 사람" 하나로만 골라지던 것 → "같이 먹는 사람 1·2") */
  guestNo?: number;
  /** 같이 먹는 사람 줄: 그 사람이 말한 알레르기 */
  allergies: string[];
  qty: number;
  /** 담을 때의 메뉴+옵션 (같은 게 또 담기면 수량만 늘림) */
  addKey: string;
}
interface Plan {
  slot: number;
  /** 그 줄에 한 말 그대로 (고를 때 옵션으로 다시 씀) */
  label: string;
  /** 화면에 보일 짧은 이름 (10/27 예형님: 말을 그대로 쓰면 길고 보기 싫음) — 없으면 사람 이름 */
  show?: string;
  /** AI 명령이 정한 그 줄 옵션 (메뉴를 고르면 그대로 넣음) */
  choices?: Choices;
  prefs: Partial<Prefs>;
}
const MAX_QTY = 10;
const CART_KEY = 'subway.cart';
const CART_KEEP_MS = 3 * 3600_000;
/** 같이 먹는 사람 알레르기 칸을 열어 둔 채로 (다시 그려도 닫히지 않게) */
let guestAllergyOpen = false;
const slots = { list: [] as Slot[], active: 0, adding: false, who: null as null | 'mine' | 'shared', plans: [] as Plan[], recFor: null as number | null, known: [] as Array<Pick<Slot, 'owner' | 'name' | 'guestNo'>> };
const emptySlot = (owner: Slot['owner'] = 'me', name?: string): Slot => ({ menu: null, choices: {}, goodChoices: {}, sheet: null, menuBy: null, usualApplied: null, allergyNotes: [], reorderNotes: [], owner, ...(name ? { name } : {}), ...(owner === 'guest' && !name ? { guestNo: nextGuestNo() } : {}), allergies: [], qty: 1, addKey: '' });
const filled = () => slots.list.filter((s) => s.menu);
const cartCount = () => filled().reduce((a, s) => a + s.qty, 0);
const cartTotal = () => filled().reduce((a, s) => a + (s.sheet?.price?.total ?? 0) * s.qty, 0);
/** 지금 연 줄 */
const curSlot = (): Slot | undefined => slots.list[slots.active];
/** 이 줄의 알레르기: 내 줄은 내 알레르기, 같이 먹는 사람 줄은 그 사람이 말한 것만 */
function slotAllergies(s: Slot | undefined = curSlot()): string[] {
  return !s || s.owner === 'me' ? state.prefs.allergies : s.allergies;
}
const nextOwner = (): Slot['owner'] => (slots.who === 'shared' ? 'guest' : 'me');
const keyOf = (menuId: string, c: Choices, who: Pick<Slot, 'owner' | 'name' | 'guestNo'>) => `${menuId}|${personKey(who)}|${JSON.stringify(Object.keys(c).sort().reduce((o: Record<string, unknown>, k) => ((o[k] = (c as Record<string, unknown>)[k]), o), {}))}`;
/** 지금 화면 → 줄 */
function saveActive() {
  const prev = curSlot();
  if (!state.menu) return;
  slots.list[slots.active] = { menu: state.menu, choices: state.choices, goodChoices: state.goodChoices, sheet: state.sheet, menuBy: state.menuBy, usualApplied: state.usualApplied, allergyNotes: state.allergyNotes, reorderNotes: state.reorderNotes, owner: prev?.owner ?? 'me', ...(prev?.name ? { name: prev.name } : {}), ...(prev?.guestNo ? { guestNo: prev.guestNo } : {}), allergies: prev?.allergies ?? [], qty: prev?.qty ?? 1, addKey: prev?.addKey ?? '' };
  saveCart();
}
/** 줄 → 지금 화면 (줄을 누름) */
function loadSlot(i: number, scroll = true) {
  closeCart(); // 장바구니 화면에서 줄을 누르면 주문 화면의 그 줄로
  if (i === slots.active && state.menu) {
    if (scroll) goTo('step-order');
    return;
  }
  saveActive();
  slots.active = i;
  const s = slots.list[i]!;
  if (!s.menu) {
    slots.recFor = i;
    // 앞 사람 메뉴가 ④에 남아 이 빈 줄에 저장되지 않게 (10/27)
    Object.assign(state, { menu: null, choices: {}, goodChoices: {}, sheet: null });
    $('step-order').hidden = true;
    renderSlots();
    void recommend();
    goTo('step-menu');
    return;
  }
  Object.assign(state, { menu: s.menu, choices: s.choices, goodChoices: s.goodChoices, sheet: s.sheet, menuBy: s.menuBy, usualApplied: s.usualApplied, allergyNotes: s.allergyNotes, reorderNotes: s.reorderNotes });
  state.allergyPending = false;
  $('step-order').hidden = false;
  put($('picked'), s.menu.name);
  renderOptions();
  void refreshSheet();
  renderSlots();
  if (scroll) goTo('step-order');
}
/** pickMenu 전에: 어느 줄에 담을지 (칸마다 추천 → 그 줄, 담겨 있으면 → 새 줄, 처음 → 1번 줄) */
function slotForPick(replace = false) {
  // 10/27 예형님: [담기] 뒤 바로 다음 사람으로 넘어가지 않음 — 옵션·세트를 고르고 [다음 사람 고르기]로 넘어감.
  // 같은 사람이 또 [담기] → 그 사람 줄 하나 더 (전엔 다음 사람 줄이 채워져 "한 사람은 두 개를 못 먹던" 것)
  if (slots.recFor !== null && slots.list[slots.recFor]) {
    saveActive();
    const target = slots.list[slots.recFor]!;
    if (!target.menu || replace) {
      slots.active = slots.recFor;
      return;
    }
    if (slots.list.length >= MAX_SLOTS) {
      slots.active = slots.recFor;
      return;
    }
    // 그 사람 마지막 줄 바로 뒤에 (장바구니에서 사람끼리 모이게) — 뒤 줄 번호를 가리키던 추천 칸은 한 칸씩 밀림
    const at = slots.list.reduce((last, x, i) => (personKey(x) === personKey(target) ? i : last), slots.recFor) + 1;
    slots.list.splice(at, 0, { ...emptySlot(target.owner, target.name), ...(target.guestNo ? { guestNo: target.guestNo } : {}), allergies: [...target.allergies] });
    shiftPlans(at, 1);
    slots.active = at;
    return;
  }
  const add = slots.adding || (!replace && filled().length > 0);
  slots.adding = false;
  if (add && slots.list.length < MAX_SLOTS) {
    saveActive();
    slots.list.push(emptySlot(nextOwner()));
    slots.active = slots.list.length - 1;
    return;
  }
  if (!slots.list.length) slots.list.push(emptySlot());
}
/** 줄을 끼우거나(+1) 뺐을 때(-1): from 번째 줄부터 뒤를 가리키던 추천 칸 번호를 맞춤 */
function shiftPlans(from: number, by: 1 | -1) {
  for (const p of slots.plans) if (p.slot >= from) p.slot += by;
  if (slots.recFor !== null && slots.recFor >= from) slots.recFor += by;
}
/** 담은 뒤: 같은 메뉴·같은 옵션이 이미 있으면 그 줄 수량 +1 (새 줄은 지움) — true면 합쳤음 */
function mergeIfSame(): boolean {
  const s = curSlot();
  if (!s || !state.menu) return false;
  const key = keyOf(state.menu.id, state.choices, s);
  s.addKey = key;
  const j = slots.list.findIndex((x, i) => i !== slots.active && x.menu && x.addKey === key && keyOf(x.menu.id, x.choices, x) === key && x.qty < MAX_QTY);
  if (j < 0) return false;
  slots.list[j]!.qty += 1;
  const gone = slots.active;
  slots.list.splice(gone, 1);
  const to = j > gone ? j - 1 : j;
  // 지운 줄을 가리키던 추천 칸은 합친 줄로
  for (const p of slots.plans) if (p.slot === gone) p.slot = to;
  if (slots.recFor === gone) slots.recFor = to;
  shiftPlans(gone + 1, -1);
  slots.active = to;
  const t = slots.list[slots.active]!;
  Object.assign(state, { menu: t.menu, choices: t.choices, goodChoices: t.goodChoices, sheet: t.sheet });
  return true;
}
function resetSlots() {
  slots.known = [];
  slots.list = [];
  slots.active = 0;
  slots.adding = false;
  slots.plans = [];
  slots.recFor = null;
  slots.who = null;
}
/** 다른 메뉴 담기 (장바구니의 [+ 메뉴 더 담기]) */
function addSlot() {
  if (slots.list.length >= MAX_SLOTS) return;
  closeCart();
  slots.adding = true;
  slots.recFor = null; // 사람마다 추천 중이어도 새 줄로
  unlockRecs();
  put($('talk-result'), h('p', { class: 'notice', id: 'adding-note' }, '③ 추천에서 [담기]를 누르거나 말해 주세요'));
  goTo('step-menu');
}
/** "다 드실 거예요?" 답 — 같이 먹는다고 하면 1번은 나, 2번부터 같이 먹는 사람 (줄마다 바꿀 수 있음) */
function answerWho(who: 'mine' | 'shared') {
  slots.who = who;
  if (who === 'shared') slots.list.forEach((s, i) => i > 0 && s.owner === 'me' && !s.name && ((s.owner = 'guest'), (s.guestNo = nextGuestNo())));
  else slots.list.forEach((s) => (s.owner = 'me'));
  state.allergyPending = true;
  renderSlots();
  void refreshAllSlots();
}
function removeSlot(i: number) {
  saveActive();
  slots.list.splice(i, 1);
  slots.plans = slots.plans.filter((p) => p.slot !== i).map((p) => ({ ...p, slot: p.slot > i ? p.slot - 1 : p.slot }));
  if (!slots.list.length) {
    resetSlots();
    Object.assign(state, { menu: null, choices: {}, goodChoices: {}, sheet: null });
    $('step-order').hidden = true;
    $('step-sheet').hidden = true;
    saveCart();
    renderSlots();
    return;
  }
  slots.active = Math.min(slots.active > i ? slots.active - 1 : slots.active, slots.list.length - 1);
  const s = slots.list[slots.active]!;
  if (s.menu) {
    Object.assign(state, { menu: s.menu, choices: s.choices, goodChoices: s.goodChoices, sheet: s.sheet });
    put($('picked'), s.menu.name);
    renderOptions();
    void refreshSheet();
  }
  saveCart();
  renderSlots();
}
function setQty(i: number, q: number) {
  const s = slots.list[i];
  if (!s) return;
  if (q < 1) return removeSlot(i);
  s.qty = Math.min(MAX_QTY, q);
  saveCart();
  renderSlots();
}
/** 같은 줄 여러 개 중 하나만 옵션을 다르게 (10/26): 수량 1을 떼어 새 줄 */
function splitOne() {
  if (!curSlot() || curSlot()!.qty < 2 || slots.list.length >= MAX_SLOTS) return;
  saveActive(); // 줄 객체가 새로 바뀌므로 저장한 뒤에 다시 꺼냄 (10/26: 먼저 꺼내 2+1=3개가 되던 것)
  const s = curSlot()!;
  s.qty -= 1;
  slots.list.splice(slots.active + 1, 0, { ...s, choices: { ...s.choices }, goodChoices: { ...s.goodChoices }, allergies: [...s.allergies], qty: 1, addKey: '' });
  slots.active += 1;
  saveCart();
  renderSlots();
  goTo('step-order');
}
const ownerText = (s: Pick<Slot, 'owner' | 'name' | 'guestNo'>) => (s.owner === 'me' ? '나' : s.name ?? (s.guestNo ? `같이 먹는 사람 ${s.guestNo}` : '같이 먹는 사람'));
/** 사람 하나를 가리키는 값 (같은 사람 줄 찾기) */
const personKey = (s: Pick<Slot, 'owner' | 'name' | 'guestNo'>) => (s.owner === 'me' ? 'me' : s.name ? `n:${s.name}` : `g:${s.guestNo ?? 0}`);
/** 사람마다 추천 칸의 이름: 짧게 줄인 말, 없으면 그 줄 사람 ("나", "민수", "같이 먹는 사람 1") */
const planName = (p: Plan | undefined) => (!p ? '' : p.show ?? (slots.list[p.slot] ? ownerText(slots.list[p.slot]!) : p.label));
const nextGuestNo = () => Math.max(0, ...slots.list.map((s) => s.guestNo ?? 0)) + 1;
/** 장바구니에 있는 사람들 (나 먼저, 나온 순서대로) */
function people(): Array<Pick<Slot, 'owner' | 'name' | 'guestNo'>> {
  const seen = new Map<string, Pick<Slot, 'owner' | 'name' | 'guestNo'>>([['me', { owner: 'me' }]]);
  // 한 번 나온 사람은 기억 (10/27 예형님: 그 사람 줄을 [나]로 바꾸면 그 사람이 버튼에서 사라지던 것)
  for (const s of [...slots.known, ...slots.list]) if (!seen.has(personKey(s))) seen.set(personKey(s), { owner: s.owner, ...(s.name ? { name: s.name } : {}), ...(s.guestNo ? { guestNo: s.guestNo } : {}) });
  slots.known = [...seen.values()].filter((x) => x.owner !== 'me');
  return [...seen.values()];
}
/** 사람끼리 모이게 줄 순서를 맞춤 (나온 순서대로) — 추천 칸·지금 줄 번호도 같이 (10/27 예형님: 1번·2번·3번이 세 사람처럼 보이던 것) */
function groupSlots() {
  const order: string[] = [];
  for (const x of slots.list) if (!order.includes(personKey(x))) order.push(personKey(x));
  const idx = slots.list.map((_, i) => i).sort((a, b) => order.indexOf(personKey(slots.list[a]!)) - order.indexOf(personKey(slots.list[b]!)) || a - b);
  if (idx.every((v, i) => v === i)) return;
  const map = new Map(idx.map((old, neu) => [old, neu]));
  slots.list = idx.map((i) => slots.list[i]!);
  for (const pl of slots.plans) pl.slot = map.get(pl.slot) ?? pl.slot;
  if (slots.recFor !== null) slots.recFor = map.get(slots.recFor) ?? slots.recFor;
  slots.active = map.get(slots.active) ?? slots.active;
}
/** 사람마다 줄 묶음 (나온 순서대로) */
function groupsOf(): Array<{ key: string; who: Pick<Slot, 'owner' | 'name' | 'guestNo'>; lines: number[] }> {
  const out: Array<{ key: string; who: Pick<Slot, 'owner' | 'name' | 'guestNo'>; lines: number[] }> = [];
  slots.list.forEach((x, i) => {
    const g = out.find((o) => o.key === personKey(x));
    if (g) g.lines.push(i);
    else out.push({ key: personKey(x), who: x, lines: [i] });
  });
  return out;
}
/** "이렇게 이해했어요" 줄 칸 — 사람이 둘 이상이면 사람별로 묶음 (10/28 예형님: 1~4번이 나란히 있으면 4명이 먹는 것처럼 보임) */
function understoodLines(lines: number[], text: (i: number) => string, lead: HTMLElement[] = []): HTMLElement[] {
  const groups = groupsOf().map((g) => ({ ...g, lines: g.lines.filter((i) => lines.includes(i)) })).filter((g) => g.lines.length);
  const tag = (i: number, who: boolean) => {
    const s = slots.list[i]!;
    return h('span', { class: 'tag' }, `${i + 1}번${who && (s.owner === 'guest' || s.name) ? ` ${ownerText(s)}` : ''}: ${text(i)}`);
  };
  if (groups.length < 2) return [h('div', { class: 'understood', 'aria-label': '이렇게 이해했어요' }, ...lead, ...lines.map((i) => tag(i, true)))];
  return [
    ...(lead.length ? [h('div', { class: 'understood' }, ...lead)] : []),
    h('div', { class: 'understood-people', 'aria-label': '이렇게 이해했어요' },
      ...groups.map((g) => h('div', { class: 'plan-person' }, h('span', { class: 'plan-who' }, ownerText(g.who)), h('div', { class: 'understood' }, ...g.lines.map((i) => tag(i, false)))))),
  ];
}
/** 옵션 한 줄 (음료·사이드·빼기까지, 10/27 예형님: "매운 거 + 제로콜라"가 "매운 거"로만 보이던 것) */
function choiceText(ch: Json): string {
  if (!ch) return '';
  const o = state.options ?? {};
  const nm = (list: Json[] | undefined, id: string) => String(list?.find((x: Json) => x.id === id)?.name ?? id).replace(/^vegetable:/, '');
  return [
    ch.set ?? '', ch.setItem ?? '', ch.drink ?? '',
    ...((ch.extras ?? []) as Json[]).map((e) => `${nm(o.singles, e.id).replace(/\s*\(\d+ml\)$/, '')}${e.qty > 1 ? ` ×${e.qty}` : ''}`),
    ...((ch.removeVegetables ?? []) as string[]).map((v) => `${nm(o.vegetables, v)} 빼기`),
    ...((ch.addVegetables ?? []) as string[]).map((v) => `${nm(o.vegetables, v)} 더`),
    ch.size === '30cm' ? '30cm' : '', ch.cheese === null ? '치즈 빼기' : '', Array.isArray(ch.sauces) && !ch.sauces.length ? '소스 없이' : '',
  ].filter(Boolean).join(' + ');
}
const slotName = (s: Slot, i: number) => `${i + 1}번 · ${ownerText(s)}`;
const lineTitle = (s: Slot) => (s.menu ? (s.menu.id === SINGLES_MENU.id ? '음료·사이드' : `${s.menu.name}${s.sheet?.size ? ` ${s.sheet.size}` : ''}`) : '아직 안 고름');
/** 줄 옵션 한 줄 요약 */
function lineSummary(s: Slot): string {
  const r = s.sheet;
  if (!r) return '';
  return [
    r.bread,
    r.vegetables?.removed?.length ? `${r.vegetables.removed.join('·')} 빼기` : '',
    r.vegetables?.added?.length ? `${r.vegetables.added.join('·')} 더` : '',
    r.sauces?.length ? r.sauces.join('·') : r.menu?.id === SINGLES_MENU.id ? '' : '소스 없음',
    r.set ?? '',
    (r.extras ?? []).map((e: Json) => `${e.name}${e.qty > 1 ? ` ×${e.qty}` : ''}`).join(', '),
  ].filter(Boolean).join(' · ');
}
/** 줄 경고 (알레르기·아침 메뉴 시간·웨지·가격 확인) */
function lineWarn(s: Slot): string[] {
  const r = s.sheet;
  if (!r || !s.menu) return [];
  const out: string[] = [];
  const w = sheetWarning(slotAllergies(s), r.allergens);
  if (w) out.push(w.level === 'bad' ? '알레르기 들어 있음' : '알레르기 확인');
  const min = seoulMinute();
  if ((s.menu.kind === 'MORNING_SANDWICH' || s.menu.kind === 'MORNING_WRAP') && (min < BREAKFAST_SALE.fromMinute || min >= BREAKFAST_SALE.untilMinute)) out.push('아침 메뉴 시간 아님');
  if (r.set?.startsWith('웨지') && min < 660) out.push('웨지는 11시부터');
  if (r.price?.needsCheck?.length) out.push('가격 확인');
  return out;
}
/** 위 🛒 개수 · 아래 "○○원 · 주문하기 N" · ⑤ 장바구니 · ④ 위 줄 정보 · ② 아래 "다 드실 거예요?" · ④ 아래 [다음 사람 고르기] · ③ 위 칸마다 추천 */
function renderSlots() {
  const n = cartCount();
  const badge = $('cart-count');
  badge.hidden = n === 0;
  badge.textContent = String(n);
  $('cart-btn').setAttribute('aria-label', `장바구니 (${n}개)`);
  const bar = $('cart-bar');
  bar.hidden = n === 0 || $('app').dataset.tab === 'taste';
  $('cart-bar-total').textContent = won(cartTotal());
  $('cart-bar-n').textContent = String(n);
  // ⑤ 장바구니
  const sec = $('step-cart');
  sec.hidden = !slots.list.length;
  const parts: Node[] = [];
  // 사람마다 묶음 (10/27 예형님: "1번·2번·3번"이 세 사람처럼 보이던 것 → "나 · 2개" 아래 그 사람 줄). 줄 번호는 말로 고칠 때 쓰니 그대로
  const line = (s: Slot, i: number) => {
    const plan = slots.plans.find((p) => p.slot === i);
    const open = h('button', { type: 'button', class: `cart-line${i === slots.active ? ' on' : ''}${s.menu ? '' : ' empty'}`, 'data-slot': String(i), 'aria-current': i === slots.active ? 'true' : undefined },
      s.menu ? menuImage(s.menu, 'cart-pic') : null,
      h('span', { class: 'cart-who' }, groupsOf().length > 1 ? `${i + 1}번` : slotName(s, i)),
      h('span', { class: 'cart-name' }, s.menu ? lineTitle(s) : `아직 안 고름${plan?.show && plan.show !== '추천에서 고르기' ? ` (${plan.show})` : ''}`),
      s.menu ? h('span', { class: 'cart-opts' }, lineSummary(s)) : null,
      ...lineWarn(s).map((x) => h('span', { class: 'cart-warn' }, `⚠ ${x}`)));
    open.addEventListener('click', () => loadSlot(i));
    const kids: Node[] = [open];
    if (s.menu) {
      const minus = h('button', { type: 'button', class: 'qty', 'aria-label': `${lineTitle(s)} 하나 빼기`, 'data-qty-minus': String(i) }, s.qty > 1 ? '−' : '🗑');
      const plus = h('button', { type: 'button', class: 'qty', 'aria-label': `${lineTitle(s)} 하나 더`, 'data-qty-plus': String(i), disabled: s.qty >= MAX_QTY }, '+');
      minus.addEventListener('click', () => setQty(i, s.qty - 1));
      plus.addEventListener('click', () => setQty(i, s.qty + 1));
      kids.push(h('div', { class: 'cart-qty' }, minus, h('span', { class: 'cart-n', 'aria-live': 'polite' }, `${s.qty}개`), plus, h('span', { class: 'cart-price' }, s.sheet ? won(s.sheet.price.total * s.qty) : '')));
    } else {
      const del = h('button', { type: 'button', class: 'btn-text' }, '빼기');
      del.addEventListener('click', () => removeSlot(i));
      kids.push(h('div', { class: 'cart-qty' }, del));
    }
    return h('li', {}, ...kids);
  };
  const groups = groupsOf();
  const manyPeople = groups.length > 1;
  parts.push(h('ol', { class: `cart-list${manyPeople ? ' grouped' : ''}`, 'aria-label': '담은 것' }, ...groups.map((g) => {
    const n = g.lines.reduce((a, i) => a + (slots.list[i]!.menu ? slots.list[i]!.qty : 0), 0);
    const sum = g.lines.reduce((a, i) => a + (slots.list[i]!.sheet?.price?.total ?? 0) * slots.list[i]!.qty, 0);
    return manyPeople
      ? h('li', { class: 'cart-group', 'data-person': g.key },
          h('p', { class: 'cart-person-head' }, h('strong', {}, ownerText(g.who)), n ? ` · ${n}개${sum ? ` · ${won(sum)}` : ''}` : ' · 아직 안 고름'),
          h('ol', { class: 'cart-group-lines' }, ...g.lines.map((i) => line(slots.list[i]!, i))))
      : h('li', { class: 'cart-group single' }, h('ol', { class: 'cart-group-lines' }, ...g.lines.map((i) => line(slots.list[i]!, i))));
  })));
  if (!slots.list.length) parts.push(h('p', { class: 'meta' }, '아직 담은 게 없어요. ③ 추천에서 [담기]를 눌러 주세요'));
  const total = cartTotal();
  parts.push(h('p', { class: 'cart-total', id: 'slot-total' }, `${n}개 합계 ${won(total)}`, filled().length < slots.list.length ? h('span', { class: 'meta' }, ` · ${slots.list.length - filled().length}줄은 아직 안 골랐어요`) : null));
  if (state.prefs.budgetKrw && n > 1 && total > state.prefs.budgetKrw) parts.push(h('p', { class: 'notice warn', id: 'cart-budget' }, `합계가 예산 ${won(state.prefs.budgetKrw)}보다 ${won(total - state.prefs.budgetKrw)} 넘어요 (예산을 1인당으로 쓰셨으면 괜찮아요)`));
  // "다 드실 거예요?"는 ② 메뉴 주문 바로 아래 — 여러 개라고 알아들은 순간 (10/27 예형님: 장바구니 맨 아래에 늦게 나오던 것)
  const whoBox = $('who-box');
  if ((n >= 2 || slots.list.length >= 2) && slots.who === null) {
    const mine = h('button', { type: 'button', class: 'btn-ghost', id: 'who-mine' }, '다 제가 먹어요');
    const shared = h('button', { type: 'button', class: 'btn-ghost', id: 'who-shared' }, '같이 먹을 사람 것도 있어요');
    mine.addEventListener('click', () => answerWho('mine'));
    shared.addEventListener('click', () => answerWho('shared'));
    put(whoBox, h('div', { class: 'notice who-ask', id: 'who-ask', role: 'group', 'aria-label': '누가 드세요' },
      h('p', {}, '여러 개를 담았어요. 다 드실 거예요?'),
      h('p', { class: 'meta' }, '같이 먹는 사람 것에는 내 평소 옵션·내 알레르기를 넣지 않고, 그 사람 알레르기만 따로 받아요'),
      h('div', { class: 'actions' }, mine, shared)));
  } else put(whoBox);
  // 10/27 예형님: "(3/5줄)" 숫자는 의미가 없어 뺌 — 누르면 ③ 추천으로
  if (filled().length && slots.list.length < MAX_SLOTS) {
    const add = h('button', { type: 'button', class: 'btn-ghost wide', id: 'slot-add' }, '+ 메뉴 더 담기');
    add.addEventListener('click', addSlot);
    parts.push(add);
  } else if (slots.list.length >= MAX_SLOTS) parts.push(h('p', { class: 'meta', id: 'slot-max' }, `한 번에 ${MAX_SLOTS}줄까지 담을 수 있어요 (줄마다 ${MAX_QTY}개까지)`));
  if (filled().length) {
    const go = h('button', { type: 'button', class: 'btn-primary wide', id: 'order-go' }, cartDone ? '넘긴 주문서 보기' : '이대로 주문하기');
    go.addEventListener('click', () => (cartDone ? openCart('step-sheet') : openOrder()));
    parts.push(go);
  }
  put($('cart-body'), ...parts);
  renderOrder();
  // ④ 위: 지금 연 줄 · 누구 거 · 같이 먹는 사람 알레르기 · 하나만 따로
  const head = $('slot-head');
  const s = curSlot();
  const many = slots.list.length > 1 || (s?.qty ?? 1) > 1;
  head.hidden = !many || !s || !s.menu;
  if (many && s && s.menu) {
    const kids: Node[] = [h('p', { class: 'slot-now' }, `지금 고르는 것: ${slotName(s, slots.active)}${s.qty > 1 ? ` · ${s.qty}개 모두 바뀌어요` : ''}`)];
    if (s.qty > 1 && slots.list.length < MAX_SLOTS) {
      const one = h('button', { type: 'button', class: 'btn-text', id: 'split-one' }, '하나만 따로 바꾸기');
      one.addEventListener('click', splitOne);
      kids.push(one);
    }
    if (slots.who === 'shared') {
      // 10/27 예형님: 사람이 3명이면 3명 다 (전엔 [내 거][같이 먹는 사람 거] 둘뿐)
      // 10/27 예형님: "같이 먹는 사람 1 거" → 사람 이름 + 그 사람이 고른 메뉴 (누구 줄인지 한눈에)
      const menusOf = (p: Pick<Slot, 'owner' | 'name' | 'guestNo'>) => slots.list.filter((x) => x.menu && personKey(x) === personKey(p)).map((x) => x.menu!.name);
      kids.push(segment('누가 먹어요?', [
        ...people().map((p) => ({ label: `${ownerText(p)}${menusOf(p).length ? ` · ${menusOf(p).join(', ')}` : ''}`, on: personKey(p) === personKey(s), click: () => setPerson(p) })),
        ...(people().length < MAX_SLOTS ? [{ label: '+ 사람 추가', on: false, click: () => setPerson('new') }] : []),
      ]));
      if (s.owner === 'guest') {
        const box = h('details', { class: 'allergy guest-allergy', id: 'guest-allergy', open: guestAllergyOpen },
          h('summary', {}, `${ownerText(s)} 알레르기 `, h('span', { id: 'guest-allergy-count' }, s.allergies.length ? `(${s.allergies.join('·')})` : '')),
          h('p', { class: 'meta' }, '그 사람이 말한 알레르기만 이 줄에 써요 (내 알레르기는 안 넣어요)'),
          segment('알레르기', (state.options?.allergens ?? []).map((a: string) => ({ label: a, on: s.allergies.includes(a), click: () => toggleGuestAllergy(a) }))));
        box.addEventListener('toggle', () => (guestAllergyOpen = (box as HTMLDetailsElement).open));
        kids.push(box);
      }
    }
    // 10/27 예형님: [앞 줄 사람과 같아요]·[이 줄 빼기] 없앰 (빼기는 장바구니 🗑)
    put(head, ...kids);
  }
  // ③ 위: 칸마다 따로 추천
  const pb = $('plan-bar');
  pb.hidden = !slots.plans.length;
  if (slots.plans.length)
    put(pb, h('p', { class: 'meta' }, '사람마다 따로 추천해요. 누르면 그 줄에 맞는 추천이 나와요'),
      // 10/27 예형님: 고른 것은 초록, 아직은 빨강 (지금 보는 것은 굵은 테두리), 사람끼리 묶음 ("나: 쇠고기·매운 거 / 돼지고기·매운 거")
      ...groupsOf().filter((g) => g.lines.some((i) => slots.plans.some((p) => p.slot === i))).map((g) =>
        h('div', { class: 'plan-person' },
          h('span', { class: 'plan-who' }, ownerText(g.who)),
          h('div', { class: 'seg' }, ...g.lines.map((i) => {
            const p = slots.plans.find((x) => x.slot === i);
            const done = !!slots.list[i]?.menu;
            const what = done ? slots.list[i]!.menu!.name : p?.show && p.show !== '추천에서 고르기' ? p.show : '추천에서 고르기';
            const b = h('button', { type: 'button', class: `chip plan ${done ? 'done' : 'todo'}${slots.recFor === i ? ' on' : ''}`, 'aria-pressed': String(slots.recFor === i), ...(done ? {} : { 'aria-label': `${i + 1}번: ${what} (아직 안 고름)` }), ...(p ? { 'data-plan': String(i) } : { 'data-line': String(i) }) }, `${i + 1}번: ${what}`); // 10/28 예형님: "· 아직" 뺌 — 빨간색이 이미 아직이라는 뜻
            b.addEventListener('click', () => {
              if (!p) return loadSlot(i); // 담기로 더한 줄은 그 줄 옵션으로
              slots.recFor = i;
              renderSlots();
              void recommend();
            });
            return b;
          })))));
  // ④ 아래: 이 사람 다 골랐으면 [다음 사람 고르기] → 위 ③으로 올라가 다음 사람 추천 (10/27 예형님)
  const np = $('next-person');
  const cur = curSlot();
  const nextPlan = slots.plans.find((p) => !slots.list[p.slot]?.menu);
  np.hidden = !slots.plans.length || !cur?.menu;
  if (!np.hidden) {
    const go = nextPlan
      ? h('button', { type: 'button', class: 'btn-primary wide', id: 'next-person-go' }, personKey(slots.list[nextPlan.slot]!) === personKey(cur!) ? `${ownerText(cur!)} 다음 메뉴 고르기` : `다음 사람 고르기 · ${ownerText(slots.list[nextPlan.slot]!)}`)
      : h('button', { type: 'button', class: 'btn-primary wide', id: 'next-person-go' }, '다 골랐어요 · 장바구니 보기');
    go.addEventListener('click', () => (nextPlan ? loadSlot(nextPlan.slot) : openCart()));
    put(np,
      h('p', { class: 'meta' }, `${ownerText(cur!)} 것을 다 골랐으면 눌러 주세요. 하나 더 먹으면 ③에서 [담기]를 한 번 더`),
      go);
  }
  markCards();
}
/** ③ 카드에 "담음 N" */
function markCards() {
  for (const card of document.querySelectorAll<HTMLElement>('#menu-list .menu')) {
    const id = card.dataset.menuId;
    const n = filled().filter((s) => s.menu!.id === id).reduce((a, s) => a + s.qty, 0);
    let tag = card.querySelector<HTMLElement>('.in-cart');
    if (!n) {
      tag?.remove();
      continue;
    }
    if (!tag) {
      tag = h('span', { class: 'in-cart' });
      card.querySelector('.price')?.append(tag); // 이름(h3)에 안 붙임: 이름 글자가 바뀌지 않게
    }
    tag.textContent = `담음 ${n}`;
  }
}
/** 이 줄은 누구 거 (나 / 같이 먹는 사람 1·2… / 이름 / 다른 사람 새로) — 같은 사람의 다른 줄에서 알레르기를 가져옴 */
function setPerson(p: Pick<Slot, 'owner' | 'name' | 'guestNo'> | 'new') {
  const s = curSlot();
  if (!s) return;
  const to = p === 'new' ? { owner: 'guest' as const, guestNo: nextGuestNo() } : p;
  s.owner = to.owner;
  delete s.name;
  delete s.guestNo;
  if (to.name) s.name = to.name;
  if (to.guestNo) s.guestNo = to.guestNo;
  const same = slots.list.find((x) => x !== s && personKey(x) === personKey(s));
  s.allergies = s.owner === 'me' ? [] : [...(same?.allergies ?? [])];
  saveActive(); // (줄 객체가 새로 바뀜 — 알레르기를 먼저 넣고 저장)
  groupSlots(); // 바꾼 사람 쪽으로 줄이 모이게
  state.allergyPending = true;
  renderSlots();
  renderOptions();
  void refreshSheet();
}
function toggleGuestAllergy(a: string) {
  const s = curSlot();
  if (!s || s.owner === 'me') return;
  s.allergies = s.allergies.includes(a) ? s.allergies.filter((x) => x !== a) : [...s.allergies, a];
  // 같은 사람이 두 개 먹으면 그 사람 줄 모두 같은 알레르기 (10/27)
  for (const x of slots.list) if (x !== s && personKey(x) === personKey(s)) (x.allergies = [...s.allergies]), (x.sheet = null);
  if (slots.list.some((x) => x !== s && personKey(x) === personKey(s))) void refreshAllSlots();
  state.allergyPending = true;
  renderSlots();
  renderOptions();
  void refreshSheet();
}
/** 추천에 보낼 조건: 칸마다 추천이면 그 줄의 조건, 같이 먹는 사람 줄이면 그 사람 알레르기만·내 취향 없이 */
function slotPrefs(): Prefs & { taste?: unknown } {
  const target = slots.recFor !== null ? slots.list[slots.recFor] : slots.adding ? { owner: nextOwner(), allergies: [] as string[] } : undefined;
  const plan = slots.recFor !== null ? slots.plans.find((p) => p.slot === slots.recFor) : null;
  const guest = !!target && target.owner !== 'me';
  const base = guest ? { ...state.prefs, allergies: target!.allergies } : prefsToSend();
  return plan ? { ...base, ...plan.prefs, allergies: guest ? target!.allergies : [...new Set([...state.prefs.allergies, ...(plan.prefs.allergies ?? [])])] } : base;
}
/** 장바구니 저장 (이 휴대폰에만, 3시간) */
function saveCart() {
  try {
    if (!filled().length && !slots.list.length) return localStorage.removeItem(CART_KEY);
    localStorage.setItem(CART_KEY, JSON.stringify({ at: Date.now(), who: slots.who, active: slots.active, lines: slots.list.filter((s) => s.menu).map((s) => ({ menuId: s.menu!.id, choices: s.goodChoices && Object.keys(s.goodChoices).length ? s.goodChoices : s.choices, qty: s.qty, owner: s.owner, name: s.name ?? null, guestNo: s.guestNo ?? null, allergies: s.allergies })) }));
  } catch {
    /* 저장 막힘: 이 화면 동안만 */
  }
}
function clearCart() {
  resetSlots();
  ordering = false;
  try {
    localStorage.removeItem(CART_KEY);
  } catch {
    /* 막힘 */
  }
}
/** 다시 열었을 때 장바구니 되살리기 */
async function restoreCart() {
  let saved: Json = null;
  try {
    saved = JSON.parse(localStorage.getItem(CART_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  if (!saved?.lines?.length || Date.now() - saved.at > CART_KEEP_MS) return clearCart();
  const lines = (saved.lines as Json[]).map((l) => ({ l, m: l.menuId === SINGLES_MENU.id ? SINGLES_MENU : state.options?.menus?.find((x: Json) => x.id === l.menuId) })).filter((x) => x.m).slice(0, MAX_SLOTS);
  if (!lines.length) return clearCart();
  slots.who = saved.who ?? null;
  slots.list = lines.map(({ l, m }) => ({ ...emptySlot(l.owner === 'guest' ? 'guest' : 'me', l.name ?? undefined), menu: m, choices: l.choices ?? {}, goodChoices: l.choices ?? {}, allergies: Array.isArray(l.allergies) ? l.allergies : [], qty: Math.min(MAX_QTY, Math.max(1, Number(l.qty) || 1)) }));
  slots.list.forEach((s, i) => {
    const g = Number(lines[i]!.l.guestNo);
    if (s.owner === 'guest' && !s.name) s.guestNo = g > 0 ? g : i;
    s.addKey = keyOf(s.menu!.id, s.choices, s);
  });
  slots.active = Math.min(Number(saved.active) || 0, slots.list.length - 1);
  await refreshAllSlots();
  $('step-order').hidden = false;
  put($('picked'), state.menu?.name ?? '');
  renderSlots();
}

// ── 젬마 먼저 (10/27 예형님 "젬마가 주도적으로, 규칙을 하나하나 만들지 말고") ──
// 모든 말을 젬마가 먼저 읽는다: 몇 명·몇 줄·줄마다 무엇을, 담은 줄 고치기·빼기, 추천 조건, 상황 한 줄 (cart-ai.ts가 검사).
// 여러 줄·고치기·다른 사람 것이면 바로 장바구니로. 나 혼자 하나면 지금 흐름(추천·옵션 고르기)에 젬마가 읽은 조건·상황을 얹음.
// 젬마·OpenAI가 둘 다 안 되면 규칙으로 (비상용). (전에 쓰던 "어떤 말을 AI로 보낼지" 규칙 LINE_REF·ONE_OF 등은 10/27에 없앰)
const condLabel = (c: Json) => [c.goal === 'FILLING' ? '든든하게' : c.goal === 'LIGHT' ? '가볍게' : c.goal === 'PROTEIN' ? '단백질 많이' : '', ...(c.wantMains ?? []).map((x: string) => `${x}`), c.wantSpicy ? '매운 거' : '', c.avoidSpicy ? '안 매운 거' : '', c.lowFat ? '기름기 적게' : '', ...(c.kinds ?? []).map((k: string) => (k === 'SALAD' ? '샐러드' : k === 'WRAP' ? '랩' : '')), c.budgetKrw ? `${won(c.budgetKrw)} 이하` : ''].filter(Boolean).slice(0, 3).join(' · ');
/** 젬마에게 먼저. handled = 장바구니로 바로 처리할 답 (여러 줄·고치기·다른 사람). null = 젬마가 못 함 → 규칙 */
async function cartAiFirst(text: string): Promise<{ handled: boolean; res: Json; late?: boolean } | null> {
  state.situation = null;
  state.aiPickChoices = null;
  saveActive();
  busy(true, '젬마가 말을 알아듣고 있어요', '여러 명·여러 개면 10초쯤 걸려요');
  const res = await api('/api/cart-command', {
    text,
    cart: slots.list.map((s) => ({ menuId: s.menu?.id ?? null, choices: s.choices, qty: s.qty, owner: s.owner, ...(s.name ? { name: s.name } : {}) })),
    recs: ((state.result?.menus?.top ?? []) as Json[]).map((m) => m.id).slice(0, 3),
    ...(state.menu && slots.list[slots.active]?.menu ? { active: slots.active } : {}),
  });
  // (busy는 끄지 않음 — 뒤에 해석이 이어지면 그대로, 장바구니로 끝나면 talk가 끔)
  // 젬마(와 OpenAI)가 40초 안에 답을 못 끝냄 → 규칙으로 엉뚱하게 담지 않고 다시 말해 달라고 (10/27: "야구부 5명…"이 빈 줄 5개로)
  if (res.http === 200 && res.late) return { handled: false, res: null, late: true };
  if (res.http !== 200 || (!res.ops?.length && !res.recommend && !res.reason && !res.ask && !res.order)) return null;
  state.situation = res.reason ?? null;
  const ops = (res.ops ?? []) as Json[];
  // 나 혼자 하나 새로 담기는 지금 흐름 그대로 (8단계 약속: 하나 살 때는 전과 똑같이) — 젬마가 읽은 조건은 mergeAiHint로 얹음
  const single = ops.length === 1 && ops[0].op === 'ADD' && ops[0].owner === 'me' && (ops[0].qty ?? 1) === 1;
  return { handled: ops.length > 0 && !single, res };
}
/** 나 혼자 말: 해석(규칙) 결과에 젬마가 읽은 조건·옵션·상황을 얹음. 규칙이 이미 읽은 값은 두고, 젬마가 더 읽은 것을 보탬 (알레르기·목록은 합침) */
function mergeAiHint(r: Json, res: Json): Json {
  const op = ((res.ops ?? []) as Json[])[0];
  const hint = res.recommend ?? (op?.op === 'ADD' ? { prefs: op.prefs, choices: op.choices, menuId: op.menuId } : null);
  const out: Json = { ...r, understood: [...((r.understood as string[]) ?? [])], prefs: { ...(r.prefs ?? {}) } };
  if (hint) {
    const p = hint.prefs ?? {};
    for (const k of ['goal', 'budgetKrw', 'lowFat', 'avoidSpicy', 'wantSpicy']) if (p[k] != null && (out.prefs[k] == null || out.prefs[k] === false)) out.prefs[k] = p[k];
    for (const k of ['wantMains', 'avoidMains', 'kinds', 'allergies']) if (p[k]?.length) out.prefs[k] = [...new Set([...(out.prefs[k] ?? []), ...p[k]])];
    if (!out.place && p.place) out.place = p.place;
    // "지난번처럼"·질문("왜?")은 그 흐름대로 — 젬마가 메뉴를 새로 고르지 않음 (10/27: "저번이랑 똑같이"가 다른 메뉴로)
    if (!out.menuId && hint.menuId && !r.ask) out.menuId = hint.menuId;
    if (!r.ask && Object.keys(hint.choices ?? {}).length) {
      if (out.menuId) out.choices = { ...hint.choices, ...(r.choices ?? {}) };
      else state.aiPickChoices = hint.choices; // ③에서 고르면 넣음 (감기 → 수프 세트)
    }
    // 이름표는 규칙이 못 읽고 젬마만 읽은 조건만 (10/27: "가벼운 쪽 (열량 낮게)" 옆에 "가볍게"가 또 붙던 것)
    const rp = r.prefs ?? {};
    const extra = Object.fromEntries(Object.entries(p).filter(([k, v]) => v != null && v !== false && (Array.isArray(v) ? v.some((x: string) => !(rp[k] ?? []).includes(x)) : rp[k] == null || rp[k] === false)));
    const label = condLabel(extra);
    if (label && !out.understood.some((u: string) => u.includes(label))) out.understood.push(label);
    if (hint.choices?.set && !out.understood.some((u: string) => u.includes(hint.choices.set))) out.understood.push(hint.choices.set);
  }
  out.situation = res.reason ?? null;
  if (res.ask && !out.ask) out.ask = res.ask;
  out.aiBy = res.by ?? out.aiBy ?? null;
  return out;
}
/** 젬마 명령으로 장바구니 만들기·고치기. 처리했으면 true */
async function cartAiTalk(text: string, via: 'voice' | 'text', stt: 'phone' | 'openai' | undefined, res: Json): Promise<boolean> {
  if (!Array.isArray(res.ops) || !res.ops.length) return false;
  if (cartDone) (cartDone = false), (handoffEl = null), (ordering = false), resetSlots();
  const findMenu = (id: string | null) => (id ? (state.options?.menus ?? []).find((m: Json) => m.id === id) ?? null : null);
  const told: string[] = [];
  const remove = new Set<number>();
  const firstNew = slots.list.length;
  let touched: number | null = null;
  const meAllergy = (a: string[]) => a.length && (state.prefs = { ...state.prefs, allergies: [...new Set([...state.prefs.allergies, ...a])] });
  // 젬마의 사람 번호 → 같이 먹는 사람 번호 (같은 사람 줄 둘이면 같은 "같이 먹는 사람 1")
  const guestOf = new Map<number, number>();
  for (const o of res.ops as Json[]) {
    if (o.op === 'REMOVE') {
      remove.add(o.line);
      told.push(`${o.line + 1}번 빼기`);
    } else if (o.op === 'EDIT') {
      const s = slots.list[o.line];
      if (!s) continue;
      const m = findMenu(o.menuId);
      if (m) (s.menu = m), (s.sheet = null), told.push(`${o.line + 1}번 → ${m.name}`);
      if (o.choices) (s.choices = o.choices), (s.goodChoices = {});
      if (o.qty) (s.qty = Math.min(MAX_QTY, o.qty)), told.push(`${o.line + 1}번 ${o.qty}개`);
      if (o.owner === 'me') (s.owner = 'me'), delete s.name, delete s.guestNo;
      if (o.owner === 'guest') s.owner = 'guest';
      if (o.name) (s.name = o.name), delete s.guestNo;
      if (s.owner === 'guest' && !s.name && !s.guestNo) s.guestNo = nextGuestNo();
      if (o.allergies?.length) {
        // "2번은 복숭아 알레르기" = 2번 먹는 사람은 내가 아님 → 그 줄만 같이 먹는 사람 (10/27 실제 주소: 내 알레르기로 넣어 1번 줄까지 붙던 것)
        // 내 알레르기는 "나는 ○○ 알레르기"처럼 나를 말했을 때만
        const mine = o.owner === 'me' && /(?:^|\s)(?:나|난|저|전|내가|제가)(?:는|도)?\s/.test(text);
        if (!mine && s.owner === 'me') (s.owner = 'guest'), (s.guestNo = s.guestNo ?? nextGuestNo());
        if (s.owner === 'guest') s.allergies = [...new Set([...s.allergies, ...o.allergies])];
        else meAllergy(o.allergies);
        told.push(`${o.line + 1}번 ${o.allergies.join('·')} 알레르기`);
      }
      if (o.choices && !m) told.push(`${o.line + 1}번 옵션 바꿈`);
      touched ??= o.line;
    } else if (o.op === 'ADD' && slots.list.length < MAX_SLOTS) {
      const m = findMenu(o.menuId) ?? (o.pick ? (state.result?.menus?.top?.[o.pick - 1] ?? null) : null);
      const sl = emptySlot(o.owner === 'guest' ? 'guest' : 'me', o.name ?? undefined);
      if (sl.owner === 'guest' && !sl.name && o.person) {
        if (!guestOf.has(o.person)) guestOf.set(o.person, sl.guestNo ?? nextGuestNo());
        sl.guestNo = guestOf.get(o.person)!;
      }
      sl.qty = Math.min(MAX_QTY, o.qty || 1);
      if (sl.owner === 'guest') sl.allergies = o.allergies ?? [];
      else meAllergy(o.allergies ?? []);
      slots.list.push(sl);
      const i = slots.list.length - 1;
      if (m) (sl.menu = m), (sl.choices = o.choices ?? {});
      else slots.plans.push({ slot: i, label: text, show: [condLabel({ ...(o.prefs ?? {}), allergies: undefined }), choiceText(o.choices ?? {})].filter(Boolean).join(' + ') || '추천에서 고르기', prefs: { ...(o.prefs?.goal ? { goal: o.prefs.goal } : {}), ...(o.prefs?.kinds?.length ? { kinds: o.prefs.kinds } : {}), ...(o.prefs?.wantMains?.length ? { wantMains: o.prefs.wantMains } : {}), ...(o.prefs?.avoidMains?.length ? { avoidMains: o.prefs.avoidMains } : {}), ...(o.prefs?.wantSpicy ? { wantSpicy: true } : {}), ...(o.prefs?.avoidSpicy ? { avoidSpicy: true } : {}), ...(o.prefs?.lowFat ? { lowFat: true } : {}), ...(o.prefs?.budgetKrw ? { budgetKrw: o.prefs.budgetKrw } : {}) }, choices: o.choices ?? {} });
    }
  }
  // 빼기는 맨 나중에 (뒤 줄부터) — 추천 칸 번호도 맞춤
  for (const i of [...remove].sort((a, b) => b - a)) {
    if (!slots.list[i]) continue;
    slots.list.splice(i, 1);
    slots.plans = slots.plans.filter((p) => p.slot !== i);
    shiftPlans(i + 1, -1);
  }
  if (slots.list.some((s) => s.owner === 'guest') && slots.who === null) slots.who = 'shared';
  groupSlots(); // 사람끼리 모이게 (젬마가 나·친구·나 순서로 줘도)
  if (!slots.list.length) {
    resetSlots();
    Object.assign(state, { menu: null, choices: {}, goodChoices: {}, sheet: null });
    $('step-order').hidden = true;
  } else {
    const firstFilled = touched !== null && slots.list[touched]?.menu ? touched : slots.list.findIndex((s, i) => i >= Math.min(firstNew, slots.list.length - 1) && s.menu);
    slots.active = Math.max(0, firstFilled >= 0 ? firstFilled : slots.list.findIndex((s) => s.menu));
    const cur = slots.list[slots.active]!;
    Object.assign(state, { menu: cur.menu, choices: cur.choices, goodChoices: cur.goodChoices, sheet: cur.sheet });
    state.allergyPending = true;
    if (cur.menu) {
      $('step-order').hidden = false;
      put($('picked'), cur.menu.name);
    }
  }
  const box = $('talk-result');
  const added = slots.list.slice(Math.min(firstNew, slots.list.length));
  put(box,
    ...understoodLines(added.map((s) => slots.list.indexOf(s)), (i) => {
      const s = slots.list[i]!;
      return `${s.menu ? [s.menu.name, choiceText(s.choices)].filter(Boolean).join(' + ') : planName(slots.plans.find((p) => p.slot === i))}${s.qty > 1 ? ` ×${s.qty}` : ''}${s.allergies.length ? ` (${s.allergies.join('·')} 알레르기)` : ''}`;
    }, told.map((t) => h('span', { class: 'tag' }, t))),
    res.reason ? h('p', { class: 'notice', id: 'ai-situation' }, `이렇게 이해했어요: ${res.reason}`) : null,
    res.capped ? h('p', { class: 'notice warn', id: 'cart-capped' }, `한 번에 ${MAX_SLOTS}명(${MAX_SLOTS}줄)까지예요. ${res.capped}명 중 ${MAX_SLOTS}명만 담았어요`) : null,
    h('p', { class: 'meta', id: 'cart-ai-note' }, `${/openai/i.test(String(res.by)) ? 'OpenAI' : '젬마'}가 나눠 알아들었어요. 장바구니에서 확인해 주세요`),
  );
  syncConditionUi();
  logTalk(text, via, { understood: [...told, ...added.map((s) => (s.menu ? s.menu.name : '추천에서 고르기'))], aiBy: res.by ?? null }, stt);
  await refreshAllSlots();
  saveCart();
  const plan = slots.plans.find((p) => !slots.list[p.slot]?.menu);
  if (plan) {
    slots.recFor = plan.slot;
    renderSlots();
    await recommend();
    unlockRecs();
    goTo('step-menu');
  } else if (!(res.ops as Json[]).some((o) => o.op === 'ADD') && touched !== null && slots.list[slots.active]?.menu) goTo('step-order'); // 담은 줄 고치기만: ④에서 그 줄
  else openCart();
  return true;
}

/** 말로 여러 개 (10/22): 처리했으면 true. 하나만 사는 말은 false → 지금 흐름 그대로 */
async function multiTalk(text: string, r: Json): Promise<boolean> {
  const box = $('talk-result');
  // 0) 사람: "3명이야", "민수는 매운 거 못 먹어, 지은이는 새우 알레르기", "한 명 더 와", "민수 거 소스 빼 줘"
  if (await peopleTalk(text, r, box)) return true;
  // "나는 두 개 먹을 거야" (10/27): 메뉴 없이 개수만 → 내 줄 하나 ×2 (고르면 그 메뉴 2개, [하나만 따로 바꾸기]·[담기] 한 번 더로 다르게)
  const selfN = !r.menuId ? selfCount(text) : null;
  if (selfN && selfN >= 2) return fillLines([{ part: '나', r: { prefs: {} }, qty: Math.min(MAX_QTY, selfN), owner: 'me' }], box);
  // 1) 담은 줄 고치기: "전부 토마토 빼", "1번은 제로콜라 2번은 콜라", "다 같은 걸로"
  if (filled().length >= 2 || (filled().length === 1 && (curSlot()?.qty ?? 1) > 1 && /전부|모두|다\s/.test(text))) {
    const ed = splitEdits(text, slots.list.length);
    if (ed) {
      saveActive();
      if (ed.sameAll) {
        const first = slots.list.find((s) => s.menu)!;
        slots.list.forEach((s, i) => i > 0 && Object.assign(s, { menu: first.menu, choices: { ...first.choices }, sheet: null }));
      }
      const apply = async (i: number, seg: string) => {
        const s = slots.list[i];
        if (!s?.menu) return [] as string[];
        const r2 = await api('/api/interpret', { text: seg, context: { menuId: s.menu.id, choices: s.choices, prefs: { ...state.prefs, allergies: slotAllergies(s) }, skipAi: true } });
        if (r2.http === 200 && r2.choices) s.choices = r2.choices;
        return r2.http === 200 ? (r2.understood as string[]) : [];
      };
      const said: string[] = [];
      if (ed.all) for (let i = 0; i < slots.list.length; i++) said.push(...(await apply(i, ed.all)).map((u) => `전부: ${u}`));
      for (const [no, seg] of Object.entries(ed.byNo)) said.push(...(await apply(Number(no) - 1, seg)).map((u) => `${no}번: ${u}`));
      const s = slots.list[slots.active]!;
      Object.assign(state, { menu: s.menu, choices: s.choices });
      renderOptions();
      await refreshAllSlots();
      put(box, h('div', { class: 'understood', 'aria-label': '이렇게 이해했어요' }, ...[...new Set([...(ed.sameAll ? ['전부 같은 메뉴로'] : []), ...said])].map((u) => h('span', { class: 'tag' }, u))));
      openCart();
      return true;
    }
  }
  // 1-2) "이거 두 개" = ③ 1번 추천 2개 ("저거·그거"는 2번) — 10/26
  const dm = text.trim().match(DEICTIC_QTY);
  const topM = state.result?.menus?.top ?? [];
  if (dm && topM.length) {
    const m = /^(?:저|그)/.test(dm[1]!) ? topM[1] ?? topM[0] : topM[0];
    const q = countWord(dm[2]!);
    await pickWithTalk(m);
    const sl = curSlot()!;
    sl.qty = Math.min(MAX_QTY, sl.qty + q - 1);
    saveCart();
    renderSlots();
    put(box, h('div', { class: 'understood' }, h('span', { class: 'tag' }, `${m.name} ${q}개`)));
    toast(`담았어요 · 장바구니 ${cartCount()}개`);
    return true;
  }
  // 2) 개수: "로스트 치킨 2개" → 한 줄 수량 2
  const n = parseCount(text);
  if (n && r.menuId && r.menuId !== SINGLES_MENU.id) {
    const m = state.options?.menus?.find((x: Json) => x.id === r.menuId);
    if (!m) return false;
    state.prefs = { ...state.prefs, ...r.prefs };
    syncConditionUi();
    if (!state.location) await useGps(true);
    await pickMenu(m, { ...(r.choices ?? {}) }, 'talk', [], { saucesAdd: r.saucesAdd, keepVegetables: r.keepVegetables });
    const s = curSlot()!;
    s.qty = Math.min(MAX_QTY, n);
    saveCart();
    put(box, h('div', { class: 'understood', 'aria-label': '이렇게 이해했어요' }, h('span', { class: 'tag' }, `${m.name} ${s.qty}개`), ...(r.understood as string[]).filter((u) => !u.startsWith('메뉴:')).map((u) => h('span', { class: 'tag' }, u))));
    if (n > MAX_QTY) box.append(h('p', { class: 'notice warn', id: 'slot-max-note' }, `한 줄에 ${MAX_QTY}개까지라 ${MAX_QTY}개만 담았어요`));
    renderSlots();
    return true;
  }
  // 3) 줄마다: "하나는 해장할 거, 하나는 가벼운 거" / 짧은 목록 "잠봉, 치킨, 스파이시"
  const protect = (state.options?.menus ?? []).filter((m: Json) => m.name.includes(',')).map((m: Json) => m.name);
  const each = splitEach(text);
  const list = each ? null : splitList(text, protect);
  const parts = each ?? list;
  if (!parts) return countedTalk(text, box);
  const read = await Promise.all(parts.map((p) => api('/api/interpret', { text: p, context: { prefs: state.prefs, skipAi: true } })));
  if (read.some((x) => x.http !== 200)) return false;
  const items = read.map((x, i) => ({ part: parts[i]!, r: x, menu: !!x.menuId, singles: x.menuId === SINGLES_MENU.id, cond: each ? !x.menuId && ((x.understood as string[]).length > 0 || !!x.question?.startsWith('매운 걸')) : condPiece(parts[i]!, x.prefs ?? {}) }));
  if (list && !listIsMulti(items)) return countedTalk(text, box);
  if (each && !items.every((x) => (x.menu && !x.singles) || x.cond)) return false;
  return fillLines(items.map((it) => ({ part: it.part, r: it.r, qty: 1 })), box);
}
/** 개수로 나눈 말 (10/26): "든든한 거 하나 가벼운 거 하나 매운 거 하나", "이거 하나 저거 하나", "나는 두 개 민수는 하나" — 규칙이 못 나누면 AI (A100 → OpenAI) */
async function countedTalk(text: string, box: HTMLElement): Promise<boolean> {
  let parts = splitCounted(text);
  let byAi = false;
  if (!parts && MAYBE_MANY.test(text)) {
    busy(true, '여러 개로 나누고 있어요', 'AI에게 물어보고 있어요 (몇 초 걸려요)');
    const r = await api('/api/split', { text });
    busy(false);
    if (r.http === 200 && Array.isArray(r.items)) (parts = r.items), (byAi = true);
  }
  if (!parts) return false;
  const read = await Promise.all(parts.map((p) => (DEICTIC.test(p.text) || OWNER_ONLY.test(p.text) ? Promise.resolve({ http: 200, understood: [], prefs: {} }) : api('/api/interpret', { text: p.text, context: { prefs: state.prefs, skipAi: true } }))));
  if (read.some((x) => x.http !== 200)) return false;
  const items = parts.map((p, i) => {
    const r = read[i]!;
    return { text: p.text, qty: p.qty, r, menu: !!r.menuId, singles: r.menuId === SINGLES_MENU.id, cond: !r.menuId && ((r.understood as string[]).length > 0 || !!r.question?.startsWith('매운 걸')) && !(r.choices?.extras?.length) };
  });
  if (!countedIsMulti(items)) return false;
  const top = state.result?.menus?.top ?? [];
  const lines = items.map((it) => {
    const t = it.text.trim();
    // "이거"·"요거" = ③ 1번 추천, "저거"·"그거" = 2번 (10/26 결정)
    if (DEICTIC.test(t)) {
      const m = /^(?:저|그)/.test(t) ? top[1] : top[0];
      return { part: t, qty: it.qty, r: m ? { ...it.r, menuId: m.id } : it.r };
    }
    const own = t.match(/^(?:나는|난|저는|전|내\s*[거꺼]는)$/) ? { owner: 'me' as const } : OWNER_ONLY.test(t) ? { owner: 'guest' as const, name: t.replace(/(?:이는|는|은)$/, '') } : {};
    // "매운 거"만: 매운 쪽 / "안 매운 거": 안 매운 쪽
    const pr = { ...(it.r.prefs ?? {}), ...(it.r.question?.startsWith('매운 걸') ? (/안\s*매운|안맵|덜\s*매운/.test(t) ? { avoidSpicy: true } : { wantSpicy: true }) : {}) };
    return { part: own.owner ? ownerText({ owner: own.owner, ...(own.name ? { name: own.name } : {}) }) : t, qty: it.qty, r: { ...it.r, prefs: pr }, ...own };
  });
  if (byAi) box.append(h('p', { class: 'meta', id: 'split-ai' }, 'AI가 여러 개로 나눴어요'));
  return fillLines(lines, box);
}
/** 나눈 조각으로 장바구니 줄 만들기 (메뉴면 바로 담고, 조건이면 그 줄 추천) — 새로 시작 */
async function fillLines(items: Array<{ part: string; r: Json; qty: number; owner?: Slot['owner']; name?: string }>, box: HTMLElement): Promise<boolean> {
  if (!state.location) await useGps(true);
  const who = items.some((x) => x.owner === 'guest') ? 'shared' : slots.who;
  resetSlots();
  slots.who = who;
  // 새 장바구니: 열려 있던 메뉴가 빈 줄에 섞여 들어가지 않게
  Object.assign(state, { menu: null, choices: {}, goodChoices: {}, sheet: null });
  cartDone = false;
  handoffEl = null;
  ordering = false;
  for (const it of items.slice(0, MAX_SLOTS)) {
    const m = it.r.menuId && it.r.menuId !== SINGLES_MENU.id ? state.options?.menus?.find((x: Json) => x.id === it.r.menuId) : null;
    if (m) {
      slots.adding = slots.list.length > 0;
      slots.recFor = null;
      await pickMenu(m, { ...(it.r.choices ?? {}) }, 'talk', [], { noScroll: true });
      const s = curSlot()!;
      s.qty = Math.min(MAX_QTY, it.qty);
      if (it.owner) s.owner = it.owner;
      if (it.name) s.name = it.name;
      else if (s.owner === 'guest' && !s.guestNo) s.guestNo = nextGuestNo();
    } else {
      saveActive();
      slots.list.push(emptySlot(it.owner ?? 'me', it.name));
      const sl = slots.list[slots.list.length - 1]!;
      sl.qty = Math.min(MAX_QTY, it.qty);
      const pr = it.r.prefs ?? {};
      if (it.owner === 'guest' && pr.allergies?.length) sl.allergies = pr.allergies;
      // "스파이시"만 말하면 매운 메뉴 먼저
      const prefs: Partial<Prefs> = { ...(pr.goal ? { goal: pr.goal } : {}), ...(pr.kinds?.length ? { kinds: pr.kinds } : {}), ...(pr.wantMains?.length ? { wantMains: pr.wantMains } : {}), ...(pr.avoidMains?.length ? { avoidMains: pr.avoidMains } : {}), ...(pr.lowFat ? { lowFat: true } : {}), ...(pr.salty ? { salty: pr.salty } : {}), ...(pr.avoidSpicy ? { avoidSpicy: true } : {}), ...(pr.wantSpicy || /스파이시/.test(it.part) || (it.r.question?.startsWith('매운 걸') && !/안\s*매운|안맵|덜\s*매운/.test(it.part)) ? { wantSpicy: true } : {}), ...(it.r.question?.startsWith('매운 걸') && /안\s*매운|안맵|덜\s*매운/.test(it.part) ? { avoidSpicy: true } : {}), ...(pr.budgetKrw ? { budgetKrw: pr.budgetKrw } : {}) };
      const tags = ((it.r.understood as string[] | undefined) ?? []).filter((u) => !/알레르기/.test(u)).slice(0, 3);
      slots.plans.push({ slot: slots.list.length - 1, label: it.name ?? it.part, prefs, ...(!it.name && it.part !== '나' && it.part !== '같이 먹는 사람' ? { show: it.part.length <= 12 ? it.part : tags.length ? tags.join(' · ') : `${it.part.slice(0, 12)}…` } : {}) });
    }
  }
  if (items.length > MAX_SLOTS) box.append(h('p', { class: 'notice warn' }, `한 번에 ${MAX_SLOTS}줄까지예요`));
  const firstPlan = slots.plans[0];
  if (firstPlan) {
    slots.recFor = firstPlan.slot;
    if (!filled().length) slots.active = firstPlan.slot;
  }
  saveCart();
  put(box, ...understoodLines(slots.list.map((_, i) => i), (i) => {
    const s = slots.list[i]!;
    return `${s.menu ? lineTitle(s) : planName(slots.plans.find((p) => p.slot === i))}${s.qty > 1 ? ` ×${s.qty}` : ''}`;
  }));
  renderSlots();
  if (firstPlan) {
    await recommend();
    unlockRecs();
    box.append(h('p', { class: 'notice', id: 'plan-note' }, `${firstPlan.slot + 1}번(${planName(firstPlan)}) 추천이에요. [담기]를 누르고 옵션까지 고른 뒤 ④ 아래 [다음 사람 고르기]를 눌러 주세요`));
    goTo('step-menu');
  } else openCart();
  return true;
}
/** 메뉴·재료·알레르기 낱말 (사람 이름으로 읽지 않게) */
function knownWords(): Set<string> {
  const o = state.options;
  const words = (x: string) => x.split(/[\s,&()]+/).filter((w) => w.length >= 2);
  const lists = [o?.breads, o?.cheeses, o?.vegetables, o?.sauces, o?.toppings, o?.singles, o?.menus].flatMap((l: Json) => (l ?? []).flatMap((x: Json) => words(String(x.name))));
  return new Set<string>([...(o?.allergens ?? []), ...lists]);
}
const NO_PREFS = { allergies: [], budgetKrw: null, goal: null, kinds: null, maxEnergyKcal: null, maxSodiumMg: null, removeVegetables: [] };
/** 사람 수·이름. 처리했으면 true */
async function peopleTalk(text: string, r: Json, box: HTMLElement): Promise<boolean> {
  const named = splitNames(text, knownWords()) ?? [];
  // 이미 있는 사람 줄 고치기: "민수 거 소스 빼 줘", "민수는 새우 알레르기"
  const known = named.filter((x) => slots.list.some((s) => s.name === x.name));
  if (known.length && filled().length) {
    saveActive();
    const said: string[] = [];
    for (const x of known) {
      for (const sl of slots.list.filter((s) => s.name === x.name)) {
        const r2 = await api('/api/interpret', { text: x.text, context: { ...(sl.menu ? { menuId: sl.menu.id, choices: sl.choices } : {}), prefs: { ...state.prefs, allergies: sl.allergies }, skipAi: true } });
        if (r2.http !== 200) continue;
        if (r2.prefs?.allergies?.length) sl.allergies = [...new Set([...sl.allergies, ...r2.prefs.allergies])];
        if (sl.menu && r2.choices) sl.choices = r2.choices;
        said.push(...(r2.understood as string[]).map((u) => `${x.name}: ${u}`));
      }
    }
    const cur = slots.list[slots.active]!;
    Object.assign(state, { menu: cur.menu, choices: cur.choices });
    state.allergyPending = true;
    renderOptions();
    await refreshAllSlots();
    put(box, h('div', { class: 'understood', 'aria-label': '이렇게 이해했어요' }, ...[...new Set(said)].map((u) => h('span', { class: 'tag' }, u))));
    return true;
  }
  const pp = parsePeople(text);
  // "한 명 더 와": 메뉴 하나 더 담기와 같음 (같이 먹는 사람 줄)
  if (pp.moreOne && filled().length) {
    if (slots.list.length >= MAX_SLOTS) {
      put(box, h('p', { class: 'notice warn' }, `한 번에 ${MAX_SLOTS}줄까지예요`));
      return true;
    }
    if (slots.who === null) slots.who = 'shared';
    saveActive();
    slots.list.push(emptySlot('guest'));
    const i = slots.list.length - 1;
    slots.plans.push({ slot: i, label: '같이 먹는 사람', prefs: {} });
    slots.recFor = i;
    put(box, h('div', { class: 'understood' }, h('span', { class: 'tag' }, `한 명 더: ${i + 1}번 · 같이 먹는 사람`)));
    renderSlots();
    await recommend();
    unlockRecs();
    goTo('step-menu');
    return true;
  }
  // "3명이야" 또는 이름이 둘 넘게: 사람마다 줄 (1번은 나), 사람마다 따로 추천
  // 이름이 둘 넘게 (같은 이름 두 번은 한 사람)
  const distinct = [...new Set(named.map((x) => x.name))];
  const n = pp.people ?? (distinct.length >= 2 ? Math.min(distinct.length + 1, MAX_SLOTS) : null);
  if (!n) return false;
  const people = named.slice(0, n - 1);
  const read = await Promise.all(people.map((x) => api('/api/interpret', { text: x.text, context: { prefs: NO_PREFS, skipAi: true } })));
  const items: Array<{ part: string; r: Json; qty: number; owner: Slot['owner']; name?: string }> = [{ part: '나', r: { prefs: {} }, qty: 1, owner: 'me' }];
  for (let i = 1; i < n; i++) {
    const person = people[i - 1];
    const rp = read[i - 1];
    items.push({ part: person?.name ?? '같이 먹는 사람', r: rp?.http === 200 ? { ...rp, menuId: rp.menuId } : { prefs: {} }, qty: 1, owner: 'guest', ...(person ? { name: person.name } : {}) });
  }
  if (pp.people && n < pp.people) box.append(h('p', { class: 'notice warn' }, `한 번에 ${MAX_SLOTS}명까지예요`));
  return fillLines(items, box);
}
/** 줄마다 주문서를 다시 계산 */
async function refreshAllSlots() {
  const keep = slots.active;
  for (let i = 0; i < slots.list.length; i++) {
    const s = slots.list[i]!;
    if (!s.menu) continue;
    if (s.menu.id === SINGLES_MENU.id && !(s.choices.extras ?? []).length) continue;
    const r2 = await api('/api/order-sheet', { menuId: s.menu.id, choices: s.choices, ...(slotAllergies(s).length ? { allergies: slotAllergies(s) } : {}) });
    if (r2.http === 200) (s.sheet = r2), (s.goodChoices = { ...s.choices });
    else s.choices = { ...s.goodChoices };
  }
  slots.active = Math.min(keep, slots.list.length - 1);
  const s = slots.list[slots.active];
  if (s?.menu) {
    Object.assign(state, { menu: s.menu, choices: s.choices, goodChoices: s.goodChoices, sheet: s.sheet });
    renderOptions();
    await refreshSheet();
  }
  renderSlots();
}
/** 주문서 글: 한 줄 1개면 전과 같음, 아니면 줄마다 + 합계 */
function multiOrderText(shop: ReturnType<typeof shopOf>): string {
  const done = slots.list.map((s, i) => ({ s, i })).filter((x) => x.s.sheet);
  const head = [`[써브웨이 주문서]${shop ? ` ${shop.name}` : ''}`, `모두 ${cartCount()}개 · 참고 합계 ${won(cartTotal())} — 매장에서 다를 수 있어요`];
  const body = done.map(({ s, i }) => {
    const lines = orderText(s.sheet as OrderSheet, null, slotAllergies(s)).split('\n').slice(1);
    if (s.qty > 1) lines[0] = `${lines[0]} ×${s.qty}`;
    return [`── ${slotName(s, i)} ──`, ...lines].join('\n');
  });
  return [...head, ...body].join('\n\n');
}

// ── ⑥ 주문서 넘겨주기: [확인]을 누르기 전에는 아무것도 나가지 않는다 ──
const shopOf = (st: Json) => (st ? { id: String(st.id), name: String(st.name), phone: st.phone ?? null, lat: st.lat, lng: st.lng } : null);

/** 장바구니 아래 넘겨주기 상자 (같은 상자를 다시 붙여 [확인] 뒤 글이 사라지지 않게) */
let handoffEl: HTMLElement | null = null;
let cartDone = false;
let cartSig = '';
function cartHandoff() {
  const sig = JSON.stringify(filled().map((x) => [x.menu?.id, x.choices, x.qty, x.owner, x.allergies]));
  if (sig !== cartSig && !cartDone) (cartSig = sig), (handoffEl = null);
  if (!handoffEl) handoffEl = handoffStart();
  return handoffEl;
}
/** 잠깐 뜨는 알림 ("담았어요 · 장바구니 2개") */
function toast(text: string) {
  document.getElementById('toast')?.remove();
  const t = h('div', { class: 'toast', id: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}
/** ⑥ 주문서 상자: "이 주문서로 주문할까요?" [다시 고르기] [확인] → 확인하면 같은 상자에 주문서 글·복사·전화·길찾기 */
function handoffStart() {
  const box = h('div', { class: 'handoff', id: 'handoff' });
  const shop = shopOf(state.store);
  const ok = h('button', { type: 'button', class: 'btn-primary', id: 'order-confirm' }, '확인');
  const back = h('button', { type: 'button', id: 'order-back' }, '다시 고르기');
  back.addEventListener('click', closeOrder);
  ok.addEventListener('click', () => handoffReady(box));
  box.append(h('div', { class: 'confirm', role: 'group', 'aria-label': '주문 확인' },
    h('p', {}, `${shop ? `${shop.name}에 ` : ''}${cartCount() > 1 ? `${cartCount()}개를 이 주문서로` : '이 주문서로'} 주문할까요?${shop ? '' : ' (매장을 아직 안 골랐어요)'}`),
    filled().length < slots.list.length ? h('p', { class: 'notice warn', id: 'slot-unpicked' }, `아직 안 고른 줄 ${slots.list.length - filled().length}개는 빼고 주문서를 만들어요`) : null,
    h('p', { class: 'meta' }, '앱이 매장에 직접 보내지 않아요. 확인하면 내 주문에 기록되고, 주문서 복사·전화·길찾기를 쓸 수 있어요'),
    h('div', { class: 'actions' }, back, ok),
  ));
  return box;
}
// ── ⑥ 주문서: [이대로 주문하기]·아래 [주문하기]를 누를 때만 (10/27 예형님), 담은 메뉴마다 사진·옵션·금액 (배민처럼) ──
let ordering = false;
function openOrder() {
  if (!filled().length) return toast('아직 담은 게 없어요. ③ 추천에서 [담기]를 눌러 주세요');
  saveActive();
  ordering = true;
  renderOrder();
  openCart('step-sheet');
  document.getElementById('order-confirm')?.focus({ preventScroll: true });
}
function closeOrder() {
  ordering = false;
  handoffEl = null;
  renderOrder();
  $('step-cart').scrollIntoView({ block: 'start' });
}
// ── 장바구니 화면 (10/27 예형님: 배민처럼 옆에서 열림) — 🛒 · 아래 [장바구니 보기] · [다 골랐어요] → ⑤ 장바구니 → [이대로 주문하기] → ⑥ 주문서 ──
// 휴대폰 뒤로 가기로도 닫힘 (열 때 기록 하나를 넣어 둠)
function openCart(to: 'step-cart' | 'step-sheet' = 'step-cart') {
  if (!slots.list.length && !cartDone) return toast('아직 담은 게 없어요. ③ 추천에서 [담기]를 눌러 주세요');
  saveActive();
  const d = $('cart-drawer');
  if (d.hidden) {
    d.hidden = false;
    document.body.classList.add('drawer-open');
    // 휴대폰 뒤로 가기로 닫히게 기록 하나 (닫을 때 남긴 기록이 있으면 다시 씀 — history.back()을 부르지 않아 열고 닫기가 엉키지 않음)
    try {
      if (history.state?.cartDrawer === 'closed') history.replaceState({ cartDrawer: 'open' }, '');
      else history.pushState({ cartDrawer: 'open' }, '');
    } catch {
      /* 기록 못 넣는 브라우저: 뒤로 가기만 안 됨 */
    }
  }
  renderSlots();
  $('drawer-body').scrollTop = 0;
  if (to === 'step-sheet') requestAnimationFrame(() => $('step-sheet').scrollIntoView({ block: 'start' }));
  $('drawer-back').focus({ preventScroll: true });
}
function closeCart(fromHistory = false) {
  const d = $('cart-drawer');
  if (d.hidden) return;
  d.hidden = true;
  document.body.classList.remove('drawer-open');
  if (!fromHistory && history.state?.cartDrawer === 'open') {
    try {
      history.replaceState({ cartDrawer: 'closed' }, '');
    } catch {
      /* 막힘 */
    }
  }
}
const cartOpen = () => !$('cart-drawer').hidden;
function renderOrder() {
  const sec = $('step-sheet');
  sec.hidden = !ordering || !filled().length;
  if (sec.hidden) {
    put($('order-lines'));
    put($('order-box'));
    return;
  }
  const card = (s: Slot, i: number) => {
    const r = s.sheet;
    const w = r ? sheetWarning(slotAllergies(s), r.allergens) : null;
    return h('li', { class: 'order-line', 'data-line': String(i) },
      menuImage(s.menu, 'order-pic'),
      h('div', { class: 'order-info' },
        h('p', { class: 'order-who' }, slotName(s, i)),
        h('h3', {}, `${lineTitle(s)}${s.qty > 1 ? ` ×${s.qty}` : ''}`),
        r ? h('p', { class: 'meta' }, lineSummary(s)) : h('p', { class: 'meta' }, '주문서를 만드는 중이에요'),
        r?.set ? h('p', { class: 'meta' }, [r.set, r.setItem, r.drink].filter(Boolean).join(' · ')) : null,
        r ? sheetPics(r) : null,
        w ? h('p', { class: `notice ${w.level}` }, w.text) : null,
        r ? h('p', { class: 'meta' }, `${r.nutrition.energyKcal == null ? '열량 확인 필요' : `${r.nutrition.energyKcal}kcal`} · 알레르기 ${r.allergens.contains.length ? r.allergens.contains.join('·') : '없음'}`) : null,
        r ? h('p', { class: 'order-price' }, won(r.price.total * s.qty)) : null,
      ));
  };
  put($('order-lines'),
    h('ol', { class: 'order-list', 'aria-label': '주문할 것' }, ...slots.list.map((s, i) => (s.menu ? card(s, i) : null))),
    h('p', { class: 'total', id: 'order-total' }, `${cartCount()}개 · 참고 합계 ${won(cartTotal())}`),
    h('p', { class: 'meta' }, '금액은 매장에서 다를 수 있어요. 결제는 매장에서 해요'),
  );
  put($('order-box'), cartHandoff());
}

async function copyText(text: string, area: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    area.select(); // 복사가 막힌 브라우저: 골라 둠 → 길게 눌러 복사
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

function handoffReady(box: HTMLElement) {
  const sheet = state.sheet as OrderSheet;
  const shop = shopOf(state.store);
  saveActive();
  const many = cartCount() > 1;
  const text = many ? multiOrderText(shop) : orderText(sheet, shop, slotAllergies());
  const area = h('textarea', { class: 'order-text', id: 'order-text', readonly: true, rows: String(text.split('\n').length), 'aria-label': '주문서 글' }) as HTMLTextAreaElement;
  area.value = text;
  const msg = h('p', { class: 'meta', 'aria-live': 'polite' });
  const copy = h('button', { type: 'button', class: 'btn-primary', id: 'order-copy' }, '주문서 복사');
  copy.addEventListener('click', async () => (msg.textContent = (await copyText(text, area)) ? '복사했어요. 매장 직원에게 보여 주거나 붙여 넣으세요' : '복사가 막혀 있어요. 글을 길게 눌러 복사해 주세요'));
  const tel = shop ? telLink(shop.phone) : null;
  // [확인]을 누른 순간 내 주문에 기록 (10/22 예형님: [이걸로 주문했어요] 단계를 없앰)
  // 여러 칸이면 "나" 칸만 기록 (10/22: 일행 것이 내 취향에 섞이지 않게)
  const mine = many ? filled().filter((x) => x.owner === 'me' && x.sheet) : [{ menu: sheet.menu, goodChoices: state.goodChoices, sheet }];
  const recs = mine.map((x) => store.addOrder({ menuId: x.sheet!.menu.id, menuName: x.sheet!.menu.name, choices: { ...x.goodChoices }, text, store: shop ? { id: shop.id, name: shop.name, phone: shop.phone } : null, totalWon: x.sheet!.price.total }));
  const rec = recs.some(Boolean);
  const guests = many ? filled().filter((x) => x.owner !== 'me').length : 0;
  // 주문서를 넘겼으면 장바구니는 비움 (화면의 주문서 글은 그대로, 다시 담으면 새 장바구니)
  cartDone = true;
  try {
    localStorage.removeItem(CART_KEY);
  } catch {
    /* 막힘 */
  }
  const done = h('p', { class: 'notice', id: 'order-recorded' }, !store.consented('orders') ? '주문 기록 저장을 꺼 두셔서 기록하지 않았어요. 아래 [취향 그래프] → "내 정보"에서 켤 수 있어요' : !mine.length ? '같이 먹는 사람 것만이라 내 주문에는 기록하지 않았어요' : `내 주문에 기록했어요 (이 휴대폰에만)${guests ? ` — 내 것 ${mine.length}줄만, 같이 먹는 사람 것 ${guests}줄은 안 남겨요` : ''}`);
  renderOrders();
  if (rec && state.location) void recommend(); // 자주 고른 메뉴가 바뀌었을 수 있음 → 추천도 새로
  put(box,
    h('h3', {}, '주문서 넘겨주기'),
    area,
    h('div', { class: 'actions' },
      copy,
      tel ? h('a', { class: 'btn', href: tel, id: 'order-tel' }, '매장 전화') : null,
      shop ? h('a', { class: 'btn', href: kakaoRouteLink(shop), target: '_blank', rel: 'noopener', id: 'order-map' }, '길찾기') : null,
    ),
    msg,
    shop && !tel ? h('p', { class: 'meta' }, '이 매장은 전화번호가 없어요') : null,
    done,
  );
}

// ── 내 주문 (휴대폰에만, 최근 10개) ──
function renderOrders() {
  renderTastes(); // 주문 기록이 바뀌면 "자주 고른 메뉴"도 바뀜
  const list = store.orders();
  const sec = $('my-orders');
  sec.hidden = !store.consented('orders');
  if (sec.hidden) return;
  // 즐겨찾기 ★ (10/17)
  const favs = store.favorites();
  put($('fav-list'), ...(favs.length
    ? [h('h3', {}, '★ 즐겨찾기'), h('ul', { class: 'orders favs' }, ...favs.map((f) => {
        const go = h('button', { type: 'button', class: 'btn-text' }, '이걸로 주문');
        go.addEventListener('click', () => void reorder(f, '즐겨찾기'));
        const del = h('button', { type: 'button', class: 'btn-text' }, '빼기');
        del.addEventListener('click', () => {
          store.toggleFavorite(f);
          renderOrders();
          const fb = document.getElementById('fav');
          if (fb && state.menu?.id === f.menuId) fb.replaceWith(favButton() ?? '');
        });
        return h('li', {}, h('p', { class: 'o-name' }, f.menuName), h('div', { class: 'actions' }, go, del));
      }))]
    : []));
  if (!list.length) return put($('order-list'), h('p', { class: 'meta' }, '아직 기록이 없어요. 주문서에서 [이대로 주문하기] → [확인]을 누르면 쌓여요'));
  const clear = h('button', { type: 'button', class: 'btn-text' }, '전부 지우기');
  clear.addEventListener('click', () => {
    if (!confirm('주문 기록을 전부 지울까요?')) return;
    store.clearOrders();
    renderOrders();
  });
  put($('order-list'),
    h('ul', { class: 'orders' }, ...list.map((o) => {
      const when = new Date(o.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const again = h('button', { type: 'button', class: 'btn-text' }, '다시 주문');
      again.addEventListener('click', () => void reorder(o, '지난 주문'));
      const del = h('button', { type: 'button', class: 'btn-text' }, '지우기');
      del.addEventListener('click', () => {
        store.removeOrder(o.id);
        renderOrders();
      });
      return h('li', {},
        h('p', { class: 'o-name' }, o.menuName),
        h('p', { class: 'meta' }, `${when}${o.store ? ` · ${o.store.name}` : ''} · 참고 ${won(o.totalWon)}`),
        h('div', { class: 'actions' }, again, del),
      );
    })),
    clear,
  );
}

// ── 동의 (처음 한 번 + "내 정보"에서 언제든 바꾸기) ──
const CONSENT_TEXT: Record<store.ConsentKind, [string, string]> = {
  allergy: ['알레르기 기억하기', '고른 알레르기를 이 휴대폰에 저장해 다음에도 빼고 추천해요. 알레르기는 민감한 정보라 따로 물어봐요. 끄면 바로 지워요'],
  orders: ['주문 기록 저장', '[이대로 주문하기] → [확인]을 누른 주문을 이 휴대폰에 최근 10개까지 저장해요. 자주 고른 메뉴는 추천에 쓰고, ★ 즐겨찾기·"지난번처럼"도 이걸로 해요. 끄면 기록도 지워요'],
  voice: ['말로 입력 (🎤)', '말한 소리는 글로 바꾸려고 휴대폰 음성 인식(안드로이드는 Google, 아이폰은 Apple)으로, 그게 안 되는 브라우저에선 외부 AI(OpenAI)로 보내요. 녹음은 저장하지 않아요'],
  taste: ['취향 기억하기', '말로 한 취향("평소 소고기 좋아해")과 오늘 상태("피곤해", 다음 날 새벽 4시까지), 말 기록(최근 30개)을 이 휴대폰에 저장해 추천·취향 그래프에 써요. 끄면 지워요'],
};
function consentList(prefix: string) {
  return h('div', { class: 'consents' },
    h('p', { class: 'meta' }, '📍 위치는 매장을 찾을 때만 쓰고 저장하지 않아요'),
    ...(['allergy', 'orders', 'taste', 'voice'] as const).map((k) => {
      const id = `${prefix}-${k}`;
      const box = h('input', { type: 'checkbox', id, 'data-consent': k, checked: store.consented(k) }) as HTMLInputElement;
      box.addEventListener('change', () => {
        store.setConsent(k, box.checked);
        if (k === 'allergy' && box.checked) store.rememberAllergies(state.prefs.allergies);
        // 켜면 이 화면에서 말한 취향을 저장, 끄면 저장한 것은 지워짐 (setConsent)
        if (k === 'taste' && box.checked) state.sessionTastes = state.sessionTastes.filter((x) => !store.addTaste(x));
        consentChanged();
      });
      return h('label', { class: 'consent', for: id }, box, h('span', {}, h('b', {}, CONSENT_TEXT[k][0]), h('span', { class: 'meta' }, CONSENT_TEXT[k][1])));
    }),
  );
}
function consentChanged() {
  // 두 곳(처음 안내·내 정보)의 체크를 같게
  document.querySelectorAll<HTMLInputElement>('[data-consent]').forEach((b) => (b.checked = store.consented(b.dataset.consent as store.ConsentKind)));
  renderOrders();
  syncMic();
  // 기록·취향을 끄거나 지우면 추천도 새로 (지운 취향이 순위에 남지 않게)
  if (state.location && state.result) void recommend();
}
// ── 내 취향 보기·지우기 (10/17): 주문 기록에서 배운 것은 지우면 다시 안 배움 ──
function renderTastes() {
  renderGraph();
  renderTalkLog();
  const box = document.getElementById('my-tastes');
  if (!box) return;
  const { items } = myTaste();
  if (!items.length) return put(box, h('h3', {}, '내 취향'), h('p', { class: 'meta' }, '아직 없어요. 주문 기록이 쌓이거나 "평소에 소고기 좋아해"처럼 말하면 생겨요'));
  const all = h('button', { type: 'button', class: 'btn-text', id: 'taste-clear' }, '취향 전부 지우기');
  all.addEventListener('click', () => {
    if (!confirm('내 취향을 전부 지울까요? (주문 기록은 그대로 두고, 거기서 배운 취향은 다시 배우지 않아요)')) return;
    const learned = items.filter((x) => x.from === 'orders').map((x) => x.key);
    store.clearTastes();
    learned.forEach(store.suppress);
    state.sessionTastes = [];
    renderTastes();
    if (state.location) void recommend();
  });
  put(box,
    h('h3', {}, '내 취향'),
    h('ul', { class: 'tastes' }, ...items.map((it) => {
      const del = h('button', { type: 'button', class: 'btn-text', 'data-taste': it.key }, '지우기');
      del.addEventListener('click', () => {
        if (it.from === 'orders') store.suppress(it.key);
        else if (it.recordId) {
          store.removeTaste(it.recordId);
          state.sessionTastes = state.sessionTastes.filter((x) => x.id !== it.recordId);
        }
        renderTastes();
        if (state.location) void recommend();
      });
      return h('li', {}, h('span', {}, it.text), it.from === 'orders' ? h('span', { class: 'meta' }, ' (주문 기록에서)') : null, del);
    })),
    store.consented('taste') ? null : h('p', { class: 'meta' }, '"취향 기억하기"가 꺼져 있어 말한 취향은 이 화면을 닫으면 사라져요'),
    all,
  );
}
// ── 아래 탭 (10/22 예형님): [주문하기] [취향 그래프] ──
function showTab(tab: 'order' | 'taste') {
  const main = $('app');
  if (main.dataset.tab === tab) return;
  main.dataset.tab = tab;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tabbar .tab')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (tab === 'taste') renderTastes();
  $('cart-bar').hidden = tab === 'taste' || cartCount() === 0;
  scrollTo({ top: 0, behavior: 'auto' });
}
// ── 취향 그래프: 묶음마다 막대 (몇 번), 말로 한 것은 "말함" 표시 ──
const GRAPH_EMPTY: Record<GraphGroup['key'], string> = {
  menus: '주문하면 쌓여요',
  likes: '주문하거나 "평소에 소고기 좋아해"처럼 말하면 생겨요',
  dislikes: '"원래 돼지고기는 별로야"처럼 평소 취향으로 말하면 생겨요 ("돼지고기 빼고"는 이번 추천에만)',
  sauces: '소스를 고른 주문이 쌓이면 생겨요',
  removed: '야채를 뺀 주문이 쌓이면 생겨요',
  allergies: '고른 알레르기가 없어요',
};
function renderGraph() {
  const box = document.getElementById('taste-graph');
  if (!box) return;
  const records = [...store.tasteRecords(), ...state.sessionTastes];
  const allergies = [...new Set([...store.savedAllergies(), ...state.prefs.allergies])];
  const groups = tasteGraph(store.orders(), records, store.suppressedKeys(), allergies);
  const scopeText = (b: { scope?: string }) => (b.scope === 'TODAY' ? '오늘' : '평소');
  put(box,
    store.consented('orders') ? null : h('p', { class: 'notice', id: 'graph-orders-off' }, '"주문 기록 저장"이 꺼져 있어 주문으로 쌓이는 그래프가 비어 있어요. 아래 내 정보에서 켤 수 있어요'),
    h('div', { class: 'graph' }, ...groups.map((g) => {
      const max = Math.max(1, ...g.bars.map((b) => b.n));
      const body = !g.bars.length
        ? h('p', { class: 'meta graph-empty' }, GRAPH_EMPTY[g.key])
        : g.key === 'allergies' || g.key === 'dislikes'
          ? h('ul', { class: `graph-chips ${g.key}` }, ...g.bars.map((b) => h('li', {}, b.label, g.key === 'dislikes' ? h('span', { class: 'graph-from' }, ` ${scopeText(b)}`) : null)))
          : h('ul', { class: 'graph-bars' }, ...g.bars.map((b) => {
            const fill = h('span', { class: `graph-fill${b.from === 'said' ? ' said' : ''}` });
            fill.style.width = `${Math.max(b.n ? 8 : 4, Math.round((b.n / max) * 100))}%`; // CSSOM (CSP는 style 속성만 막음)
            return h('li', {},
              h('span', { class: 'graph-label', title: b.label }, b.label),
              h('span', { class: 'graph-track', 'aria-hidden': 'true' }, fill),
              h('span', { class: 'graph-n' }, [b.n ? `${b.n}번` : '', b.from === 'said' ? `${scopeText(b)} 말함` : ''].filter(Boolean).join(' · ')),
            );
          }));
      return h('section', { class: 'graph-group', 'data-group': g.key }, h('h3', {}, g.title), body);
    })),
  );
}
// ── 말 기록 (10/22 예형님: 타임라인) — 언제·말/글·알아들은 것·처리한 곳 ──
const BY_KO: Record<store.TalkLogEntry['by'], string> = { RULES: '규칙', GPU: 'GPU', OpenAI: 'OpenAI' };
function logTalk(text: string, via: 'voice' | 'text', r: Json, stt?: 'phone' | 'openai') {
  const by: store.TalkLogEntry['by'] = !r.aiBy ? 'RULES' : /openai/i.test(String(r.aiBy)) ? 'OpenAI' : 'GPU';
  const e: store.TalkLogEntry = { at: new Date().toISOString(), text: text.slice(0, 300), via, ...(stt ? { stt } : {}), understood: ((r.understood as string[]) ?? []).slice(0, 12), by };
  if (!store.addTalkLog(e)) state.sessionTalkLog = [e, ...state.sessionTalkLog].slice(0, store.MAX_TALK_LOG);
  renderTalkLog();
}
function renderTalkLog() {
  const list = document.getElementById('talk-log');
  if (!list) return;
  const saved = store.consented('taste');
  const items = saved ? store.talkLog() : state.sessionTalkLog;
  const head = list.parentElement!;
  head.querySelectorAll('.talk-log-extra').forEach((x) => x.remove());
  if (!items.length) return put(list, h('li', { class: 'meta talk-log-empty' }, '아직 없어요. ② 메뉴 주문에서 말하거나 글로 보내면 여기에 쌓여요'));
  put(list, ...items.map((e) => h('li', { class: 'talk-log-item' },
    h('p', { class: 'talk-log-meta' }, h('time', { datetime: e.at }, new Date(e.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })), ` · ${e.via === 'voice' ? `🎤 말${e.stt === 'phone' ? ' (휴대폰 받아쓰기)' : e.stt === 'openai' ? ' (OpenAI 받아쓰기)' : ''}` : '글'} · `, h('b', { class: `by-${e.by.toLowerCase()}` }, BY_KO[e.by])),
    h('p', { class: 'talk-log-text' }, `"${e.text}"`),
    e.understood.length ? h('p', { class: 'meta' }, `알아들은 것: ${e.understood.join(' · ')}`) : h('p', { class: 'meta' }, '알아들은 조건 없음'),
  )));
  const clear = h('button', { type: 'button', class: 'btn-text talk-log-extra', id: 'talk-log-clear' }, '말 기록 지우기');
  clear.addEventListener('click', () => {
    store.clearTalkLog();
    state.sessionTalkLog = [];
    renderTalkLog();
  });
  if (!saved) head.append(h('p', { class: 'meta talk-log-extra' }, '"취향 기억하기"가 꺼져 있어 이 화면을 닫으면 사라져요'));
  head.append(clear);
}
// ── 내 정보 보기 (10/19, 권리 요청 — SOPHIA rights-service 의 "열람"을 휴대폰 저장소로): 저장된 것 전부 보기·내려받기 ──
function myDataView() {
  const box = h('details', { class: 'my-data', id: 'my-data' }, h('summary', {}, '이 휴대폰에 저장된 것 보기'));
  box.addEventListener('toggle', () => {
    if (!(box as HTMLDetailsElement).open) return;
    const s = store.load();
    const on = (k: store.ConsentKind) => (store.consented(k) ? '켜짐' : '꺼짐');
    const data = { 동의: s.consents, 주문기록: s.orders, 알레르기: s.allergies, 취향: s.tastes ?? [], 지운_배운것: s.suppressed ?? [], 즐겨찾기: s.favorites ?? [], 말기록: s.talkLog ?? [] };
    const text = JSON.stringify(data, null, 2);
    const dl = h('button', { type: 'button', class: 'btn-text', id: 'my-data-download' }, '파일로 내려받기');
    dl.addEventListener('click', () => {
      const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: 'subway-my-data.json' }) as HTMLAnchorElement;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    put(box, h('summary', {}, '이 휴대폰에 저장된 것 보기'),
      h('ul', { class: 'my-data-sum' },
        h('li', {}, `알레르기 기억하기 ${on('allergy')} · 저장된 알레르기 ${s.allergies.length}개`),
        h('li', {}, `주문 기록 저장 ${on('orders')} · 주문 ${s.orders.length}개 · 즐겨찾기 ${(s.favorites ?? []).length}개`),
        h('li', {}, `취향 기억하기 ${on('taste')} · 취향 ${(s.tastes ?? []).length}개 · 말 기록 ${(s.talkLog ?? []).length}개`),
        h('li', {}, `말로 입력 ${on('voice')} (녹음은 저장 안 함)`),
        h('li', {}, '위치는 저장하지 않아요. 서버에는 내 기록이 없어요'),
      ),
      h('pre', { class: 'my-data-raw', tabindex: '0', 'aria-label': '저장된 내용 전체' }, text),
      dl,
    );
  });
  return box;
}
function renderConsents() {
  put($('settings-body'), consentList('set'),
    (() => {
      const b = h('button', { type: 'button', class: 'btn-text', id: 'clear-all' }, '내 기록 전부 지우기');
      b.addEventListener('click', () => {
        // 동의를 다 꺼서 남은 게 없으면 묻지 않음 (10/16: 지울 게 없는데도 "모두 지울까요?"라고 묻던 것)
        if (!store.hasRecords() && !state.sessionTastes.length && !state.sessionTalkLog.length) {
          $('clear-result').textContent = '지울 기록이 없어요';
          return;
        }
        if (!confirm('동의·주문 기록·알레르기·취향·즐겨찾기·말 기록을 이 휴대폰에서 모두 지울까요?')) return;
        store.clearAll();
        clearCart();
        renderSlots();
        state.sessionTastes = [];
        state.sessionTalkLog = [];
        store.markOnboarded();
        consentChanged();
        $('clear-result').textContent = '모두 지웠어요';
      });
      return b;
    })(),
    h('p', { class: 'meta', id: 'clear-result', role: 'status' }),
    myDataView(),
    h('p', { class: 'meta' }, h('a', { href: '/privacy.html', id: 'privacy-link' }, '개인정보 처리방침')),
  );
  const ob = $('onboard');
  ob.hidden = store.load().onboarded;
  if (ob.hidden) return;
  const go = h('button', { type: 'button', class: 'btn-primary wide', id: 'onboard-done' }, '이대로 시작');
  go.addEventListener('click', () => {
    store.markOnboarded();
    ob.hidden = true;
    autoLocate(); // 처음 동의를 마치면 바로 지금 위치로 (10/16)
  });
  put($('onboard-body'), h('p', {}, '로그인 없이 써요. 필요한 것만 켜 주세요 (나중에 아래 [취향 그래프] → "내 정보"에서 바꿀 수 있어요)'), consentList('ob'), h('p', { class: 'meta' }, h('a', { href: '/privacy.html' }, '개인정보 처리방침 보기')), go);
}

// ── 🎤 말로 입력 (10/22 예형님): 말하는 동안 글자가 입력 칸에 보이고, 2초 조용하면 저절로 끝 + 보냄, [보내기]·🎤를 누르면 바로 끝 + 보냄 ──
const MAX_RECORD_MS = 30000;
/** 말을 멈춘 뒤 이만큼 조용하면 끝 */
const SILENCE_MS = 2000;
/** 처음부터 말이 없으면 이만큼 기다리고 끝 */
const NO_SPEECH_MS = 8000;
/** 말하는 동안 글자 받기 (SOPHIA media-input-ui 와 같은 1.5초) */
const LIVE_EVERY_MS = 1500;
let recorder: MediaRecorder | null = null;
let micStarting = false;
/** 녹음을 끝내고 보냄 (🎤 다시 누름·[보내기]·조용함·30초) */
function stopMic() {
  if (phoneRec) return phoneRec.stop();
  if (recorder && recorder.state === 'recording') recorder.stop();
}
/** 휴대폰(브라우저) 음성 인식 (10/26 예형님: 휴대폰 받아쓰기 먼저, 안 되면 OpenAI) */
type PhoneRec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: Json) => void) | null; onerror: ((e: Json) => void) | null; onend: (() => void) | null };
let phoneRec: PhoneRec | null = null;
/** 이 화면에서 휴대폰 받아쓰기가 한 번 실패하면 그다음부터는 바로 OpenAI */
let phoneSttBroken = false;
const phoneSR = (): (new () => PhoneRec) | null => ((window as Json).SpeechRecognition ?? (window as Json).webkitSpeechRecognition ?? null);
function syncMic() {
  const mic = $('mic') as HTMLButtonElement;
  const can = !!phoneSR() || (state.options?.voice === 'ready' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);
  mic.hidden = !can;
  $('mic-hint').hidden = !can;
  // 동의 전에도 누를 수 있다 (누르면 동의 안내). 그래서 aria-disabled 대신 모양·이름으로만 알림
  const off = !store.consented('voice');
  mic.classList.toggle('needs-consent', off);
  if (!recorder) mic.setAttribute('aria-label', off ? '말하기 (동의 필요)' : '말하기');
}
function pickAudioType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return '';
}
async function micClick() {
  const box = $('talk-result');
  if (!store.consented('voice')) {
    const on = h('button', { type: 'button', class: 'btn-primary' }, '동의하고 켜기');
    on.addEventListener('click', () => {
      store.setConsent('voice', true);
      consentChanged();
      box.replaceChildren();
      void micClick();
    });
    return put(box, h('div', { class: 'notice' }, h('p', {}, CONSENT_TEXT.voice[1]), on));
  }
  if (recorder || phoneRec) return stopMic();
  if (micStarting) return; // 마이크 허용 창이 떠 있는 동안 또 누르면 녹음이 둘 생기던 것
  const SR = phoneSR();
  if (SR && !phoneSttBroken) return listenWithPhone(SR);
  return recordWithOpenAI();
}
/** 휴대폰 받아쓰기: 말하는 동안 글자, 2초 조용하면·[보내기]·🎤·30초면 끝 → 보냄. 안 되면(기능 없음·연결 오류) OpenAI로 */
function listenWithPhone(SR: new () => PhoneRec) {
  const box = $('talk-result');
  const mic = $('mic');
  const input = $('talk-input') as HTMLInputElement;
  const typed = input.value;
  const sr = new SR();
  sr.lang = 'ko-KR';
  sr.interimResults = true;
  sr.continuous = true;
  let finalText = '';
  let interim = '';
  let heard = false;
  let fallback = false;
  let denied = false;
  let ended = false;
  const started = Date.now();
  let lastAt = started;
  const timer = window.setInterval(() => {
    const now = Date.now();
    if ((heard && now - lastAt > SILENCE_MS) || (!heard && now - started > NO_SPEECH_MS) || now - started > MAX_RECORD_MS) stopMic();
  }, 200);
  sr.onresult = (e: Json) => {
    finalText = '';
    interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    const t = (finalText + interim).trim();
    if (!t) return;
    heard = true;
    lastAt = Date.now();
    input.value = t;
    input.classList.add('live');
    fitTalk();
  };
  sr.onerror = (e: Json) => {
    if (e.error === 'not-allowed') denied = true;
    else if (e.error !== 'no-speech' && e.error !== 'aborted') fallback = true; // network·audio-capture·service-not-allowed 등
  };
  sr.onend = async () => {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    phoneRec = null;
    mic.classList.remove('rec');
    mic.setAttribute('aria-label', '말하기');
    mic.querySelector('.mic-label')!.textContent = '말하기';
    input.classList.remove('live');
    const text = (finalText + interim).trim();
    if (fallback && !text) {
      phoneSttBroken = true;
      input.value = typed;
      await recordWithOpenAI();
      box.append(h('p', { class: 'meta', id: 'stt-fallback' }, '이 브라우저에선 휴대폰 받아쓰기가 안 돼서 OpenAI로 받아써요'));
      return;
    }
    if (denied || !text) {
      input.value = typed;
      fitTalk();
      return put(box, h('p', { class: 'notice warn' }, denied ? '마이크를 쓸 수 없어요. 브라우저 설정에서 마이크·음성 인식을 허용하거나 글로 입력해 주세요' : '알아듣지 못했어요. 다시 말하거나 글로 입력해 주세요'));
    }
    input.value = text;
    fitTalk();
    if (await talk(text, 'voice', 'phone')) (input.value = ''), fitTalk();
  };
  try {
    sr.start();
  } catch {
    clearInterval(timer);
    phoneSttBroken = true;
    return recordWithOpenAI();
  }
  phoneRec = sr;
  mic.classList.add('rec');
  mic.setAttribute('aria-label', '말하기 끝내고 보내기');
  mic.querySelector('.mic-label')!.textContent = '듣는 중';
  put(box, h('p', { class: 'notice', id: 'mic-listening' }, `듣고 있어요… 말을 멈추면 ${SILENCE_MS / 1000}초 뒤 저절로 보내요. 바로 보내려면 [보내기]`));
}
/** OpenAI 받아쓰기 (휴대폰 받아쓰기가 없거나 안 될 때): 녹음 → 1.5초마다 글자 → 끝나면 받아쓰기 */
async function recordWithOpenAI() {
  const box = $('talk-result');
  micStarting = true;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    micStarting = false;
    return put(box, h('p', { class: 'notice warn' }, '마이크를 쓸 수 없어요. 브라우저 설정에서 마이크를 허용하거나 글로 입력해 주세요'));
  }
  const type = pickAudioType();
  const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
  const chunks: Blob[] = [];
  const mic = $('mic');
  const input = $('talk-input') as HTMLInputElement;
  const blobType = (rec.mimeType || type || 'audio/webm').split(';')[0] ?? 'audio/webm';
  const typed = input.value;
  let liveText = '';
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const timer = window.setTimeout(stopMic, MAX_RECORD_MS);
  // 말하는 동안 글자: 1.5초마다 지금까지 녹음한 것을 받아쓰기 (못 하면 글자 없이 녹음만 계속)
  let liveOn = true;
  let liveBusy = false;
  let liveSent = 0;
  const liveTimer = window.setInterval(() => {
    if (!liveOn || liveBusy || chunks.length === liveSent || rec.state !== 'recording') return;
    liveBusy = true;
    liveSent = chunks.length;
    const blob = new Blob(chunks, { type: blobType });
    fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': blob.type, 'x-subway-live': '1' }, body: blob })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (res.status !== 200 || j.live === 'OFF') liveOn = res.status === 200 ? false : liveOn && res.status !== 429 && res.status !== 503;
        if (j.text && rec.state === 'recording') {
          liveText = j.text;
          input.value = j.text;
          fitTalk();
          input.classList.add('live');
        }
      })
      .catch(() => (liveOn = false))
      .finally(() => (liveBusy = false));
  }, LIVE_EVERY_MS);
  // 조용함 알아채기: 소리 크기(RMS)가 바닥 소리보다 크면 말하는 중, 말한 뒤 2초 조용하면 끝
  let ac: AudioContext | null = null;
  let quietTimer = 0;
  try {
    ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 1024;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const started = performance.now();
    let floor = 0.01;
    let heard = false;
    let lastLoud = started;
    quietTimer = window.setInterval(() => {
      if (rec.state !== 'recording') return;
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (rms > Math.max(0.03, floor * 3)) (heard = true), (lastLoud = now);
      else floor = floor * 0.95 + rms * 0.05;
      if ((heard && now - lastLoud > SILENCE_MS) || (!heard && now - started > NO_SPEECH_MS)) stopMic();
    }, 100);
  } catch {
    ac = null; // 조용함을 못 재는 브라우저: 🎤·[보내기]·30초로 끝
  }
  rec.onstop = async () => {
    clearTimeout(timer);
    clearInterval(liveTimer);
    clearInterval(quietTimer);
    void ac?.close().catch(() => undefined);
    stream.getTracks().forEach((t) => t.stop());
    recorder = null;
    mic.classList.remove('rec');
    mic.setAttribute('aria-label', '말하기');
    mic.querySelector('.mic-label')!.textContent = '말하기';
    input.classList.remove('live');
    const blob = new Blob(chunks, { type: blobType });
    busy(true, '말을 글로 바꾸고 있어요');
    let r: Json;
    try {
      const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
      r = { ...(await res.json().catch(() => ({}))), http: res.status };
    } catch {
      r = { http: 0 };
      $('offline').hidden = false;
    }
    busy(false);
    // 끝난 뒤 받아쓰기가 안 되면 말하는 동안 받은 글로 (10/22)
    const text: string = r.http === 200 && r.text ? r.text : liveText;
    if (!text) {
      input.value = typed;
      fitTalk();
      const why = r.http === 0 ? '인터넷 연결을 확인해 주세요' : r.error === 'AUDIO_TOO_SHORT' ? '너무 짧았어요' : r.error === 'VOICE_BUSY' ? '지금은 말로 입력을 쓸 수 없어요 (사용량이 많아요)' : '알아듣지 못했어요';
      return put(box, h('p', { class: 'notice warn' }, `${why}. 다시 말하거나 글로 입력해 주세요`));
    }
    input.value = text;
    fitTalk();
    if (await talk(text, 'voice', 'openai')) (input.value = ''), fitTalk();
  };
  rec.start(500);
  recorder = rec;
  micStarting = false;
  mic.classList.add('rec');
  mic.setAttribute('aria-label', '말하기 끝내고 보내기');
  mic.querySelector('.mic-label')!.textContent = '듣는 중';
  put(box, h('p', { class: 'notice', id: 'mic-listening' }, `듣고 있어요… 말을 멈추면 ${SILENCE_MS / 1000}초 뒤 저절로 보내요. 바로 보내려면 [보내기]`));
}

/** 말·글 칸 높이를 글에 맞춤 (10/22: 말한 것 전체가 보이게, 5줄까지) */
function fitTalk() {
  const t = $('talk-input') as HTMLTextAreaElement;
  const cs = getComputedStyle(t);
  const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const max = (parseFloat(cs.lineHeight) || 26) * 5 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + border;
  t.style.height = 'auto'; // CSSOM (CSP는 style 속성만 막음)
  t.style.height = `${Math.min(t.scrollHeight + border, max)}px`;
  t.style.overflowY = t.scrollHeight + border > max ? 'auto' : 'hidden';
}

// ── 끊김 안내: 끊겨도 화면은 그대로, 다시 연결되면 알려 줌 ──
function syncOnline() {
  $('offline').hidden = navigator.onLine;
}

// ── 말·글 ──
/** 서버가 받아 줬으면 true (실패하면 입력한 글을 지우지 않아 다시 보낼 수 있게) */
// 한 번에 말하기 (10/16): "강남역에서 로스트 치킨 먹을 건데 양파 빼고 피클 추가, 우유 알레르기"
//  → 장소·메뉴·옵션·알레르기를 버튼에 다 채운다. 말 안 한 것은 앱이 채우고 "AI가 추천했어요!"를 붙인다
//    (장소를 안 말함 → 지금 위치, 메뉴를 안 말함 → 추천 1위). 마음에 안 들면 그 칸만 고치면 된다.
const NEED_MENU = '먼저 메뉴를 골라 주세요';
/** 말했던 것 (장소 고르기를 기다리는 동안 기억) */
let pendingTalk: { text: string; r: Json } | null = null;

/** 서버가 받아 줬으면 true (실패하면 입력한 글을 지우지 않아 다시 보낼 수 있게) */
async function talk(text: string, via: 'voice' | 'text' = 'text', stt?: 'phone' | 'openai'): Promise<boolean> {
  state.engaged = true;
  const remembered = state.talkForPick;
  state.talkForPick = null;
  // 10/27 예형님 "젬마가 주도적으로": 모든 말을 젬마가 먼저 읽는다 (몇 명·몇 줄·무엇을·어떤 상황). 여러 줄이면 바로 장바구니로.
  // 한 사람 말이면 젬마가 읽은 조건·상황을 아래 해석에 얹음. 젬마·OpenAI가 둘 다 안 되면 아래 규칙 그대로 (비상용)
  const ai = state.options?.ai === 'off' ? null : await cartAiFirst(text);
  if (ai?.late || ai?.handled) busy(false);
  if (ai?.late) {
    put($('talk-result'), h('p', { class: 'notice warn', id: 'ai-late' }, '젬마 답이 늦어요. 잠시 뒤 다시 말해 주세요 (말이 길면 나눠서 말해도 돼요)'));
    return false;
  }
  if (ai?.handled) return (await cartAiTalk(text, via, stt, ai.res)) || false;
  busy(true, '뜻을 해석하고 있어요', 'AI에게 물어보고 있어요 (몇 초 걸려요)');
  const r0 = await api('/api/interpret', { text, context: { menuId: state.menu?.id, choices: state.choices, prefs: state.prefs, ...(ai?.res ? { skipAi: true } : {}) } });
  const r = ai?.res && r0.http === 200 ? mergeAiHint(r0, ai.res) : r0;
  busy(false);
  const box = $('talk-result');
  if (r.http !== 200) {
    box.replaceChildren(h('p', { class: 'notice bad' }, r.http === 0 ? '인터넷 연결을 확인하고 다시 시도해 주세요' : '해석하지 못했어요. 버튼으로 골라 주세요'));
    return false;
  }
  logTalk(text, via, r, stt);
  // 여러 개 주문 (8단계): "로스트 치킨 2개", "하나는 해장할 거, 하나는 가벼운 거", "잠봉, 치킨, 스파이시", 담은 칸 고치기 — 하나만 사는 말은 그대로 아래로
  if (await multiTalk(text, r)) return true;
  // 메뉴를 안 말했으면 1위를 골라 둘 것이므로 "먼저 메뉴를 골라 주세요"는 보이지 않음
  const willPick = (!r.menuId && r.understood.length > 0 && !r.ask) || r.ask === 'LAST'; // "지난번처럼"도 메뉴를 불러옴
  const refusals = (r.refusals as string[]).filter((x) => !(willPick && x.startsWith(NEED_MENU)));
  put(box,
    r.understood.length ? h('div', { class: 'understood', 'aria-label': '이렇게 이해했어요' }, ...r.understood.map((u: string) => h('span', { class: 'tag' }, u))) : null,
    r.question ? h('p', { class: 'notice' }, r.question) : null,
    ...refusals.map((x: string) => h('p', { class: 'notice warn' }, x)),
    !r.understood.length && !r.question && !refusals.length ? h('p', { class: 'notice' }, '잘 못 알아들었어요. "만 원 이하", "단백질 많이"처럼 말해 주세요') : null,
    // 젬마가 읽은 상황 (감기·운동 후…) — 추천과 AI 한마디가 이 상황에 맞춰요 (10/27)
    r.situation ? h('p', { class: 'notice', id: 'ai-situation' }, `이렇게 이해했어요: ${r.situation}`) : null,
  );
  // 막연한 말 ("뭐 먹지?", 10/20 예형님): 지금 시간·내 취향에 맞춰 골랐다고 한마디
  if (r.vague && r.understood.length === 1 && r.understood[0] === '메뉴 추천') box.append(h('p', { class: 'notice', id: 'vague-note' }, vagueLine()));
  // "2번으로 할게" (10/21 4차): 지금 추천의 N번째를 고름 — 앞에서 말한 옵션(양파 빼기 등)도 그 메뉴에
  if (r.pickRank && state.result?.menus?.top?.[r.pickRank - 1]) {
    state.talkForPick = remembered;
    await pickWithTalk(state.result.menus.top[r.pickRank - 1]);
    return true;
  }
  state.prefs = { ...state.prefs, ...r.prefs };
  store.rememberAllergies(state.prefs.allergies);
  syncConditionUi();
  // 말한 취향·피곤함 (10/17): 이번 추천에 바로 쓰고, '취향 기억하기'를 켰으면 저장
  if (rememberTalk(r) && !store.consented('taste')) box.append(h('p', { class: 'meta' }, '이번에만 반영해요. 다음에도 쓰려면 [취향 그래프] → 내 정보에서 "취향 기억하기"를 켜 주세요'));
  // 말로 "평소처럼" (10/21): 메뉴를 이미 골랐으면 [평소처럼] 버튼과 같게 (지금 메뉴에 평소 옵션) — 안 골랐으면 아래 "지난번처럼"
  if (r.ask === 'LAST' && state.menu && state.sheet && /평소/.test(text) && !/지난|저번/.test(text)) {
    const b = document.getElementById('usual') as HTMLButtonElement | null;
    if (b) b.click();
    box.append(h('p', { class: 'notice' }, b ? '지금 메뉴에 평소 옵션을 넣었어요' : state.usualApplied ? '이미 평소대로 넣어 두었어요' : '아직 평소 옵션이 없어요 (같은 옵션으로 2번 넘게 주문하면 생겨요)'));
    return true;
  }
  // "지난번처럼" (10/17): 마지막 주문을 그대로
  if (r.ask === 'LAST') {
    const last = store.orders()[0];
    if (!last) {
      box.append(h('p', { class: 'notice warn' }, store.consented('orders') ? '아직 주문 기록이 없어요. 주문서에서 [이대로 주문하기] → [확인]을 누르면 다음부터 불러올 수 있어요' : '주문 기록 저장이 꺼져 있어 지난 주문을 몰라요. 맨 아래 내 정보에서 켤 수 있어요'));
      return true;
    }
    if (!state.location) await useGps(true);
    if (!(await reorder(last, '지난 주문'))) return true;
    // "지난번처럼, 근데 양파 빼줘": 불러온 주문에 같은 말의 수정을 더함 (AI는 또 부르지 않음)
    if (r.understood.length > 1) {
      const r2 = await api('/api/interpret', { text, context: { menuId: state.menu.id, choices: state.choices, prefs: state.prefs, skipAi: true } });
      if (r2.http === 200 && r2.choices) {
        state.choices = r2.choices;
        renderOptions();
        await refreshSheet();
      }
      if (r2.http === 200) for (const x of (r2.refusals as string[]).filter((x) => !x.startsWith(NEED_MENU))) box.append(h('p', { class: 'notice warn' }, x));
    }
    return true;
  }
  // 말로 알레르기가 바뀌면 열린 옵션·주문서의 표시도 (메뉴를 새로 고르는 경우는 아래 pickMenu가 다시 그림)
  if (!r.menuId && state.menu && state.sheet) {
    state.allergyPending = true;
    renderOptions();
    void refreshSheet();
  }
  // 장소: 말했으면 그 장소, 안 말했으면 지금 위치 (이미 정한 위치가 있으면 그대로)
  if (r.place) {
    const found = await searchPlace(r.place);
    if (found === 'CHOOSE') {
      pendingTalk = { text, r }; // 어느 곳인지 고르면 이어서
      box.append(h('p', { class: 'notice', id: 'place-wait' }, `"${r.place}"이 여러 곳이에요. 위에서 고르면 이어서 추천해요`));
      goTo('step-location');
      return true;
    }
    if (found !== 'OK') return true;
  } else if (!state.location && r.understood.length) {
    await useGps(true);
  } else if (state.location) await recommend();
  if (!state.location) {
    if (r.understood.length) $('cond-hint').hidden = false;
    return true;
  }
  await afterRecommend(text, r);
  // 10/22 예형님: 장소를 말했으면 ① 매장에서 고른 매장을 먼저 확인
  if (r.place) goTo('step-location');
  if (r.ask === 'COMPARE') showCompare();
  if (r.ask === 'WHY') document.querySelector<HTMLButtonElement>('#menu-list .menu .actions button')?.click();
  return true;
}

/** 추천이 나온 뒤: 말한 메뉴를 고르거나, 안 말했으면 1위를 골라 같은 말의 옵션을 그 메뉴에 적용 */
async function afterRecommend(text: string, r: Json) {
  if (r.menuId) {
    const fromTop = state.result?.menus?.top.find((m: Json) => m.id === r.menuId);
    // 샌드위치 없이 단품만 (10/19 "콜라만 줘")
    const m = r.menuId === SINGLES_MENU.id ? SINGLES_MENU : fromTop ?? (state.menu?.id === r.menuId ? state.menu : state.options?.menus?.find((x: Json) => x.id === r.menuId));
    if (m) pickMenu(m, r.choices ?? {}, 'talk', [], { saucesAdd: r.saucesAdd, keepVegetables: r.keepVegetables });
    return;
  }
  const top = state.result?.menus?.top?.[0];
  // 직접 고른 메뉴는 바꾸지 않음. 질문("왜?")만 한 말이면 안 고름
  if (!top || !r.understood.length || r.ask) return;
  // 직접 고른 메뉴가 있어도 조건을 말했으면 바뀐 ③을 보여 줌 (10/22). 음료·사이드만이었으면 ③ 잠금도 풂
  if (state.menuBy === 'user') {
    if (state.menu?.id === SINGLES_MENU.id) unlockRecs();
    if (!r.place) goTo('step-menu');
    return;
  }
  // 10/21 예형님: 1위를 알아서 고르지 않는다 — ③ 추천 메뉴에서 직접 고르면 같은 말의 옵션(양파 빼기·세트·음료 등)을 그 메뉴에 넣음
  state.talkForPick = text;
  const options = (r.understood as string[]).filter((u) => /빼기|더$|넣기|소스|토핑|세트|단품|크기|빵|치즈|토스팅/.test(u) && !/^샌드위치로|메뉴 빼기$|메뉴로$/.test(u));
  if (options.length) $('talk-result').append(h('p', { class: 'notice', id: 'pick-hint' }, `위 추천에서 메뉴를 고르시면 말씀하신 ${options.join('·')}도 넣어 드려요`));
  if (!r.place) goTo('step-menu');
}

/** 음료·사이드만으로 잠근 ③을 다시 누를 수 있게 */
function unlockRecs() {
  ($('recs-body') as HTMLElement & { inert: boolean }).inert = false;
  $('recs-unlock').hidden = true;
  $('step-menu').classList.remove('dimmed');
  state.engaged = true;
  gateRecs();
}

function goTo(id: string) {
  $(id).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

async function loadOptions() {
  const o = await api('/api/options');
  if (o.http === 200) {
    state.options = o;
    renderAllergyChips(o.allergens, o.allergenGroups);
  }
  syncMic();
  syncConditionUi();
}

// ── 카카오톡 안 브라우저 → Chrome (kakao-handoff.ts). 자동으로 못 옮겼을 때 남는 안내 ──
function kakaoGuide() {
  const g = $('kakao-guide');
  g.hidden = !isKakaoInApp(navigator.userAgent) || staysInKakao(window);
  if (g.hidden) return;
  const result = $('kakao-result');
  const tried = '열리지 않으면 오른쪽 위 메뉴(⋮ 또는 ···) → "다른 브라우저로 열기"를 눌러 주세요';
  $('kakao-open').addEventListener('click', () => {
    openInChrome(window, { manual: true });
    result.textContent = tried;
  });
  $('kakao-copy').addEventListener('click', async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(location.href);
      ok = true;
    } catch {
      /* 복사 막힘 */
    }
    result.textContent = ok ? '링크를 복사했어요. Chrome 주소창에 붙여 넣어 주세요' : `이 주소를 Chrome에 입력해 주세요: ${location.href}`;
  });
  $('kakao-stay').addEventListener('click', () => {
    stayInKakao(window);
    g.hidden = true;
  });
}

// ── 맨 위 설치 안내 (install-banner.ts) ──
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let installPrompt: InstallPrompt | null = null;
let justInstalled = false;
const CLOSED_KEY = 'subway.install.closed';
const installClosed = () => {
  try {
    return localStorage.getItem(CLOSED_KEY) === '1';
  } catch {
    return false;
  }
};
function renderInstall() {
  const v = installView({ userAgent: navigator.userAgent, standalone: isStandalone(window), kakao: isKakaoInApp(navigator.userAgent), canPrompt: !!installPrompt, justInstalled, closed: installClosed() });
  const bar = $('install-bar');
  bar.hidden = !v.show;
  if (!v.show) return;
  bar.dataset.kind = v.kind;
  $('install-text').textContent = v.text;
  ($('install-go') as HTMLButtonElement).hidden = !v.button;
  ($('install-close') as HTMLButtonElement).hidden = !v.close;
}
function bindInstall() {
  // 브라우저가 "설치할 수 있어요"라고 알려 주면 버튼을 보임 (안드로이드 Chrome 등). 기본 작은 안내 대신 우리 버튼으로
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    renderInstall();
  });
  addEventListener('appinstalled', () => {
    installPrompt = null;
    justInstalled = true;
    renderInstall();
  });
  $('install-go').addEventListener('click', async () => {
    const p = installPrompt;
    if (!p) return renderInstall();
    installPrompt = null; // 설치 창은 한 번만 띄울 수 있음
    await p.prompt();
    const { outcome } = await p.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
    if (outcome === 'accepted') justInstalled = true;
    renderInstall();
  });
  $('install-close').addEventListener('click', () => {
    try {
      localStorage.setItem(CLOSED_KEY, '1');
    } catch {
      /* 저장 막힘: 이번 화면에서만 닫힘 */
    }
    justInstalled = false;
    $('install-bar').hidden = true;
  });
  // 홈 화면 앱으로 바뀌는 순간(설치 직후 열기 등)에도 다시 판단
  matchMedia('(display-mode: standalone)').addEventListener?.('change', renderInstall);
  renderInstall();
}

// ── 시작 ──
async function start() {
  bindInstall();
  // 카카오톡 안이면 Chrome으로 (탭에 한 번, 안에서 계속을 고른 탭은 안 함). 화면을 다 그린 뒤에 옮긴다:
  // 그리기 전에 옮기면, 그 주소를 못 여는 브라우저에서는 화면이 아예 안 그려져 안내도 못 보게 됨
  kakaoGuide();
  if (document.readyState === 'complete') setTimeout(() => openInChrome(window), 0);
  else addEventListener('load', () => setTimeout(() => openInChrome(window), 0), { once: true });
  showNow();
  bindConditions();
  $('use-gps').addEventListener('click', () => void useGps());
  $('place-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = ($('place-input') as HTMLInputElement).value.trim();
    if (q) void searchPlace(q);
  });
  $('talk-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (recorder || phoneRec) return stopMic(); // 말하는 중 [보내기] → 녹음 끝 + 그때까지 말한 것으로 한 번만 보냄 (10/22)
    const input = $('talk-input') as HTMLInputElement;
    const t = input.value.trim();
    if (t) void talk(t).then((ok) => ok && ((input.value = ''), fitTalk()));
  });
  // 여러 줄 칸: 쓰는 만큼 늘어나고, 자판의 보내기(엔터)는 줄바꿈 대신 보내기 (한글 조합 중에는 안 보냄)
  $('talk-input').addEventListener('input', fitTalk);
  $('talk-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ($('talk-form') as HTMLFormElement).requestSubmit();
    }
  });
  $('compare').addEventListener('click', toggleCompare);
  const toCart = () => (showTab('order'), openCart());
  $('cart-btn').addEventListener('click', () => (cartCount() || slots.list.length ? toCart() : toast('아직 담은 게 없어요. ③ 추천에서 [담기]를 눌러 주세요')));
  $('drawer-back').addEventListener('click', () => closeCart());
  addEventListener('popstate', () => closeCart(true));
  addEventListener('keydown', (e: KeyboardEvent) => e.key === 'Escape' && cartOpen() && closeCart());
  // 아래 [장바구니 보기 · N개 · 금액] (10/27 예형님): 장바구니 화면
  $('cart-bar').addEventListener('click', toCart);
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tabbar .tab')) b.addEventListener('click', () => showTab(b.dataset.tab === 'taste' ? 'taste' : 'order'));
  $('show-recs').addEventListener('click', () => {
    state.engaged = true;
    gateRecs();
  });
  $('recs-unlock').addEventListener('click', () => {
    unlockRecs();
    goTo('step-menu');
  });
  // 샌드위치 없이 음료·사이드만 (10/19)
  $('singles-only').addEventListener('click', () => {
    state.talkForPick = null;
    state.usualApplied = null;
    document.getElementById('pick-hint')?.remove();
    void pickMenu(SINGLES_MENU, {}, 'user', [], { noUsual: true });
  });
  $('mic').addEventListener('click', () => void micClick());
  addEventListener('online', () => {
    syncOnline();
    if (!state.options) void loadOptions(); // 처음 열 때 끊겨 있었으면 다시 받기
  });
  addEventListener('offline', syncOnline);
  syncOnline();
  state.prefs.allergies = store.savedAllergies();
  renderConsents();
  await loadOptions();
  // 오늘 "피곤해"라고 했으면 (새벽 4시까지) 다시 열어도 든든한 쪽으로 — 버튼으로 끌 수 있음
  const { tired } = myTaste();
  if (tired && !state.prefs.goal) {
    state.prefs.goal = 'FILLING';
    syncConditionUi();
    put($('talk-result'), h('p', { class: 'notice', id: 'tired-note' }, '오늘 피곤하다고 하셔서 든든한 쪽으로 골라요 (내일 새벽 4시까지). 아니면 [든든하게]를 눌러 끄세요'));
  }
  renderOrders();
  // 담아 둔 장바구니 되살리기 (10/26, 3시간 안)
  await restoreCart();
  // 다시 연 사람(처음 안내를 이미 본 사람)은 바로 지금 위치로. 처음 온 사람은 [이대로 시작] 뒤에
  if (store.load().onboarded) autoLocate();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
void start();

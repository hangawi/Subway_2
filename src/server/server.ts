// 써브웨이 서버: 상태 확인 + 추천 API. 화면(10/14)은 이 API를 부른다.
//  GET  /health                 살아 있는지 (배포 확인)
//  GET  /ready                  판단 데이터·외부 연결 준비 (키 값은 내보내지 않음)
//  GET  /version.json           배포한 커밋·엔진 버전 (배포 확인 단계가 커밋을 맞춰 봄)
//  GET  /api/stores?lat&lng | ?q=강남역   근처 써브웨이 Top3 + 이유
//  POST /api/menus/recommend    { location, prefs?, at? } → 매장 Top3 + 메뉴 Top3 + 설명
//  POST /api/order-sheet        { menuId, choices } → 주문서 (규칙에 안 맞으면 400 + 이유)
//  POST /api/interpret          { text, context? } → 말 → 조건·주문서 선택 (규칙 + AI는 값만 옮김)
//  POST /api/cart-command       { text, cart, recs } → { ops | null, by } 장바구니 말을 AI 명령으로 (10/27, 규칙이 못 하는 말만, 검사한 것만)
//  POST /api/split              { text } → { items: [{text, qty}] | null } 여러 개 주문 나누기 (10/26, 규칙이 못 나눈 말만, AI가 나누고 원문에 있는 말만)
//  POST /api/transcribe         녹음(audio/webm·mp4 등, 1MB·약 30초까지) → 글 (저장 안 함). 화면이 받은 글을 /api/interpret 로 보냄
//                                (10/22 머리글 x-subway-live: 1 → 말하는 동안 지금까지 말한 글. 한도는 따로, 실패해도 200 {text: null})
//  GET  /api/options            옵션 수정 화면에 쓸 빵·치즈·야채·소스·토핑·세트·알레르기 목록
//  GET  /, /app.js, …           화면 (dist/web)
// 판단은 김민지 공통 엔진(vendor/sophia)이 하고, 이 파일은 입력 검사와 모양 바꾸기만 한다.
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { interpret, orderErrorText, type AiRoute, type TalkContext } from '../conversation/interpret.ts';
import { avoidAllergens, composeAllergens, DEFAULT_VEGETABLES, type Changes } from '../order-sheet/composition.ts';
import { AUDIO_TYPES, type AudioType, type SpeechProvider } from '../../vendor/sophia/packages/contracts/src/media-contract.ts';
import type { MenuKind, SubwayCatalog } from '../catalog/subway-catalog.ts';
import { recommendFlow, type MenuPrefs } from '../flow/recommend-flow.ts';
import type { LocationInput } from '../location/resolve-location.ts';
import { buildOrderSheet, buildSinglesSheet, MAX_EXTRA_LINES, MAX_EXTRA_QTY, SET_ITEMS, SINGLES_ID, type OrderChoices } from '../order-sheet/order-sheet.ts';
import { compareMenus, explainMenu, explainRejection } from '../subway-menu/explain.ts';
import { aiExplain } from '../subway-menu/ai-explain.ts';
import { aiSplit } from '../conversation/split-ai.ts';
import { aiCartCommands, type CartLineIn } from '../conversation/cart-ai.ts';
import { MAIN_KINDS, SUBWAY_MENU_FUNCTION_VERSION, type MainKind, type Taste } from '../subway-menu/menu-domain.ts';
import { DRINKS } from '../conversation/intent-schema.ts';
import { explainStore, explainStoreRejection } from '../subway-store/explain.ts';
import { SUBWAY_STORE_FUNCTION_VERSION } from '../subway-store/store-domain.ts';
import { mealTimeOf } from '../time/meal-time.ts';
import type { Providers } from './providers.ts';

export interface ServerDeps {
  catalog: SubwayCatalog;
  providers: Providers;
  version: { commit: string; engineSource: string; builtAt: string };
  clock?: () => Date;
  /** AI (없으면 규칙 해석만) */
  ai?: AiRoute | null;
  /** Top3 AI 한마디 (A100만, 10/21). 없으면 설명 없이 */
  aiExplain?: AiRoute | null;
  aiStatus?: string;
  /** 음성 받아쓰기 (없으면 /api/transcribe 는 VOICE_UNAVAILABLE) */
  speech?: SpeechProvider[];
  /** 받아쓰기 한도 (쓸 때마다 OpenAI 비용 — 서버 전체 기준). 기본 분당 20·하루 300 */
  voiceLimit?: { perMinute: number; perDay: number };
  /** 말하는 동안 글자 보이기 (10/22, 1.5초마다) — 끝난 뒤 받아쓰기와 한도를 따로 */
  voiceLiveLimit?: { perMinute: number; perDay: number };
  /** 화면 파일 폴더 (dist/web). 없으면 화면은 안 냄 */
  webDir?: string | null;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp',
};
// 화면은 우리 서버 것만 (외부 스크립트·글꼴 없음)
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function serveStatic(res: ServerResponse, webDir: string, path: string): boolean {
  const rel = path === '/' ? '/index.html' : path;
  // 진짜 경로로 폴더 안인지 확인 (앞 글자 비교는 web2/ 같은 옆 폴더를 못 막음 — 10/14 보안 검토)
  const root = resolve(webDir);
  const full = resolve(root, '.' + rel);
  const inside = relative(root, full);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return false;
  let body: Buffer;
  try {
    body = readFileSync(full);
  } catch {
    return false;
  }
  const ext = extname(full);
  const immutable = rel.startsWith('/fonts/');
  // 메뉴 사진은 하루 (공식 사진이 바뀌면 다시 받아 같은 이름으로 배포)
  const daily = rel.startsWith('/menu-img/');
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : daily ? 'public, max-age=86400' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(ext === '.html' ? { 'content-security-policy': CSP, 'permissions-policy': 'geolocation=(self), microphone=(self), camera=()' } : {}),
  });
  res.end(body);
  return true;
}

const MAX_BODY = 16 * 1024;
const KINDS: readonly MenuKind[] = ['SANDWICH', 'SALAD', 'GRAIN_SALAD', 'WRAP', 'MORNING_SANDWICH', 'MORNING_WRAP', 'SIDE'];

class BadRequest extends Error {}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(text);
}

const MAX_AUDIO = 1024 * 1024;
/** 고기·해산물 알레르기 (메인 재료라 보통 메뉴를 뺌). 화면 묶음 표시용 */
const MAIN_ALLERGENS = ['쇠고기', '닭고기', '돼지고기', '새우', '게', '오징어', '조개류', '고등어'];

/** 서버 전체 받아쓰기 횟수 (메모리, 재시작하면 0부터). 하루는 서울 날짜 기준 */
export function voiceCounter(limit: { perMinute: number; perDay: number }, clock: () => Date) {
  let minute: number[] = [];
  let day = '';
  let dayCount = 0;
  return () => {
    const now = clock();
    const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
    if (today !== day) (day = today), (dayCount = 0);
    minute = minute.filter((x) => now.getTime() - x < 60_000);
    if (minute.length >= limit.perMinute || dayCount >= limit.perDay) return false;
    minute.push(now.getTime());
    dayCount += 1;
    return true;
  };
}
async function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) throw new BadRequest('BODY_TOO_LARGE');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new BadRequest('BODY_TOO_LARGE');
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new BadRequest('INVALID_JSON');
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finiteOr = (v: unknown, name: string, min: number, max: number): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new BadRequest(`INVALID_${name}`);
  return v;
};

export function parseLocation(v: unknown): LocationInput {
  if (!isObj(v)) throw new BadRequest('INVALID_LOCATION');
  if (typeof v.q === 'string') {
    const text = v.q.trim();
    if (!text || text.length > 60) throw new BadRequest('INVALID_LOCATION');
    return { kind: 'TEXT', text };
  }
  const lat = finiteOr(v.lat, 'LOCATION', -90, 90);
  const lng = finiteOr(v.lng, 'LOCATION', -180, 180);
  if (lat === null || lng === null) throw new BadRequest('INVALID_LOCATION');
  return { kind: 'COORDS', point: { lat, lng } };
}

/** 내 취향 (휴대폰이 계산해 보냄): 아는 메뉴·메인 재료만, 점수는 -1 ~ 1, 많아야 30개 */
export function parseTaste(v: unknown, catalog: SubwayCatalog): Taste {
  if (!isObj(v)) throw new BadRequest('INVALID_TASTE');
  const score = (x: unknown) => {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < -1 || x > 1) throw new BadRequest('INVALID_TASTE');
    return x;
  };
  const out: Taste = {};
  if (v.menus !== undefined) {
    if (!isObj(v.menus) || Object.keys(v.menus).length > 30) throw new BadRequest('INVALID_TASTE');
    const ids = new Set(catalog.menus.map((m) => m.id));
    out.menus = {};
    for (const [k, x] of Object.entries(v.menus)) if (ids.has(k)) out.menus[k] = score(x);
  }
  if (v.mains !== undefined) {
    if (!isObj(v.mains)) throw new BadRequest('INVALID_TASTE');
    out.mains = {};
    for (const [k, x] of Object.entries(v.mains)) if ((MAIN_KINDS as readonly string[]).includes(k)) out.mains[k as MainKind] = score(x);
  }
  if (v.mainsFrom !== undefined) {
    if (!isObj(v.mainsFrom)) throw new BadRequest('INVALID_TASTE');
    out.mainsFrom = {};
    for (const [k, x] of Object.entries(v.mainsFrom)) if ((MAIN_KINDS as readonly string[]).includes(k) && (x === 'LASTING' || x === 'TODAY')) out.mainsFrom[k as MainKind] = x;
  }
  return out;
}

export function parsePrefs(v: unknown, catalog: SubwayCatalog): MenuPrefs {
  const p = v === undefined ? {} : v;
  if (!isObj(p)) throw new BadRequest('INVALID_PREFS');
  const list = (x: unknown, name: string, allowed: readonly string[]) => {
    if (x === undefined || x === null) return [];
    if (!Array.isArray(x) || x.length > 30 || !x.every((s) => typeof s === 'string' && allowed.includes(s))) throw new BadRequest(`INVALID_${name}`);
    return [...new Set(x as string[])];
  };
  const kinds = list(p.kinds, 'KINDS', KINDS) as MenuKind[];
  const goal = p.goal === undefined || p.goal === null ? null : p.goal === 'PROTEIN' || p.goal === 'LIGHT' || p.goal === 'FILLING' ? p.goal : (() => { throw new BadRequest('INVALID_GOAL'); })();
  const wantMains = list(p.wantMains, 'WANT_MAINS', MAIN_KINDS) as MainKind[];
  const avoidMains = list(p.avoidMains, 'AVOID_MAINS', MAIN_KINDS) as MainKind[];
  const vegetables = catalog.ingredients.filter((i) => i.category === 'VEGETABLE').map((i) => i.id);
  return {
    allergies: list(p.allergies, 'ALLERGIES', catalog.allergenList),
    maxEnergyKcal: finiteOr(p.maxEnergyKcal, 'MAX_ENERGY', 0, 5000),
    maxSodiumMg: finiteOr(p.maxSodiumMg, 'MAX_SODIUM', 0, 10000),
    budgetKrw: finiteOr(p.budgetKrw, 'BUDGET', 0, 1_000_000),
    kinds: kinds.length ? kinds : null,
    goal,
    removeVegetables: list(p.removeVegetables, 'VEGETABLES', vegetables),
    ...(wantMains.length ? { wantMains } : {}),
    ...(avoidMains.length ? { avoidMains } : {}),
    ...(p.lowFat === true ? { lowFat: true } : p.lowFat === undefined || p.lowFat === false || p.lowFat === null ? {} : (() => { throw new BadRequest('INVALID_LOW_FAT'); })()),
    ...(p.salty === 'MORE' || p.salty === 'LESS' ? { salty: p.salty } : p.salty === undefined || p.salty === null ? {} : (() => { throw new BadRequest('INVALID_SALTY'); })()),
    ...(['BREAKFAST', 'LUNCH', 'DINNER', 'LATE_NIGHT'].includes(p.meal as string) ? { meal: p.meal as 'LUNCH' } : p.meal === undefined || p.meal === null ? {} : (() => { throw new BadRequest('INVALID_MEAL'); })()),
    ...(p.taste !== undefined && p.taste !== null ? { taste: parseTaste(p.taste, catalog) } : {}),
    // "매운 것 빼기" (10/15 점검: 이 줄이 없어 버튼·말 모두 무시되던 문제)
    ...(p.avoidSpicy === true ? { avoidSpicy: true } : p.avoidSpicy === undefined || p.avoidSpicy === false || p.avoidSpicy === null ? {} : (() => { throw new BadRequest('INVALID_AVOID_SPICY'); })()),
    // "매운 것 넣기" (10/16). 빼기와 같이 오면 빼기만
    ...(p.wantSpicy === true && p.avoidSpicy !== true ? { wantSpicy: true } : p.wantSpicy === undefined || p.wantSpicy === false || p.wantSpicy === null || p.wantSpicy === true ? {} : (() => { throw new BadRequest('INVALID_WANT_SPICY'); })()),
  };
}

const parseAt = (v: unknown, now: Date) => {
  if (v === undefined || v === null) return now.toISOString();
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw new BadRequest('INVALID_AT');
  return new Date(Date.parse(v)).toISOString();
};

/** 휴대폰이 보낸 앞 선택을 검사: 아는 id 와 맞는 모양만 남긴다 (모르는 값은 버림) */
export function parseChoices(v: unknown, catalog: SubwayCatalog): OrderChoices {
  if (!isObj(v)) return {};
  const ids = new Set([...catalog.ingredients.map((i) => i.id), ...catalog.toppings.map((t) => t.id)]);
  const strs = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && ids.has(s)))].slice(0, 12) : undefined);
  const out: OrderChoices = {};
  if (v.size === '15cm' || v.size === '30cm') out.size = v.size;
  if (typeof v.bread === 'string' && ids.has(v.bread)) out.bread = v.bread;
  if (v.cheese === null) out.cheese = null;
  else if (typeof v.cheese === 'string' && ids.has(v.cheese)) out.cheese = v.cheese;
  for (const k of ['removeVegetables', 'addVegetables', 'sauces', 'toppings'] as const) {
    const s = strs(v[k]);
    if (s) out[k] = s;
  }
  if (v.set === null) out.set = null;
  else if (typeof v.set === 'string' && catalog.sets.some((s) => s.name === v.set)) out.set = v.set;
  if (typeof v.toasted === 'boolean') out.toasted = v.toasted;
  if (typeof v.drink === 'string' && (DRINKS as readonly string[]).includes(v.drink)) out.drink = v.drink;
  if (typeof v.setItem === 'string' && Object.values(SET_ITEMS).some((x) => x.names.includes(v.setItem as string))) out.setItem = v.setItem;
  const extras = parseExtras(v.extras, catalog);
  if (extras.length) out.extras = extras;
  return out;
}

/** 단품 (10/19): 아는 id·1~20개만, 10줄까지. 모양이 틀린 것은 버림 (주문서 규칙 검사는 buildOrderSheet가 한 번 더) */
export function parseExtras(v: unknown, catalog: SubwayCatalog): Array<{ id: string; qty: number }> {
  if (!Array.isArray(v)) return [];
  const ids = new Set((catalog.singles ?? []).map((x) => x.id));
  const out: Array<{ id: string; qty: number }> = [];
  for (const e of v) {
    if (!isObj(e) || typeof e.id !== 'string' || !ids.has(e.id) || !Number.isInteger(e.qty) || (e.qty as number) < 1 || (e.qty as number) > MAX_EXTRA_QTY) continue;
    if (out.some((x) => x.id === e.id)) continue;
    out.push({ id: e.id, qty: e.qty as number });
  }
  return out.slice(0, MAX_EXTRA_LINES);
}

export function createSubwayServer(deps: ServerDeps): Server {
  const clock = deps.clock ?? (() => new Date());
  const { catalog, providers } = deps;
  const menuName = (id: string) => catalog.menus.find((m) => m.id === id);
  const voiceAllowed = voiceCounter(deps.voiceLimit ?? { perMinute: 20, perDay: 300 }, clock);
  const voiceLiveAllowed = voiceCounter(deps.voiceLiveLimit ?? { perMinute: 120, perDay: 3000 }, clock);
  // 메뉴 사진 (10/17): 화면 폴더의 menu-img/<공식 번호>.webp 가 있는 메뉴만. 없으면 null (화면은 이름만)
  const imageFiles = new Set<string>();
  try {
    if (deps.webDir) for (const n of readdirSync(resolve(deps.webDir, 'menu-img'))) imageFiles.add(n);
  } catch {
    /* 사진 폴더 없음 */
  }
  // 오류 기록 (10/19, 로드맵 49번): 서버를 띄운 뒤 몇 번 났는지만 센다 (위치·문장·알레르기는 안 남김). /health 에서 봄
  const counts = { since: clock().toISOString(), requests: 0, serverErrors: 0, badRequests: 0, storeLookupFailures: 0, aiFailures: 0, voiceFailures: 0 };
  const imageOf = (m: { officialIdx: string | null }) => (m.officialIdx && imageFiles.has(`${m.officialIdx}.webp`) ? `/menu-img/${m.officialIdx}.webp` : null);

  /** 추천 이유 + 알레르기로 자동으로 뺀 재료 (10/16: 메인 재료가 아니면 메뉴 대신 재료만 뺌) */
  const whyFor = (prefs: MenuPrefs) => (c: Parameters<typeof explainMenu>[0]) => {
    const av = avoidAllergens(c.menu, catalog, prefs.allergies, { removeVegetables: prefs.removeVegetables ?? [] });
    const after = composeAllergens(c.menu, catalog, { removeVegetables: [...(prefs.removeVegetables ?? []), ...av.removeVegetables], ...(av.bread ? { bread: av.bread } : {}) });
    return [...av.notes, ...explainMenu(c, prefs.allergies, after.mayContain)];
  };

  const flow = async (location: LocationInput, prefs: MenuPrefs, at: string) => {
    const whyOf = whyFor(prefs);
    const r = await recommendFlow({ location, places: providers.places, sources: providers.sources, referenceAt: at, prefs, catalog });
    if (r.step === 'LOCATION') {
      const l = r.location;
      return { step: 'LOCATION', status: l.status, options: l.status === 'CHOOSE' ? l.options.map((o) => ({ name: o.name, address: o.address, lat: o.point.lat, lng: o.point.lng })) : [] };
    }
    if (r.step === 'STORES') {
      if (r.status !== 'NONE') counts.storeLookupFailures++; // NONE(3km 안에 없음)은 실패가 아님
      return { step: 'STORES', status: r.status };
    }
    const state = { ...prefs, menus: catalog.menus, moment: null };
    const menus = r.menu.candidates;
    return {
      step: 'DONE',
      label: r.label,
      point: r.point,
      referenceAt: at,
      stores: {
        status: r.store.status,
        top: r.store.candidates.map((c) => ({
          rank: c.rank, id: c.store.id, name: c.store.name, address: c.store.address, phone: c.store.phone, url: c.store.url,
          lat: c.store.point.lat, lng: c.store.point.lng, distanceM: c.store.distanceM, open: c.store.open, travel: c.store.travel,
          reasons: c.reason_codes, why: explainStore(c.store, c.reason_codes, mealTimeOf(at).holidayName),
        })),
        rejected: r.store.rejected.map((x) => ({ id: x.candidate_id, reasons: x.reason_codes, why: explainStoreRejection(x.reason_codes) })),
        decisionId: r.store.trace.decision_id,
        transitLeft: r.transitLeft,
      },
      menus: {
        status: r.menu.status,
        top: menus.map((c) => ({
          rank: c.rank, id: c.menu.id, name: c.menu.name, kind: c.menu.kind, image: imageOf(c.menu), defaultVegetables: c.menu.defaultVegetables ?? null, price15cm: c.menu.price.price15cm, price30cm: c.menu.price.price30cm, priceStatus: c.menu.price.status,
          nutrition15cm: c.menu.nutrition15cm, score: c.score, parts: c.score_components, reasons: c.reason_codes, why: whyOf(c),
        })),
        compare12: menus.length >= 2 ? compareMenus(menus[0]!, menus[1]!) : [],
        rejected: r.menu.rejected.slice(0, 20).map((x) => {
          const m = menuName(x.candidate_id)!;
          return { id: x.candidate_id, name: m.name, reasons: x.reason_codes, why: explainRejection(x.reason_codes, m, state) };
        }),
        rejectedCount: r.menu.rejected.length,
        // 뺀 이유별 개수 (전부 기준, 위 목록은 20개까지) — 화면이 추천 위에 "매운 것 빼기로 4개 뺐어요" (10/16)
        rejectedByReason: r.menu.rejected.reduce<Record<string, number>>((acc, x) => {
          for (const code of new Set(x.reason_codes)) acc[code] = (acc[code] ?? 0) + 1;
          return acc;
        }, {}),
        decisionId: r.menu.trace.decision_id,
        versions: r.menu.trace.versions,
      },
    };
  };

  return createServer(async (req, res) => {
    try {
      counts.requests++;
      const url = new URL(req.url ?? '/', 'http://local');
      const path = url.pathname;
      // HEAD는 GET과 같게 (몸통은 Node가 안 보냄) — 접속 확인 도구·링크 미리보기가 HEAD로 물으면 404가 나던 것 (10/15 점검)
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      if (method === 'GET' && path === '/health') return send(res, 200, { status: 'ok', service: 'subway', commit: deps.version.commit, counts });
      if (method === 'GET' && path === '/ready') {
        const checks = { catalog: catalog.menus.length > 0, places: providers.ready.places, hours: providers.ready.hours, transit: providers.ready.transit, ai: !!deps.ai };
        const ready = checks.catalog && checks.places;
        return send(res, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', checks });
      }
      if (method === 'GET' && path === '/version.json')
        return send(res, 200, {
          commit: deps.version.commit, build_version: deps.version.builtAt, engine_source: deps.version.engineSource,
          domain_functions: { subway_menu: SUBWAY_MENU_FUNCTION_VERSION, subway_store: SUBWAY_STORE_FUNCTION_VERSION },
        });
      if (method === 'GET' && path === '/api/stores') {
        const q = url.searchParams.get('q');
        const location = parseLocation(q !== null ? { q } : { lat: Number(url.searchParams.get('lat')), lng: Number(url.searchParams.get('lng')) });
        const out = await flow(location, parsePrefs({}, catalog), parseAt(url.searchParams.get('at') ?? undefined, clock()));
        return send(res, 200, 'stores' in out ? { step: out.step, label: out.label, point: out.point, referenceAt: out.referenceAt, stores: out.stores } : out);
      }
      // 여러 개 주문 나누기 (10/26): { text } → { items: [{text, qty}] | null } — 규칙이 못 나눈 말만 화면이 부름, AI 없으면 null
      if (method === 'POST' && path === '/api/split') {
        const body = await readJson(req);
        if (!isObj(body) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 300) throw new BadRequest('INVALID_TEXT');
        if (!deps.ai) return send(res, 200, { items: null });
        const items = await aiSplit(deps.ai, body.text);
        return send(res, 200, { items });
      }
      // 장바구니 말 (10/27): { text, cart: [{menuId|null, choices, qty, owner, name?}] (5줄까지), recs: [메뉴 id] } → { ops: [...] | null, by }
      // AI가 명령을 내고 검사한 것만 (cart-ai.ts). AI가 없거나 늦으면 ops null → 화면은 규칙으로
      if (method === 'POST' && path === '/api/cart-command') {
        const body = await readJson(req);
        if (!isObj(body) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 300) throw new BadRequest('INVALID_TEXT');
        const cartIn = Array.isArray(body.cart) ? body.cart.slice(0, 10) : [];
        const cart: CartLineIn[] = cartIn.map((l: unknown) => {
          const o = isObj(l) ? l : {};
          const menuId = typeof o.menuId === 'string' && menuName(o.menuId) ? o.menuId : null;
          return { menuId, choices: o.choices !== undefined ? parseChoices(o.choices, catalog) : {}, qty: Math.min(10, Math.max(1, Number(o.qty) || 1)), owner: o.owner === 'guest' ? 'guest' : 'me', ...(typeof o.name === 'string' && o.name.trim() ? { name: o.name.trim().slice(0, 6) } : {}) };
        });
        const recs = (Array.isArray(body.recs) ? body.recs : []).filter((x: unknown): x is string => typeof x === 'string' && !!menuName(x)).slice(0, 3);
        if (!deps.ai) return send(res, 200, { ops: null, by: null });
        const active = Number.isInteger(body.active) && (body.active as number) >= 0 && (body.active as number) < cart.length ? (body.active as number) : null;
        const out = await aiCartCommands(deps.ai, catalog, body.text, cart, recs, undefined, active);
        return send(res, 200, out ?? { ops: null, recommend: null, reason: null, by: null });
      }
      // Top3 AI 한마디 (10/21): { menuIds(1~3), prefs } → { lines: {id: 한 줄} } — A100만, 4초 넘으면 빈 값
      if (method === 'POST' && path === '/api/menus/explain') {
        const body = await readJson(req);
        if (!isObj(body) || !Array.isArray(body.menuIds) || body.menuIds.length < 1 || body.menuIds.length > 3 || !body.menuIds.every((x) => typeof x === 'string' && !!menuName(x))) throw new BadRequest('INVALID_MENUS');
        const prefs = parsePrefs(body.prefs, catalog);
        if (!deps.aiExplain) return send(res, 200, { lines: {} });
        // 10/27: 젬마가 읽은 손님 상황 한 줄 ("감기라서 따뜻하고 자극 적은 것") — 그 상황에 왜 맞는지 쓰게
        const situation = typeof body.situation === 'string' && body.situation.trim() ? body.situation.trim().slice(0, 60) : null;
        return send(res, 200, { lines: await aiExplain(deps.aiExplain, catalog, body.menuIds as string[], prefs, undefined, situation) });
      }
      if (method === 'POST' && path === '/api/menus/recommend') {
        const body = await readJson(req);
        if (!isObj(body)) throw new BadRequest('INVALID_BODY');
        return send(res, 200, await flow(parseLocation(body.location), parsePrefs(body.prefs, catalog), parseAt(body.at, clock())));
      }
      if (method === 'POST' && path === '/api/order-sheet') {
        const body = await readJson(req);
        if (!isObj(body) || typeof body.menuId !== 'string') throw new BadRequest('INVALID_BODY');
        // 샌드위치 없이 단품만 (10/19: "콜라만 줘")
        if (body.menuId === SINGLES_ID) {
          if (body.choices !== undefined && !isObj(body.choices)) throw new BadRequest('INVALID_CHOICES');
          const raw = (body.choices ?? {}) as Record<string, unknown>;
          if (raw.extras !== undefined && !Array.isArray(raw.extras)) throw new BadRequest('INVALID_CHOICES');
          const r = buildSinglesSheet({ extras: (raw.extras ?? []) as Array<{ id: string; qty: number }> }, catalog);
          if (!r.ok) return send(res, 400, { error: 'ORDER_RULES', reasons: r.errors, messages: r.errors.map(orderErrorText) });
          return send(res, 200, { ...r.sheet, allergyAvoid: null });
        }
        const menu = menuName(body.menuId);
        if (!menu) return send(res, 404, { error: 'MENU_NOT_FOUND' });
        if (body.choices !== undefined && !isObj(body.choices)) throw new BadRequest('INVALID_CHOICES');
        // 모양이 틀린 값은 규칙 오류로 알려 준다 (조용히 버리지 않음)
        const raw = (body.choices ?? {}) as Record<string, unknown>;
        for (const k of ['removeVegetables', 'addVegetables', 'sauces', 'toppings']) if (raw[k] !== undefined && !(Array.isArray(raw[k]) && (raw[k] as unknown[]).every((x) => typeof x === 'string'))) throw new BadRequest('INVALID_CHOICES');
        if (raw.extras !== undefined && !(Array.isArray(raw.extras) && (raw.extras as unknown[]).every((x) => isObj(x) && typeof x.id === 'string' && typeof x.qty === 'number'))) throw new BadRequest('INVALID_CHOICES');
        const r = buildOrderSheet(menu, raw as OrderChoices, catalog);
        if (!r.ok) return send(res, 400, { error: 'ORDER_RULES', reasons: r.errors, messages: r.errors.map(orderErrorText) });
        const allergies = body.allergies === undefined ? [] : parsePrefs({ allergies: body.allergies }, catalog).allergies;
        const allergyAvoid = allergies.length ? avoidAllergens(menu, catalog, allergies, raw as Changes) : null;
        return send(res, 200, { ...r.sheet, allergyAvoid });
      }
      if (method === 'POST' && path === '/api/interpret') {
        const body = await readJson(req);
        if (!isObj(body) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 300) throw new BadRequest('INVALID_TEXT');
        const ctx = isObj(body.context) ? body.context : {};
        const context: TalkContext = {};
        if (typeof ctx.menuId === 'string' && menuName(ctx.menuId)) context.menuId = ctx.menuId;
        if (ctx.choices !== undefined) context.choices = parseChoices(ctx.choices, catalog);
        if (ctx.prefs !== undefined) context.prefs = parsePrefs(ctx.prefs, catalog);
        // skipAi: 화면이 AI가 고른 메뉴에 같은 말을 다시 적용할 때 (AI를 또 부르지 않음)
        const r = await interpret(body.text, catalog, context, ctx.skipAi === true ? null : (deps.ai ?? null));
        if (r.aiStatus === 'FAILED') counts.aiFailures++;
        return send(res, 200, { ...r, intent: undefined, ask: r.intent.ask ?? null, compare: r.intent.compare ?? null });
      }
      if (method === 'POST' && path === '/api/transcribe') {
        const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
        if (!(AUDIO_TYPES as readonly string[]).includes(type)) throw new BadRequest('INVALID_AUDIO_TYPE');
        const audio = await readRaw(req, MAX_AUDIO);
        if (audio.length < 200) throw new BadRequest('AUDIO_TOO_SHORT');
        const speech = deps.speech ?? [];
        if (!speech.length) return send(res, 503, { error: 'VOICE_UNAVAILABLE' });
        // 말하는 동안 글자 (10/22): 못 하면 화면은 글자 없이 녹음만 계속 → 끝난 뒤 받아쓰기는 그대로
        if (req.headers['x-subway-live'] === '1') {
          if (!voiceLiveAllowed()) return send(res, 200, { text: null, live: 'OFF' });
          const r = await speech[0]!.transcribe(new Uint8Array(audio), type as AudioType, 'ko', AbortSignal.timeout(8000)).catch(() => null);
          const text = r && (r.code === 'SUCCESS' || r.code === 'PARTIAL') ? r.text?.trim() || null : null;
          return send(res, 200, { text: text ? text.slice(0, 300) : null });
        }
        if (!voiceAllowed()) return send(res, 429, { error: 'VOICE_BUSY' });
        for (const s of speech) {
          const r = await s.transcribe(new Uint8Array(audio), type as AudioType, 'ko', AbortSignal.timeout(20000)).catch(() => null);
          const text = r?.text?.trim();
          if (r && (r.code === 'SUCCESS' || r.code === 'PARTIAL') && text) return send(res, 200, { text: text.slice(0, 300), provider: s.execution_location });
        }
        counts.voiceFailures++;
        return send(res, 502, { error: 'TRANSCRIBE_FAILED' });
      }
      if (method === 'GET' && path === '/api/options') {
        // 알레르기: contains(들어 있음)·mayContain(★ 들어 있을 수 있음)·allergenStatus(KNOWN 아니면 확인 필요) — 화면이 고른 알레르기를 표시 (10/15)
        const ing = (cat: string) => catalog.ingredients.filter((i) => i.category === cat).map((i) => ({ id: i.id, name: i.name, kcal: i.energyKcal, allergens: i.allergens.contains, mayContain: i.allergens.mayContain, allergenStatus: i.allergens.status }));
        return send(res, 200, {
          breads: ing('BREAD'), cheeses: ing('CHEESE'), vegetables: ing('VEGETABLE'), defaultVegetables: DEFAULT_VEGETABLES, sauces: ing('SAUCE'),
          toppings: catalog.toppings.map((x) => ({ id: x.id, name: x.name, appliesTo: x.appliesTo, price15cm: x.price.price15cm, price30cm: x.price.price30cm, priceStatus: x.price.status, allergens: x.allergens.contains, mayContain: x.allergens.mayContain, allergenStatus: x.allergens.status })),
          sets: catalog.sets.map((x) => ({ name: x.name, item: x.item, addPrice: x.addPrice })),
          // 단품 (10/19): 음료·쿠키·칩·웨지·수프 — 샌드위치에 더하거나 단품만 주문
          singles: (catalog.singles ?? []).map((x) => ({ id: x.id, name: x.name, group: x.group, price: x.price, fromMinute: x.fromMinute ?? null, allergens: x.allergens.contains, mayContain: x.allergens.mayContain, allergenStatus: x.allergens.status })),
          menus: catalog.menus.map((m) => ({ id: m.id, name: m.name, kind: m.kind, image: imageOf(m), defaultVegetables: m.defaultVegetables ?? null, price15cm: m.price.price15cm, price30cm: m.price.price30cm, priceStatus: m.price.status, nutrition15cm: m.nutrition15cm })),
          // AI는 켜짐/꺼짐만 (설정 오류 문장은 내보내지 않음 — 10/14 보안 검토)
          allergens: catalog.allergenList,
          // 세트 음료 (공식 자료에 세트 음료 종류가 없어 화면·주문서에 "매장에서 확인")
          drinks: DRINKS,
          // 세트마다 고를 수 있는 것 (쿠키 5·웨지 3·칩·수프 3)
          setItems: Object.fromEntries(Object.entries(SET_ITEMS).map(([k, x]) => [k, x.names])),
          allergenGroups: { main: catalog.allergenList.filter((a) => MAIN_ALLERGENS.includes(a)), other: catalog.allergenList.filter((a) => !MAIN_ALLERGENS.includes(a)) },
          ai: deps.ai ? 'ready' : 'off', voice: (deps.speech ?? []).length ? 'ready' : 'off',
        });
      }
      if (method === 'GET' && deps.webDir && !path.startsWith('/api/') && serveStatic(res, deps.webDir, path)) return;
      return send(res, 404, { error: 'NOT_FOUND' });
    } catch (e) {
      if (e instanceof BadRequest) {
        counts.badRequests++;
        return send(res, 400, { error: e.message });
      }
      counts.serverErrors++;
      // 내부 오류는 자세히 내보내지 않는다 (키·경로가 섞일 수 있음)
      console.error('SUBWAY_SERVER_ERROR', e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : 'unknown');
      return send(res, 500, { error: 'INTERNAL' });
    }
  });
}

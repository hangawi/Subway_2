// 휴대폰 안 저장소 (로그인 없음, 10/19 판). 서버로 보내지 않는다.
// SOPHIA local-edge-vault.ts 원칙(계정마다 분리·형식 버전)만 따르고 써브웨이용으로 작게 새로 씀 — 그 파일은 달력 중심(1016줄)이라 그대로 못 씀.
// 동의 기록은 SOPHIA 허용 기록(state/emotion/authorize-processing.ts)과 같은 모양: 목적·받는 쪽·맥락·유효기간.
// 기록마다 account_id: null — 8단계에서 SOPHIA 공통 계정에 붙일 칸.
// 저장이 막힌 브라우저(사생활 보호 모드 등)에서도 화면은 그대로 돈다 (저장만 안 됨).

export type ConsentKind = 'orders' | 'allergy' | 'voice' | 'taste';
import type { TasteRecord } from './taste.ts';
export interface ConsentRecord {
  kind: ConsentKind;
  purpose: 'subway_food_recommendation';
  /** 받는 쪽: 이 휴대폰 / 외부 AI */
  recipient: 'this_device' | 'openai';
  context: { app: 'subway' };
  granted: boolean;
  at: string;
  /** 유효기간 (없으면 끌 때까지) */
  valid_until: string | null;
  account_id: null;
}
export interface OrderRecord {
  id: string;
  at: string;
  menuId: string;
  menuName: string;
  choices: Record<string, unknown>;
  text: string;
  store: { id: string; name: string; phone: string | null } | null;
  totalWon: number;
  account_id: null;
}
interface Saved {
  version: 1;
  deviceId: string;
  consents: Partial<Record<ConsentKind, ConsentRecord>>;
  orders: OrderRecord[];
  allergies: string[];
  /** 처음 안내(동의 고르기)를 봤는지 */
  onboarded: boolean;
  /** 취향·오늘 상태 (10/16, '취향 기억하기' 동의) */
  tastes?: TasteRecord[];
  /** 사용자가 지운 "주문 기록에서 배운 것" (다시 배우지 않음) */
  suppressed?: string[];
  /** 즐겨찾기 ★ (최대 10) */
  favorites?: Favorite[];
  /** 말 기록 (10/22, '취향 기억하기' 동의, 최근 30개) */
  talkLog?: TalkLogEntry[];
}
/** 말 기록 한 줄: 언제·무엇을·어떻게(말/글)·알아들은 것·처리한 곳 */
export interface TalkLogEntry {
  at: string;
  text: string;
  via: 'voice' | 'text';
  /** 🎤면 어디서 받아썼는지 (10/26: 휴대폰 / OpenAI) */
  stt?: 'phone' | 'openai';
  understood: string[];
  by: 'RULES' | 'GPU' | 'OpenAI';
}
export const MAX_TALK_LOG = 30;
export interface Favorite {
  id: string;
  menuId: string;
  menuName: string;
  choices: Record<string, unknown>;
  at: string;
  account_id: null;
}

const KEY = 'subway.v1';
export const MAX_ORDERS = 10;
const RECIPIENT: Record<ConsentKind, ConsentRecord['recipient']> = { orders: 'this_device', allergy: 'this_device', voice: 'openai', taste: 'this_device' };
const rid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function empty(): Saved {
  return { version: 1, deviceId: rid(), consents: {}, orders: [], allergies: [], onboarded: false };
}

let memory: Saved | null = null; // 저장이 막혔을 때 이 화면 동안만

export function load(): Saved {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Saved) : null;
    memory = v && v.version === 1 && Array.isArray(v.orders) ? v : empty();
  } catch {
    memory = empty();
  }
  return memory;
}
function save(s: Saved) {
  memory = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 막힘: 이 화면 동안만 기억 */
  }
}

export function consented(kind: ConsentKind, now = new Date()): boolean {
  const c = load().consents[kind];
  return !!c && c.granted && (c.valid_until === null || Date.parse(c.valid_until) > now.getTime());
}

export function setConsent(kind: ConsentKind, granted: boolean, now = new Date()) {
  const s = load();
  s.consents[kind] = { kind, purpose: 'subway_food_recommendation', recipient: RECIPIENT[kind], context: { app: 'subway' }, granted, at: now.toISOString(), valid_until: null, account_id: null };
  // 동의를 끄면 그 기록도 지운다
  if (!granted && kind === 'orders') s.orders = [];
  if (!granted && kind === 'allergy') s.allergies = [];
  if (!granted && kind === 'taste') (s.tastes = []), (s.suppressed = []), (s.talkLog = []);
  if (!granted && kind === 'orders') s.favorites = [];
  save(s);
}

export function markOnboarded() {
  const s = load();
  s.onboarded = true;
  save(s);
}

export function savedAllergies(): string[] {
  return consented('allergy') ? [...load().allergies] : [];
}
export function rememberAllergies(list: string[]) {
  if (!consented('allergy')) return;
  const s = load();
  s.allergies = [...new Set(list)];
  save(s);
}

/** 주문 기록 저장 (동의했을 때만). 최근 10개만 둔다 */
export function addOrder(o: Omit<OrderRecord, 'id' | 'at' | 'account_id'>, now = new Date()): OrderRecord | null {
  if (!consented('orders')) return null;
  const s = load();
  const rec: OrderRecord = { ...o, id: rid(), at: now.toISOString(), account_id: null };
  s.orders = [rec, ...s.orders].slice(0, MAX_ORDERS);
  save(s);
  return rec;
}
export function orders(): OrderRecord[] {
  return consented('orders') ? [...load().orders] : [];
}
export function removeOrder(id: string) {
  const s = load();
  s.orders = s.orders.filter((o) => o.id !== id);
  save(s);
}
export function clearOrders() {
  const s = load();
  s.orders = [];
  save(s);
}
/** 지울 기록이 있는지 (켜 둔 동의·주문 기록·알레르기 중 하나라도) */
export function hasRecords(): boolean {
  const s = load();
  return Object.values(s.consents).some((c) => c?.granted) || s.orders.length > 0 || s.allergies.length > 0 || (s.tastes?.length ?? 0) > 0 || (s.favorites?.length ?? 0) > 0 || (s.talkLog?.length ?? 0) > 0;
}

/** 내 기록 전부 지우기 (동의·주문·알레르기) */
export function clearAll() {
  memory = empty();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 막힘 */
  }
}

// ── 말 기록 (10/22) ── 저장은 '취향 기억하기' 동의한 사람만 (안 했으면 화면이 이번에만 보여 줌)
export function talkLog(): TalkLogEntry[] {
  return consented('taste') ? [...(load().talkLog ?? [])] : [];
}
export function addTalkLog(e: TalkLogEntry): boolean {
  if (!consented('taste')) return false;
  const s = load();
  s.talkLog = [e, ...(s.talkLog ?? [])].slice(0, MAX_TALK_LOG);
  save(s);
  return true;
}
export function clearTalkLog() {
  const s = load();
  s.talkLog = [];
  save(s);
}

// ── 취향 (10/16) ── 저장은 '취향 기억하기' 동의한 사람만. 동의 안 했으면 화면이 이번에만 쓰고 저장하지 않는다
export function tasteRecords(): TasteRecord[] {
  return consented('taste') ? [...(load().tastes ?? [])] : [];
}
export function addTaste(r: TasteRecord): boolean {
  if (!consented('taste')) return false;
  const s = load();
  // 같은 대상·같은 범위는 새 것으로 바꿈
  const same = (x: TasteRecord) => x.scope === r.scope && x.target.type === r.target.type && x.target.id === r.target.id;
  s.tastes = [r, ...(s.tastes ?? []).filter((x) => !same(x))].slice(0, 50);
  save(s);
  return true;
}
export function removeTaste(id: string) {
  const s = load();
  s.tastes = (s.tastes ?? []).filter((x) => x.id !== id);
  save(s);
}
/** 주문 기록에서 배운 것을 지움 (그 뒤로 다시 배우지 않음) */
export function suppress(key: string) {
  const s = load();
  s.suppressed = [...new Set([...(s.suppressed ?? []), key])];
  save(s);
}
export function suppressedKeys(): string[] {
  return [...(load().suppressed ?? [])];
}
export function clearTastes() {
  const s = load();
  s.tastes = [];
  s.suppressed = [];
  save(s);
}

// ── 즐겨찾기 ★ (주문 기록 동의한 사람만) ──
export function favorites(): Favorite[] {
  return consented('orders') ? [...(load().favorites ?? [])] : [];
}
export function isFavorite(menuId: string, choices: Record<string, unknown>): string | null {
  const key = JSON.stringify(choices);
  return favorites().find((f) => f.menuId === menuId && JSON.stringify(f.choices) === key)?.id ?? null;
}
export function toggleFavorite(o: { menuId: string; menuName: string; choices: Record<string, unknown> }): boolean {
  if (!consented('orders')) return false;
  const s = load();
  const id = isFavorite(o.menuId, o.choices);
  if (id) s.favorites = (s.favorites ?? []).filter((f) => f.id !== id);
  else s.favorites = [{ id: rid(), ...o, at: new Date().toISOString(), account_id: null }, ...(s.favorites ?? [])].slice(0, 10);
  save(s);
  return !id;
}


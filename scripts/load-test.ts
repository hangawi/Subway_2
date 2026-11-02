// 부하 시험 (10/19, 로드맵 48번): 점심시간에 여러 명이 동시에 쓰는 상황. **운영 서버에서 돌리지 않는다** (SOPHIA와 같은 서버).
// 이 컴퓨터에서 써브웨이 서버를 따로 띄우고, 외부 연결(카카오·Google·TMAP·ODsay·AI)은 가짜 — 하루 한도를 쓰지 않는다.
// 가짜 연결은 실제처럼 기다린다 (매장 찾기 120ms, 영업시간 80ms). 운영 컨테이너는 CPU 1개라 Node 한 프로세스로 같은 조건.
// 한 사람 = 메뉴판 받기 → 추천 → 말로 조건(규칙) → 주문서 2번. 기준: 100명 동시에 추천 p95 2초, 주문서 p95 0.5초, 실패 0.
// 실행: npx tsx scripts/load-test.ts [동시 사용자 수들, 기본 20,50,100,200]
import type { AddressInfo } from 'node:net';
import { loadSubwayCatalog } from '../src/catalog/subway-catalog.ts';
import { createSubwayServer } from '../src/server/server.ts';
import type { Providers } from '../src/server/providers.ts';
import type { VenueHours } from '../vendor/sophia/packages/contracts/src/place-contract.ts';
import { stamp, type PlaceDataProvider } from '../vendor/sophia/services/providers/place-data-provider.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const catalog = loadSubwayCatalog();
const center = { lat: 37.4979, lng: 127.0276 };
const stores = Array.from({ length: 6 }, (_, i) => ({
  place_id: `kakao:${i}`, name: `써브웨이 시험${i + 1}점`, category: null, address: '서울', point: { lat: center.lat + i * 0.001, lng: center.lng + i * 0.001 }, phone: `02-000-000${i}`, url: null, distance_m: 120 + i * 110,
}));
const places: PlaceDataProvider = {
  name: 'fake',
  search: async () => (await sleep(120), { ok: true, data: [{ place_id: 'kakao:st', name: '강남역', category: null, address: null, point: center, phone: null, url: null }], stamp: stamp('fake', false, 0, 1) }),
  nearby: async () => (await sleep(120), { ok: true, data: stores, stamp: stamp('fake', true, 0, 1) }),
};
const daily: VenueHours = { status: 'OPERATIONAL', periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, minute: 420 }, close: { day, minute: 1320 } })) };
const providers: Providers = {
  places,
  sources: { hours: { name: 'h', hours: async () => (await sleep(80), { ok: true, data: daily, stamp: stamp('h', false, 0, 1) }) } },
  ready: { places: true, hours: true, walk: false, transit: false, car: false },
};
const server = createSubwayServer({ catalog, providers, version: { commit: 'load', engineSource: 'x', builtAt: 't' }, clock: () => new Date('2026-10-19T12:10:00+09:00') });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const times: Record<string, number[]> = {};
let failures = 0;
async function call(name: string, path: string, body?: unknown) {
  const t = performance.now();
  const r = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  const ms = performance.now() - t;
  (times[name] ??= []).push(ms);
  if (!r || r.status !== 200) failures++;
  return r ? r.json().catch(() => null) : null;
}
const sandwiches = catalog.menus.filter((m) => m.kind === 'SANDWICH');
const talks = ['만 원 이하 단백질 많이', '매운 거 빼고 가볍게', '든든하게 쇠고기 종류로', '샐러드로 우유 알레르기', '양파 빼고 피클 추가'];
async function user(i: number) {
  // 사람마다 조금씩 다른 때에 시작 (0~1초)
  await sleep(Math.random() * 1000);
  const location = { lat: center.lat + (i % 7) * 0.0003, lng: center.lng + (i % 5) * 0.0003 };
  await call('메뉴판', '/api/options');
  await call('추천', '/api/menus/recommend', { location, prefs: { allergies: i % 4 === 0 ? ['우유'] : [], goal: i % 3 === 0 ? 'PROTEIN' : null } });
  await call('말로 조건', '/api/interpret', { text: talks[i % talks.length] });
  const menu = sandwiches[i % sandwiches.length]!;
  await call('주문서', '/api/order-sheet', { menuId: menu.id, choices: {} });
  await call('주문서', '/api/order-sheet', { menuId: menu.id, choices: { removeVegetables: ['vegetable:양파'], sauces: ['sauce:랜치'] } });
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))] ?? 0;
const levels = (process.argv[2] ?? '20,50,100,200').split(',').map(Number);
const rows: string[] = [];
let pass = true;
for (const n of levels) {
  for (const k of Object.keys(times)) delete times[k];
  failures = 0;
  const t = performance.now();
  await Promise.all(Array.from({ length: n }, (_, i) => user(i)));
  const total = (performance.now() - t) / 1000;
  const line = Object.entries(times).map(([k, xs]) => `${k} p50 ${Math.round(pct(xs, 50))}ms · p95 ${Math.round(pct(xs, 95))}ms · 최대 ${Math.round(Math.max(...xs))}ms`).join(' | ');
  const ok = failures === 0 && (n > 100 || (pct(times['추천']!, 95) <= 2000 && pct(times['주문서']!, 95) <= 500));
  if (n <= 100 && !ok) pass = false;
  rows.push(`${ok ? '✅' : n > 100 ? '⚠' : '❌'} 동시 ${n}명 (${total.toFixed(1)}초, 실패 ${failures}) — ${line}`);
}
for (const r of rows) console.log(r);
console.log(pass ? '기준 통과 (100명까지: 추천 p95 ≤ 2초, 주문서 p95 ≤ 0.5초, 실패 0)' : '기준 못 넘음');
server.close();
process.exit(pass ? 0 : 1);

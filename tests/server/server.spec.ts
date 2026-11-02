import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { createSubwayServer, voiceCounter } from '../../src/server/server.ts';
import { wholeOr, type Providers } from '../../src/server/providers.ts';
import type { VenueHours } from '../../vendor/sophia/packages/contracts/src/place-contract.ts';
import { stamp, type PlaceDataProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';

const catalog = loadSubwayCatalog();
const gangnam = { lat: 37.4979, lng: 127.0276 };
const places: PlaceDataProvider = {
  name: 'fake',
  search: async (q) => ({ ok: true, data: q === '강남역' ? [{ place_id: 'kakao:st', name: '강남역', category: null, address: null, point: gangnam, phone: null, url: null }] : [], stamp: stamp('fake', false, 0, 1) }),
  nearby: async (_k, _c, radius) => ({
    ok: true,
    data: radius === 1000 ? [{ place_id: 'kakao:1', name: '써브웨이 강남역점', category: null, address: '서울', point: { lat: 37.499, lng: 127.0276 }, phone: '02-1', url: null, distance_m: 150 }] : [],
    stamp: stamp('fake', true, 0, 1),
  }),
};
const daily: VenueHours = { status: 'OPERATIONAL', periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, minute: 420 }, close: { day, minute: 1320 } })) };
const providers: Providers = {
  places,
  sources: { hours: { name: 'h', hours: async () => ({ ok: true, data: daily, stamp: stamp('h', false, 0, 1) }) } },
  ready: { places: true, hours: true, walk: false, transit: false, car: false },
};
let base = '';
const speechCalls: string[] = [];
const speech = [{ provider_id: 'fake_stt', execution_location: 'external' as const, configReady: () => true, transcribe: async (_a: Uint8Array, type: string) => (speechCalls.push(type), { code: 'SUCCESS' as const, provider_id: 'fake_stt', execution_location: 'external' as const, model_version: null, text: '  만 원 이하 단백질 많이  ', message: '' }) }];
const server = createSubwayServer({ catalog, providers, speech, version: { commit: 'abc123', engineSource: '1e274c7', builtAt: 't' }, clock: () => new Date('2026-10-13T12:10:00+09:00') });
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
const get = (p: string) => fetch(base + p).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
const post = (p: string, body: unknown) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));

describe('써브웨이 서버', () => {
  it('/health · /ready · /version.json (키 값은 안 나감)', async () => {
    const h = (await get('/health')).body;
    expect(h).toMatchObject({ status: 'ok', service: 'subway', commit: 'abc123' });
    // 오류 기록 (10/19): 횟수만 — 위치·문장 같은 내용은 없음
    expect(Object.keys(h.counts).sort()).toEqual(['aiFailures', 'badRequests', 'requests', 'serverErrors', 'since', 'storeLookupFailures', 'voiceFailures']);
    const before = h.counts.badRequests;
    await post('/api/menus/recommend', { location: { lat: 'x' } });
    expect((await get('/health')).body.counts.badRequests).toBe(before + 1);
    const ready = await get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks).toEqual({ catalog: true, places: true, hours: true, transit: false, ai: false });
    const v = await get('/version.json');
    expect(v.body).toMatchObject({ commit: 'abc123', engine_source: '1e274c7', domain_functions: { subway_menu: 'subway.menu@0.13', subway_store: 'subway.store@0.2' } });
  });

  it('/api/stores: 직접 입력 → 매장 Top + "걸어서 3분, 지금 영업 중"', async () => {
    const r = await get('/api/stores?q=' + encodeURIComponent('강남역'));
    expect(r.status).toBe(200);
    expect(r.body.stores.top[0]).toMatchObject({ name: '써브웨이 강남역점', open: 'OPEN' });
    expect(r.body.stores.top[0].why).toEqual(['걸어서 3분 (거리로 추정)', '지금 영업 중']);
  });

  it('/api/menus/recommend: 매장 → 메뉴 Top3 + 설명 + 1번 vs 2번, 알레르기는 뺀 이유와 함께', async () => {
    const r = await post('/api/menus/recommend', { location: gangnam, prefs: { allergies: ['새우'], goal: 'PROTEIN' } });
    expect(r.status).toBe(200);
    expect(r.body.step).toBe('DONE');
    expect(r.body.menus.top).toHaveLength(3);
    expect(r.body.menus.top[0].why.length).toBeGreaterThan(0);
    expect(r.body.menus.compare12.length).toBeGreaterThan(0);
    expect(r.body.menus.rejected.some((x: any) => x.why.includes('새우 알레르기라서 뺐어요'))).toBe(true);
  });

  it('(10/15) 매운 것 빼기: 버튼 값이 서버에서 버려지지 않고 스파이시 메뉴가 빠진다, 이상한 값은 400', async () => {
    const r = await post('/api/menus/recommend', { location: gangnam, prefs: { avoidSpicy: true, kinds: ['SANDWICH'] } });
    expect(r.body.menus.rejected.some((x: any) => x.reasons.includes('TOO_SPICY'))).toBe(true);
    const plain = await post('/api/menus/recommend', { location: gangnam, prefs: { kinds: ['SANDWICH'] } });
    expect(plain.body.menus.rejected.some((x: any) => x.reasons.includes('TOO_SPICY'))).toBe(false);
    expect((await post('/api/menus/recommend', { location: gangnam, prefs: { avoidSpicy: 'yes' } })).body.error).toBe('INVALID_AVOID_SPICY');
    // 앞 대화의 "매운 것 빼기"가 다음 말에도 이어짐
    const talk = await post('/api/interpret', { text: '단백질 많이', context: { prefs: { avoidSpicy: true } } });
    expect(talk.body.prefs.avoidSpicy).toBe(true);
  });

  it('(10/15) HEAD 요청도 GET처럼 200 (몸통 없음)', async () => {
    const r = await fetch(base + '/health', { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('');
    expect((await fetch(base + '/nope', { method: 'HEAD' })).status).toBe(404);
  });

  it('(10/15) 한도 숫자 설정: 글자·음수·빈 값이면 기본값 (NaN이면 한도가 사라지던 것)', () => {
    expect([wholeOr('abc', 20), wholeOr('-1', 20), wholeOr('', 20), wholeOr(' ', 20), wholeOr(undefined, 20), wholeOr('1.5', 20)]).toEqual([20, 20, 20, 20, 20, 20]);
    expect([wholeOr('0', 20), wholeOr('5', 20)]).toEqual([0, 5]);
  });

  it('(10/15) 받아쓰기 한도: 분당·하루 (서울 날짜가 바뀌면 다시)', () => {
    let now = new Date('2026-10-15T23:59:00+09:00');
    const allow = voiceCounter({ perMinute: 2, perDay: 3 }, () => now);
    expect([allow(), allow(), allow()]).toEqual([true, true, false]); // 분당 2
    now = new Date('2026-10-15T23:59:50+09:00');
    expect(allow()).toBe(false);
    now = new Date('2026-10-16T00:00:30+09:00'); // 1분 지남 + 다음 날
    expect([allow(), allow(), allow()]).toEqual([true, true, false]);
  });

  it('(10/16) 알레르기: 주문서가 자동으로 뺄 재료를 알려 줌, 알레르기 두 묶음, 추천 카드 맨 앞에 "토마토를 뺐어요"', async () => {
    const menu = catalog.menus.find((m) => m.name === '로스트 치킨')!;
    const r = await post('/api/order-sheet', { menuId: menu.id, choices: {}, allergies: ['토마토'] });
    expect(r.body.allergyAvoid).toEqual({ removeVegetables: ['vegetable:토마토'], bread: null, notes: ['토마토 알레르기라서 토마토를 뺐어요'], blocked: [] });
    expect((await post('/api/order-sheet', { menuId: menu.id, choices: {} })).body.allergyAvoid).toBeNull();
    expect((await post('/api/order-sheet', { menuId: menu.id, allergies: ['외계인'] })).body.error).toBe('INVALID_ALLERGIES');
    const o = (await get('/api/options')).body;
    expect(o.allergenGroups.main).toEqual(expect.arrayContaining(['쇠고기', '닭고기', '새우']));
    expect(o.allergenGroups.other).toEqual(expect.arrayContaining(['토마토', '우유']));
    const rec = await post('/api/menus/recommend', { location: gangnam, prefs: { allergies: ['토마토'], kinds: ['SANDWICH'] } });
    expect(rec.body.menus.top.length).toBeGreaterThan(0);
    expect(rec.body.menus.top[0].why[0]).toBe('토마토 알레르기라서 토마토를 뺐어요');
  });

  it('(10/17) 취향 점수: 받으면 순위에 쓰고, 이상한 값은 거절·모르는 메뉴는 버림', async () => {
    const steak = catalog.menus.find((m) => m.name === '스테이크 & 치즈')!;
    const rec = await post('/api/menus/recommend', { location: gangnam, prefs: { kinds: ['SANDWICH'], taste: { menus: { [steak.id]: 1, 'menu:없는메뉴': 1 }, mains: { 쇠고기: 0.5, 외계인: 1 }, mainsFrom: { 쇠고기: 'LASTING' } } } });
    expect(rec.status).toBe(200);
    expect(rec.body.menus.top[0].name).toBe('스테이크 & 치즈');
    expect(rec.body.menus.top[0].why).toContain('자주 고른 메뉴예요');
    expect(rec.body.menus.top[0].parts.preference).toBeGreaterThan(0);
    for (const bad of [{ menus: { [steak.id]: 2 } }, { menus: { [steak.id]: 'x' } }, { mains: { 쇠고기: -1.5 } }, 'x', { menus: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`m${i}`, 0])) }])
      expect((await post('/api/menus/recommend', { location: gangnam, prefs: { taste: bad } })).body.error).toBe('INVALID_TASTE');
    // 메뉴 사진: 사진 폴더가 없으면 image: null (화면은 이름만)
    expect(rec.body.menus.top[0]).toHaveProperty('image', null);
  });

  it('(10/16) 든든하게·메인 재료 조건, 세트 음료가 주문서·주문서 글로, 말한 장소는 응답에', async () => {
    const rec = await post('/api/menus/recommend', { location: gangnam, prefs: { goal: 'FILLING', wantMains: ['쇠고기'], kinds: ['SANDWICH'] } });
    expect(rec.status).toBe(200);
    expect(rec.body.menus.top.every((m: any) => /스테이크|비프/.test(m.name))).toBe(true);
    expect(rec.body.menus.rejectedByReason.NOT_WANTED_MAIN).toBeGreaterThan(0);
    expect((await post('/api/menus/recommend', { location: gangnam, prefs: { wantMains: ['외계인'] } })).body.error).toBe('INVALID_WANT_MAINS');
    const menu = catalog.menus.find((m) => m.name === '로스트 치킨')!;
    const sheet = await post('/api/order-sheet', { menuId: menu.id, choices: { set: '쿠키 음료 세트', drink: '제로콜라' } });
    expect(sheet.body).toMatchObject({ set: '쿠키 음료 세트', drink: '제로콜라' });
    expect((await post('/api/order-sheet', { menuId: menu.id, choices: { drink: '제로콜라' } })).body.drink).toBeNull(); // 세트가 없으면 음료 없음
    const talk = await post('/api/interpret', { text: '판교역 근처에서 닭고기 들어간 거' });
    expect(talk.body).toMatchObject({ place: '판교역', prefs: { wantMains: ['닭고기'] } });
    expect((await get('/api/options')).body.drinks).toContain('제로콜라');
  });

  it('(10/15) 옵션 목록에 재료별 알레르기(들어 있음·★·정보 없음)', async () => {
    const o = (await get('/api/options')).body;
    expect(o.cheeses.find((c: any) => c.name === '아메리칸 치즈')).toMatchObject({ allergens: expect.arrayContaining(['우유']), allergenStatus: 'KNOWN' });
    expect(o.breads.find((b: any) => b.name === '위트').mayContain).toEqual(expect.arrayContaining(['우유']));
    expect(o.toppings.every((x: any) => Array.isArray(x.allergens) && Array.isArray(x.mayContain))).toBe(true);
  });

  it('/api/order-sheet: 옵션 수정 → 주문서, 규칙 위반은 400 + 이유', async () => {
    const menu = catalog.menus.find((m) => m.name === '로스트 치킨')!;
    const ok = await post('/api/order-sheet', { menuId: menu.id, choices: { cheese: 'cheese:아메리칸 치즈', removeVegetables: ['vegetable:양파'] } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ cheese: '아메리칸 치즈', nutrition: { status: 'ESTIMATE' } });
    const bad = await post('/api/order-sheet', { menuId: menu.id, choices: { sauces: ['sauce:랜치', 'sauce:마요네즈', 'sauce:핫 칠리', 'sauce:스위트 칠리'] } });
    expect(bad).toEqual({ status: 400, body: { error: 'ORDER_RULES', reasons: ['TOO_MANY_SAUCES'], messages: ['소스는 3개까지 고를 수 있어요'] } });
  });

  it('이상한 입력은 400으로 이유와 함께 (서버는 안 죽음)', async () => {
    expect((await post('/api/menus/recommend', '{not json')).body).toEqual({ error: 'INVALID_JSON' });
    expect((await post('/api/menus/recommend', { location: { lat: 'x' } })).body).toEqual({ error: 'INVALID_LOCATION' });
    expect((await post('/api/menus/recommend', { location: gangnam, prefs: { allergies: ['외계인'] } })).body).toEqual({ error: 'INVALID_ALLERGIES' });
    expect((await post('/api/menus/recommend', { location: gangnam, at: '어제' })).body).toEqual({ error: 'INVALID_AT' });
    expect((await post('/api/menus/recommend', { location: { q: 'x'.repeat(61) } })).body).toEqual({ error: 'INVALID_LOCATION' });
    expect((await post('/api/order-sheet', { menuId: 'nope' })).status).toBe(404);
    expect((await post('/api/menus/recommend', 'x'.repeat(17 * 1024))).body).toEqual({ error: 'BODY_TOO_LARGE' });
    expect((await get('/nope')).status).toBe(404);
    expect((await get('/%2e%2e/%2e%2e/package.json')).status).toBe(404); // 10/14 보안 검토: 폴더 밖 파일
    // 10/14 검증 ⑤: 앞 선택이 이상한 모양이면 버림, 주문서에 이상한 모양이면 400
    const menu = catalog.menus.find((m) => m.name === '로스트 치킨')!;
    const it = await post('/api/interpret', { text: '아까 거기서 랜치로', context: { menuId: menu.id, choices: { sauces: '랜치', toppings: [1, 2] } } });
    expect(it.body.choices).toEqual({ sauces: ['sauce:랜치'] });
    expect((await post('/api/order-sheet', { menuId: menu.id, choices: { sauces: '랜치' } })).body).toEqual({ error: 'INVALID_CHOICES' });
    expect((await get('/health')).status).toBe(200);
  });

  it('위치를 못 찾으면 그 단계에서 멈추고 알려 준다', async () => {
    const r = await get('/api/stores?q=' + encodeURIComponent('없는곳'));
    expect(r.body).toEqual({ step: 'LOCATION', status: 'NOT_FOUND', options: [] });
  });

  it('/api/transcribe: 녹음 → 글 (저장 안 함), 이상한 녹음은 400', async () => {
    const audio = new Uint8Array(4000);
    const ok = await fetch(base + '/api/transcribe', { method: 'POST', headers: { 'content-type': 'audio/webm;codecs=opus' }, body: audio }).then(async (r) => ({ s: r.status, j: await r.json() }));
    expect(ok).toEqual({ s: 200, j: { text: '만 원 이하 단백질 많이', provider: 'external' } });
    expect(speechCalls).toEqual(['audio/webm']);
    const bad = (type: string, body: Uint8Array<ArrayBuffer>) => fetch(base + '/api/transcribe', { method: 'POST', headers: { 'content-type': type }, body }).then(async (r) => (await r.json()).error);
    expect(await bad('video/mp4', audio)).toBe('INVALID_AUDIO_TYPE');
    expect(await bad('audio/mp4', new Uint8Array(10))).toBe('AUDIO_TOO_SHORT');
    expect(await bad('audio/mp4', new Uint8Array(1024 * 1024 + 10))).toBe('BODY_TOO_LARGE');
    expect((await get('/api/options')).body.voice).toBe('ready');
  });

  it('/api/transcribe 말하는 동안 (x-subway-live, 10/22): 지금까지 말한 글만, provider 없이', async () => {
    const live = await fetch(base + '/api/transcribe', { method: 'POST', headers: { 'content-type': 'audio/webm', 'x-subway-live': '1' }, body: new Uint8Array(4000) }).then(async (r) => ({ s: r.status, j: await r.json() }));
    expect(live).toEqual({ s: 200, j: { text: '만 원 이하 단백질 많이' } });
  });
});

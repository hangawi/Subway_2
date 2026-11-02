import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { aiCartCommands as aiCartCommandsRaw, type CartAiResult } from '../../src/conversation/cart-ai.ts';
const aiCartCommands = async (...a: Parameters<typeof aiCartCommandsRaw>) => (await aiCartCommandsRaw(...a)) as CartAiResult | null;

const c = loadSubwayCatalog();
const menuId = (n: string) => c.menus.find((m) => m.name === n)!.id;
const ingId = (n: string) => c.ingredients.find((i) => i.name === n)!.id;
const nul = { allergies: null, budgetKrw: null, goal: null, wantMains: null, avoidMains: null, kinds: null, avoidSpicy: null, wantSpicy: null, place: null };
const noOpt = { size: null, bread: null, cheese: null, addVegetables: null, removeVegetables: null, sauces: null, noSauce: null, toppings: null, set: null, drink: null, setItem: null };
const cmd = (x: Record<string, unknown>) => ({ op: 'ADD', line: null, allLines: null, qty: null, owner: null, name: null, pick: null, menu: null, conditions: nul, options: noOpt, ...x });
const fake = (commands: unknown[], code = 'SUCCESS') => ({ route: async () => ({ code, output: { commands }, provider_id: 'a100' }) }) as never;
const two = [
  { menuId: menuId('로스트 치킨'), choices: {}, qty: 1, owner: 'me' as const },
  { menuId: menuId('참치'), choices: {}, qty: 1, owner: 'me' as const },
];

describe('장바구니 말 → AI 명령 → 줄 고치기 (10/27)', () => {
  it('1번 빵 바꾸고 2번은 땅콩 알레르기', async () => {
    const r = await aiCartCommands(fake([cmd({ op: 'EDIT', line: 1, options: { ...noOpt, bread: '허니오트' } }), cmd({ op: 'EDIT', line: 2, conditions: { ...nul, allergies: ['땅콩'] } })]), c, '1번 빵은 허니오트로 바꾸고 2번은 땅콩 알레르기 있어', two, []);
    expect(r!.ops).toEqual([
      { op: 'EDIT', line: 0, choices: { bread: ingId('허니오트') } },
      { op: 'EDIT', line: 1, allergies: ['땅콩'] },
    ]);
    expect(r!.by).toBe('a100');
  });
  it('둘 다 → 줄마다 EDIT, 두 번째 빼기, 2번 메뉴 바꾸기', async () => {
    const all = await aiCartCommands(fake([cmd({ op: 'EDIT', allLines: true, options: { ...noOpt, size: '30cm', removeVegetables: ['양파'] } })]), c, '둘 다 양파 빼고 30cm로', two, []);
    expect(all!.ops.map((o) => [o.op, (o as { line: number }).line])).toEqual([['EDIT', 0], ['EDIT', 1]]);
    expect((all!.ops[1] as { choices: { size: string; removeVegetables: string[] } }).choices).toMatchObject({ size: '30cm', removeVegetables: [ingId('양파')] });
    const rm = await aiCartCommands(fake([cmd({ op: 'REMOVE', line: 2 })]), c, '두 번째는 빼줘', two, []);
    expect(rm!.ops).toEqual([{ op: 'REMOVE', line: 1 }]);
    const sw = await aiCartCommands(fake([cmd({ op: 'EDIT', line: 2, menu: '에그마요' })]), c, '2번 에그마요로 바꿔줘', two, []);
    expect(sw!.ops[0]).toMatchObject({ op: 'EDIT', line: 1, menuId: menuId('에그마요') });
  });
  it('11/02: 샐러드 줄에 빵을 넣는 AI 답 → 규칙이 읽은 메뉴(로티세리 바비큐 치킨)로 바꿈, 못 바꾸면 버림', async () => {
    const salad = [{ menuId: menuId('로티세리 치킨 더블치즈 그레인 샐러드'), choices: { sauces: [] }, qty: 1, owner: 'me' as const }];
    const r = await aiCartCommands(fake([cmd({ op: 'EDIT', line: 1, options: { ...noOpt, bread: '허니오트' } })]), c, '로티 허니오트로', salad, [], undefined, 0);
    expect(r!.ops[0]).toMatchObject({ op: 'EDIT', line: 0, menuId: menuId('로티세리 바비큐 치킨'), choices: { bread: ingId('허니오트') } });
    const bad = await aiCartCommands(fake([cmd({ op: 'EDIT', line: 1, options: { ...noOpt, bread: '허니오트' } })]), c, '빵은 허니오트로', salad, [], undefined, 0);
    expect(bad).toBeNull();
  });
  it('11/02: 음료만 따로 담은 줄은 앞 메뉴 줄에 단품으로 붙인다 ("로스트 치킨 하나랑 콜라 하나")', async () => {
    const r = await aiCartCommands(fake([cmd({ menu: '로스트 치킨', person: 1 }), cmd({ person: 1, options: { ...noOpt, drink: '콜라' } })]), c, '로스트 치킨 하나랑 콜라 하나', [], []);
    expect(r!.ops).toHaveLength(1);
    expect(r!.ops[0]).toMatchObject({ op: 'ADD', menuId: menuId('로스트 치킨') });
    expect((r!.ops[0] as unknown as { choices: Record<string, unknown> }).choices).toMatchObject({ drink: '콜라' });
  });
  it('같은 메뉴 둘 중 하나만 양파 빼기 → 두 줄', async () => {
    const r = await aiCartCommands(fake([cmd({ menu: '로스트 치킨', qty: 1, options: { ...noOpt, removeVegetables: ['양파'] } }), cmd({ menu: '로스트 치킨', qty: 1 })]), c, '로스트 치킨 두 개 시킬 건데 하나만 양파 빼줘', [], []);
    expect(r!.ops).toHaveLength(2);
    expect(r!.ops[0]).toMatchObject({ op: 'ADD', menuId: menuId('로스트 치킨'), qty: 1, choices: { removeVegetables: [ingId('양파')] } });
    expect(r!.ops[1]).toMatchObject({ op: 'ADD', menuId: menuId('로스트 치킨'), qty: 1, choices: {} });
  });
  it('"우유 알레르기"를 AI가 난류로 내면 → 말한 우유로 바꿈 (젬마 10/27)', async () => {
    const r = await aiCartCommands(fake([cmd({ name: '민수', owner: 'GUEST', menu: '참치', conditions: { ...nul, allergies: ['난류'] } }), cmd({ owner: 'ME', menu: '로스트 치킨' })]), c, '민수는 참치에 우유 알레르기, 나는 로스트 치킨', [], []);
    expect(r!.ops[0]).toMatchObject({ op: 'ADD', owner: 'guest', name: '민수', allergies: ['우유'] });
    expect(r!.ops[1]).toMatchObject({ op: 'ADD', owner: 'me', allergies: [] });
  });
  it('메뉴 이름 속 "에그"는 계란 알레르기 근거가 아님 (10/27 실제 주소에서 젬마가 낸 답)', async () => {
    const r = await aiCartCommands(fake([cmd({ owner: 'ME', menu: '에그마요' }), cmd({ name: '민수', owner: 'GUEST', menu: '참치', conditions: { ...nul, allergies: ['난류'] } })]), c, '민수는 참치에 우유 알레르기, 나는 에그마요', [], []);
    expect(r!.ops[1]).toMatchObject({ op: 'ADD', name: '민수', allergies: ['우유'] });
    expect(r!.ops[0]).toMatchObject({ op: 'ADD', owner: 'me', allergies: [] });
  });
  it('추천만 → recommend (조건·옵션), 10명 넘으면 자름 (10/27)', async () => {
    const r = await aiCartCommands(fake([cmd({ op: 'RECOMMEND', conditions: { ...nul, goal: 'FILLING' } })]), c, '든든한 거 추천해줘', [], []);
    expect(r!.ops).toEqual([]);
    expect(r!.recommend!.prefs).toMatchObject({ goal: 'FILLING' });
    const many = await aiCartCommands(fake(Array.from({ length: 11 }, (_, i) => cmd({ person: i + 1 }))), c, '야구부 11명', [], []);
    expect(many!.ops).toHaveLength(10);
    expect(many!.capped).toBe(11);
    expect(many!.ops.map((o) => (o as { owner: string }).owner).slice(0, 2)).toEqual(['me', 'guest']);
  });
  it('조건만 말한 고치기 → 추천, "랜치도 추가" → 지금 소스에 더함 (10/27)', async () => {
    const light = await aiCartCommands(fake([cmd({ op: 'EDIT', line: 1, conditions: { ...nul, goal: 'LIGHT' } })]), c, '가볍게', [two[0]!], []);
    expect(light!.ops).toEqual([]);
    expect(light!.recommend!.prefs).toMatchObject({ goal: 'LIGHT' });
    const salt = c.ingredients.find((i) => i.name === '소금')!.id;
    const ranch = c.ingredients.find((i) => i.name === '랜치')!.id;
    const add = await aiCartCommands(fake([{ op: 'EDIT', line: 1, all: null, qty: null, person: null, name: null, pick: null, menu: null, set: [{ k: 'addSauce', v: '랜치' }], want: [] }]), c, '랜치도 추가해줘', [{ ...two[0]!, choices: { sauces: [salt] } }], []);
    expect((add!.ops[0] as { choices: { sauces: string[] } }).choices.sauces).toEqual([salt, ranch]);
  });
  it('AI가 없거나 실패면 null (화면은 규칙으로)', async () => {
    expect(await aiCartCommands(fake([], 'PROVIDER_ERROR'), c, '1번 빼줘', two, [])).toBeNull();
    // 늦으면 late (화면은 규칙으로 넘기지 않고 다시 말해 달라고, 10/27)
    expect(await aiCartCommandsRaw({ route: () => new Promise(() => undefined) } as never, c, '1번 빼줘', two, [], 30)).toEqual({ late: true });
  });
});

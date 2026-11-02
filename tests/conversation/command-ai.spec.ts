import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { applyCommands, commandInput, commandInstructions, commandSchema, validateCommands, type SimLine } from '../../src/conversation/command-ai.ts';

const c = loadSubwayCatalog();
const menuId = (name: string) => c.menus.find((m) => m.name === name)!.id;
const ingId = (name: string) => c.ingredients.find((i) => i.name === name)!.id;
const ROAST = c.menus.find((m) => m.name === '로스트 치킨')!.name;
const veg = c.ingredients.find((i) => i.category === 'VEGETABLE')!.name;
const bread = c.ingredients.find((i) => i.category === 'BREAD')!.name;
const nul = { allergies: null, budgetKrw: null, goal: null, wantMains: null, avoidMains: null, kinds: null, avoidSpicy: null, wantSpicy: null, place: null };
const noOpt = { size: null, bread: null, cheese: null, addVegetables: null, removeVegetables: null, sauces: null, noSauce: null, toppings: null, set: null, drink: null, setItem: null };
const cmd = (x: Record<string, unknown>) => ({ op: 'ADD', line: null, allLines: null, qty: null, owner: null, name: null, pick: null, menu: null, conditions: nul, options: noOpt, ...x });

describe('AI 명령 검사 (10/26 시험)', () => {
  it('형식에 메뉴는 이름으로, 재료는 지시문 메뉴판에 (10/27 짧은 답)', () => {
    const s = JSON.stringify(commandSchema(c));
    expect(s).toContain('"로스트 치킨"');
    expect(s).not.toContain(menuId('로스트 치킨'));
    expect(commandInstructions(c)).toContain(veg);
  });
  it('짧은 답(set·want) → 같은 검사: 사람 번호·10명·상황 한 줄', () => {
    const raw = {
      reason: '야구부 5명이 든든하게',
      commands: [1, 2, 3, 4, 5].map((person) => ({ op: 'ADD', line: null, all: null, qty: null, person, name: null, pick: null, menu: null, set: [], want: [{ k: 'goal', v: 'FILLING' }] })),
    };
    const v = validateCommands(raw, c, '야구부 5명인데 든든하게 추천해줘', 0);
    expect(v.reason).toBe('야구부 5명이 든든하게');
    expect(v.commands.map((x) => [x.person, x.owner, x.intent.conditions.goal])).toEqual([[1, 'ME', 'FILLING'], [2, 'GUEST', 'FILLING'], [3, 'GUEST', 'FILLING'], [4, 'GUEST', 'FILLING'], [5, 'GUEST', 'FILLING']]);
    const one = validateCommands({ reason: '감기라서 따뜻한 것 (감기가 낫는 메뉴)', commands: [{ op: 'RECOMMEND', line: null, all: null, qty: null, person: null, name: null, pick: null, menu: null, set: [{ k: 'set', v: '수프 음료 세트' }, { k: 'setItem', v: '오늘의 수프' }, { k: 'removeVeg', v: '피망' }], want: [{ k: 'notSpicy', v: 'true' }, { k: 'lowFat', v: 'true' }] }] }, c, '감기 걸렸는데 추천해줘', 0);
    expect(one.reason).toBeNull(); // "낫는" = 장담하는 말 → 버림
    expect(one.commands[0]!.intent.conditions).toMatchObject({ avoidSpicy: true, lowFat: true });
    expect(one.commands[0]!.intent.options).toMatchObject({ set: '수프 음료 세트', setItem: '오늘의 수프', removeVegetables: [ingId('피망(파프리카)')] });
  });
  it('입력에 장바구니 줄 번호와 사람', () => {
    const t = commandInput('2번 빼줘', [{ no: 1, menu: '로스트 치킨', qty: 1, owner: 'ME' }, { no: 2, menu: '에그마요', qty: 2, owner: 'GUEST', name: '민수' }], []);
    expect(t).toContain('2번: 에그마요 ×2 (민수 거)');
  });
  it('이름 → id, 같은 메뉴 둘 중 하나만 야채 빼기 = 두 줄', () => {
    const text = `${ROAST} 두 개 시킬 건데 하나만 ${veg} 빼줘`;
    const raw = { commands: [cmd({ menu: ROAST, qty: 1, options: { ...noOpt, removeVegetables: [veg] } }), cmd({ menu: ROAST, qty: 1 })] };
    const v = validateCommands(raw, c, text, 0);
    expect(v.commands).toHaveLength(2);
    expect(v.commands[0]!.intent.menu).toBe(menuId(ROAST));
    expect(v.commands[0]!.intent.options.removeVegetables).toEqual([ingId(veg)]);
    const lines = applyCommands([], v.commands, []);
    expect(lines.map((l) => [l.menuId, l.qty])).toEqual([[menuId(ROAST), 1], [menuId(ROAST), 1]]);
  });
  it('말에 알레르기 근거가 없으면 버림, 있으면 그 줄만 같이 먹는 사람', () => {
    const empty: SimLine[] = [
      { menuId: menuId(ROAST), qty: 1, owner: 'ME', allergies: [], choices: {} },
      { menuId: menuId(ROAST), qty: 1, owner: 'ME', allergies: [], choices: {} },
    ];
    const raw = { commands: [cmd({ op: 'EDIT', line: 2, conditions: { ...nul, allergies: ['우유'] } })] };
    expect(validateCommands(raw, c, '2번은 우유 빼', 2).dropped).toContain('allergies');
    const v = validateCommands(raw, c, '2번은 우유 알레르기 있어', 2);
    const out = applyCommands(empty, v.commands, []);
    expect(out[1]!.allergies).toEqual(['우유']);
    expect(out[0]!.allergies).toEqual([]);
  });
  it('말에 없는 메뉴·장바구니 밖 줄·말에 없는 이름은 버림', () => {
    const raw = { commands: [cmd({ menu: '에그마요' }), cmd({ op: 'REMOVE', line: 5 }), cmd({ name: '철수', menu: ROAST })] };
    const v = validateCommands(raw, c, `${ROAST} 하나`, 2);
    expect(v.commands).toHaveLength(2);
    expect(v.commands[0]!.intent.menu).toBeUndefined();
    expect(v.commands[1]!.name).toBeNull();
    expect(v.dropped).toEqual(expect.arrayContaining(['menu', 'line', 'REMOVE_NO_LINE']));
  });
  it('전부 고치기·빼기·하나 더', () => {
    const lines: SimLine[] = [
      { menuId: 'a', qty: 1, owner: 'ME', allergies: [], choices: {} },
      { menuId: 'b', qty: 1, owner: 'ME', allergies: [], choices: {} },
    ];
    const raw = { commands: [cmd({ op: 'EDIT', allLines: true, options: { ...noOpt, size: '30cm', bread: bread } }), cmd({ op: 'EDIT', line: 1, qty: 2 }), cmd({ op: 'REMOVE', line: 2 })] };
    const v = validateCommands(raw, c, '둘 다 30cm, 첫 번째 하나 더, 두 번째 빼', 2);
    const out = applyCommands(lines, v.commands, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ menuId: 'a', qty: 2, choices: { size: '30cm', bread: ingId(bread) } });
  });
  it('가리키지 않았는데 추천 1·2·3번 담기 → 추천 하나로 (10/27 OpenAI 감기)', () => {
    const v = validateCommands({ commands: [cmd({ pick: 1 }), cmd({ pick: 2 }), cmd({ pick: 3 })] }, c, '감기 걸렸는데 추천해줘', 0);
    expect(v.commands.map((x) => x.op)).toEqual(['RECOMMEND']);
  });
  it('"참치"라고 했는데 AI가 "참치 아보카도 그레인 샐러드"를 고르면 → 말한 참치 (10/27)', () => {
    const long = c.menus.find((m) => m.name.startsWith('참치 ') && m.name.length > 4)!.name;
    const v = validateCommands({ commands: [cmd({ menu: long })] }, c, '참치 하나는 지우 거고 메밀 알레르기 있어요', 0);
    expect(v.commands[0]!.intent.menu).toBe(menuId('참치'));
    expect(validateCommands({ commands: [cmd({ menu: long })] }, c, `${long} 하나`, 0).commands[0]!.intent.menu).toBe(menuId(long));
  });
  it('"이거" = 추천 1번', () => {
    const v = validateCommands({ commands: [cmd({ pick: 1 })] }, c, '이거 하나', 0);
    expect(applyCommands([], v.commands, ['m1', 'm2'])[0]!.menuId).toBe('m1');
  });
});

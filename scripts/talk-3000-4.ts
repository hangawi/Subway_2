// 말로 주문하기 4차 (10/21 오후, 예형님): 예형님이 실제 화면에 쓴 말투를 틀로 — 1·2·3차와 겹치지 않음
// 실제로 쓴 말: "나 지금 배고프고 돼직고기로 먹고시퍼 맵게 해주고 제로콜라에다가 스프 야무진거 하나 추가해주고 나 고등어알레르기 있어",
//  "좀 있다가 점심 먹을 거니까 점심 추천해줘", "소고기들어간걸로 가볍게 추천해줘", "소고기 메뉴로 소스 3개 다 넣어주고 추가로 에그마요도 넣어줘",
//  "아나 뭐 먹을까?", "오늘 뭐먹을지 추턴해줘", "제로콜라에다가 치킨을 넣어서 맵게해줘", "콜라만 줘"
// 말투: 띄어쓰기 없음·한 글자 오타·"~에다가"·"~해주고"로 길게 잇기·나중 끼니("좀 있다가 점심")·개수만("소스 3개 다")·"추가로 ○○도"·③에서 "2번으로 할게"
//   npx tsx scripts/talk-3000-run2.ts --set 4 [--live 주소]
import type { SubwayCatalog } from '../src/catalog/subway-catalog.ts';
import type { Want } from './talk-cases.ts';
import { make3000 } from './talk-3000.ts';
import { heartiest, make3000b, type TalkCase2 } from './talk-3000-2.ts';
import { make3000c } from './talk-3000-3.ts';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ro = (w: string) => {
  const c = w.charCodeAt(w.length - 1);
  const b = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
  return b && b !== 8 ? `${w}으로` : `${w}로`;
};

export function make3000d(catalog: SubwayCatalog, seed = 20261021 + 4): TalkCase2[] {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const before = new Set([...make3000(catalog), ...make3000b(catalog), ...make3000c(catalog)].map((c) => c.text));
  const cases: TalkCase2[] = [];
  const seen = new Set<string>();
  const add = (group: string, text: string, want: Want, extra: Partial<TalkCase2> = {}) => {
    const t = text.replace(/\s+/g, ' ').trim();
    const key = `${(extra.before ?? []).join('|')}|${t}`;
    if (!t || seen.has(key) || (!extra.before && before.has(t))) return;
    seen.add(key);
    cases.push({ id: `${group}-${String(cases.filter((c) => c.group === group).length + 1).padStart(3, '0')}`, group, text: t, want, ...extra });
  };
  // 예형님처럼: 띄어쓰기를 자주 빼고 (절반), 끝말 한 글자 오타
  const squashSome = (t: string) => (r() < 0.45 ? t.replace(/\s+/g, '') : r() < 0.5 ? t.replace(/ (?=[가-힣]{1,2}(?: |$))/g, '') : t);
  const END = [' 추천해줘', ' 추턴해줘', ' 추천해줘바', ' 해줘', ' 줘', ' 먹고시퍼', ' 먹고싶어', ''];
  const sw = catalog.menus.filter((m) => m.kind === 'SANDWICH' && m.price.price30cm != null);
  const MAINS: Array<[string, string]> = [['소고기', '쇠고기'], ['쇠고기', '쇠고기'], ['치킨', '닭고기'], ['닭고기', '닭고기'], ['돼지고기', '돼지고기'], ['새우', '새우'], ['돼직고기', '돼지고기'], ['소고길', '쇠고기']]; // "참치"는 메뉴 이름이라 메뉴로 (따로 A4·H4 아님)
  const DRINKS: Array<[string, string, string | null]> = [['콜라', '코카콜라 (355ml)', '콜라'], ['제로콜라', '코카콜라 제로 (355ml)', '제로콜라'], ['사이다', '스프라이트 (355ml)', '사이다'], ['제로사이다', '스프라이트 제로 (355ml)', '제로사이다'], ['아메리카노', '아메리카노', '커피']];
  const ALLERGY: Array<[string, string]> = [['고등어', '고등어'], ['새우', '새우'], ['땅콩', '땅콩'], ['우유', '우유'], ['계란', '난류'], ['대두', '대두'], ['복숭아', '복숭아'], ['오징어', '오징어']];
  const SAUCES: Array<[string, string]> = [['랜치', '랜치'], ['스위트어니언', '스위트 어니언'], ['마요네즈', '마요네즈'], ['스위트칠리', '스위트 칠리'], ['허니머스터드', '허니 머스터드'], ['스모크바비큐', '스모크 바비큐']];
  const TOPPINGS = ['에그마요', '베이컨', '아보카도', '페퍼로니', '오믈렛'];
  const VEGS: Array<[string, string]> = [['양파', '양파'], ['피클', '피클'], ['오이', '오이'], ['토마토', '토마토'], ['올리브', '올리브'], ['피망', '피망(파프리카)']];

  // ── A4. 예형님 문장 그대로 바꿔 끼우기 (긴 한 문장) ──
  for (let i = 0; i < 300; i++) {
    const [mw, mk] = pick(MAINS);
    const [dw, , setDrink] = pick(DRINKS.filter((d) => d[2]));
    const [sw2, set] = pick([['스프', '수프 음료 세트'], ['쿠키', '쿠키 음료 세트'], ['웨지', '웨지 음료 세트']] as const);
    const [aw, a] = pick(ALLERGY.filter(([, x]) => x !== mk));
    const item = heartiest(catalog, set, [a]);
    if (!item) continue;
    const spicy = r() < 0.6;
    const t = `${pick(['나 지금 ', '아나 ', '', '나 '])}${pick(['배고프고 ', '개배고프고 ', ''])}${ro(mw)} ${pick(['먹고시퍼', '먹고싶어', '먹고싶고'])} ${spicy ? pick(['맵게 해주고 ', '맵게해주고 ', '매운거 넣어주고 ']) : ''}${dw}에다가 ${sw2} ${pick(['야무진거', '든든한거', '맛있는거'])} 하나 추가해주고 나 ${aw}알레르기 있어`;
    add('A4예형님문장', squashSome(t), { mains: [mk], allergies: [a], set, drink: setDrink!, setItem: item, ...(spicy ? { spicy: 'want' as const } : {}), ...(/배고프/.test(t) ? { goal: 'FILLING' as const } : {}) });
  }
  // ── B4. 나중 끼니 ("좀 있다가 점심", 아침 9시에) ──
  const LATER: Array<[string, 'LUNCH' | 'DINNER' | 'LATE_NIGHT']> = [['좀있다가 점심 먹을거니까 점심', 'LUNCH'], ['이따 점심에 먹을건데', 'LUNCH'], ['점심으로 먹을거', 'LUNCH'], ['오늘 저녁에 먹을거', 'DINNER'], ['이따 저녁', 'DINNER'], ['퇴근하고 저녁으로', 'DINNER'], ['야식으로 먹을거', 'LATE_NIGHT'], ['밤에 먹을 야식', 'LATE_NIGHT']];
  for (const [w, meal] of LATER) for (let k = 0; k < 15; k++) {
    const extra = pick([['', {}], [' 가볍게', { goal: 'LIGHT' }], [' 든든하게', { goal: 'FILLING' }], [' 소고기로', { mains: ['쇠고기'] }], [' 매운걸로', { spicy: 'want' }]] as const);
    add('B4나중끼니', squashSome(`${w}${extra[0]}${pick(END)}`), { meal, ...extra[1] } as Want, { at: '2026-10-22T09:10:00+09:00', top: 'NO_BREAKFAST' });
  }
  // ── C4. 재료 + 가볍게/든든하게 (띄어쓰기 없음) ──
  for (const [mw, mk] of MAINS) for (const [gw, g] of [['가볍게', 'LIGHT'], ['든든하게', 'FILLING'], ['칼로리낮게', 'LIGHT'], ['배부르게', 'FILLING']] as const) for (let k = 0; k < 3; k++)
    add('C4재료가볍게', squashSome(`${mw}${pick(['들어간걸로', '로', ' 메뉴로', '들어간거'])} ${gw}${pick(END)}`), { mains: [mk], goal: g });
  // ── D4. 개수만 (소스·토핑) → 묻기, "추가로 ○○도" ──
  for (let i = 0; i < 150; i++) {
    const m = pick(sw);
    const [mw, mk] = pick(MAINS.slice(0, 7));
    const tp = pick(TOPPINGS);
    const k = Math.floor(r() * 3);
    if (k === 0) add('D4개수만', squashSome(`${mw} 메뉴로 소스 ${pick(['3개 다', '2개', '세개', '두개', '다'])} 넣어주고 추가로 ${tp}도 넣어줘`), { mains: [mk], question: true });
    else if (k === 1) add('D4개수만', squashSome(`${m.name} 소스${pick(['3개', '두개 넣어줘', ' 다 넣어줘', ' 아무거나 두개'])}`), { menu: m.name, question: true });
    else {
      const [sw2, s] = pick(SAUCES);
      add('D4개수만', squashSome(`${m.name} 소스는 ${sw2} 하고 추가로 ${tp}도 넣어줘`), { menu: m.name, sauces: [s] });
    }
  }
  // ── E4. "~에다가 ~넣어서" (제로콜라에다가 치킨을 넣어서 맵게해줘) ──
  for (let i = 0; i < 200; i++) {
    const [dw, ds] = pick(DRINKS);
    const [mw, mk] = pick(MAINS);
    const [vw, v] = pick(VEGS);
    const k = Math.floor(r() * 3);
    if (k === 0) add('E4에다가', squashSome(`${dw}에다가 ${mw}을 넣어서 맵게해줘`), { extras: [ds], mains: [mk], spicy: 'want' });
    else if (k === 1) add('E4에다가', squashSome(`${dw}에다가 ${mw} 들어간거 ${vw}는 빼주고`), { extras: [ds], mains: [mk], remove: [v] });
    else add('E4에다가', squashSome(`${dw}만 줘`), { menu: 'singles', extras: [ds] });
  }
  // ── F4. 막연한 말 (예형님 말투) ──
  for (const w of ['아나 뭐 먹을까?', '오늘 뭐먹을지 추턴해줘', '아나 뭐먹지', '뭐먹을지 추천해줘바', '오늘머먹지', '아나 배고픈데 뭐먹지', '뭐먹을까 추턴', '아 뭐먹징', '배고파 뭐먹지 추천해줘바', '뭐 먹을지 골라줘바'])
    for (let k = 0; k < 3; k++) add('F4막연', k ? squashSome(w) : w, /배고/.test(w) ? ({ vague: true, goal: 'FILLING' } as Want) : ({ vague: true } as Want));
  // ── G4. ③에서 번호로 고르기 ("2번으로 할게") ──
  const RANK = [['1번으로 할게', 1], ['2번으로 할게', 2], ['3번으로 할게', 3], ['두번째거', 2], ['세번째걸로', 3], ['첫번째거로 줘', 1], ['2번 줘', 2], ['3번꺼', 3]] as const;
  for (const [w, n] of RANK) for (const b of ['소고기들어간걸로 가볍게 추천해줘', '아나 뭐 먹을까?', '좀있다가 점심 먹을거니까 점심 추천해줘', '치킨으로 든든하게 추천해줘바', '매운거 넣고 돼지고기로 추천'])
    add('G4번호고르기', w, { pickRank: n } as Want, { before: [b] });
  // ── H4. 섞기 (예형님 말투 조각을 길게) ──
  let guard = 0;
  while (cases.length < 2000 && guard++ < 30000) {
    const parts: Array<{ text: string; want: Want }> = [];
    const n = 2 + Math.floor(r() * 3);
    const used = new Set<string>();
    for (let k = 0; k < n; k++) {
      const key = pick(['mains', 'goal', 'spicy', 'drink', 'allergy', 'remove', 'meal']);
      if (used.has(key) || (key === 'remove' && used.has('spicy')) || (key === 'spicy' && used.has('remove'))) continue;
      used.add(key);
      if (key === 'mains') {
        const [w, k2] = pick(MAINS);
        parts.push({ text: `${ro(w)} ${pick(['먹고시퍼', '먹고싶고', ''])}`, want: { mains: [k2] } });
      } else if (key === 'goal') {
        const [w, g] = pick([['배고프고', 'FILLING'], ['가볍게', 'LIGHT'], ['든든하게', 'FILLING']] as const);
        parts.push({ text: w, want: { goal: g } });
      } else if (key === 'spicy') parts.push({ text: pick(['맵게 해주고', '매운거 넣어주고', '맵게해줘']), want: { spicy: 'want' } });
      else if (key === 'drink') {
        const [w, s] = pick(DRINKS);
        parts.push({ text: pick([`${w}도 하나`, `${w} 추가해주고`, `음료는 ${w}`]), want: { extras: [s] } });
      } else if (key === 'allergy') {
        const [w, a] = pick(ALLERGY);
        parts.push({ text: pick([`나 ${w}알레르기 있어`, `${w}알레르기 있음`]), want: { allergies: [a] } });
      } else if (key === 'remove') {
        const [w, v] = pick(VEGS);
        parts.push({ text: pick([`${w}는 빼주고`, `${w} 빼줘`]), want: { remove: [v] } });
      } else if (key === 'meal') {
        const [w, meal] = pick(LATER);
        parts.push({ text: w, want: { meal } as Want });
      }
    }
    if (parts.length < 2) continue;
    // 메인 재료가 알레르기와 겹치면 빼기 (새우 좋아 + 새우 알레르기는 따로 시험)
    const w: Want = {};
    for (const p of parts) for (const [k, v] of Object.entries(p.want)) (w as Record<string, unknown>)[k] = Array.isArray(v) && Array.isArray((w as Record<string, unknown>)[k]) ? [...((w as Record<string, unknown>)[k] as unknown[]), ...v] : v;
    if (w.mains?.some((x) => w.allergies?.includes(x))) continue;
    add('H4섞기', squashSome(`${pick(['나 지금 ', '아나 ', '', ''])}${parts.map((p) => p.text).join(' ')}${pick(END)}`), w, (w as { meal?: string }).meal ? { at: '2026-10-22T09:10:00+09:00', top: 'NO_BREAKFAST' } : {});
  }
  return cases;
}

if (process.argv[1]?.endsWith('talk-3000-4.ts') && process.argv.includes('--docs')) {
  const { loadSubwayCatalog } = await import('../src/catalog/subway-catalog.ts');
  const { writeFileSync, existsSync, readFileSync } = await import('node:fs');
  const list = make3000d(loadSubwayCatalog());
  const res: Record<string, string> = existsSync('var/talk-3000-4-result.json') ? JSON.parse(readFileSync('var/talk-3000-4-result.json', 'utf8')) : {};
  const groups = [...new Set(list.map((c) => c.group))];
  const lines = ['# 말로 주문하기 4차 목록 (10/21 오후) — 예형님이 실제로 쓴 말투', '', '> 만든 곳: `scripts/talk-3000-4.ts` (1·2·3차와 겹치는 문장 없음). 결과: ✅ 맞음 / ❌ 틀림', '', '| 묶음 | 개수 |', '|---|---|', ...groups.map((g) => `| ${g} | ${list.filter((c) => c.group === g).length} |`), `| 합계 | ${list.length} |`, ''];
  for (const g of groups) {
    lines.push(`## ${g}`, '', '| 번호 | 앞에서 한 말 | 문장 | 정답 | 결과 |', '|---|---|---|---|---|');
    for (const c of list.filter((x) => x.group === g)) lines.push(`| ${c.id} | ${(c.before ?? []).join(' → ').replace(/\|/g, '/')} | ${c.text.replace(/\|/g, '/')}${c.at ? ` (${c.at.slice(11, 16)})` : ''} | ${JSON.stringify(c.want).replace(/\|/g, '/')}${c.top ? ` top:${c.top}` : ''} | ${res[c.id] ?? ''} |`);
    lines.push('');
  }
  writeFileSync('docs/검수/3000문장_목록_4차.md', lines.join('\n'));
  console.log(`docs/검수/3000문장_목록_4차.md — ${list.length}문장`);
}

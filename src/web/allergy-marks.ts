// 고른 알레르기가 재료·주문서에 있는지 (10/15 사용자 요청: 우유 알레르기인데 치즈를 조용히 넣을 수 있던 문제).
// 막지는 않는다 — 알레르기가 아니라 피하고 싶은 것일 수도 있어서 표시·경고만.
// 추천에서 메뉴를 빼는 판단은 서버(subway.menu)가 하고, 이 파일은 화면 표시만 한다.
import { josa } from '../subway-menu/explain.ts';

export interface AllergenInfo {
  /** 들어 있음 */
  allergens: string[];
  /** ★ 들어 있을 수 있음 (없으면 빈 칸) */
  mayContain?: string[];
  /** KNOWN 이 아니면 알레르기 정보 없음 */
  allergenStatus?: string;
}

export interface AllergyMark {
  /** 고른 알레르기 중 들어 있는 것 */
  hit: string[];
  /** 고른 알레르기 중 ★ 들어 있을 수 있는 것 */
  may: string[];
  /** 알레르기를 골랐는데 이 재료는 정보가 없음 */
  unknown: boolean;
}

export function allergyMark(chosen: readonly string[], x: AllergenInfo): AllergyMark {
  if (!chosen.length) return { hit: [], may: [], unknown: false };
  const hit = chosen.filter((a) => x.allergens.includes(a));
  const may = chosen.filter((a) => !hit.includes(a) && (x.mayContain ?? []).includes(a));
  return { hit, may, unknown: x.allergenStatus !== undefined && x.allergenStatus !== 'KNOWN' };
}

/** 옵션 버튼 옆에 붙는 짧은 글 (없으면 빈 글) */
export function markLabel(m: AllergyMark): string {
  if (m.hit.length) return `${m.hit.join('·')} 들어 있음`;
  if (m.may.length) return `${m.may.join('·')} ★`;
  if (m.unknown) return '알레르기 확인 필요';
  return '';
}

/** 주문서 위 경고 (없으면 null). contains·mayContain 은 주문서(고른 재료까지 합친 것) 값 */
export function sheetWarning(chosen: readonly string[], sheet: { contains: string[]; mayContain: string[] }): { level: 'bad' | 'warn'; text: string } | null {
  const m = allergyMark(chosen, { allergens: sheet.contains, mayContain: sheet.mayContain });
  if (m.hit.length) return { level: 'bad', text: `⚠ 고른 알레르기 ${josa(m.hit.join('·'), '이', '가')} 들어 있어요. 메뉴나 재료를 바꿔 주세요` };
  if (m.may.length) return { level: 'warn', text: `⚠ 고른 알레르기 ${josa(m.may.join('·'), '이', '가')} 들어 있을 수 있어요 (★). 매장에서 꼭 확인하세요` };
  return null;
}

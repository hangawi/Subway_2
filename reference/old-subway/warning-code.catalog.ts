// src/explanation/catalog/warning-code.catalog.ts
//
// Warning Code → 한국어 설명 사전

export interface WarningCodeDefinition {
  code: string;
  labelKo: string;
  sentenceTemplate: string;
}

export const WARNING_CODE_CATALOG: Record<string, WarningCodeDefinition> = {
  NUTRITION_INCOMPLETE: {
    code: 'NUTRITION_INCOMPLETE',
    labelKo: '영양정보 불완전',
    sentenceTemplate: '일부 영양정보가 누락되어 수치를 보수적으로 확인해야 합니다.',
  },
  LOW_DATA_CONFIDENCE: {
    code: 'LOW_DATA_CONFIDENCE',
    labelKo: '데이터 신뢰도 낮음',
    sentenceTemplate: '일부 데이터의 신뢰도가 낮아 추천 근거를 참고용으로 봐야 합니다.',
  },
};

export function requireWarningCodeDefinition(code: string): WarningCodeDefinition {
  const def = WARNING_CODE_CATALOG[code];
  if (!def) {
    throw new Error(
      `UNMAPPED_WARNING_CODE: '${code}'는 Warning Code Catalog에 등록되지 않았습니다.`,
    );
  }
  return def;
}

export function findWarningCodeDefinition(code: string): WarningCodeDefinition | null {
  return WARNING_CODE_CATALOG[code] ?? null;
}

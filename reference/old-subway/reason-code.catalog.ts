// src/explanation/catalog/reason-code.catalog.ts
//
// Reason Code → 한국어 설명 사전
// 실제 Reason Code는 SoftScoringEngine.createReasonCodes()에서 생성된다.

export interface ReasonCodeDefinition {
  code: string;
  labelKo: string;
  sentenceTemplate: string;
  requiredEvidence: Array<'SCORE_AXIS' | 'CONTRIBUTION' | 'CANDIDATE_FACT'>;
}

export const REASON_CODE_CATALOG: Record<string, ReasonCodeDefinition> = {
  HIGH_PROTEIN_FIT: {
    code: 'HIGH_PROTEIN_FIT',
    labelKo: '단백질 적합도 우수',
    sentenceTemplate: '단백질 조건과 잘 맞습니다.',
    requiredEvidence: ['SCORE_AXIS', 'CONTRIBUTION'],
  },
  SODIUM_FIT: {
    code: 'SODIUM_FIT',
    labelKo: '나트륨 적합도',
    sentenceTemplate: '설정한 나트륨 기준과 잘 맞습니다.',
    requiredEvidence: ['SCORE_AXIS', 'CONTRIBUTION'],
  },
  BUDGET_FIT: {
    code: 'BUDGET_FIT',
    labelKo: '예산 적합도',
    sentenceTemplate: '현재 예산 조건과 잘 맞습니다.',
    requiredEvidence: ['SCORE_AXIS', 'CONTRIBUTION'],
  },
  SATIETY_FIT: {
    code: 'SATIETY_FIT',
    labelKo: '포만감 적합도',
    sentenceTemplate: '현재 원하는 포만감과 잘 맞습니다.',
    requiredEvidence: ['SCORE_AXIS', 'CONTRIBUTION'],
  },
  CHEESE_PREFERENCE_MATCH: {
    code: 'CHEESE_PREFERENCE_MATCH',
    labelKo: '치즈 선호 일치',
    sentenceTemplate: '현재 치즈 선호와 구성이 맞습니다.',
    requiredEvidence: ['CANDIDATE_FACT', 'SCORE_AXIS'],
  },
  SPICY_PREFERENCE_MATCH: {
    code: 'SPICY_PREFERENCE_MATCH',
    labelKo: '매운맛 선호 일치',
    sentenceTemplate: '현재 매운맛 선호와 구성이 맞습니다.',
    requiredEvidence: ['CANDIDATE_FACT', 'SCORE_AXIS'],
  },
  BEHAVIOR_REJECTED: {
    code: 'BEHAVIOR_REJECTED',
    labelKo: '세션 내 거절',
    sentenceTemplate: '이전에 거절한 후보입니다.',
    requiredEvidence: ['SCORE_AXIS'],
  },
  BEHAVIOR_PREFERRED: {
    code: 'BEHAVIOR_PREFERRED',
    labelKo: '세션 내 선호',
    sentenceTemplate: '세션 내 선호 신호가 높은 후보입니다.',
    requiredEvidence: ['SCORE_AXIS'],
  },
};

/** 미매핑 Code인지 확인한다. 미매핑이면 오류를 던진다. */
export function requireReasonCodeDefinition(code: string): ReasonCodeDefinition {
  const def = REASON_CODE_CATALOG[code];
  if (!def) {
    throw new Error(`UNMAPPED_REASON_CODE: '${code}'는 Reason Code Catalog에 등록되지 않았습니다.`);
  }
  return def;
}

/** Reason Code가 Catalog에 있으면 정의를 반환, 없으면 null */
export function findReasonCodeDefinition(code: string): ReasonCodeDefinition | null {
  return REASON_CODE_CATALOG[code] ?? null;
}

// src/explanation/catalog/score-axis.catalog.ts
//
// Score Axis → 한국어 설명 사전

import type { ScoreAxis } from '../../pure-engine/scoring/score.types';

export interface ScoreAxisDefinition {
  axis: ScoreAxis;
  labelKo: string;
  scoreUnit: string;
  /** CandidateMenu.nutrition의 필드 경로 (있으면 원자료 표시) */
  rawFactPath: string | null;
  rawFactUnit: string | null;
  neutralDescription: string;
}

export const SCORE_AXIS_CATALOG: Record<ScoreAxis, ScoreAxisDefinition> = {
  proteinFit: {
    axis: 'proteinFit',
    labelKo: '단백질 적합도',
    scoreUnit: '점',
    rawFactPath: 'nutrition.proteinG',
    rawFactUnit: 'g',
    neutralDescription: '단백질 함량이 현재 목표와 얼마나 맞는지를 나타냅니다.',
  },
  sodiumFit: {
    axis: 'sodiumFit',
    labelKo: '나트륨 적합도',
    scoreUnit: '점',
    rawFactPath: 'nutrition.sodiumMg',
    rawFactUnit: 'mg',
    neutralDescription: '나트륨 함량이 현재 기준과 얼마나 맞는지를 나타냅니다.',
  },
  calorieFit: {
    axis: 'calorieFit',
    labelKo: '칼로리 적합도',
    scoreUnit: '점',
    rawFactPath: 'nutrition.energyKcal',
    rawFactUnit: 'kcal',
    neutralDescription: '칼로리가 현재 목표 열량과 얼마나 가까운지를 나타냅니다.',
  },
  budgetFit: {
    axis: 'budgetFit',
    labelKo: '예산 적합도',
    scoreUnit: '점',
    rawFactPath: null,
    rawFactUnit: null,
    neutralDescription: '현재 예산 범위 안에서 얼마나 적합한지를 나타냅니다.',
  },
  satietyFit: {
    axis: 'satietyFit',
    labelKo: '포만감 적합도',
    scoreUnit: '점',
    rawFactPath: null,
    rawFactUnit: null,
    neutralDescription: '현재 원하는 포만감 수준과 얼마나 맞는지를 나타냅니다.',
  },
  emotionFit: {
    axis: 'emotionFit',
    labelKo: '감성 적합도',
    scoreUnit: '점',
    rawFactPath: null,
    rawFactUnit: null,
    neutralDescription: '치즈·매운맛 선호, 보상감, 포만감 필요 등 감성 요소와 얼마나 맞는지를 나타냅니다.',
  },
  healthFit: {
    axis: 'healthFit',
    labelKo: '건강 적합도',
    scoreUnit: '점',
    rawFactPath: null,
    rawFactUnit: null,
    neutralDescription: '단백질·나트륨·칼로리 기준을 종합한 건강 적합도를 나타냅니다.',
  },
  confidenceFit: {
    axis: 'confidenceFit',
    labelKo: '데이터 신뢰도',
    scoreUnit: '점',
    rawFactPath: null,
    rawFactUnit: null,
    neutralDescription: '이 후보의 영양·가격 데이터가 얼마나 신뢰할 수 있는지를 나타냅니다.',
  },
  behaviorFit: {
    axis: 'behaviorFit',
    labelKo: '세션 선호도',
    scoreUnit: '점',
    rawFactPath: null,
    rawFactUnit: null,
    neutralDescription: '현재 세션 내 행동 신호(거절·선호)와 얼마나 맞는지를 나타냅니다.',
  },
};

/** Korean keyword → ScoreAxis 매핑 (대화 해석용) */
export const AXIS_KEYWORD_MAP: Record<string, ScoreAxis> = {
  단백질: 'proteinFit',
  나트륨: 'sodiumFit',
  소금: 'sodiumFit',
  칼로리: 'calorieFit',
  열량: 'calorieFit',
  가격: 'budgetFit',
  예산: 'budgetFit',
  포만감: 'satietyFit',
  든든: 'satietyFit',
  기분: 'emotionFit',
  보상: 'emotionFit',
  건강: 'healthFit',
  신뢰도: 'confidenceFit',
  데이터: 'confidenceFit',
  선호도: 'behaviorFit',
};

export function findAxisByKeyword(text: string): ScoreAxis | null {
  for (const [keyword, axis] of Object.entries(AXIS_KEYWORD_MAP)) {
    if (text.includes(keyword)) return axis;
  }
  return null;
}

export function requireAxisDefinition(axis: string): ScoreAxisDefinition {
  const def = SCORE_AXIS_CATALOG[axis as ScoreAxis];
  if (!def) {
    throw new Error(`UNMAPPED_SCORE_AXIS: '${axis}'는 Score Axis Catalog에 없습니다.`);
  }
  return def;
}

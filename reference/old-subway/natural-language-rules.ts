// src/natural-language/interpreter/natural-language-rules.ts
//
// Rule 데이터 분리: 각 Rule은 ID, 우선순위, test(), apply()를 가진다.
// 담당하지 않는 일: Repository 조회, Pure Engine 호출, UUID/시간 생성

import type { StatePatch } from '../../state/state-patch';
import type {
  NaturalLanguageReferenceContext,
  InterpretationResult,
  NaturalLanguageIntent,
  BehaviorEventDraft,
  CandidateReference,
  MenuReference,
  InterpretationConfidence,
} from '../contracts/natural-language.types';

// ─────────────────────────────────────────────
// Partial Interpretation (Rule 1개의 결과)
// ─────────────────────────────────────────────

export interface PartialInterpretation {
  intents: NaturalLanguageIntent[];
  statePatch: StatePatch | null;
  behaviorEventDraft: BehaviorEventDraft | null;
  candidateReferences: CandidateReference[];
  menuReferences: MenuReference[];
  requiresClarification: boolean;
  clarificationCode: string | null;
  clarificationQuestion: string | null;
  conflictingValues: string[];
  ambiguities: string[];
  unparsedTerms: string[];
  errorCode: string | null;
  errorMessage: string | null;
}

export interface NaturalLanguageRule {
  ruleId: string;
  priority: number;
  test(text: string, context?: NaturalLanguageReferenceContext): boolean;
  apply(
    text: string,
    context: NaturalLanguageReferenceContext,
  ): PartialInterpretation;
}

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function emptyPartial(): PartialInterpretation {
  return {
    intents: [],
    statePatch: null,
    behaviorEventDraft: null,
    candidateReferences: [],
    menuReferences: [],
    requiresClarification: false,
    clarificationCode: null,
    clarificationQuestion: null,
    conflictingValues: [],
    ambiguities: [],
    unparsedTerms: [],
    errorCode: null,
    errorMessage: null,
  };
}

function parseBudgetKrw(text: string): number | null {
  // "만원" 단독 (숫자 없이) = 10,000
  if (/(?<!\d)\s*만\s*원/.test(text) && !/(\d+)\s*만\s*원/.test(text)) {
    return 10_000;
  }
  const manwon = text.match(/(\d+)\s*만\s*원/);
  if (manwon !== null && manwon[1] !== undefined) {
    return Number(manwon[1]) * 10_000;
  }
  const won = text.match(/([\d,]+)\s*원/);
  if (won !== null && won[1] !== undefined) {
    return Number(won[1].replace(/,/g, ''));
  }
  return null;
}

// ─────────────────────────────────────────────
// 개별 Rule 구현
// 우선순위: 1=빈입력, 2=상충, 3=오류, 4=Candidate Ref, 5=Menu Ref, 6=State Patch
// ─────────────────────────────────────────────

// Priority 1: 빈 입력
const ruleEmptyInput: NaturalLanguageRule = {
  ruleId: 'NL_EMPTY_INPUT',
  priority: 1,
  test(text: string): boolean {
    return text.trim() === '';
  },
  apply(_text: string, _context: NaturalLanguageReferenceContext): PartialInterpretation {
    return {
      ...emptyPartial(),
      errorCode: 'EMPTY_INPUT',
      errorMessage: '입력이 비어 있습니다.',
    };
  },
};

// Priority 2: 상충 — 치즈 많이 + 치즈 빼줘
const ruleConflictCheeseIncludeExclude: NaturalLanguageRule = {
  ruleId: 'NL_CONFLICT_CHEESE_INCLUDE_EXCLUDE',
  priority: 2,
  test(text: string): boolean {
    const wantsCheese = /(치즈.*많이|치즈.*추가)/.test(text);
    const avoidsCheese = /(치즈.*빼|치즈.*제외)/.test(text);
    return wantsCheese && avoidsCheese;
  },
  apply(_text: string, _context: NaturalLanguageReferenceContext): PartialInterpretation {
    return {
      ...emptyPartial(),
      requiresClarification: true,
      clarificationCode: 'CONFLICTING_CHEESE_PREFERENCE',
      clarificationQuestion: '치즈를 많이 넣을까요, 제외할까요?',
      conflictingValues: ['치즈 많이', '치즈 제외'],
      ambiguities: ['CHEESE_PREFERENCE_CONFLICT'],
    };
  },
};

// Priority 3: 음수 예산 오류
const ruleBudgetNegative: NaturalLanguageRule = {
  ruleId: 'NL_BUDGET_NEGATIVE',
  priority: 3,
  test(text: string): boolean {
    const budget = parseBudgetKrw(text);
    return budget !== null && budget < 0;
  },
  apply(_text: string, _context: NaturalLanguageReferenceContext): PartialInterpretation {
    return {
      ...emptyPartial(),
      errorCode: 'NEGATIVE_BUDGET',
      errorMessage: '예산은 0 이상이어야 합니다.',
    };
  },
};

// Priority 4: Candidate 거절 ("아까 1위")
const ruleRejectRankedCandidate: NaturalLanguageRule = {
  ruleId: 'NL_REJECT_RANKED_CANDIDATE',
  priority: 4,
  test(text: string): boolean {
    return /(아까|이전|전에)\s*(1위|2위|3위|순위).*싫|싫.*아까\s*(1위|2위|3위)/.test(text) ||
      /(아까|이전)\s*(1위|2위|3위).*는?\s*싫/.test(text);
  },
  apply(text: string, _context: NaturalLanguageReferenceContext): PartialInterpretation {
    const rankMatch = text.match(/([1-3])위/);
    const rank = rankMatch ? Number(rankMatch[1]) : 1;
    return {
      ...emptyPartial(),
      intents: ['REJECT_CANDIDATE'],
      behaviorEventDraft: {
        eventType: 'CANDIDATE_REJECTED',
        candidateId: null,
        menuId: null,
        signals: null,
      },
      candidateReferences: [{
        referenceType: 'RANK',
        rawText: `아까 ${rank}위`,
        rank,
        candidateId: null,
      }],
    };
  },
};

// Priority 5: Menu 선호 ("로티세리 치킨이 좋아")
const rulePreferMenuAlias: NaturalLanguageRule = {
  ruleId: 'NL_PREFER_MENU_ALIAS',
  priority: 5,
  test(text: string, context?: NaturalLanguageReferenceContext): boolean {
    if (!context) return false;
    return Object.keys(context.menuAliases).some((alias) => text.includes(alias));
  },
  apply(text: string, context: NaturalLanguageReferenceContext): PartialInterpretation {
    const matchedAlias = Object.keys(context.menuAliases).find((alias) =>
      text.includes(alias),
    );
    if (!matchedAlias) return emptyPartial();

    const menuId = context.menuAliases[matchedAlias] ?? null;
    return {
      ...emptyPartial(),
      intents: ['PREFER_MENU'],
      behaviorEventDraft: {
        eventType: 'PREFERENCE_STATED',
        candidateId: null,
        menuId,
        signals: menuId
          ? {
              preferredMenuIds: [menuId],
              avoidedMenuIds: [],
              preferredTags: [],
              avoidedTags: [],
            }
          : null,
      },
      menuReferences: [{
        rawText: matchedAlias,
        menuId,
      }],
    };
  },
};

// Priority 6: 예산
const ruleBudgetKrw: NaturalLanguageRule = {
  ruleId: 'NL_BUDGET_KRW',
  priority: 6,
  test(text: string): boolean {
    const budget = parseBudgetKrw(text);
    return budget !== null && budget >= 0;
  },
  apply(text: string, _context: NaturalLanguageReferenceContext): PartialInterpretation {
    const budget = parseBudgetKrw(text);
    if (budget === null || budget < 0) return emptyPartial();
    return {
      ...emptyPartial(),
      intents: ['UPDATE_BUDGET'],
      statePatch: {
        commonState: { budget_krw: budget },
      },
      behaviorEventDraft: {
        eventType: 'PREFERENCE_STATED',
        candidateId: null,
        menuId: null,
        signals: null,
      },
    };
  },
};

// Priority 7: 치즈 제외
const ruleCheeseExclude: NaturalLanguageRule = {
  ruleId: 'NL_CHEESE_EXCLUDE',
  priority: 7,
  test(text: string): boolean {
    return /(치즈.*빼|치즈.*제외|치즈.*없이)/.test(text);
  },
  apply(_text: string, _context: NaturalLanguageReferenceContext): PartialInterpretation {
    return {
      ...emptyPartial(),
      intents: ['UPDATE_PREFERENCE'],
      statePatch: {
        emotionState: { cheese_preference: 0 },
      },
      behaviorEventDraft: {
        eventType: 'PREFERENCE_STATED',
        candidateId: null,
        menuId: null,
        signals: null,
      },
    };
  },
};

// Priority 8: 건강 선호
const ruleHealthyChoice: NaturalLanguageRule = {
  ruleId: 'NL_HEALTHY_CHOICE',
  priority: 8,
  test(text: string): boolean {
    return /(건강한|건강하게|건강|담백한)/.test(text);
  },
  apply(_text: string, _context: NaturalLanguageReferenceContext): PartialInterpretation {
    return {
      ...emptyPartial(),
      intents: ['UPDATE_PREFERENCE'],
      statePatch: {
        emotionState: { healthy_choice_need: 0.9 },
      },
      behaviorEventDraft: {
        eventType: 'PREFERENCE_STATED',
        candidateId: null,
        menuId: null,
        signals: null,
      },
    };
  },
};

// Priority 9: 포만감
const ruleSatietyHigh: NaturalLanguageRule = {
  ruleId: 'NL_SATIETY_HIGH',
  priority: 9,
  test(text: string): boolean {
    return /(든든|배부르|푸짐)/.test(text);
  },
  apply(_text: string, _context: NaturalLanguageReferenceContext): PartialInterpretation {
    return {
      ...emptyPartial(),
      intents: ['UPDATE_PREFERENCE'],
      statePatch: {
        emotionState: { satiety_need: 0.9 },
      },
      behaviorEventDraft: {
        eventType: 'PREFERENCE_STATED',
        candidateId: null,
        menuId: null,
        signals: null,
      },
    };
  },
};

// Priority 10: 매운맛 회피
const ruleSpicyAvoid: NaturalLanguageRule = {
  ruleId: 'NL_SPICY_AVOID',
  priority: 10,
  test(text: string): boolean {
    return /(매운|매워|매운건|맵).*피하|피하.*매운/.test(text);
  },
  apply(_text: string, _context: NaturalLanguageReferenceContext): PartialInterpretation {
    return {
      ...emptyPartial(),
      intents: ['UPDATE_PREFERENCE'],
      statePatch: {
        emotionState: { spicy_preference: 0 },
      },
      behaviorEventDraft: {
        eventType: 'PREFERENCE_STATED',
        candidateId: null,
        menuId: null,
        signals: null,
      },
    };
  },
};

// ─────────────────────────────────────────────
// 규칙 목록 (우선순위 순)
// ─────────────────────────────────────────────

export const NATURAL_LANGUAGE_RULES: NaturalLanguageRule[] = [
  ruleEmptyInput,
  ruleConflictCheeseIncludeExclude,
  ruleBudgetNegative,
  ruleRejectRankedCandidate,
  rulePreferMenuAlias,
  ruleBudgetKrw,
  ruleCheeseExclude,
  ruleHealthyChoice,
  ruleSatietyHigh,
  ruleSpicyAvoid,
].sort((a, b) => a.priority - b.priority);

// ─────────────────────────────────────────────
// 여러 Rule 결과를 깊은 병합으로 합친다.
// 얕은 Object.assign으로 emotionState 전체를 덮어쓰지 않는다.
// ─────────────────────────────────────────────

export function mergePartials(partials: PartialInterpretation[]): PartialInterpretation {
  const result: PartialInterpretation = emptyPartial();

  for (const partial of partials) {
    // 오류/상충은 즉시 반환
    if (partial.errorCode !== null || partial.requiresClarification) {
      return partial;
    }

    // intents 병합 (중복 제거)
    for (const intent of partial.intents) {
      if (!result.intents.includes(intent)) {
        result.intents.push(intent);
      }
    }

    // statePatch 깊은 병합
    if (partial.statePatch !== null) {
      if (result.statePatch === null) {
        result.statePatch = {};
      }
      if (partial.statePatch.emotionState) {
        result.statePatch.emotionState = {
          ...(result.statePatch.emotionState ?? {}),
          ...partial.statePatch.emotionState,
        };
      }
      if (partial.statePatch.commonState) {
        result.statePatch.commonState = {
          ...(result.statePatch.commonState ?? {}),
          ...partial.statePatch.commonState,
        };
      }
    }

    // behaviorEventDraft: 첫 번째를 사용 (중복 방지)
    if (partial.behaviorEventDraft !== null && result.behaviorEventDraft === null) {
      result.behaviorEventDraft = partial.behaviorEventDraft;
    }

    // signals 병합 (preferredMenuIds 중복 제거)
    if (partial.behaviorEventDraft?.signals) {
      const existingSignals = result.behaviorEventDraft?.signals ?? {
        preferredMenuIds: [],
        avoidedMenuIds: [],
        preferredTags: [],
        avoidedTags: [],
      };
      const mergedSignals = {
        preferredMenuIds: [
          ...existingSignals.preferredMenuIds,
          ...partial.behaviorEventDraft.signals.preferredMenuIds.filter(
            (id) => !existingSignals.preferredMenuIds.includes(id),
          ),
        ],
        avoidedMenuIds: [
          ...existingSignals.avoidedMenuIds,
          ...partial.behaviorEventDraft.signals.avoidedMenuIds.filter(
            (id) => !existingSignals.avoidedMenuIds.includes(id),
          ),
        ],
        preferredTags: [
          ...existingSignals.preferredTags,
          ...partial.behaviorEventDraft.signals.preferredTags.filter(
            (t) => !existingSignals.preferredTags.includes(t),
          ),
        ],
        avoidedTags: [
          ...existingSignals.avoidedTags,
          ...partial.behaviorEventDraft.signals.avoidedTags.filter(
            (t) => !existingSignals.avoidedTags.includes(t),
          ),
        ],
      };
      if (result.behaviorEventDraft !== null) {
        result.behaviorEventDraft = {
          ...result.behaviorEventDraft,
          signals: mergedSignals,
        };
      }
    }

    // 참조 병합
    result.candidateReferences.push(...partial.candidateReferences);
    result.menuReferences.push(...partial.menuReferences);
    result.ambiguities.push(...partial.ambiguities);
    result.unparsedTerms.push(...partial.unparsedTerms);
  }

  return result;
}

// 매장 고르기 어댑터 `subway_store` — 김민지 SOPHIA 공통 엔진에 붙는 써브웨이 판단 규칙.
//  generate: 찾은 매장 전부 (영업·이동 시간이 붙은 것)
//  hard:     지금 닫음(CLOSED_NOW), 30분 안에 닫음(CLOSING_SOON), 이동 한도 초과(TOO_FAR)
//            — 1km 넘는데 이동 시간을 못 받았으면(추정값) 빼지 않고 "확인 필요"(TRAVEL_UNKNOWN)로 둔다
//  evaluate: 이동 시간 짧을수록 +, 영업시간을 모르면 − (모르는 걸 영업 중이라고 치지 않음)
//  tieBreak: 거리 → 매장 ID / similar: 50m 안의 두 매장은 하나 (같은 건물 등)
import type { DomainAdapter } from '../../vendor/sophia/pure_engine/decision-graph.ts';
import { distanceM } from '../stores/find-stores.ts';
import { WALK_LIMIT_M } from '../stores/store-facts.ts';
import type { StoreFacts } from '../stores/store-facts.ts';

export const SUBWAY_STORE_DOMAIN = 'subway_store';
export const RECOMMEND_STORE = 'RECOMMEND_STORE';
export const SUBWAY_STORE_FUNCTION_VERSION = 'subway.store@0.2';
export const DEFAULT_MAX_TRAVEL_MIN = 20;
export const SAME_PLACE_M = 50;

export interface StoreState {
  stores: StoreFacts[];
  maxTravelMin: number;
}

export interface StoreCandidate {
  candidate_id: string;
  store: StoreFacts;
}

// 점수 비중 (써브웨이 설계값, 측정값 아님).
const WEIGHTS = { perMinute: -0.2, hoursUnknown: -1, travelUnknown: -1 } as const;

// 1km 넘는 매장의 걷기 추정은 대중교통 시간을 못 받았다는 뜻 — 실제 이동 시간을 모름.
const travelUnknown = (s: StoreFacts) => s.travel.source === 'ESTIMATE' && s.distanceM > WALK_LIMIT_M;

export const subwayStoreDomain: DomainAdapter<StoreState, StoreCandidate> = {
  domain: SUBWAY_STORE_DOMAIN,
  function_version: SUBWAY_STORE_FUNCTION_VERSION,
  action_types: [RECOMMEND_STORE],

  *generate(state) {
    for (const store of state.stores) yield { candidate_id: store.id, store };
  },

  hard(state, { store }) {
    const reasons: string[] = [];
    if (store.open === 'CLOSED') reasons.push('CLOSED_NOW');
    if (store.open === 'CLOSING_SOON') reasons.push('CLOSING_SOON');
    if (store.travel.minutes > state.maxTravelMin && !travelUnknown(store)) reasons.push('TOO_FAR');
    return reasons;
  },

  evaluate(_state, { store }) {
    const reason_codes: string[] = [];
    if (store.open === 'OPEN') reason_codes.push('OPEN_NOW');
    if (store.open === 'UNKNOWN') reason_codes.push('HOURS_UNKNOWN');
    if (store.travel.mode === 'WALK' && store.travel.minutes <= 5) reason_codes.push('WALK_5_MIN');
    if (travelUnknown(store)) reason_codes.push('TRAVEL_UNKNOWN');
    else if (store.travel.source === 'ESTIMATE') reason_codes.push('TRAVEL_ESTIMATED');
    return {
      score_components: {
        travel: Math.round(store.travel.minutes * WEIGHTS.perMinute * 1e4) / 1e4,
        hoursUnknown: store.open === 'UNKNOWN' ? WEIGHTS.hoursUnknown : 0,
        travelUnknown: travelUnknown(store) ? WEIGHTS.travelUnknown : 0,
      },
      reason_codes,
    };
  },

  tieBreak: (a, b) => a.store.distanceM - b.store.distanceM || (a.store.id < b.store.id ? -1 : a.store.id > b.store.id ? 1 : 0),
  similar: (a, b) => distanceM(a.store.point, b.store.point) <= SAME_PLACE_M,
};

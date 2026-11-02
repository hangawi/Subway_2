import { describe, expect, it } from 'vitest';
import { runDecision } from '../../vendor/sophia/pure_engine/decision-graph.ts';
import { SUBWAY_DOMAINS } from '../../src/engine/registry.ts';
import {
  DEFAULT_MAX_TRAVEL_MIN,
  RECOMMEND_STORE,
  SUBWAY_STORE_DOMAIN,
  type StoreCandidate,
  type StoreState,
} from '../../src/subway-store/store-domain.ts';
import type { StoreFacts } from '../../src/stores/store-facts.ts';

const s = (id: string, minutes: number, open: StoreFacts['open'], dLat = 0, distanceM = minutes * 70): StoreFacts => ({
  id, name: `써브웨이 ${id}`, branch: id, address: null, point: { lat: 37.5 + dLat, lng: 127.03 }, phone: null, url: null,
  distanceM, hours: null, hoursSource: null, specialToday: false, open, travel: { mode: 'WALK', minutes, source: 'ESTIMATE' },
});
const decide = (stores: StoreFacts[], maxTravelMin = DEFAULT_MAX_TRAVEL_MIN) =>
  runDecision<StoreState, StoreCandidate>(
    { domain: SUBWAY_STORE_DOMAIN, action_type: RECOMMEND_STORE, state: { stores, maxTravelMin }, state_version: 1, policy_version: 1, reference_at: '2026-10-12T12:10:00+09:00', requested_top_n: 3, evidence_refs: [] },
    SUBWAY_DOMAINS,
  );

describe('subway_store × 김민지 공통 엔진', () => {
  it('등록부에 매장·메뉴 두 규칙이 있다', () => {
    expect(SUBWAY_DOMAINS.domains()).toEqual(['subway_menu', 'subway_store']);
  });

  it('가까운 매장 1곳 + 대안 2곳, 닫음·곧 닫음·너무 멂은 이유와 함께 빠진다', () => {
    const r = decide([s('A', 4, 'OPEN', 0.001), s('B', 8, 'OPEN', 0.002), s('C', 3, 'CLOSED', 0.003), s('D', 6, 'CLOSING_SOON', 0.004), { ...s('E', 25, 'OPEN', 0.005), travel: { mode: 'TRANSIT', minutes: 25, source: 'ODSAY' } }, s('F', 12, 'OPEN', 0.006)]);
    expect(r.candidates.map((c) => c.candidate_id)).toEqual(['A', 'B', 'F']);
    const why = Object.fromEntries(r.rejected.map((x) => [x.candidate_id, x.reason_codes]));
    expect(why).toEqual({ C: ['CLOSED_NOW'], D: ['CLOSING_SOON'], E: ['TOO_FAR'] });
    expect(r.candidates[0]!.reason_codes).toEqual(expect.arrayContaining(['OPEN_NOW', 'WALK_5_MIN']));
  });

  it('영업시간을 모르면 빼지 않지만 아래로 (확인 필요)', () => {
    const r = decide([s('A', 5, 'UNKNOWN', 0.001), s('B', 7, 'OPEN', 0.002)]);
    expect(r.candidates.map((c) => c.candidate_id)).toEqual(['B', 'A']);
    expect(r.candidates[1]!.reason_codes).toContain('HOURS_UNKNOWN');
  });

  it('50m 안의 두 매장은 하나만 (나머지는 비슷한 후보로 묶임)', () => {
    const r = decide([s('A', 4, 'OPEN', 0.0001), s('A2', 4, 'OPEN', 0.0002, 290), s('B', 9, 'OPEN', 0.01)]);
    expect(r.candidates.map((c) => c.candidate_id)).toEqual(['A', 'B']);
    expect(r.pruned).toEqual([{ candidate_id: 'A2', similar_to: 'A' }]);
  });

  it('이동 한도를 줄이면 순위가 바뀐다, 같은 입력이면 같은 결과', () => {
    const stores = [s('A', 4, 'OPEN', 0.001), s('B', 12, 'OPEN', 0.002)];
    expect(decide(stores, 10).candidates.map((c) => c.candidate_id)).toEqual(['A']);
    expect(decide(stores).trace.decision_id).toBe(decide(stores).trace.decision_id);
  });

  it('남는 매장이 없으면 "가능한 매장 없음"과 모든 이유', () => {
    const r = decide([s('A', 3, 'CLOSED')]);
    expect(r.status).toBe('NO_FEASIBLE_CANDIDATE');
    expect(r.rejected[0]!.reason_codes).toEqual(['CLOSED_NOW']);
  });

  it('1km 넘는데 이동 시간을 모르면(대중교통 못 받음) 빼지 않고 "확인 필요"', () => {
    const far: StoreFacts = { ...s('F', 42, 'OPEN', 0.02, 2875) }; // 걷기 추정 42분
    const measured: StoreFacts = { ...s('M', 25, 'OPEN', 0.03, 2000), travel: { mode: 'TRANSIT', minutes: 25, source: 'ODSAY' } };
    const r = decide([far, measured]);
    expect(r.candidates.map((c) => c.candidate_id)).toEqual(['F']);
    expect(r.candidates[0]!.reason_codes).toContain('TRAVEL_UNKNOWN');
    expect(r.rejected).toEqual([{ candidate_id: 'M', reason_codes: ['TOO_FAR'] }]); // 실제로 잰 25분은 한도 초과로 빠짐
  });
});

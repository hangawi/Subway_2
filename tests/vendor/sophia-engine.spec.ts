import { describe, expect, it } from 'vitest';
import { DomainRegistry, runDecision, type DomainAdapter } from '../../vendor/sophia/pure_engine/decision-graph.ts';

// SOPHIA 공통 엔진을 이 저장소에서 불러와 쓸 수 있는지 확인하는 최소 시험.
interface Item {
  candidate_id: string;
  price: number;
}
interface ItemState {
  budget: number;
  items: Item[];
}

const cheapest: DomainAdapter<ItemState, Item> = {
  domain: 'subway_smoke',
  function_version: 'subway.smoke@1',
  action_types: ['PICK'],
  generate: (state) => state.items,
  hard: (state, c) => (c.price > state.budget ? ['OVER_BUDGET'] : []),
  evaluate: (_state, c) => ({ score_components: { price: -c.price / 1000 }, reason_codes: [] }),
  tieBreak: () => 0,
};

const request = (state: ItemState) => ({
  domain: 'subway_smoke',
  action_type: 'PICK',
  state,
  state_version: 1,
  policy_version: 1,
  reference_at: '2026-10-07T12:00:00+09:00',
  requested_top_n: 3,
  evidence_refs: [],
});

describe('SOPHIA 공통 엔진 (vendor)', () => {
  const registry = new DomainRegistry().register(cheapest);
  const state: ItemState = {
    budget: 9000,
    items: [
      { candidate_id: 'a', price: 8900 },
      { candidate_id: 'b', price: 7800 },
      { candidate_id: 'c', price: 9500 },
    ],
  };

  it('예산 초과는 빼고 싼 순서로 순위를 낸다', () => {
    const result = runDecision<ItemState, Item>(request(state), registry);
    expect(result.candidates.map((c) => c.candidate_id)).toEqual(['b', 'a']);
    expect(result.rejected).toEqual([{ candidate_id: 'c', reason_codes: ['OVER_BUDGET'] }]);
  });

  it('같은 입력이면 같은 결정 ID', () => {
    const a = runDecision<ItemState, Item>(request(state), registry);
    const b = runDecision<ItemState, Item>(request(state), registry);
    expect(a.trace.decision_id).toBe(b.trace.decision_id);
  });
});

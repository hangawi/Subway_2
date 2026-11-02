// Common Decision Graph contract shared by every domain (scheduling now; learning, food, field service and
// meetings later). The engine only sees normalized state; it never calls external APIs, the UI or the LLM.
// Same request (state, versions, reference time, top-N) → same decision_id, same order, same reasons.
export const DECISION_CONTRACT_VERSION = 1;
// v2: optional similarity pruning in ④ (a candidate too close to a better one is left out, kept in the graph).
export const DECISION_ENGINE_VERSION = 2;
export const DEFAULT_TOP_N = 3;
export const MAX_TOP_N = 10;

export interface DecisionRequest<S> {
  domain: string;
  action_type: string;
  // Normalized Common/Emotion (and domain) state. Built by State layers from Evidence, never by the engine.
  state: S;
  state_version: number;
  policy_version: number;
  // Reference time for anything time-dependent, so the same request is reproducible later.
  reference_at: string;
  requested_top_n: number;
  // Evidence ids the state was built from (kept for tracing, not re-read by the engine).
  evidence_refs: readonly string[];
}

export interface CandidateScore {
  // Named Soft components. The score is their sum, so every rank can be explained by its parts.
  score: number;
  score_components: Record<string, number>;
  reason_codes: string[];
}
export type RankedCandidateOf<C> = C & CandidateScore & { rank: number };

export interface DecisionTrace {
  contract_version: typeof DECISION_CONTRACT_VERSION;
  decision_id: string;
  input_digest: string;
  domain: string;
  action_type: string;
  versions: { engine: number; domain_function: string; policy: number; state: number };
  reference_at: string;
  requested_top_n: number;
  generated_count: number;
  viable_count: number;
  pruned_count: number;
  evidence_refs: string[];
}

export interface DecisionResult<C> {
  status: 'RANKED' | 'NO_FEASIBLE_CANDIDATE';
  candidates: Array<RankedCandidateOf<C>>;
  // Hard rejections are final: a rejected candidate is never revived by any Soft score.
  rejected: Array<{ candidate_id: string; reason_codes: string[] }>;
  // Viable candidates left out because a better-ranked one is too similar (④ pruning). Not rejected: they passed
  // every Hard constraint and are kept with the candidate they resemble.
  pruned: Array<{ candidate_id: string; similar_to: string }>;
  // DECISION_ROOT → each ranked candidate; a pruned candidate hangs under the one it resembles.
  graph: Array<{ from: string; to: string }>;
  trace: DecisionTrace;
}

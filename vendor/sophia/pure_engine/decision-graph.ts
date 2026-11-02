import {
  DECISION_CONTRACT_VERSION,
  DECISION_ENGINE_VERSION,
  MAX_TOP_N,
  type DecisionRequest,
  type DecisionResult,
  type RankedCandidateOf,
} from '../packages/contracts/src/decision-contract.ts';
import { canonicalJson, digest64 } from './canonical.ts';

// The one Decision Graph Core shared by every domain:
// ① generate → ② Hard constraints → ③ Soft evaluation → ④ graph and pruning → ⑤ ranking → ⑥ Top-N.
// Domains plug in through a registered adapter; this file never imports a domain. Candidates are created
// only here (by calling the adapter), never by Runtime, State, UI, LLM or Provider code.
export interface IdentifiedCandidate {
  candidate_id: string;
}
export interface DecisionContext {
  action_type: string;
  reference_at: string;
}
export interface SoftEvaluation {
  // Named components; the engine adds them up. No component may bring back a Hard-rejected candidate.
  score_components: Record<string, number>;
  reason_codes: string[];
}
export interface DomainAdapter<S, C extends IdentifiedCandidate> {
  domain: string;
  // Bumped whenever generate/hard/evaluate change, so old decisions stay explainable.
  function_version: string;
  action_types: readonly string[];
  generate(state: S, context: DecisionContext): Iterable<C>;
  hard(state: S, candidate: C, context: DecisionContext): string[];
  evaluate(state: S, candidate: C, context: DecisionContext): SoftEvaluation;
  tieBreak(a: C, b: C): number;
  // ④ Optional: a candidate too close to a better one (e.g. 18:00 and 18:30 on the same evening) is pruned, so the
  // Top-N are real alternatives. Both passed Hard; only the better-ranked one is offered.
  similar?(a: C, b: C): boolean;
}

export class DomainRegistry {
  private readonly adapters = new Map<string, DomainAdapter<unknown, IdentifiedCandidate>>();

  register<S, C extends IdentifiedCandidate>(adapter: DomainAdapter<S, C>): this {
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(adapter.domain)) throw new Error('INVALID_DOMAIN_ID');
    if (this.adapters.has(adapter.domain)) throw new Error(`DOMAIN_ALREADY_REGISTERED:${adapter.domain}`);
    if (!adapter.function_version || !adapter.action_types.length) throw new Error('INVALID_DOMAIN_ADAPTER');
    this.adapters.set(adapter.domain, adapter as unknown as DomainAdapter<unknown, IdentifiedCandidate>);
    return this;
  }
  get<S, C extends IdentifiedCandidate>(domain: string): DomainAdapter<S, C> {
    const adapter = this.adapters.get(domain);
    if (!adapter) throw new Error(`DOMAIN_NOT_REGISTERED:${domain}`);
    return adapter as unknown as DomainAdapter<S, C>;
  }
  domains(): string[] {
    return [...this.adapters.keys()].sort();
  }
}

// Fixed rounding so a sum of the same components always compares the same on every device.
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function runDecision<S, C extends IdentifiedCandidate>(
  request: DecisionRequest<S>,
  registry: DomainRegistry,
): DecisionResult<C> {
  const adapter = registry.get<S, C>(request.domain);
  if (!adapter.action_types.includes(request.action_type))
    throw new Error(`ACTION_TYPE_NOT_SUPPORTED:${request.domain}:${request.action_type}`);
  const topN = request.requested_top_n;
  if (!Number.isInteger(topN) || topN < 1 || topN > MAX_TOP_N) throw new Error('INVALID_TOP_N');
  if (!Number.isFinite(Date.parse(request.reference_at))) throw new Error('INVALID_REFERENCE_AT');
  if (!Number.isSafeInteger(request.state_version) || !Number.isSafeInteger(request.policy_version))
    throw new Error('INVALID_VERSION');

  const context: DecisionContext = { action_type: request.action_type, reference_at: request.reference_at };
  const generated = [...adapter.generate(request.state, context)];
  const rejected: Array<{ candidate_id: string; reason_codes: string[] }> = [];
  const viable: Array<C & { score: number; score_components: Record<string, number>; reason_codes: string[] }> = [];
  for (const candidate of generated) {
    const reasons = adapter.hard(request.state, candidate, context);
    if (reasons.length) {
      rejected.push({ candidate_id: candidate.candidate_id, reason_codes: [...reasons] });
      continue;
    }
    const soft = adapter.evaluate(request.state, candidate, context);
    const names = Object.keys(soft.score_components).sort();
    for (const name of names)
      if (!Number.isFinite(soft.score_components[name])) throw new Error(`INVALID_SCORE_COMPONENT:${name}`);
    const score = round(names.reduce((sum, name) => sum + soft.score_components[name]!, 0));
    viable.push({
      ...candidate,
      score,
      score_components: { ...soft.score_components },
      reason_codes: [...soft.reason_codes],
    });
  }

  const unique = new Map<string, (typeof viable)[number]>();
  let pruned = 0;
  for (const candidate of viable) {
    if (unique.has(candidate.candidate_id)) {
      pruned++;
      continue;
    }
    unique.set(candidate.candidate_id, candidate);
  }
  const ordered = [...unique.values()].sort(
    (a, b) =>
      b.score - a.score ||
      adapter.tieBreak(a, b) ||
      (a.candidate_id < b.candidate_id ? -1 : a.candidate_id > b.candidate_id ? 1 : 0),
  );
  // ④ Graph and pruning: walk from the best; a candidate similar to one already kept hangs under it instead.
  const kept: typeof ordered = [];
  const similar: Array<{ candidate_id: string; similar_to: string }> = [];
  const graph: Array<{ from: string; to: string }> = [];
  for (const candidate of ordered) {
    const near = adapter.similar ? kept.find((k) => adapter.similar!(k, candidate)) : undefined;
    if (near) {
      similar.push({ candidate_id: candidate.candidate_id, similar_to: near.candidate_id });
      graph.push({ from: near.candidate_id, to: candidate.candidate_id });
      continue;
    }
    kept.push(candidate);
    graph.unshift({ from: 'DECISION_ROOT', to: candidate.candidate_id });
  }
  pruned += similar.length;
  const ranked: Array<RankedCandidateOf<C>> = kept.slice(0, topN).map((c, i) => ({ ...c, rank: i + 1 }));

  const versions = {
    engine: DECISION_ENGINE_VERSION,
    domain_function: adapter.function_version,
    policy: request.policy_version,
    state: request.state_version,
  };
  const evidenceRefs = [...request.evidence_refs].sort();
  const inputDigest = digest64(
    canonicalJson({
      contract_version: DECISION_CONTRACT_VERSION,
      domain: request.domain,
      action_type: request.action_type,
      versions,
      reference_at: request.reference_at,
      requested_top_n: topN,
      evidence_refs: evidenceRefs,
      state: request.state,
    }),
  );
  return {
    status: ranked.length ? 'RANKED' : 'NO_FEASIBLE_CANDIDATE',
    candidates: ranked,
    rejected,
    pruned: similar,
    graph,
    trace: {
      contract_version: DECISION_CONTRACT_VERSION,
      decision_id: `dec:${request.domain}:${inputDigest}`,
      input_digest: inputDigest,
      domain: request.domain,
      action_type: request.action_type,
      versions,
      reference_at: request.reference_at,
      requested_top_n: topN,
      generated_count: generated.length,
      viable_count: unique.size,
      pruned_count: pruned,
      evidence_refs: evidenceRefs,
    },
  };
}

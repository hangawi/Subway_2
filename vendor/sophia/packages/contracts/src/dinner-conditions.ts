import type { DataStamp } from './place-contract.ts';

// User-stated meal conditions only. Never infer health conditions or attendance from these values.
export interface DinnerConditions {
  party_size: number | null;
  budget_won: number | null;
  budget_scope: 'PER_PERSON' | 'TOTAL' | 'UNSPECIFIED';
  dietary: string | null;
}
export const DINNER_CONDITION_CLEARS = ['party_size', 'budget', 'dietary'] as const;
export type DinnerConditionClear = (typeof DINNER_CONDITION_CLEARS)[number];
export const emptyDinnerConditions = (): DinnerConditions => ({
  party_size: null,
  budget_won: null,
  budget_scope: 'PER_PERSON',
  dietary: null,
});
export interface RestaurantFacts {
  price_min_won: number | null;
  price_max_won: number | null;
  vegetarian: boolean | null;
  groups: boolean | null;
  reservable: boolean | null;
}
export interface DinnerVenueCheck {
  run_id: string;
  candidate_id: string;
  per_person_won: number | null;
  party_available: boolean | null;
  dietary_available: boolean | null;
  source: string;
}
export interface DinnerVenueEvidence extends Omit<DinnerVenueCheck, 'run_id'> {
  checked_at: string;
  expires_at: string;
}
export interface DinnerFoodEvidence {
  facts: RestaurantFacts | null;
  stamp: DataStamp | null;
  checked: DinnerVenueEvidence | null;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, max: number) =>
  v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max);
export function parseDinnerConditions(v: unknown): DinnerConditions {
  if (
    !object(v) ||
    Object.keys(v).some((k) => !['party_size', 'budget_won', 'budget_scope', 'dietary'].includes(k)) ||
    !integer(v.party_size, 100) ||
    !integer(v.budget_won, 100_000_000) ||
    !['PER_PERSON', 'TOTAL', 'UNSPECIFIED'].includes(String(v.budget_scope)) ||
    (v.dietary !== null && (typeof v.dietary !== 'string' || v.dietary.trim().length > 100))
  )
    throw new Error('INVALID_DINNER_REQUEST');
  return {
    party_size: v.party_size as number | null,
    budget_won: v.budget_won as number | null,
    budget_scope: v.budget_scope as DinnerConditions['budget_scope'],
    dietary: typeof v.dietary === 'string' ? v.dietary.trim() || null : null,
  };
}
export function parseDinnerVenueCheck(v: unknown): DinnerVenueCheck {
  if (
    !object(v) ||
    Object.keys(v).some(
      (k) =>
        !['run_id', 'candidate_id', 'per_person_won', 'party_available', 'dietary_available', 'source'].includes(k),
    ) ||
    typeof v.run_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.run_id) ||
    typeof v.candidate_id !== 'string' ||
    !v.candidate_id ||
    v.candidate_id.length > 200 ||
    !integer(v.per_person_won, 100_000_000) ||
    ![null, true, false].includes(v.party_available as null) ||
    ![null, true, false].includes(v.dietary_available as null) ||
    typeof v.source !== 'string' ||
    v.source.trim().length < 2 ||
    v.source.trim().length > 120
  )
    throw new Error('INVALID_DINNER_REQUEST');
  return {
    run_id: v.run_id.toLowerCase(),
    candidate_id: v.candidate_id,
    per_person_won: v.per_person_won as number | null,
    party_available: v.party_available as boolean | null,
    dietary_available: v.dietary_available as boolean | null,
    source: v.source.trim(),
  };
}
export function hasDinnerConditions(c: DinnerConditions | undefined): boolean {
  return !!c && (c.party_size !== null || c.budget_won !== null || !!c.dietary);
}
export function missingDinnerCondition(c: DinnerConditions): 'budget_scope' | 'party_size' | null {
  if (c.budget_won === null) return null;
  if (c.budget_scope === 'UNSPECIFIED') return 'budget_scope';
  return c.budget_scope === 'TOTAL' && c.party_size === null ? 'party_size' : null;
}
export function dinnerConditionSummary(c: DinnerConditions | undefined): string {
  if (!c) return '';
  return [
    c.party_size ? `${c.party_size}명` : '',
    c.budget_won
      ? `${c.budget_scope === 'TOTAL' ? '전체' : c.budget_scope === 'PER_PERSON' ? '1인' : '기준 미정'} ${c.budget_won.toLocaleString('ko-KR')}원 이내`
      : '',
    c.dietary ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
}

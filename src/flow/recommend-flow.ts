// 한 번의 추천 흐름: 위치 → 근처 써브웨이 → 영업·이동 시간 → 매장 고르기(엔진) → 메뉴 Top3(엔진, 시간대 반영).
// 위치를 못 정하거나 매장이 없으면 그 단계에서 멈추고 이유를 돌려준다 (화면이 다음 행동을 보여 줌).
import type { DecisionResult } from '../../vendor/sophia/packages/contracts/src/decision-contract.ts';
import { runDecision } from '../../vendor/sophia/pure_engine/decision-graph.ts';
import type { PlaceDataProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';
import { loadSubwayCatalog, type SubwayCatalog } from '../catalog/subway-catalog.ts';
import { SUBWAY_DOMAINS } from '../engine/registry.ts';
import { resolveLocation, type LocationInput, type LocationResult } from '../location/resolve-location.ts';
import { findSubwayStores } from '../stores/find-stores.ts';
import { storeFacts, transitLeft, type FactSources } from '../stores/store-facts.ts';
import { RECOMMEND_MENU, SUBWAY_MENU_DOMAIN, type MenuCandidate, type MenuState } from '../subway-menu/menu-domain.ts';
import { DEFAULT_MAX_TRAVEL_MIN, RECOMMEND_STORE, SUBWAY_STORE_DOMAIN, type StoreCandidate, type StoreState } from '../subway-store/store-domain.ts';
import { mealTimeOf } from '../time/meal-time.ts';

export type MenuPrefs = Omit<MenuState, 'menus' | 'moment' | 'parts'>;

export interface FlowInput {
  location: LocationInput;
  places: PlaceDataProvider;
  sources: FactSources;
  referenceAt: string;
  prefs: MenuPrefs;
  maxTravelMin?: number;
  /** 메뉴 데이터 (서버는 시작할 때 한 번 읽은 것을 넘긴다). 없으면 기본 위치에서 읽는다 */
  catalog?: SubwayCatalog;
  byCar?: boolean;
}

export type FlowResult =
  | { step: 'LOCATION'; location: Exclude<LocationResult, { status: 'OK' }> }
  | { step: 'STORES'; status: 'NONE' | 'FAILED' }
  | {
      step: 'DONE';
      label: string;
      /** 정한 위치 (화면이 다음 추천에 다시 씀) */
      point: { lat: number; lng: number };
      store: DecisionResult<StoreCandidate>;
      menu: DecisionResult<MenuCandidate>;
      /** ODsay 오늘 남은 횟수 (화면에 표시). 모르면 null */
      transitLeft: { left: number; limit: number } | null;
    };

const request = <S>(domain: string, action_type: string, state: S, reference_at: string) => ({
  domain, action_type, state, state_version: 1, policy_version: 1, reference_at, requested_top_n: 3, evidence_refs: [],
});

export async function recommendFlow(input: FlowInput): Promise<FlowResult> {
  const loc = await resolveLocation(input.location, input.places);
  if (loc.status !== 'OK') return { step: 'LOCATION', location: loc };
  const found = await findSubwayStores(loc.point, input.places);
  if (found.status !== 'OK') return { step: 'STORES', status: found.status };
  const stores = await storeFacts(loc.point, found.stores, input.sources, input.referenceAt, { byCar: input.byCar === true });
  const store = runDecision<StoreState, StoreCandidate>(
    request(SUBWAY_STORE_DOMAIN, RECOMMEND_STORE, { stores, maxTravelMin: input.maxTravelMin ?? DEFAULT_MAX_TRAVEL_MIN }, input.referenceAt),
    SUBWAY_DOMAINS,
  );
  const catalog = input.catalog ?? loadSubwayCatalog();
  const menu = runDecision<MenuState, MenuCandidate>(
    request(SUBWAY_MENU_DOMAIN, RECOMMEND_MENU, { ...input.prefs, menus: catalog.menus, parts: catalog, moment: mealTimeOf(input.referenceAt) }, input.referenceAt),
    SUBWAY_DOMAINS,
  );
  return { step: 'DONE', label: loc.label, point: loc.point, store, menu, transitLeft: transitLeft(input.sources.transit) };
}

// 외부 자료 짧게 보관하기 (10/15 점검): 조건 버튼을 한 번 누를 때마다 매장 15곳의 영업시간(Google)·걷기 경로(TMAP)를
// 다시 물어서 비용이 들고, TMAP 하루 한도(써브웨이 몫 300번)가 버튼 20번쯤에 끝나던 문제.
// 성공한 응답만 보관하고(실패·한도 초과는 다음에 다시 물음), 보관 시간이 지나면 새로 묻는다. 메모리만 (재시작하면 비움).
import type { GeoPoint } from '../../vendor/sophia/packages/contracts/src/place-contract.ts';
import type { DataOutcome, HoursProvider, PlaceDataProvider, RouteProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';

export const MINUTE = 60_000;
export const HOURS_KEEP_MS = 30 * MINUTE; // 영업시간: 매장이 바꿀 수 있어 짧게 (Google이 알려 준 6시간보다 짧음)
export const WALK_KEEP_MS = 30 * MINUTE; // 걷기 경로: 길은 잘 안 바뀜
export const NEARBY_KEEP_MS = 5 * MINUTE; // 근처 매장 목록
const MAX_KEYS = 2000;

export function keepFor<A extends unknown[], T>(
  fn: (...a: A) => Promise<DataOutcome<T>>,
  keyOf: (...a: A) => string,
  ms: number,
  clock: () => number = Date.now,
): (...a: A) => Promise<DataOutcome<T>> {
  const kept = new Map<string, { until: number; value: DataOutcome<T> }>();
  return async (...a: A) => {
    const key = keyOf(...a);
    const now = clock();
    const hit = kept.get(key);
    if (hit && hit.until > now) return hit.value;
    const value = await fn(...a);
    if (value.ok) {
      if (kept.size >= MAX_KEYS) kept.delete(kept.keys().next().value!); // 가장 오래된 것부터
      kept.set(key, { until: now + ms, value });
    } else kept.delete(key);
    return value;
  };
}

// 좌표는 소수 넷째 자리(약 10m)로 묶는다 — 같은 자리에서 버튼만 바꾼 경우를 같은 요청으로
const at = (p: GeoPoint) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

export function keepHours(p: HoursProvider, clock?: () => number): HoursProvider {
  return { ...p, hours: keepFor((name: string, near: GeoPoint) => p.hours(name, near), (name, near) => `${name}@${at(near)}`, HOURS_KEEP_MS, clock) };
}

/** 걷기만 (출발 시각을 안 씀). 대중교통은 시각마다 달라 보관하지 않는다 */
export function keepWalk(p: RouteProvider, clock?: () => number): RouteProvider {
  const route = keepFor(
    (from: GeoPoint, to: GeoPoint, departAt: string | null) => p.route(from, to, departAt),
    (from, to, departAt) => `${at(from)}>${at(to)}${departAt ? `@${departAt}` : ''}`,
    WALK_KEEP_MS,
    clock,
  );
  return { ...p, route: (from, to, departAt) => route(from, to, departAt) };
}

export function keepNearby(p: PlaceDataProvider, clock?: () => number): PlaceDataProvider {
  const nearby = keepFor(
    (kind: Parameters<PlaceDataProvider['nearby']>[0], center: GeoPoint, radiusM: number, menu?: string) => p.nearby(kind, center, radiusM, menu),
    (kind, center, radiusM, menu) => `${kind}:${menu ?? ''}:${radiusM}@${at(center)}`,
    NEARBY_KEEP_MS,
    clock,
  );
  return { ...p, nearby: (kind, center, radiusM, menu) => nearby(kind, center, radiusM, menu) };
}

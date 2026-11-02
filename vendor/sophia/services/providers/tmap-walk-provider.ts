import type { DailyQuota } from './daily-quota.ts';
import { failed, fetchJson, HOUR, stamp, type FetchLike, type RouteProvider } from './place-data-provider.ts';

// TMAP pedestrian route estimate; not real-time closures or an accessibility guarantee.
export function createTmapWalkProvider(options: {
  api_key: string;
  fetcher?: FetchLike;
  clock?: () => number;
  quota?: DailyQuota;
}): RouteProvider {
  const fetcher = options.fetcher ?? ((u, i) => fetch(u, i));
  const clock = options.clock ?? Date.now;
  return {
    name: 'tmap-walk',
    modes: ['WALK'],
    ...(options.quota ? { usage: () => ({ used: options.quota!.used(), limit: options.quota!.limit }) } : {}),
    async route(from, to) {
      if (options.quota && !options.quota.take()) return failed('QUOTA_EXCEEDED');
      const r = await fetchJson(fetcher, 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json', appKey: options.api_key },
        body: JSON.stringify({
          startX: from.lng,
          startY: from.lat,
          endX: to.lng,
          endY: to.lat,
          startName: 'start',
          endName: 'end',
          reqCoordType: 'WGS84GEO',
          resCoordType: 'WGS84GEO',
          searchOption: '0',
        }),
      });
      if (!r.ok) return r;
      const data = r.body as {
        type?: unknown;
        features?: Array<{ properties?: { pointType?: unknown; totalTime?: unknown; totalDistance?: unknown } }>;
      };
      const first = Array.isArray(data?.features)
        ? data.features.find((f) => f?.properties?.pointType === 'SP')?.properties
        : undefined;
      const seconds = first?.totalTime,
        distance = first?.totalDistance;
      if (
        data?.type !== 'FeatureCollection' ||
        typeof seconds !== 'number' ||
        !Number.isFinite(seconds) ||
        seconds <= 0 ||
        typeof distance !== 'number' ||
        !Number.isFinite(distance) ||
        distance < 0
      )
        return failed('INVALID_RESPONSE');
      return {
        ok: true,
        data: { minutes: Math.ceil(seconds / 60), distance_m: distance, too_close: false },
        stamp: stamp('tmap-walk', true, clock(), HOUR),
      };
    },
  };
}

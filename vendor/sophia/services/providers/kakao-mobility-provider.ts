import { failed, fetchJson, HOUR, stamp, type FetchLike, type RouteProvider } from './place-data-provider.ts';

// 카카오모빌리티 길찾기 (https://developers.kakaomobility.com): driving time. With a future departure time the
// "미래 운행 정보" endpoint is used, so the time reflects the hour of the meeting. Key: SOPHIA_KAKAO_REST_API_KEY
// (the same app, with 카카오내비 API enabled). Parking is looked up separately (places around the destination).
const BASE = 'https://apis-navi.kakaomobility.com/v1';
const ROUTE_TTL = 24 * HOUR;
const seoulStamp = (iso: string) => {
  const d = new Date(Date.parse(iso) + 9 * HOUR);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
};

export function createKakaoMobilityProvider(options: {
  api_key: string;
  fetcher?: FetchLike;
  clock?: () => number;
}): RouteProvider {
  const fetcher = options.fetcher ?? ((u, i) => fetch(u, i));
  const clock = options.clock ?? Date.now;
  return {
    name: 'kakao-mobility',
    modes: ['CAR'],
    async route(from, to, departAt) {
      const future = departAt !== null && Date.parse(departAt) > clock() + 10 * 60_000;
      const params = new URLSearchParams({
        origin: `${from.lng},${from.lat}`,
        destination: `${to.lng},${to.lat}`,
        ...(future ? { departure_time: seoulStamp(departAt) } : {}),
      });
      const r = await fetchJson(fetcher, `${BASE}/${future ? 'future/directions' : 'directions'}?${params}`, {
        headers: { authorization: `KakaoAK ${options.api_key}` },
      });
      if (!r.ok) return r;
      const route = (
        r.body as { routes?: Array<{ result_code?: unknown; summary?: { duration?: unknown; distance?: unknown } }> }
      ).routes?.[0];
      if (!route) return failed('INVALID_RESPONSE');
      const s = stamp('kakao-mobility', true, clock(), ROUTE_TTL);
      // 104: origin and destination are within 5 m; other non-zero codes: no route found.
      if (route.result_code === 104)
        return { ok: true, data: { minutes: null, distance_m: 0, too_close: true }, stamp: s };
      if (route.result_code !== 0)
        return { ok: true, data: { minutes: null, distance_m: null, too_close: false }, stamp: s };
      const seconds = Number(route.summary?.duration);
      const distance = Number(route.summary?.distance);
      if (!Number.isFinite(seconds) || seconds < 0) return failed('INVALID_RESPONSE');
      return {
        ok: true,
        data: {
          minutes: Math.max(1, Math.round(seconds / 60)),
          distance_m: Number.isFinite(distance) ? distance : null,
          too_close: false,
        },
        stamp: s,
      };
    },
  };
}

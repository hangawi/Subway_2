import type { TransitSchedule } from '../contracts/src/transit-contract.ts';
import {
  distanceM,
  type BikeRoad,
  type GeoPoint,
  type GeocodedAddress,
  type PlaceRecord,
  type PublicParkingLot,
  type TrailNetwork,
} from '../contracts/src/place-contract.ts';
import {
  failed,
  HOUR,
  stamp,
  type NearbyPlace,
  type PlaceProviders,
  type RouteProvider,
} from '../../services/providers/place-data-provider.ts';
import { readShowSchedule } from '../../domains/scheduling/show-times.ts';

// Test data for places, routes and weather (live=false: the screen says 시험용 자료, never real information). Used
// by the e2e/dev server and integration tests only. Names say "시험" so they are never taken for real places.
const CENTER = { lat: 37.5, lng: 127.0 };
const at = (dLat: number, dLng: number): GeoPoint => ({
  lat: Math.round((CENTER.lat + dLat) * 1e6) / 1e6,
  lng: Math.round((CENTER.lng + dLng) * 1e6) / 1e6,
});
const place = (id: string, name: string, point: GeoPoint, category: string): PlaceRecord => ({
  place_id: `test:${id}`,
  name,
  category,
  address: `시험시 ${name}`,
  point,
  phone: null,
  url: null,
});
// Starting points people can search for, and stations spread around the centre.
export const SCRIPTED_ORIGINS = [
  place('home-east', '시험 동쪽 집', at(0, 0.06), '주거'),
  place('home-west', '시험 서쪽 집', at(0, -0.06), '주거'),
  place('home-north', '시험 북쪽 회사', at(0.05, 0), '회사'),
];
const STATIONS = [
  place('st-center', '시험 가운데역', at(0.001, 0.001), '교통 > 지하철역'),
  place('st-east', '시험 동역', at(0, 0.02), '교통 > 지하철역'),
  place('st-west', '시험 서역', at(0, -0.02), '교통 > 지하철역'),
  place('st-far', '시험 먼역', at(-0.025, 0), '교통 > 지하철역'),
];
// Review-sheet names exercise real provider response shapes, but coordinates remain synthetic.
// These records are available only through this live=false test provider.
const REVIEW_STATIONS = [
  place('review-gangbyeon', '강변역 2호선', SCRIPTED_ORIGINS[0]!.point, '교통 > 지하철역'),
  place('review-uijeongbu', '의정부역 1호선', SCRIPTED_ORIGINS[1]!.point, '교통 > 지하철역'),
  place('review-gangnam-2', '강남역 2호선', SCRIPTED_ORIGINS[2]!.point, '교통 > 지하철역'),
  place('review-gangnam-sin', '강남역 신분당선', at(0.0501, 0), '교통 > 지하철역'),
];
const REVIEW_REGION: GeocodedAddress = {
  address_type: 'REGION',
  address_name: '서울 강남구 압구정동',
  point: STATIONS[0]!.point,
  region_names: ['압구정동'],
  address_aliases: ['서울 강남구 압구정동'],
};
const REVIEW_SHOPS = [
  place('review-apgujeong-food', '시험 압구정 식당', at(0.002, 0.004), '음식점'),
  place('review-apgujeong-cafe', '시험 압구정 카페', at(0.003, 0.005), '음식점 > 카페'),
];
const VENUE_KINDS = [
  ['FOOD', '음식점 > 한식 > 육류,고기', '고깃집'],
  ['FOOD', '음식점 > 중식', '중국집'],
  ['FOOD', '음식점 > 한식 > 국수', '국숫집'],
  ['CAFE', '음식점 > 카페', '카페'],
  ['CAFE', '음식점 > 카페 > 디저트카페', '디저트'],
  ['BAR', '음식점 > 술집 > 호프,요리주점', '호프'],
  ['BAR', '음식점 > 술집 > 이자카야', '이자카야'],
  ['THEATER', '문화,예술 > 공연장 > 소극장', '소극장'],
  ['CINEMA', '문화,예술 > 영화,영상 > 영화관', '영화관'],
] as const;
// 10/7 performances by theatre name: 시험 소극장 1 runs 시험 연극 (화～금 20:00, 토·일 15:00·19:00, 100 minutes) all
// year; 시험 소극장 2 runs 시험 뮤지컬 whose times are published as a sentence (not read → a check for a person).
const PLAYS = [
  {
    theatre: '시험 소극장 1',
    show_id: 'test:show-play',
    title: '시험 연극',
    genre: '연극',
    runtime_min: 100,
    times_text: '화요일 ~ 금요일(20:00), 토요일 ~ 일요일(15:00,19:00)',
    price: '전석 30,000원',
    age: '만 13세 이상',
  },
  {
    theatre: '시험 소극장 2',
    show_id: 'test:show-musical',
    title: '시험 뮤지컬',
    genre: '뮤지컬',
    runtime_min: null,
    times_text: '공연 시간은 예매처에서 확인해 주세요',
    price: null,
    age: null,
  },
];
// Films now showing (the box office of the day before): two fit a two-and-a-half-hour activity, one does not.
const FILMS = [
  { movie_id: 'test:film-1', title: '시험 영화 하나', rank: 1, runtime_min: 118, rating: '12세이상관람가' },
  { movie_id: 'test:film-2', title: '시험 영화 둘', rank: 2, runtime_min: 95, rating: '전체관람가' },
  { movie_id: 'test:film-3', title: '시험 영화 셋', rank: 3, runtime_min: 165, rating: '15세이상관람가' },
];

// Hiking trails around any place (like the venues): 시험산 — a trail end about 450 m away, a junction, the summit
// (75 trail minutes up and down) and a far summit too long for a half-day hike; 시험 둘레산 — a viewpoint only, one
// segment without published minutes.
function trailsAround(c: GeoPoint): TrailNetwork[] {
  const p = (dLat: number, dLng: number): GeoPoint => ({
    lat: Math.round((c.lat + dLat) * 1e6) / 1e6,
    lng: Math.round((c.lng + dLng) * 1e6) / 1e6,
  });
  return [
    {
      mountain_id: 'test:mountain-1',
      mountain: '시험산',
      nodes: [p(0.003, 0.003), p(0.007, 0.005), p(0.012, 0.007), p(0.009, 0.014), p(0.035, 0.01)],
      segments: [
        { from: 0, to: 1, length_m: 600, up_min: 15, down_min: 10, difficulty: 'EASY', risk: null },
        {
          from: 1,
          to: 2,
          length_m: 800,
          up_min: 30,
          down_min: 20,
          difficulty: 'MODERATE',
          risk: '바위 구간 미끄럼 주의',
        },
        { from: 1, to: 3, length_m: 900, up_min: 20, down_min: 15, difficulty: 'EASY', risk: null },
        { from: 2, to: 4, length_m: 3000, up_min: 120, down_min: 90, difficulty: 'HARD', risk: null },
      ],
      destinations: [
        { node: 2, label: '시험산 정상', kind: 'SUMMIT' },
        { node: 4, label: '시험 큰봉우리', kind: 'SUMMIT' },
      ],
      facilities: [{ point: p(0.0031, 0.0031), kind: 'TOILET' }],
    },
    {
      mountain_id: 'test:mountain-2',
      mountain: '시험 둘레산',
      nodes: [p(-0.008, -0.008), p(-0.011, -0.012)],
      segments: [{ from: 0, to: 1, length_m: 500, up_min: null, down_min: null, difficulty: null, risk: null }],
      destinations: [{ node: 1, label: '시험 둘레산 전망 지점', kind: 'VIEWPOINT' }],
      facilities: [],
    },
  ];
}

// Bicycle roads around any place: a 4 km road for bikes only starting about 600 m away, and a 15 km road shared with
// people walking (too long for a two-hour ride at the easy pace).
function bikeRoadsAround(c: GeoPoint): BikeRoad[] {
  const p = (dLat: number, dLng: number): GeoPoint => ({
    lat: Math.round((c.lat + dLat) * 1e6) / 1e6,
    lng: Math.round((c.lng + dLng) * 1e6) / 1e6,
  });
  const road = (id: string, name: string, kind: BikeRoad['kind'], length: number, start: GeoPoint, end: GeoPoint) => ({
    road_id: `test:${id}`,
    name,
    area: '시험시 시험구',
    kind,
    width_m: 2.5,
    length_m: length,
    start,
    end,
    both_sides: false,
    manager: '시험구청',
    phone: null,
    as_of: '2025-02-20',
  });
  return [
    road('bike-1', '시험 강변 자전거길', 'DEDICATED', 4000, p(-0.004, 0.004), p(-0.03, 0.03)),
    road('bike-2', '시험 둘레 자전거길', 'SHARED_WITH_WALKERS', 15000, p(0.007, -0.005), p(0.1, -0.1)),
  ];
}

// Published parking lots: by the east station a lot open all day (paid) and a market lot open weekdays 09:00～20:00
// (free, closed Saturdays); by the far station a lot open weekdays 08:00～18:00 only. Nothing by the others.
const allDay = { open_min: 0, close_min: 1440 };
const PARKING_LOTS: PublicParkingLot[] = [
  {
    lot_id: 'test:lot-east-1',
    name: '시험 동역 공영주차장',
    operator: 'PUBLIC',
    type: 'OFF_STREET',
    spaces: 120,
    point: { lat: 37.5005, lng: 127.0205 },
    address: '시험시 동역로 1',
    hours: { weekday: allDay, saturday: allDay, holiday: allDay },
    fee: { kind: 'PAID', base_min: 30, base_won: 1000, unit_min: 10, unit_won: 500, day_won: 15000 },
    restriction: null,
    phone: '000-0000-0001',
    as_of: '2026-04-16',
  },
  {
    lot_id: 'test:lot-east-2',
    name: '시험 시장 주차장',
    operator: 'PUBLIC',
    type: 'OFF_STREET',
    spaces: 30,
    point: { lat: 37.4995, lng: 127.0198 },
    address: null,
    hours: { weekday: { open_min: 540, close_min: 1200 }, saturday: 'CLOSED', holiday: 'CLOSED' },
    fee: { kind: 'FREE', base_min: null, base_won: null, unit_min: null, unit_won: null, day_won: null },
    restriction: '5부제',
    phone: null,
    as_of: '2025-02-20',
  },
  {
    lot_id: 'test:lot-far',
    name: '시험 먼역 주차장',
    operator: 'PUBLIC',
    type: 'ON_STREET',
    spaces: 15,
    point: { lat: 37.4752, lng: 127.0003 },
    address: null,
    hours: { weekday: { open_min: 480, close_min: 1080 }, saturday: 'CLOSED', holiday: 'CLOSED' },
    fee: { kind: 'FREE', base_min: null, base_won: null, unit_min: null, unit_won: null, day_won: null },
    restriction: null,
    phone: null,
    as_of: '2026-04-16',
  },
];

// Synthetic timetable for local tests only. The enclosing provider stamp always has live=false.
export function scriptedTransitSchedule(at: string, minutes: number): TransitSchedule {
  return {
    status: 'AVAILABLE',
    requested_departure: at,
    departure_at: at,
    arrival_at: new Date(Date.parse(at) + minutes * 60_000).toISOString(),
    transfers: 1,
    basis: 'TIMETABLE',
    realtime: false,
  };
}
export function scriptedPlaceProviders(options: { clock?: () => number } = {}): PlaceProviders {
  const clock = options.clock ?? Date.now;
  const s = (ttl: number) => stamp('test-fixture', false, clock(), ttl);
  const near = (list: PlaceRecord[], center: GeoPoint, radius: number): NearbyPlace[] =>
    list
      .map((p) => ({ ...p, distance_m: distanceM(center, p.point) }))
      .filter((p) => p.distance_m <= radius)
      .sort((a, b) => a.distance_m - b.distance_m);
  const venuesAround = (center: GeoPoint, kind: string): PlaceRecord[] =>
    VENUE_KINDS.flatMap(([k, category, label], i) =>
      (k === kind ? [0, 1] : []).map((j) =>
        place(
          `${kind}-${i}-${j}-${center.lat.toFixed(3)}-${center.lng.toFixed(3)}`.replace(/\./g, '_'),
          `시험 ${label} ${j + 1}`,
          { lat: center.lat + 0.001 * (i + 1) * (j ? -1 : 1), lng: center.lng + 0.0015 * (j + 1) },
          category,
        ),
      ),
    );
  const route = (mode: 'TRANSIT' | 'CAR' | 'WALK', perKm: number, base: number): RouteProvider => ({
    name: `test-${mode.toLowerCase()}`,
    modes: [mode],
    async route(from, to, at) {
      const m = distanceM(from, to);
      if (mode === 'TRANSIT' && m < 700 && !at)
        return { ok: true, data: { minutes: null, distance_m: m, too_close: true }, stamp: s(24 * HOUR) };
      return {
        ok: true,
        data: {
          minutes: Math.round(base + (m / 1000) * perKm),
          distance_m: m,
          too_close: false,
          ...(mode === 'TRANSIT' && at
            ? { schedule: scriptedTransitSchedule(at, Math.round(base + (m / 1000) * perKm)) }
            : {}),
        },
        stamp: s(24 * HOUR),
      };
    },
  });
  return {
    places: {
      name: 'test-places',
      async search(query) {
        // A keyword query for the area returns shops, not a fictitious exact-name region venue.
        if (query.trim() === '압구정') return { ok: true, data: REVIEW_SHOPS, stamp: s(7 * 24 * HOUR) };
        const reviewStations = REVIEW_STATIONS.filter((p) => p.name.startsWith(`${query.trim()} `));
        if (reviewStations.length) return { ok: true, data: reviewStations, stamp: s(7 * 24 * HOUR) };
        const all = [...SCRIPTED_ORIGINS, ...STATIONS];
        const found = all.filter((p) => p.name.includes(query.trim()) || query.trim() === '시험');
        return { ok: true, data: found, stamp: s(7 * 24 * HOUR) };
      },
      async searchAddress(query) {
        return {
          ok: true,
          data: { addresses: query.trim() === '압구정' ? [REVIEW_REGION] : [], complete: true },
          stamp: s(7 * 24 * HOUR),
        };
      },
      async nearby(kind, center, radius, menu) {
        if (kind === 'SUBWAY') return { ok: true, data: near(STATIONS, center, radius), stamp: s(7 * 24 * HOUR) };
        // Parking only around the east station (others: none found).
        if (kind === 'PARKING')
          return {
            ok: true,
            data:
              distanceM(center, STATIONS[1]!.point) < 300
                ? near([place('pk-east', '시험 주차장', at(0, 0.021), '주차장')], center, radius)
                : [],
            stamp: s(7 * 24 * HOUR),
          };
        return {
          ok: true,
          data: near(venuesAround(center, kind), center, radius).filter(
            (v) => !menu || `${v.category} ${v.name}`.includes(menu),
          ),
          stamp: s(7 * 24 * HOUR),
        };
      },
    },
    routes: [route('TRANSIT', 3, 8), route('CAR', 2, 5), route('WALK', 15, 1)],
    weather: {
      name: 'test-weather',
      async forecast(_at, when) {
        const t = Date.parse(when);
        if (!Number.isFinite(t)) return failed('INVALID_RESPONSE');
        // Forecast only up to three days ahead; rain on Saturdays (Seoul).
        if (t - clock() > 3 * 24 * HOUR || t < clock()) return { ok: true, data: null, stamp: s(3 * HOUR) };
        const saturday = new Date(t + 9 * HOUR).getUTCDay() === 6;
        return {
          ok: true,
          data: {
            at: new Date(t - (t % HOUR)).toISOString(),
            rain_chance: saturday ? 80 : 10,
            sky: saturday ? 'OVERCAST' : 'CLEAR',
            rain_type: saturday ? 'RAIN' : 'NONE',
            temperature_c: 18,
          },
          stamp: s(3 * HOUR),
        };
      },
    },
    // Opening hours by the test venue's name: most open 11:00～23:00 every day; 디저트 closes at 18:00; 이자카야 runs
    // 18:00～02:00; 국숫집 has no published hours (not found).
    hours: {
      name: 'test-hours',
      async hours(name) {
        if (name.includes('국숫집')) return { ok: true, data: null, stamp: s(24 * HOUR) };
        const [open, close] = name.includes('디저트')
          ? [660, 1080]
          : name.includes('이자카야')
            ? [1080, 120]
            : [660, 1380];
        const periods = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          open: { day, minute: open },
          close: { day: close < open ? (day + 1) % 7 : day, minute: close },
        }));
        return { ok: true, data: { periods, status: 'OPERATIONAL' as const }, stamp: s(24 * HOUR) };
      },
    },
    trails: {
      name: 'test-trails',
      async near(point, radius) {
        const found = trailsAround(point).filter((t) => t.nodes.some((n) => distanceM(n, point) <= radius));
        return { ok: true, data: found, stamp: s(30 * 24 * HOUR) };
      },
    },
    bikeRoads: {
      name: 'test-bike-roads',
      async near(point, radius) {
        const found = bikeRoadsAround(point).filter(
          (r) => distanceM(r.start, point) <= radius || distanceM(r.end, point) <= radius,
        );
        return { ok: true, data: found, stamp: s(30 * 24 * HOUR) };
      },
    },
    shows: {
      name: 'test-shows',
      async performances(venue, nearPoint, day) {
        const year = day.slice(0, 4);
        const data = PLAYS.filter((p) => venue === p.theatre).map(({ theatre, ...p }) => ({
          ...p,
          venue: theatre,
          point: nearPoint,
          from: `${year}-01-01`,
          to: `${year}-12-31`,
          schedule: readShowSchedule(p.times_text),
        }));
        return { ok: true, data, stamp: s(6 * HOUR) };
      },
    },
    movies: {
      name: 'test-movies',
      async nowShowing() {
        const as_of = new Date(clock() + 9 * HOUR - 24 * HOUR).toISOString().slice(0, 10);
        return { ok: true, data: FILMS.map((f) => ({ ...f, as_of })), stamp: s(12 * HOUR) };
      },
    },
    parkingLots: {
      name: 'test-parking-lots',
      async near(point, radius) {
        const found = PARKING_LOTS.filter((l) => distanceM(l.point, point) <= radius).sort(
          (a, b) => distanceM(point, a.point) - distanceM(point, b.point),
        );
        return { ok: true, data: found, stamp: s(30 * 24 * HOUR) };
      },
    },
    ready: true,
  };
}

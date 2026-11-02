// M07.04～06 (F10·F11, U1.3 B16·B17) 장소·코스 후보.
//  - Each member gives, per proposal, where they leave from and how they travel (내 출발지). It stays readable by
//    that member only; the group sees travel burden (minutes), never the place someone leaves from.
//  - Places come from real map data (Provider): subway stations around the map midpoint of everyone's starting
//    points (the "Activity Hub" pool) and places the organizer adds. Travel minutes come from real route data.
//    The shared Decision Graph compares them; the map midpoint itself is shown only as a reference.
//  - A course links the proposal's activities (식사·카페·2차·산행·자전거·공연) around the chosen place, with venues
//    and weather from real data. What no connected source covers is said so (never filled with made-up values).
//  - Every piece of outside data carries its source, whether it is live, when it was read and when it expires.
//    Test data (live=false) is always shown as such. A run whose inputs changed or whose data expired is stale.
export const PLACE_CONTRACT_VERSION = 1;
export type TravelMode = 'TRANSIT' | 'CAR' | 'WALK' | 'BIKE';
export const TRAVEL_MODES: readonly TravelMode[] = ['TRANSIT', 'CAR', 'WALK', 'BIKE'];
export const ORIGIN_LABEL_MAX = 80;
export const PLACE_OPTIONS_MAX = 4;
export const TRAVEL_MAX_MIN = 300;

export interface GeoPoint {
  lat: number;
  lng: number;
}
// Where a piece of outside data came from. live=false: test data (fixtures), never real information.
export interface DataStamp {
  provider: string;
  live: boolean;
  as_of: string;
  expires_at: string;
}
// Why outside data could not be read. UNSUPPORTED: no connected source has this kind of data at all.
export type DataFailure =
  | 'CONFIG_NOT_READY'
  | 'UNSUPPORTED'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'AUTH_FAILED'
  | 'PROVIDER_DOWN'
  | 'INVALID_RESPONSE'
  | 'NOT_FOUND'
  // 10/6 the day's calls allowed by the provider's plan are used up (e.g. ODsay free plan: 30 a day).
  | 'QUOTA_EXCEEDED';
export interface PlaceRecord {
  // Provider-scoped id, e.g. "kakao:12345".
  place_id: string;
  name: string;
  category: string | null;
  address: string | null;
  point: GeoPoint;
  phone: string | null;
  url: string | null;
}
export interface PlaceSearchResult {
  places: PlaceRecord[];
  stamp: DataStamp;
}

// Provider geocoding results are origins, not searchable venue candidates.
export interface GeocodedAddress {
  address_type: 'REGION' | 'ROAD' | 'REGION_ADDR' | 'ROAD_ADDR';
  address_name: string;
  point: GeoPoint;
  // Official names of the most specific region, including its administrative/legal aliases.
  region_names: string[];
  // Full road/lot address alternatives supplied by the same provider record.
  address_aliases: string[];
}
export interface AddressSearchResult {
  addresses: GeocodedAddress[];
  // False if unseen pages or malformed rows could hide another namesake.
  complete: boolean;
}

// ── 내 출발지 (one member, one proposal) ────────────────────────────────────
export interface PlaceInput {
  origin_label: string;
  origin: GeoPoint;
  mode: TravelMode;
  // Needs a parking lot near the place (driving).
  needs_parking: boolean;
  // The earliest time I can leave (Seoul wall clock, "HH:MM"), e.g. after work. null: not given.
  leave_after: string | null;
  // The time I must be home by ("HH:MM"; a time earlier than the meeting start is the next day). null: not given.
  home_by: string | null;
  // The longest trip I accept one way, in minutes. null: not given.
  max_travel_min: number | null;
}
export interface PlaceInputUpload extends Partial<PlaceInput> {
  request_id: string;
  // The version of my current input the screen showed (0 = none).
  expected_version: number;
  // true: take my input back (nothing of it is used from now on).
  withdraw: boolean;
}
export interface MyPlaceInput extends PlaceInput {
  version: number;
  updated_at: string;
}

// ── 장소 후보 (M07.04) ─────────────────────────────────────────────────────
export interface PlaceRunParams {
  request_id: string;
  // Places the organizer added (picked from a search), besides the stations around the midpoint.
  options: PlaceRecord[];
  // Also look at the subway stations around the midpoint of everyone's starting points.
  include_hubs: boolean;
}
export interface PlaceCandidate {
  rank: number;
  place: PlaceRecord;
  kind: 'HUB' | 'OPTION';
  score: number;
  same_as_previous: boolean;
  // Travel burden only (minutes): no member's starting point or name per trip.
  travel: {
    known: number;
    unknown: number;
    longest_min: number | null;
    average_min: number | null;
    // My own trip (only in my view), null when unknown.
    mine_min: number | null;
  };
  // Straight distance from the map midpoint, to tell the place apart from "the middle of the map".
  from_midpoint_m: number | null;
  parking_lots_nearby: number | null;
  // 10/6 published parking lots (전국주차장정보표준데이터) within 500 m — open for the meeting first, then nearest (at
  // most 3); null when not looked up (nobody drives) or not read.
  public_parking: PublicParkingNear[] | null;
  // false while a member who said 참석 has an unknown trip or arrival/return time: it can be offered, not fixed.
  confirmable: boolean;
  reason_codes: string[];
}
export interface PlaceRun {
  run_id: string;
  created_at: string;
  requested_by: string;
  params: Omit<PlaceRunParams, 'request_id'>;
  status: 'RANKED' | 'NO_FEASIBLE_CANDIDATE';
  candidates: PlaceCandidate[];
  rejected: Record<string, number>;
  midpoint: GeoPoint | null;
  // How many members gave a starting point (their consent checked now) and how many are expected.
  members: { with_input: number; expected: number };
  // The meeting time used for arrival and return checks; null when no time is known yet.
  meeting: { starts_at: string; ends_at: string } | null;
  sources: DataSourceLine[];
  // When the earliest piece of data used expires.
  data_expires_at: string | null;
  stale: boolean;
  stale_reasons: Array<'INPUTS_CHANGED' | 'DATA_EXPIRED'>;
  trace: {
    decision_id: string;
    versions: { engine: number; domain_function: string; policy: number; state: number };
    generated_count: number;
    viable_count: number;
    pruned_count: number;
  };
}
// 10/6 a parking lot as published (전국주차장정보표준데이터, 지자체·공단): opening hours per kind of day (minutes from
// midnight; close 1440 = midnight; a close before the open runs past midnight), 'CLOSED' when the lot does not open
// on that kind of day, null when not published; fees as published (null where not).
export type ParkingDayHours = { open_min: number; close_min: number } | 'CLOSED' | null;
export interface ParkingHours {
  weekday: ParkingDayHours;
  saturday: ParkingDayHours;
  // 공휴일 — used for Sundays; other public holidays are not known to the app (the screen says so).
  holiday: ParkingDayHours;
}
export interface ParkingFee {
  kind: 'FREE' | 'PAID' | 'MIXED' | null;
  base_min: number | null;
  base_won: number | null;
  unit_min: number | null;
  unit_won: number | null;
  day_won: number | null;
}
export interface PublicParkingLot {
  lot_id: string;
  name: string;
  operator: 'PUBLIC' | 'PRIVATE' | null;
  type: 'OFF_STREET' | 'ON_STREET' | 'ATTACHED' | null;
  spaces: number | null;
  point: GeoPoint;
  address: string | null;
  hours: ParkingHours;
  fee: ParkingFee;
  // e.g. "5부제" (plate-number days); null when none.
  restriction: string | null;
  phone: string | null;
  as_of: string;
}
// A lot near a place candidate, as shown: open for the whole meeting (arrival to leaving) by its published hours;
// null when the meeting time or the hours are not known.
export interface PublicParkingNear {
  name: string;
  operator: PublicParkingLot['operator'];
  spaces: number | null;
  point: GeoPoint;
  distance_m: number;
  open_at_time: boolean | null;
  fee: ParkingFee;
  restriction: string | null;
  phone: string | null;
}
// One line per kind of outside data used in a run: what it was, from where, how fresh, or why it is missing.
export interface DataSourceLine {
  kind:
    | 'PLACES'
    | 'ROUTES_TRANSIT'
    | 'ROUTES_CAR'
    | 'ROUTES_WALK'
    | 'PARKING'
    | 'VENUES'
    | 'WEATHER'
    | 'COURSE_DATA'
    // 10/6 opening hours of the venues in a course (Google Places).
    | 'HOURS'
    | 'RESTAURANT_FACTS'
    // 10/6 hiking trails near the place (산림청 등산로, 2016).
    | 'TRAILS'
    // 10/6 bicycle roads near the place (전국자전거도로표준데이터, 지자체).
    | 'BIKE_ROADS'
    // 10/6 parking lots near the places (전국주차장정보표준데이터).
    | 'PUBLIC_PARKING'
    // 10/7 performances at theatres near the place (KOPIS 공연예술통합전산망).
    | 'SHOWS'
    // 10/7 films now showing and their running time (KOBIS 영화관입장권통합전산망; no showtimes).
    | 'MOVIES';
  stamp: DataStamp | null;
  failure: DataFailure | null;
  // How many lookups this line covers (e.g. trips), and how many failed.
  count: number;
  failed: number;
}

// ── 코스 후보 (M07.05) ─────────────────────────────────────────────────────
// 10/7: SHOW is a stage performance (공연·연극·뮤지컬·콘서트); MOVIE a film at a cinema (before: both were SHOW).
export type CourseStageKind = 'DINING' | 'CAFE' | 'SECOND_ROUND' | 'HIKING' | 'BIKE' | 'SHOW' | 'MOVIE' | 'OTHER';
export const COURSE_STAGE_KINDS: readonly CourseStageKind[] = [
  'DINING',
  'CAFE',
  'SECOND_ROUND',
  'HIKING',
  'BIKE',
  'SHOW',
  'MOVIE',
  'OTHER',
];
export const MENU_MAX = 20;
export interface CourseStageParam {
  stage_id: string;
  kind: CourseStageKind;
  // A stated food preference (e.g. "한식"), matched against the venue's category. null: none.
  menu: string | null;
}
export interface CourseRunParams {
  request_id: string;
  stages: CourseStageParam[];
}
export interface CourseVenue {
  place: PlaceRecord;
  distance_from_hub_m: number | null;
  menu_match: boolean | null;
  // 10/6: open for this activity's time by the venue's published hours; null when the hours (or the time) are not
  // known — then the step keeps its HOURS check.
  open_at_time: boolean | null;
}
// 10/6 a venue's weekly opening hours as published (Google Places "regularOpeningHours"), in the venue's local time.
// day 0 = Sunday … 6 = Saturday, minute from midnight. A period without close is open all the time.
export interface OpeningPeriod {
  open: { day: number; minute: number };
  close: { day: number; minute: number } | null;
}
export interface VenueHours {
  periods: OpeningPeriod[];
  status: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY' | null;
}
// 10/6 a mountain's published trails near a point (산림청 등산로·산악안전지점, 2016-12-31): the trail graph as
// published — segment length, up/down minutes, difficulty and risk note as written, null where not published.
export type TrailDifficulty = 'EASY' | 'MODERATE' | 'HARD';
export type TrailFacility = 'TOILET' | 'PARKING' | 'WATER' | 'SHELTER';
export interface TrailSegment {
  from: number;
  to: number;
  length_m: number;
  up_min: number | null;
  down_min: number | null;
  difficulty: TrailDifficulty | null;
  risk: string | null;
}
export interface TrailNetwork {
  // "forest:<산 코드>"
  mountain_id: string;
  mountain: string;
  nodes: GeoPoint[];
  segments: TrailSegment[];
  // SUMMIT: a published summit (정상). VIEWPOINT: a published viewpoint (조망점), given only for a mountain whose
  // data has no summit.
  destinations: Array<{ node: number; label: string; kind: 'SUMMIT' | 'VIEWPOINT' }>;
  facilities: Array<{ point: GeoPoint; kind: TrailFacility }>;
}
// One hiking route for a course step: from the place to the nearest trail end, on the trails to a summit (or
// viewpoint) and back the same way. Minutes are the published up/down minutes of the segments walked; the walk
// between the place and the trail end is a straight-line estimate, shown apart.
export interface HikingRoute {
  route_id: string;
  mountain: string;
  destination: string;
  destination_kind: 'SUMMIT' | 'VIEWPOINT';
  destination_point: GeoPoint;
  trailhead: GeoPoint;
  // Straight distance from the chosen place to the trail end, and the walk there and back at 70 m a minute.
  access_m: number;
  access_min: number;
  // On the trails, there and back.
  distance_m: number;
  // Published minutes going up (to the destination) and down (back); null when any segment has none.
  up_min: number | null;
  down_min: number | null;
  // up + down + the walk to and from the trail end; null when the trail minutes are not known.
  total_min: number | null;
  // The hardest published difficulty on the way; null when none is published.
  difficulty: TrailDifficulty | null;
  // Risk notes published for segments on the way (at most 3).
  risks: string[];
  // Published facilities within 300 m of the trail end.
  facilities: TrailFacility[];
}
// 10/6 a bicycle road section as published (전국자전거도로표준데이터): a start and an end point and its length — no
// line, so the way between them is not known. Kind as published: 전용도로 (bikes only), 보행자 겸용 (shared with
// people walking), 우선도로 (shared with cars, bikes first), 전용차로 (a bike lane on the road).
export type BikeRoadKind = 'DEDICATED' | 'SHARED_WITH_WALKERS' | 'PRIORITY' | 'LANE';
export interface BikeRoad {
  road_id: string;
  name: string;
  // 시도·시군구
  area: string;
  kind: BikeRoadKind | null;
  width_m: number | null;
  length_m: number;
  start: GeoPoint;
  end: GeoPoint;
  // Published once per side of the street.
  both_sides: boolean;
  manager: string | null;
  phone: string | null;
  // The managing office's data date (YYYY-MM-DD).
  as_of: string;
}
// One ride for a course step: from the place to the nearer end of a bicycle road, along it and back. Minutes are an
// estimate at 12 km/h (an easy pace), not published data, and say so.
export interface BikeRoute {
  route_id: string;
  road: string;
  area: string;
  kind: BikeRoadKind | null;
  width_m: number | null;
  // The end nearer the place (where the ride starts) and the other end.
  start: GeoPoint;
  end: GeoPoint;
  // Straight distance from the place to the start.
  access_m: number;
  // Along the road there and back.
  distance_m: number;
  // (access there and back + distance) at 12 km/h.
  total_min: number;
  manager: string | null;
  phone: string | null;
  as_of: string;
}
// 10/7 a performance's times as published (KOPIS "공연시간" e.g. "화요일 ~ 금요일(20:00), 토요일(15:00,19:00),
// HOL(15:00)"): start minutes by weekday (0 = Sunday … 6 = Saturday) and on public holidays. Read by code only; text
// that does not read cleanly gives no times (the published text is still shown).
export interface ShowSchedule {
  weekly: Array<{ day: number; minute: number }>;
  holiday: number[];
}
// 10/7 a performance at a theatre as published by KOPIS (공연예술통합전산망), with the theatre's point; prices and
// age as written.
export interface Performance {
  // "kopis:<공연 ID>"
  show_id: string;
  title: string;
  genre: string | null;
  venue: string;
  point: GeoPoint;
  // Running period (YYYY-MM-DD).
  from: string;
  to: string;
  runtime_min: number | null;
  schedule: ShowSchedule | null;
  times_text: string | null;
  price: string | null;
  age: string | null;
}
// 10/7 a film now showing (KOBIS daily box office of the day before) with its running time; KOBIS has no showtimes.
export interface MovieNowShowing {
  // "kobis:<영화 코드>"
  movie_id: string;
  title: string;
  rank: number;
  runtime_min: number | null;
  rating: string | null;
  // The box office day the list is from (YYYY-MM-DD).
  as_of: string;
}
// 10/7 the performance picked for a 공연 step and the showing used (null when its times are not known).
export interface CourseShow {
  performance: Performance;
  starts_at: string | null;
  distance_from_hub_m: number;
}
export interface CourseStep {
  stage_id: string;
  title: string;
  kind: CourseStageKind;
  starts_at: string | null;
  venue: CourseVenue | null;
  // 10/6 the hiking route for a hiking activity (null otherwise, or when no trail data is near).
  route: HikingRoute | null;
  // 10/6 the ride for a cycling activity (null otherwise, or when no bicycle road data is near).
  bike: BikeRoute | null;
  // 10/7 공연: the performance and showing (null otherwise, or when none is found). 영화: films now showing that end
  // within the activity's time (its venue is the cinema; null otherwise or when the list is not read).
  show: CourseShow | null;
  movies: MovieNowShowing[] | null;
  // Straight distance from the previous step's venue (walking route data is not connected).
  from_previous_m: number | null;
  weather: StageWeather | null;
  // What must still be checked by a person for this step (e.g. opening hours are not in the data).
  // TRAIL_TIME: the route's trail minutes are not published (it cannot be checked against the activity's time).
  checks: Array<'HOURS' | 'COURSE_DATA' | 'WEATHER' | 'SHOWTIMES' | 'TRAIL_TIME'>;
}
export interface StageWeather {
  at: string;
  rain_chance: number | null;
  sky: 'CLEAR' | 'CLOUDY' | 'OVERCAST' | null;
  rain_type: 'NONE' | 'RAIN' | 'SNOW' | 'MIXED' | 'SHOWER' | null;
  temperature_c: number | null;
}
export interface CourseCandidate {
  rank: number;
  score: number;
  same_as_previous: boolean;
  steps: CourseStep[];
  total_walk_m: number | null;
  confirmable: boolean;
  reason_codes: string[];
}
export interface CourseRun {
  run_id: string;
  created_at: string;
  requested_by: string;
  hub: PlaceRecord;
  status: 'RANKED' | 'NO_FEASIBLE_CANDIDATE';
  candidates: CourseCandidate[];
  rejected: Record<string, number>;
  params: Omit<CourseRunParams, 'request_id'>;
  sources: DataSourceLine[];
  data_expires_at: string | null;
  stale: boolean;
  stale_reasons: Array<'INPUTS_CHANGED' | 'DATA_EXPIRED'>;
  trace: PlaceRun['trace'];
}

// ── 정한 장소 (M07.07 for places) ───────────────────────────────────────────
export interface PlaceChoice {
  place: PlaceRecord | null;
  version: number;
  chosen_by: string;
  chosen_at: string;
  // The run it was picked from is not the latest, or went stale: check again (the pick itself is not changed).
  recheck: boolean;
}
export interface PlaceChoiceInput {
  request_id: string;
  // The run and the candidate's place picked; both null to clear (보류).
  run_id: string | null;
  place_id: string | null;
  expected_version: number;
}

export interface PlaceCandidateView {
  contract_version: typeof PLACE_CONTRACT_VERSION;
  group_id: string;
  proposal_id: string;
  can_run: boolean;
  // Whether outside data is connected at all (false: the screen says "연결 준비 중").
  data_ready: boolean;
  mine: MyPlaceInput | null;
  // My latest input version, a withdrawal included (0 = none): the screen sends it back as expected_version.
  input_version: number;
  // 10/12: how many members gave a starting point now (a count, no names), for whoever can compute; else null.
  inputs: number | null;
  run: PlaceRun | null;
  choice: PlaceChoice | null;
  course: CourseRun | null;
}

// ── parsing ────────────────────────────────────────────────────────────────
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).every((k) => keys.includes(k));
const REQUEST_ID = /^[-a-zA-Z0-9_]{20,80}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACE_ID = /^[a-z]{2,12}:[-A-Za-z0-9_.]{1,60}$/;
const clean = (v: string) => v.normalize('NFC').replace(/\s+/g, ' ').trim();
// Korea and its seas, roughly: a point outside is not a place this app can route to.
export const inKorea = (p: GeoPoint) => p.lat >= 33 && p.lat <= 39 && p.lng >= 124 && p.lng <= 132;
const point = (v: unknown, code: string): GeoPoint => {
  if (!isObject(v) || !onlyKeys(v, ['lat', 'lng'])) throw new Error(code);
  const lat = Number(v.lat);
  const lng = Number(v.lng);
  if (typeof v.lat !== 'number' || typeof v.lng !== 'number' || !inKorea({ lat, lng })) throw new Error(code);
  return { lat, lng };
};
const optionalText = (v: unknown, max: number, code: string): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || /[\u0000-\u001f\u007f]/.test(v)) throw new Error(code);
  const t = clean(v);
  if (t.length > max) throw new Error(code);
  return t || null;
};

export function parsePlaceRecord(v: unknown): PlaceRecord {
  const code = 'INVALID_PLACE';
  if (!isObject(v) || !onlyKeys(v, ['place_id', 'name', 'category', 'address', 'point', 'phone', 'url']))
    throw new Error(code);
  if (typeof v.place_id !== 'string' || !PLACE_ID.test(v.place_id)) throw new Error(code);
  const name = optionalText(v.name, ORIGIN_LABEL_MAX, code);
  if (!name) throw new Error(code);
  const url = optionalText(v.url, 300, code);
  if (url !== null && !/^https:\/\//.test(url)) throw new Error(code);
  return {
    place_id: v.place_id,
    name,
    category: optionalText(v.category, 100, code),
    address: optionalText(v.address, 120, code),
    point: point(v.point, code),
    phone: optionalText(v.phone, 30, code),
    url,
  };
}

export function parsePlaceInputUpload(value: unknown): PlaceInputUpload & { input: PlaceInput | null } {
  const code = 'INVALID_PLACE_INPUT';
  if (
    !isObject(value) ||
    !onlyKeys(value, [
      'request_id',
      'expected_version',
      'withdraw',
      'origin_label',
      'origin',
      'mode',
      'needs_parking',
      'leave_after',
      'home_by',
      'max_travel_min',
    ])
  )
    throw new Error(code);
  if (typeof value.request_id !== 'string' || !REQUEST_ID.test(value.request_id)) throw new Error(code);
  if (!Number.isInteger(value.expected_version) || Number(value.expected_version) < 0) throw new Error(code);
  if (typeof value.withdraw !== 'boolean') throw new Error(code);
  const base = {
    request_id: value.request_id,
    expected_version: Number(value.expected_version),
    withdraw: value.withdraw,
  };
  if (value.withdraw) return { ...base, input: null };
  const label = optionalText(value.origin_label, ORIGIN_LABEL_MAX, code);
  if (!label) throw new Error('PLACE_ORIGIN_REQUIRED');
  if (typeof value.mode !== 'string' || !TRAVEL_MODES.includes(value.mode as TravelMode)) throw new Error(code);
  const clock = (v: unknown) => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string' || !CLOCK.test(v)) throw new Error(code);
    return v;
  };
  let max: number | null = null;
  if (value.max_travel_min !== null && value.max_travel_min !== undefined) {
    if (!Number.isInteger(value.max_travel_min)) throw new Error(code);
    max = Number(value.max_travel_min);
    if (max < 5 || max > TRAVEL_MAX_MIN) throw new Error(code);
  }
  if (value.needs_parking !== undefined && typeof value.needs_parking !== 'boolean') throw new Error(code);
  const input: PlaceInput = {
    origin_label: label,
    origin: point(value.origin, 'PLACE_ORIGIN_REQUIRED'),
    mode: value.mode as TravelMode,
    needs_parking: value.needs_parking === true,
    leave_after: clock(value.leave_after),
    home_by: clock(value.home_by),
    max_travel_min: max,
  };
  return { ...base, input };
}

// 10/20 회사 1차 범위 "지역·장소(후보 3개)": an area said in the talk ("강남역") → three places around it, ranked by the
// same place engine (no starting points needed; nothing is stored). MEET: stations to meet at, FOOD/CAFE: places.
export type AreaPlaceKind = 'MEET' | 'FOOD' | 'CAFE';
export interface AreaPlacesRequest {
  area: string;
  kind: AreaPlaceKind;
  menu?: string | null;
}
export interface AreaPlace {
  place: PlaceRecord;
  // Straight distance from the area's point, in metres.
  distance_m: number;
}
export interface AreaPlacesView {
  status: 'OK' | 'AREA_NOT_FOUND' | 'NOTHING_NEARBY' | 'UNAVAILABLE';
  area: PlaceRecord | null;
  kind: AreaPlaceKind;
  candidates: AreaPlace[];
  // false for test data (the screen says 시험용 자료).
  live: boolean;
}
export const AREA_TEXT_MAX = 40;
export function parseAreaPlacesRequest(value: unknown): AreaPlacesRequest {
  const code = 'INVALID_AREA_REQUEST';
  if (!isObject(value) || !onlyKeys(value, ['area', 'kind', 'menu'])) throw new Error(code);
  const area = typeof value.area === 'string' ? value.area.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  if (!area || [...area].length > AREA_TEXT_MAX || /[\u0000-\u001f\u007f]/.test(area)) throw new Error(code);
  if (value.kind !== 'MEET' && value.kind !== 'FOOD' && value.kind !== 'CAFE') throw new Error(code);
  const menu = optionalText(value.menu, MENU_MAX, code);
  if (menu && value.kind !== 'FOOD') throw new Error(code);
  return { area, kind: value.kind, ...(menu ? { menu } : {}) };
}

export function parsePlaceRunParams(value: unknown): PlaceRunParams {
  const code = 'INVALID_PLACE_REQUEST';
  if (!isObject(value) || !onlyKeys(value, ['request_id', 'options', 'include_hubs'])) throw new Error(code);
  if (typeof value.request_id !== 'string' || !REQUEST_ID.test(value.request_id)) throw new Error(code);
  if (!Array.isArray(value.options) || value.options.length > PLACE_OPTIONS_MAX) throw new Error(code);
  if (typeof value.include_hubs !== 'boolean') throw new Error(code);
  const options = value.options.map(parsePlaceRecord);
  if (new Set(options.map((o) => o.place_id)).size !== options.length) throw new Error(code);
  if (!options.length && !value.include_hubs) throw new Error('PLACE_NOTHING_TO_COMPARE');
  return { request_id: value.request_id, options, include_hubs: value.include_hubs };
}

export function parseCourseRunParams(value: unknown): CourseRunParams {
  const code = 'INVALID_COURSE_REQUEST';
  if (!isObject(value) || !onlyKeys(value, ['request_id', 'stages'])) throw new Error(code);
  if (typeof value.request_id !== 'string' || !REQUEST_ID.test(value.request_id)) throw new Error(code);
  if (!Array.isArray(value.stages) || !value.stages.length || value.stages.length > 8) throw new Error(code);
  const stages = value.stages.map((s): CourseStageParam => {
    if (!isObject(s) || !onlyKeys(s, ['stage_id', 'kind', 'menu'])) throw new Error(code);
    if (typeof s.stage_id !== 'string' || !UUID_TEXT.test(s.stage_id)) throw new Error(code);
    if (typeof s.kind !== 'string' || !COURSE_STAGE_KINDS.includes(s.kind as CourseStageKind)) throw new Error(code);
    return {
      stage_id: s.stage_id.toLowerCase(),
      kind: s.kind as CourseStageKind,
      menu: optionalText(s.menu, MENU_MAX, code),
    };
  });
  if (new Set(stages.map((s) => s.stage_id)).size !== stages.length) throw new Error(code);
  return { request_id: value.request_id, stages };
}

export function parsePlaceChoiceInput(value: unknown): PlaceChoiceInput {
  const code = 'INVALID_PLACE_CHOICE';
  if (!isObject(value) || !onlyKeys(value, ['request_id', 'run_id', 'place_id', 'expected_version']))
    throw new Error(code);
  if (typeof value.request_id !== 'string' || !REQUEST_ID.test(value.request_id)) throw new Error(code);
  if (!Number.isInteger(value.expected_version) || Number(value.expected_version) < 0) throw new Error(code);
  const clear = value.run_id === null && value.place_id === null;
  if (!clear) {
    if (typeof value.run_id !== 'string' || !UUID_TEXT.test(value.run_id)) throw new Error(code);
    if (typeof value.place_id !== 'string' || !PLACE_ID.test(value.place_id)) throw new Error(code);
  }
  return {
    request_id: value.request_id,
    run_id: clear ? null : (value.run_id as string).toLowerCase(),
    place_id: clear ? null : (value.place_id as string),
    expected_version: Number(value.expected_version),
  };
}
export const PLACE_INPUT_ERRORS = [
  'INVALID_PLACE',
  'INVALID_PLACE_INPUT',
  'PLACE_ORIGIN_REQUIRED',
  'INVALID_PLACE_REQUEST',
  'PLACE_NOTHING_TO_COMPARE',
  'INVALID_COURSE_REQUEST',
  'INVALID_PLACE_CHOICE',
] as const;

// "HH:MM" → minutes after midnight.
export const clockMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
// Straight-line distance in metres (haversine).
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

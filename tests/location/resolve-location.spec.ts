import { describe, expect, it } from 'vitest';
import { looksLikeAddress, resolveLocation } from '../../src/location/resolve-location.ts';
import type { GeocodedAddress, PlaceRecord } from '../../vendor/sophia/packages/contracts/src/place-contract.ts';
import type { PlaceDataProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';
import { placesNotReady, stamp } from '../../vendor/sophia/services/providers/place-data-provider.ts';

const rec = (id: string, name: string, lat: number, lng: number): PlaceRecord => ({
  place_id: `kakao:${id}`, name, category: null, address: null, point: { lat, lng }, phone: null, url: null,
});
const fake = (data: PlaceRecord[]): PlaceDataProvider => ({
  name: 'fake',
  search: async () => ({ ok: true, data, stamp: stamp('fake', false, 0, 1) }),
  nearby: async () => ({ ok: true, data: [], stamp: stamp('fake', false, 0, 1) }),
});

describe('내 위치 받기', () => {
  it('휴대폰 좌표는 그대로 쓴다', async () => {
    const r = await resolveLocation({ kind: 'COORDS', point: { lat: 37.498, lng: 127.0276 } }, fake([]));
    expect(r).toEqual({ status: 'OK', point: { lat: 37.498, lng: 127.0276 }, label: '현재 위치', source: 'DEVICE' });
  });

  it('한국 밖 좌표는 쓰지 않는다', async () => {
    expect((await resolveLocation({ kind: 'COORDS', point: { lat: 35.68, lng: 139.76 } }, fake([]))).status).toBe('OUTSIDE_KOREA');
  });

  it('직접 입력: 이름이 똑같은 곳이 하나면 바로 쓴다', async () => {
    const r = await resolveLocation({ kind: 'TEXT', text: '강남역' }, fake([rec('1', '강남역 2호선', 37.4979, 127.0276), rec('2', '강남역', 37.4979, 127.0277), rec('3', '강남역 신분당선', 37.4966, 127.0283)]));
    expect(r).toMatchObject({ status: 'OK', label: '강남역', source: 'SEARCH' });
  });

  it('직접 입력: 여러 곳이면 위 3곳을 보여 주고 고르게 한다', async () => {
    const r = await resolveLocation({ kind: 'TEXT', text: '시청' }, fake([1, 2, 3, 4, 5].map((i) => rec(String(i), `시청 ${i}`, 37.56, 126.97))));
    expect(r.status).toBe('CHOOSE');
    if (r.status === 'CHOOSE') expect(r.options).toHaveLength(3);
  });

  it('없는 지명, 빈 입력', async () => {
    expect((await resolveLocation({ kind: 'TEXT', text: '없는곳' }, fake([]))).status).toBe('NOT_FOUND');
    expect((await resolveLocation({ kind: 'TEXT', text: '   ' }, fake([]))).status).toBe('NOT_FOUND');
  });

  it('키가 없으면(연결 안 됨) 실패 이유를 그대로 알린다', async () => {
    expect(await resolveLocation({ kind: 'TEXT', text: '강남역' }, placesNotReady)).toEqual({ status: 'FAILED', failure: 'CONFIG_NOT_READY' });
  });
});

// 10/26 주소로 찾기 (SOPHIA ee5ffdc searchAddress): 동 이름·지번·도로명은 카카오 주소 검색 먼저
describe('주소로 장소 찾기 (10/26)', () => {
  const addr = (name: string, lat = 37.527, lng = 127.028): GeocodedAddress => ({ address_type: 'REGION', address_name: name, point: { lat, lng }, region_names: [], address_aliases: [] });
  const calls: string[] = [];
  const withAddress = (places: PlaceRecord[], addresses: GeocodedAddress[], complete = true): PlaceDataProvider => ({
    ...fake(places),
    searchAddress: async (q) => (calls.push(q), { ok: true, data: { addresses, complete }, stamp: stamp('fake', false, 0, 1) }),
  });

  it('주소 모양인지', () => {
    for (const t of ['압구정동', '역삼동 737', '서울 강남구 테헤란로 152', '테헤란로', '분당구 정자동', '역삼동 737-1번지']) expect(looksLikeAddress(t), t).toBe(true);
    for (const t of ['강남역', '홍대입구', '판교역 2번 출구', '스타벅스', '코엑스']) expect(looksLikeAddress(t), t).toBe(false);
  });

  it('"압구정동" → 주소 검색 하나면 바로 그 자리 (장소 검색 안 씀)', async () => {
    const r = await resolveLocation({ kind: 'TEXT', text: '압구정동' }, withAddress([rec('x', '엉뚱한 가게', 37.6, 127.0)], [addr('서울 강남구 압구정동')]));
    expect(r).toEqual({ status: 'OK', point: { lat: 37.527, lng: 127.028 }, label: '서울 강남구 압구정동', source: 'ADDRESS' });
  });

  it('주소가 여럿이거나 다 못 봤으면 고르기 (지어내지 않음)', async () => {
    const r = await resolveLocation({ kind: 'TEXT', text: '신사동' }, withAddress([], [addr('서울 강남구 신사동'), addr('서울 관악구 신사동', 37.48, 126.92)]));
    expect(r.status).toBe('CHOOSE');
    expect(r.status === 'CHOOSE' && r.options.map((o) => o.name)).toEqual(['서울 강남구 신사동', '서울 관악구 신사동']);
    const one = await resolveLocation({ kind: 'TEXT', text: '정자동' }, withAddress([], [addr('경기 성남시 분당구 정자동')], false));
    expect(one.status).toBe('CHOOSE');
  });

  it('주소로 못 찾으면 장소 검색, 이름으로 못 찾으면 주소로 한 번 더', async () => {
    const a = await resolveLocation({ kind: 'TEXT', text: '테헤란로 999' }, withAddress([rec('1', '테헤란로 999 빌딩', 37.5, 127.03)], []));
    expect(a).toMatchObject({ status: 'OK', label: '테헤란로 999 빌딩', source: 'SEARCH' });
    calls.length = 0;
    const b = await resolveLocation({ kind: 'TEXT', text: '세종대왕' }, withAddress([], [addr('서울 종로구 세종대로')]));
    expect(b).toMatchObject({ status: 'OK', source: 'ADDRESS' });
    expect(calls).toEqual(['세종대왕']);
  });

  it('역 이름은 지금처럼 장소 검색 (주소 검색 안 부름)', async () => {
    calls.length = 0;
    const r = await resolveLocation({ kind: 'TEXT', text: '강남역' }, withAddress([rec('2', '강남역', 37.4979, 127.0277)], [addr('엉뚱')]));
    expect(r).toMatchObject({ status: 'OK', label: '강남역', source: 'SEARCH' });
    expect(calls).toEqual([]);
  });
});

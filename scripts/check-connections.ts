// 연결 점검 (써브웨이용 키만): 카카오(장소)·Google(영업시간)·ODsay(대중교통)·카카오모빌리티(차)를 한 번씩 불러 본다.
// 키 값은 찍지 않고 "연결됨 / 실패(이유) / 설정 없음"만. ODsay는 SOPHIA와 하루 한도를 같이 쓰므로 --odsay 일 때만 부른다.
// 실행: 서버 → docker exec subway-prod node dist/check-connections.mjs (또는 npm run check-connections, .env.local)
import { tmpdir } from 'node:os';
import { providersFromEnv } from '../src/server/providers.ts';

const p = providersFromEnv(process.env, tmpdir());
const gangnam = { lat: 37.4979, lng: 127.0276 };
const near = { lat: 37.499, lng: 127.0286 };
const rows: Array<[string, string]> = [];
const check = async (name: string, on: boolean, f: () => Promise<{ ok: boolean; failure?: string }>) => {
  if (!on) return rows.push([name, '설정 없음']);
  try {
    const r = await f();
    rows.push([name, r.ok ? '연결됨' : `실패 (${r.failure})`]);
  } catch (e) {
    rows.push([name, `실패 (${e instanceof Error ? e.name : 'unknown'})`]);
  }
};
const failureOf = (r: { ok: boolean } & Record<string, unknown>) => ({ ok: r.ok, failure: String(r.failure ?? '') });
await check('카카오 장소', p.ready.places, async () => failureOf(await p.places.search('강남역', null)));
await check('Google 영업시간', p.ready.hours, async () => failureOf(await p.sources.hours.hours('써브웨이 강남역점', near)));
await check('카카오모빌리티', p.ready.car, async () => failureOf(await p.sources.car!.route(gangnam, near, new Date().toISOString())));
await check('TMAP 걷기', p.ready.walk, async () => failureOf(await p.sources.walk!.route(gangnam, near, null)));
if (process.argv.includes('--odsay')) await check('ODsay 대중교통', p.ready.transit, async () => failureOf(await p.sources.transit!.route(gangnam, { lat: 37.5133, lng: 127.1001 }, new Date().toISOString())));
else rows.push(['ODsay 대중교통', p.ready.transit ? '건너뜀 (하루 한도 아끼기, --odsay 로 확인)' : '설정 없음']);
for (const [n, s] of rows) console.log(`${n}: ${s}`);
const failed = rows.filter(([, s]) => s.startsWith('실패')).length;
console.log(`연결됨 ${rows.filter(([, s]) => s === '연결됨').length}, 실패 ${failed}`);
process.exit(failed ? 1 : 0);

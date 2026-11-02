// 실제 키로 추천 흐름 확인: npx tsx scripts/check-live.ts 강남역 판교역 ...
// 키는 .env.local(Git 제외)에서만 읽고 화면에 띄우지 않는다. ODsay는 SOPHIA와 하루 한도를 같이 쓰므로 한 번에 최대 3회.
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createFileDailyQuota } from '../vendor/sophia/services/providers/daily-quota.ts';
import { createGoogleHoursProvider } from '../src/stores/google-hours.ts';
import { createKakaoLocalProvider } from '../vendor/sophia/services/providers/kakao-local-provider.ts';
import { createOdsayTransitProvider } from '../vendor/sophia/services/providers/odsay-transit-provider.ts';
import { recommendFlow } from '../src/flow/recommend-flow.ts';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const need = (k: string) => env[k] || (() => { throw new Error(`.env.local에 ${k} 없음`); })();
const places = createKakaoLocalProvider({ api_key: need('SOPHIA_KAKAO_REST_API_KEY') });
const hours = createGoogleHoursProvider({ api_key: need('SOPHIA_GOOGLE_PLACES_API_KEY') });
const transit = createOdsayTransitProvider({ api_key: need('SOPHIA_ODSAY_API_KEY'), quota: createFileDailyQuota({ name: 'subway-odsay', limit: 3, dir: tmpdir() }) });

const referenceAt = new Date().toISOString();
for (const text of process.argv.slice(2)) {
  const run = (location: Parameters<typeof recommendFlow>[0]['location']) => recommendFlow({
    location, places, sources: { hours, transit }, referenceAt,
    prefs: { allergies: [], maxEnergyKcal: null, maxSodiumMg: null, budgetKrw: null, kinds: null, goal: null },
  });
  let r = await run({ kind: 'TEXT', text });
  console.log(`\n■ ${text}`);
  // 여러 곳이 나오면 화면에서 사용자가 고른다. 여기서는 첫 번째를 고른 것으로 이어간다.
  if (r.step === 'LOCATION' && r.location.status === 'CHOOSE') {
    const pick = r.location.options[0]!;
    console.log(`  고르기 ${r.location.options.map((o) => o.name).join(' / ')} → ${pick.name}`);
    r = await run({ kind: 'COORDS', point: pick.point });
  }
  if (r.step === 'LOCATION') { console.log('  위치:', JSON.stringify(r.location).slice(0, 300)); continue; }
  if (r.step === 'STORES') { console.log('  매장:', r.status); continue; }
  console.log(`  위치 → ${r.label} / 매장 ${r.store.status} / ODsay 오늘 남은 횟수 ${r.transitLeft ? `${r.transitLeft.left}/${r.transitLeft.limit}` : '모름'}`);
  for (const c of r.store.candidates) {
    const s = c.store;
    console.log(`  ${c.rank}. ${s.name} ${s.distanceM}m · ${s.travel.mode} ${s.travel.minutes}분(${s.travel.source}) · ${s.open} · ${c.reason_codes.join(',')}`);
  }
  for (const x of r.store.rejected) console.log(`  ✕ ${x.candidate_id} ${x.reason_codes.join(',')}`);
  console.log(`  메뉴: ${r.menu.candidates.map((c) => `${c.rank}. ${c.menu.name}`).join(' / ')}`);
}

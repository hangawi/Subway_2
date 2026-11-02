// 서버 설정(환경 변수)으로 외부 연결 만들기. 키는 서버 설정 파일(subway.env)에만 두고, 화면·응답·기록에 내보내지 않는다.
// 이름은 SUBWAY_* (써브웨이 전용 설정 파일). 내 컴퓨터 시험용 .env.local 의 SOPHIA_* 이름도 받는다.
import { join } from 'node:path';
import { createFileDailyQuota } from '../../vendor/sophia/services/providers/daily-quota.ts';
import { createGoogleHoursProvider } from '../stores/google-hours.ts';
import { createKakaoLocalProvider } from '../../vendor/sophia/services/providers/kakao-local-provider.ts';
import { createKakaoMobilityProvider } from '../../vendor/sophia/services/providers/kakao-mobility-provider.ts';
import { createOdsayTransitProvider } from '../../vendor/sophia/services/providers/odsay-transit-provider.ts';
import { createTmapWalkProvider } from '../../vendor/sophia/services/providers/tmap-walk-provider.ts';
import { hoursNotReady, placesNotReady, type PlaceDataProvider } from '../../vendor/sophia/services/providers/place-data-provider.ts';
import type { FactSources } from '../stores/store-facts.ts';
import { keepHours, keepNearby, keepWalk } from '../stores/cache.ts';
import { AiRouter } from '../../vendor/sophia/runtime/ai_router/ai-router.ts';
import { aiRouterOptionsFromEnv, speechProvidersFromEnv } from '../../vendor/sophia/services/ai/config.ts';
import type { SpeechProvider } from '../../vendor/sophia/packages/contracts/src/media-contract.ts';
import { JsonlUsageSink } from '../../vendor/sophia/services/ai/usage-jsonl-sink.ts';

export type Env = Record<string, string | undefined>;

/** 숫자 설정: 잘못 넣으면(글자·음수) 기본값. NaN이면 한도 비교가 늘 통과해 한도가 사라짐 (10/15 점검) */
export const wholeOr = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
};

const key = (env: Env, name: string) => (env[`SUBWAY_${name}`] ?? env[`SOPHIA_${name}`])?.trim() || null;

export interface Providers {
  places: PlaceDataProvider;
  sources: FactSources;
  /** 어떤 연결이 켜졌는지 (키 값은 넣지 않음) */
  ready: { places: boolean; hours: boolean; walk: boolean; transit: boolean; car: boolean };
}

export function providersFromEnv(env: Env, quotaDir: string): Providers {
  const kakao = key(env, 'KAKAO_REST_API_KEY');
  const google = key(env, 'GOOGLE_PLACES_API_KEY');
  const odsay = key(env, 'ODSAY_API_KEY');
  const tmap = key(env, 'TMAP_API_KEY');
  // ODsay는 SOPHIA와 하루 한도를 같이 쓰므로 써브웨이 몫을 따로 센다 (기본 10회)
  const odsayLimit = wholeOr(env.SUBWAY_ODSAY_DAILY_LIMIT, 10);
  const tmapLimit = wholeOr(env.SUBWAY_TMAP_DAILY_LIMIT, 300);
  return {
    // 근처 매장·영업시간·걷기는 짧게 보관 (src/stores/cache.ts — 버튼마다 외부에 다시 묻던 것)
    places: kakao ? keepNearby(createKakaoLocalProvider({ api_key: kakao })) : placesNotReady,
    sources: {
      hours: google ? keepHours(createGoogleHoursProvider({ api_key: google })) : hoursNotReady,
      walk: tmap ? keepWalk(createTmapWalkProvider({ api_key: tmap, quota: createFileDailyQuota({ name: 'subway-tmap', limit: tmapLimit, dir: quotaDir }) })) : null,
      transit: odsay ? createOdsayTransitProvider({ api_key: odsay, quota: createFileDailyQuota({ name: 'subway-odsay', limit: odsayLimit, dir: quotaDir }) }) : null,
      car: kakao ? createKakaoMobilityProvider({ api_key: kakao }) : null,
    },
    ready: { places: !!kakao, hours: !!google, walk: !!tmap, transit: !!odsay, car: !!kakao },
  };
}

export const defaultQuotaDir = (root: string) => join(root, 'var', 'quota');

// AI: SOPHIA AI 라우터 그대로 (A100 먼저, 안 되면 OpenAI). 설정 이름 SUBWAY_* 를 SOPHIA_* 로 옮겨 SOPHIA 설정 함수에 넘긴다.
// 키가 없거나 설정이 틀리면 AI 없이(규칙 해석만) 돌고, 이유만 남긴다 (키 값은 남기지 않음).
export function aiFromEnv(env: Env, usageDir: string): { router: AiRouter | null; status: string; explain?: AiRouter | null } {
  const mapped: Env = { ...env };
  for (const [k, v] of Object.entries(env)) if (k.startsWith('SUBWAY_') && v !== undefined) mapped[`SOPHIA_${k.slice(7)}`] ??= v;
  // A100은 SOPHIA 내부 네트워크(a100-tunnel) 안이라 써브웨이 컨테이너에서 안 닿는다 → SUBWAY_A100_DISABLED=1 이면 건너뜀 (OpenAI만)
  if (env.SUBWAY_A100_DISABLED === '1') for (const k of Object.keys(mapped)) if (k.startsWith('SOPHIA_A100_')) delete mapped[k];
  if (!mapped.SOPHIA_OPENAI_API_KEY && !mapped.SOPHIA_A100_BASE_URL) return { router: null, status: 'NOT_CONFIGURED' };
  try {
    const options = aiRouterOptionsFromEnv(mapped, { usage_sink: new JsonlUsageSink(usageDir) });
    const router = new AiRouter(options);
    // Top3 AI 한마디 (10/21): A100이 있으면 A100만.
    // 11/02 A100 계약 종료 → OpenAI minimal로 (예형님 "전부 고쳐"): 짧은 설명이라 생각 수준은 낮게, 1번에 약 1~2원
    const a100 = options.providers.filter((p) => p.provider_id === 'a100');
    const openaiFast = mapped.SOPHIA_OPENAI_API_KEY
      ? aiRouterOptionsFromEnv({ ...mapped, SOPHIA_OPENAI_REASONING_EFFORT: 'minimal' }, { usage_sink: new JsonlUsageSink(usageDir) }).providers.filter((p) => p.provider_id === 'openai')
      : [];
    const explainProviders = a100.length ? a100 : openaiFast;
    const explain = explainProviders.length ? new AiRouter({ ...options, providers: explainProviders }) : null;
    return { router, explain, status: router.status().map((p) => `${p.provider_id}:${p.config_ready ? 'ready' : 'off'}`).join(',') };
  } catch (e) {
    return { router: null, status: `CONFIG_ERROR:${e instanceof Error ? e.message.slice(0, 60) : 'unknown'}` };
  }
}

// 음성 받아쓰기 (10/15): SOPHIA 설정 함수 그대로 — A100 받아쓰기(STT) 설정이 있으면 먼저, 없으면 OpenAI.
// 녹음은 이 요청에만 쓰고 저장하지 않는다.
export function speechFromEnv(env: Env): SpeechProvider[] {
  const mapped: Env = { ...env };
  for (const [k, v] of Object.entries(env)) if (k.startsWith('SUBWAY_') && v !== undefined) mapped[`SOPHIA_${k.slice(7)}`] ??= v;
  try {
    return speechProvidersFromEnv(mapped).filter((s) => s.configReady());
  } catch {
    return [];
  }
}

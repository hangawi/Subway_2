// 써브웨이 서버 시작. 설정은 환경 변수 (서버에서는 secrets/subway.env → docker compose env_file).
//  SUBWAY_HOST (기본 127.0.0.1, 컨테이너 안에서는 0.0.0.0), SUBWAY_PORT (기본 4174)
//  SUBWAY_BUILD_COMMIT (배포 확인용), SUBWAY_KAKAO_REST_API_KEY 등 (src/server/providers.ts)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubwayCatalog } from '../catalog/subway-catalog.ts';
import { existsSync } from 'node:fs';
import { aiFromEnv, defaultQuotaDir, providersFromEnv, speechFromEnv, wholeOr } from './providers.ts';
import { createSubwayServer } from './server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.SUBWAY_ROOT ?? resolve(here, '../..');
const port = Number(process.env.SUBWAY_PORT ?? 4174);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
const host = process.env.SUBWAY_HOST ?? '127.0.0.1';
const read = (p: string) => {
  try {
    return readFileSync(resolve(root, p), 'utf8').trim();
  } catch {
    return 'UNKNOWN';
  }
};

const catalog = loadSubwayCatalog(process.env.SUBWAY_CATALOG_PATH);
const providers = providersFromEnv(process.env, process.env.SUBWAY_QUOTA_DIR ?? defaultQuotaDir(root));
const ai = aiFromEnv(process.env, process.env.SUBWAY_AI_USAGE_DIR ?? resolve(root, 'var/ai-usage'));
const webDir = process.env.SUBWAY_WEB_DIR ?? resolve(root, 'dist/web');
const server = createSubwayServer({
  catalog,
  providers,
  ai: ai.router,
  aiExplain: ai.explain ?? null,
  speech: speechFromEnv(process.env),
  voiceLimit: { perMinute: wholeOr(process.env.SUBWAY_VOICE_PER_MINUTE, 20), perDay: wholeOr(process.env.SUBWAY_VOICE_PER_DAY, 300) },
  aiStatus: ai.status,
  webDir: existsSync(webDir) ? webDir : null,
  version: { commit: process.env.SUBWAY_BUILD_COMMIT ?? 'UNCOMMITTED', engineSource: read('vendor/sophia/SOURCE_COMMIT'), builtAt: process.env.SUBWAY_BUILT_AT ?? new Date().toISOString() },
});
server.listen(port, host, () => {
  // 키는 찍지 않는다. 어떤 연결이 켜졌는지만.
  console.log(`subway listening on ${host}:${port}`, JSON.stringify(providers.ready), `ai=${ai.status}`, `web=${existsSync(webDir)}`);
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

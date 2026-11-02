import type { AiProvider, AiUsageSink } from '../../packages/contracts/src/ai-contract.ts';
import type { AiRouterOptions } from '../../runtime/ai_router/ai-router.ts';
import {
  createOpenAiResponsesProvider,
  type FetchLike,
  type ReasoningEffort,
} from '../providers/openai-responses-provider.ts';
import { createOllamaChatProvider } from '../providers/ollama-chat-provider.ts';
import { createTranscriptionProvider } from '../providers/openai-transcription-provider.ts';
import type { SpeechProvider } from '../../packages/contracts/src/media-contract.ts';

// Server-side AI configuration. Keys come only from the server environment (never the client bundle,
// Git, or logs). Provider order = preference: A100 model server first when configured, then the company
// server's Local LLM (Ollama) when configured, external API last.
type Env = Record<string, string | undefined>;
const EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

export function checkedBaseUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name}_INVALID`);
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error(`${name}_REQUIRES_HTTPS`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${name}_INVALID`);
  return url.toString().replace(/\/+$/, '');
}

// The Local LLM is reached inside the company network only: plain http is allowed for loopback, a container
// service name (no dots, e.g. "ollama") or a private IPv4 address, never for a public host.
export function checkedInternalBaseUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name}_INVALID`);
  }
  const host = url.hostname;
  const internal =
    ['127.0.0.1', 'localhost', '[::1]'].includes(host) ||
    /^[a-z0-9-]+$/i.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && internal)) throw new Error(`${name}_REQUIRES_HTTPS`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${name}_INVALID`);
  return url.toString().replace(/\/+$/, '');
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name}_INVALID`);
  return n;
}

export function aiProvidersFromEnv(env: Env, fetcher?: FetchLike): AiProvider[] {
  const providers: AiProvider[] = [];
  const extra = fetcher ? { fetch: fetcher } : {};
  if (env.SOPHIA_A100_BASE_URL) {
    if (!env.SOPHIA_A100_MODEL) throw new Error('SOPHIA_A100_MODEL_REQUIRED');
    providers.push(
      createOpenAiResponsesProvider({
        provider_id: 'a100',
        execution_location: 'sophia_ai_server',
        // OpenAI-compatible model servers may run without a key; the header is then ignored.
        api_key: env.SOPHIA_A100_API_KEY || 'no-key',
        model: env.SOPHIA_A100_MODEL,
        // Reached through the company server's SSH tunnel (Runyour has no IP allow list): plain http only to an
        // internal host such as the tunnel container; the A100 side listens on its own loopback with an API key.
        base_url: checkedInternalBaseUrl(env.SOPHIA_A100_BASE_URL, 'SOPHIA_A100_BASE_URL'),
        reasoning_effort: null,
        // Only when the served model is confirmed to read images (e.g. gemma vision through the Responses API).
        vision: env.SOPHIA_A100_VISION === 'true',
        ...extra,
      }),
    );
  }
  if (env.SOPHIA_LOCAL_LLM_BASE_URL) {
    if (!env.SOPHIA_LOCAL_LLM_MODEL) throw new Error('SOPHIA_LOCAL_LLM_MODEL_REQUIRED');
    const format = env.SOPHIA_LOCAL_LLM_FORMAT || 'schema';
    if (format !== 'schema' && format !== 'json') throw new Error('SOPHIA_LOCAL_LLM_FORMAT_INVALID');
    providers.push(
      createOllamaChatProvider({
        provider_id: 'local_llm',
        execution_location: 'sophia_ai_server',
        model: env.SOPHIA_LOCAL_LLM_MODEL,
        base_url: checkedInternalBaseUrl(env.SOPHIA_LOCAL_LLM_BASE_URL, 'SOPHIA_LOCAL_LLM_BASE_URL'),
        num_ctx: positiveInt(env.SOPHIA_LOCAL_LLM_NUM_CTX, 4096, 'SOPHIA_LOCAL_LLM_NUM_CTX'),
        // Manual v1.4 13절: the app keeps the model loaded for 5 minutes after a request.
        keep_alive: env.SOPHIA_LOCAL_LLM_KEEP_ALIVE || '5m',
        format,
        ...extra,
      }),
    );
  }
  // 'minimal' measured on the C.01 sample set (9/28): same accuracy as 'low' (56/60) at about half the latency.
  const effort = (env.SOPHIA_OPENAI_REASONING_EFFORT || 'minimal') as ReasoningEffort;
  if (!EFFORTS.includes(effort)) throw new Error('SOPHIA_OPENAI_REASONING_EFFORT_INVALID');
  providers.push(
    createOpenAiResponsesProvider({
      provider_id: 'openai',
      execution_location: 'external',
      api_key: env.SOPHIA_OPENAI_API_KEY || null,
      model: env.SOPHIA_OPENAI_MODEL || 'gpt-5-mini',
      base_url: checkedBaseUrl(env.SOPHIA_OPENAI_BASE_URL || 'https://api.openai.com/v1', 'SOPHIA_OPENAI_BASE_URL'),
      reasoning_effort: effort,
      vision: true,
      ...extra,
    }),
  );
  return providers;
}

export function aiRouterOptionsFromEnv(
  env: Env,
  deps: { fetch?: FetchLike; usage_sink?: AiUsageSink } = {},
): AiRouterOptions {
  return {
    providers: aiProvidersFromEnv(env, deps.fetch),
    queue: {
      concurrency: positiveInt(env.SOPHIA_AI_CONCURRENCY, 4, 'SOPHIA_AI_CONCURRENCY'),
      max_queued: positiveInt(env.SOPHIA_AI_MAX_QUEUED, 50, 'SOPHIA_AI_MAX_QUEUED'),
      timeout_ms: {
        interactive: positiveInt(env.SOPHIA_AI_INTERACTIVE_TIMEOUT_MS, 12000, 'SOPHIA_AI_INTERACTIVE_TIMEOUT_MS'),
        batch: positiveInt(env.SOPHIA_AI_TIMEOUT_MS, 30000, 'SOPHIA_AI_TIMEOUT_MS'),
      },
      max_attempts: { interactive: 2, batch: 3 },
      backoff_ms: 500,
    },
    ...(deps.usage_sink ? { usage_sink: deps.usage_sink } : {}),
  };
}

// M05.01 speech to text, in preference order: the A100 whisper model (OpenAI-compatible, through the internal
// tunnel) when configured, then the external API with the same OpenAI key. No key → CONFIG_NOT_READY (type instead).
export function speechProvidersFromEnv(env: Env, fetcher?: FetchLike): SpeechProvider[] {
  const extra = fetcher ? { fetch: fetcher } : {};
  const providers: SpeechProvider[] = [];
  if (env.SOPHIA_STT_BASE_URL) {
    if (!env.SOPHIA_STT_MODEL) throw new Error('SOPHIA_STT_MODEL_REQUIRED');
    providers.push(
      createTranscriptionProvider({
        provider_id: 'a100_stt',
        execution_location: 'sophia_ai_server',
        api_key: env.SOPHIA_STT_API_KEY || 'no-key',
        model: env.SOPHIA_STT_MODEL,
        base_url: checkedInternalBaseUrl(env.SOPHIA_STT_BASE_URL, 'SOPHIA_STT_BASE_URL'),
        ...extra,
      }),
    );
  }
  providers.push(
    createTranscriptionProvider({
      provider_id: 'openai_stt',
      execution_location: 'external',
      api_key: env.SOPHIA_OPENAI_API_KEY || null,
      model: env.SOPHIA_OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
      base_url: checkedBaseUrl(env.SOPHIA_OPENAI_BASE_URL || 'https://api.openai.com/v1', 'SOPHIA_OPENAI_BASE_URL'),
      ...extra,
    }),
  );
  return providers;
}

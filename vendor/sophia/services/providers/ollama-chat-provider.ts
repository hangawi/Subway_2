import {
  emptyAiUsage,
  type AiExecutionLocation,
  type AiProvider,
  type AiProviderResult,
  type AiUsage,
} from '../../packages/contracts/src/ai-contract.ts';
import type { ProviderCode } from '../../packages/contracts/src/provider-contract.ts';
import { httpStatusCode, type FetchLike } from './openai-responses-provider.ts';

// Adapter for a Local LLM served by Ollama on the company server (Local LLM manual v1.4 13절): the native
// POST {base_url}/api/chat with options.num_ctx and keep_alive, because the OpenAI-compatible paths cannot set
// the context length per request. The answer shape is forced with `format` (the JSON schema), or plain JSON
// mode when a model's schema support turns out to be broken. No API key: Ollama listens only inside the server.
export interface OllamaChatOptions {
  provider_id: string;
  execution_location: AiExecutionLocation;
  model: string;
  base_url: string;
  // Context window requested per call. Ollama silently cuts a longer prompt, so the reply is refused when the
  // prompt filled the window (CONTEXT_FULL) instead of trusting an answer to a truncated instruction.
  num_ctx: number;
  keep_alive: string;
  format: 'schema' | 'json';
  fetch?: FetchLike;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => (Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null);

export function buildOllamaChatBody(
  request: { instructions: string; input: string; max_output_tokens: number; output_schema?: { schema: unknown } },
  options: Pick<OllamaChatOptions, 'model' | 'num_ctx' | 'keep_alive' | 'format'>,
) {
  return {
    model: options.model,
    messages: [
      { role: 'system', content: request.instructions },
      { role: 'user', content: request.input },
    ],
    stream: false,
    ...(request.output_schema ? { format: options.format === 'schema' ? request.output_schema.schema : 'json' } : {}),
    keep_alive: options.keep_alive,
    options: { num_ctx: options.num_ctx, num_predict: request.max_output_tokens, temperature: 0 },
  };
}

export function createOllamaChatProvider(options: OllamaChatOptions): AiProvider {
  const fetcher: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const endpoint = options.base_url.replace(/\/+$/, '') + '/api/chat';
  const base = {
    provider_id: options.provider_id,
    execution_location: options.execution_location,
    model: options.model,
  };
  const result = (
    code: ProviderCode,
    message: string,
    usage: AiUsage,
    extra: Partial<Pick<AiProviderResult, 'model_version' | 'output'>> = {},
  ): AiProviderResult => ({
    ...base,
    code,
    message,
    usage,
    model_version: extra.model_version ?? null,
    output: extra.output ?? null,
    refusal: null,
  });
  return {
    ...base,
    configReady: () => Boolean(options.model && options.base_url),
    async generate(request, signal) {
      const payload = JSON.stringify(buildOllamaChatBody(request, options));
      const usage = emptyAiUsage(bytes(payload));
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
          signal,
        });
      } catch (error) {
        const aborted = signal.aborted || (error instanceof Error && error.name === 'AbortError');
        return result(aborted ? 'TIMEOUT' : 'PROVIDER_DOWN', aborted ? 'ABORTED' : 'NETWORK_ERROR', usage);
      }
      let raw: string;
      try {
        raw = await response.text();
      } catch {
        return result(signal.aborted ? 'TIMEOUT' : 'PROVIDER_DOWN', 'BODY_READ_FAILED', usage);
      }
      usage.response_bytes = bytes(raw);
      let body: unknown = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      // Ollama's error text can echo the request; only the status is kept.
      if (!response.ok) return result(httpStatusCode(response.status, null), `HTTP_${response.status}`, usage);
      if (!object(body)) return result('INVALID_RESPONSE', 'BODY_NOT_JSON_OBJECT', usage);
      usage.input_tokens = count(body.prompt_eval_count);
      usage.output_tokens = count(body.eval_count);
      const version = { model_version: typeof body.model === 'string' ? body.model : null };
      if (usage.input_tokens !== null && usage.input_tokens >= options.num_ctx)
        return result('INVALID_RESPONSE', 'CONTEXT_FULL', usage, version);
      if (body.done !== true || (body.done_reason !== undefined && body.done_reason !== 'stop'))
        return result('INVALID_RESPONSE', `STATUS_${String(body.done_reason ?? 'NOT_DONE')}`, usage, version);
      const text = object(body.message) && typeof body.message.content === 'string' ? body.message.content : null;
      if (text === null) return result('INVALID_RESPONSE', 'NO_OUTPUT_TEXT', usage, version);
      if (!request.output_schema) return result('SUCCESS', 'SUCCESS', usage, { ...version, output: text });
      try {
        return result('SUCCESS', 'SUCCESS', usage, { ...version, output: JSON.parse(text) as unknown });
      } catch {
        return result('INVALID_RESPONSE', 'OUTPUT_NOT_JSON', usage, version);
      }
    },
  };
}

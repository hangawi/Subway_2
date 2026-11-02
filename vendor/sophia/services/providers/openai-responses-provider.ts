import type { ProviderCode } from '../../packages/contracts/src/provider-contract.ts';
import {
  emptyAiUsage,
  type AiExecutionLocation,
  type AiProvider,
  type AiProviderResult,
  type AiRequest,
  type AiUsage,
} from '../../packages/contracts/src/ai-contract.ts';

// Adapter for the OpenAI Responses API (POST {base_url}/responses). Also usable for OpenAI-compatible
// servers (e.g. a future A100 model server) by changing base_url and execution_location.
// The API key is read from server config only and is sent solely in the Authorization header.
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface OpenAiResponsesOptions {
  provider_id: string;
  execution_location: AiExecutionLocation;
  api_key: string | null;
  model: string;
  base_url: string;
  // null omits the reasoning field (for OpenAI-compatible servers whose models do not accept it).
  reasoning_effort: ReasoningEffort | null;
  // The model reads images (M05.02).
  vision?: boolean;
  fetch?: FetchLike;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => (Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null);

export function httpStatusCode(status: number, errorCode: string | null): ProviderCode {
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  // insufficient_quota is a billing/account state: retrying cannot succeed.
  if (status === 429) return errorCode === 'insufficient_quota' ? 'AUTH_FAILED' : 'RATE_LIMITED';
  if (status === 404) return 'CONFIG_NOT_READY';
  if (status === 408) return 'TIMEOUT';
  if (status >= 500) return 'PROVIDER_DOWN';
  return 'INVALID_RESPONSE';
}

export function buildResponsesBody(request: AiRequest, model: string, effort: ReasoningEffort | null) {
  return {
    model,
    instructions: request.instructions,
    // M05.02: a photo goes with the text as one user message (data URL; nothing is uploaded or kept elsewhere).
    input: request.images?.length
      ? [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: request.input },
              ...request.images.map((i) => ({
                type: 'input_image',
                image_url: `data:${i.media_type};base64,${i.data_base64}`,
                // OpenAI's default; the A100 (vLLM) Responses API refuses an image without it (10/6 시험).
                detail: 'auto',
              })),
            ],
          },
        ]
      : request.input,
    max_output_tokens: request.max_output_tokens,
    ...(effort ? { reasoning: { effort } } : {}),
    // Do not keep request/response on the provider side beyond its abuse-monitoring policy.
    store: false,
    ...(request.output_schema
      ? {
          text: {
            format: {
              type: 'json_schema',
              name: request.output_schema.name,
              schema: request.output_schema.schema,
              strict: true,
            },
          },
        }
      : {}),
  };
}

interface ParsedResponse {
  status: string | null;
  model: string | null;
  text: string | null;
  refusal: string | null;
  incomplete_reason: string | null;
  usage: Pick<AiUsage, 'input_tokens' | 'output_tokens' | 'reasoning_tokens'>;
}

export function parseResponsesBody(body: unknown): ParsedResponse | null {
  if (!object(body)) return null;
  let text: string | null = null;
  let refusal: string | null = null;
  for (const item of Array.isArray(body.output) ? body.output : []) {
    if (!object(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!object(part)) continue;
      if (part.type === 'output_text' && typeof part.text === 'string') text = (text ?? '') + part.text;
      if (part.type === 'refusal' && typeof part.refusal === 'string') refusal = part.refusal;
    }
  }
  const usage = object(body.usage) ? body.usage : {};
  const details = object(usage.output_tokens_details) ? usage.output_tokens_details : {};
  return {
    status: typeof body.status === 'string' ? body.status : null,
    model: typeof body.model === 'string' ? body.model : null,
    text,
    refusal,
    incomplete_reason:
      object(body.incomplete_details) && typeof body.incomplete_details.reason === 'string'
        ? body.incomplete_details.reason
        : null,
    usage: {
      input_tokens: count(usage.input_tokens),
      output_tokens: count(usage.output_tokens),
      reasoning_tokens: count(details.reasoning_tokens),
    },
  };
}

export function createOpenAiResponsesProvider(options: OpenAiResponsesOptions): AiProvider {
  const fetcher: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const endpoint = options.base_url.replace(/\/+$/, '') + '/responses';
  const base = {
    provider_id: options.provider_id,
    execution_location: options.execution_location,
    model: options.model,
  };
  const result = (
    code: ProviderCode,
    message: string,
    usage: AiUsage,
    extra: Partial<Pick<AiProviderResult, 'model_version' | 'output' | 'refusal'>> = {},
  ): AiProviderResult => ({
    ...base,
    code,
    message,
    usage,
    model_version: extra.model_version ?? null,
    output: extra.output ?? null,
    refusal: extra.refusal ?? null,
  });
  return {
    ...base,
    vision: options.vision === true,
    configReady: () => Boolean(options.api_key),
    async generate(request, signal) {
      if (!options.api_key) return result('CONFIG_NOT_READY', 'API_KEY_MISSING', emptyAiUsage());
      const payload = JSON.stringify(buildResponsesBody(request, options.model, options.reasoning_effort));
      const usage = emptyAiUsage(bytes(payload));
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${options.api_key}` },
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
      if (!response.ok) {
        // Only the machine-readable error code is kept; provider messages may echo request content.
        const errorCode =
          object(body) && object(body.error) && typeof body.error.code === 'string' ? body.error.code : null;
        return result(
          httpStatusCode(response.status, errorCode),
          `HTTP_${response.status}${errorCode ? ':' + errorCode : ''}`,
          usage,
        );
      }
      const parsed = parseResponsesBody(body);
      if (!parsed) return result('INVALID_RESPONSE', 'BODY_NOT_JSON_OBJECT', usage);
      Object.assign(usage, parsed.usage);
      const version = { model_version: parsed.model };
      if (parsed.refusal !== null) return result('PARTIAL', 'REFUSED', usage, { ...version, refusal: parsed.refusal });
      if (parsed.status !== 'completed')
        return result(
          'INVALID_RESPONSE',
          `STATUS_${parsed.status ?? 'UNKNOWN'}${parsed.incomplete_reason ? ':' + parsed.incomplete_reason : ''}`,
          usage,
          version,
        );
      if (parsed.text === null) return result('INVALID_RESPONSE', 'NO_OUTPUT_TEXT', usage, version);
      if (!request.output_schema) return result('SUCCESS', 'SUCCESS', usage, { ...version, output: parsed.text });
      try {
        return result('SUCCESS', 'SUCCESS', usage, { ...version, output: JSON.parse(parsed.text) as unknown });
      } catch {
        return result('INVALID_RESPONSE', 'OUTPUT_NOT_JSON', usage, version);
      }
    },
  };
}

// Deterministic provider for tests and keyless development. Marked as mock in every result message.
export function createMockAiProvider(
  provider_id: string,
  respond: (request: AiRequest) => Partial<AiProviderResult> & { code: ProviderCode },
  execution_location: AiExecutionLocation = 'external',
): AiProvider {
  return {
    provider_id,
    execution_location,
    model: 'mock',
    configReady: () => true,
    async generate(request, signal) {
      if (signal.aborted) throw new Error('ABORTED');
      const answer = respond(request);
      return {
        provider_id,
        execution_location,
        model: 'mock',
        model_version: 'mock',
        output: null,
        refusal: null,
        usage: emptyAiUsage(),
        ...answer,
        message: `MOCK:${answer.message ?? answer.code}`,
      };
    },
  };
}

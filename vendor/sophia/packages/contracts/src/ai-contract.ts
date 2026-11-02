import type { ProviderCode } from './provider-contract.ts';

// C.04~C.06 AI execution contract. The AI layer interprets and phrases only; it never ranks candidates,
// approves actions, or executes external effects (Pure Engine and Action Contract own those).
export const AI_CONTRACT_VERSION = 1;

// media_extraction (M05.02·03): event details read from a photo or a web page; the person confirms them as a sentence.
export type AiTask = 'intent_structuring' | 'short_reply' | 'explanation' | 'media_extraction';
export type AiLane = 'interactive' | 'batch';
export type AiExecutionLocation = 'device' | 'sophia_ai_server' | 'external';

export interface AiOutputSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface AiRequest {
  request_id: string;
  trace_id: string;
  task: AiTask;
  lane: AiLane;
  instructions: string;
  input: string;
  output_schema?: AiOutputSchema;
  max_output_tokens: number;
  // M05.02: one photo the person chose (JPEG/PNG/WebP, already made small on the device). Only providers that read
  // images (AiProvider.vision) are tried; the photo is never logged or stored.
  images?: Array<{ media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data_base64: string }>;
}

export interface AiUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  request_bytes: number;
  response_bytes: number;
}

export interface AiProviderResult {
  code: ProviderCode;
  provider_id: string;
  execution_location: AiExecutionLocation;
  model: string;
  // Model identifier echoed by the provider (snapshot/version), null when no response arrived.
  model_version: string | null;
  // Parsed JSON when output_schema was given, otherwise plain text. Null on any failure.
  output: unknown;
  refusal: string | null;
  usage: AiUsage;
  message: string;
}

export interface AiResult extends AiProviderResult {
  request_id: string;
  attempts: number;
  queued_ms: number;
  run_ms: number;
  // Set when a later provider answered after an earlier one failed (code is FALLBACK_USED).
  fallback_from: string | null;
}

export interface AiProvider {
  provider_id: string;
  execution_location: AiExecutionLocation;
  model: string;
  configReady(): boolean;
  // Reads images (requests with images go only to these).
  vision?: boolean;
  generate(request: AiRequest, signal: AbortSignal): Promise<AiProviderResult>;
}

// One row per routed request. Never contains prompt text, output text, or secrets: only sizes and counts.
export interface AiUsageRecord {
  record_version: 1;
  request_id: string;
  trace_id: string;
  task: AiTask;
  lane: AiLane;
  provider_id: string;
  execution_location: AiExecutionLocation;
  model: string;
  model_version: string | null;
  code: ProviderCode;
  fallback_from: string | null;
  attempts: number;
  queued_ms: number;
  run_ms: number;
  input_chars: number;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  request_bytes: number;
  response_bytes: number;
  started_at: string;
  finished_at: string;
}

export interface AiUsageSink {
  write(record: AiUsageRecord): void | Promise<void>;
}

export function assertAiRequest(request: AiRequest): void {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(request.request_id)) throw new TypeError('AI_REQUEST_ID_INVALID');
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(request.trace_id)) throw new TypeError('AI_TRACE_ID_INVALID');
  if (!['intent_structuring', 'short_reply', 'explanation', 'media_extraction'].includes(request.task))
    throw new TypeError('AI_TASK_INVALID');
  if (request.images) {
    if (request.images.length !== 1) throw new TypeError('AI_IMAGES_INVALID');
    const image = request.images[0]!;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.media_type)) throw new TypeError('AI_IMAGES_INVALID');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data_base64) || image.data_base64.length > 2_000_000)
      throw new TypeError('AI_IMAGES_INVALID');
  }
  if (!['interactive', 'batch'].includes(request.lane)) throw new TypeError('AI_LANE_INVALID');
  if (!request.instructions.trim() || !request.input.trim()) throw new TypeError('AI_INPUT_EMPTY');
  if (request.input.length > 8000) throw new TypeError('AI_INPUT_TOO_LONG');
  if (
    !Number.isInteger(request.max_output_tokens) ||
    request.max_output_tokens < 16 ||
    request.max_output_tokens > 8192
  )
    throw new TypeError('AI_MAX_OUTPUT_TOKENS_INVALID');
  if (request.output_schema && !/^[A-Za-z0-9_-]{1,64}$/.test(request.output_schema.name))
    throw new TypeError('AI_SCHEMA_NAME_INVALID');
}

export function emptyAiUsage(requestBytes = 0): AiUsage {
  return {
    input_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    request_bytes: requestBytes,
    response_bytes: 0,
  };
}

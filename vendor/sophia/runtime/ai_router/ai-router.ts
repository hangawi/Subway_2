import type { ProviderCode } from '../../packages/contracts/src/provider-contract.ts';
import {
  assertAiRequest,
  emptyAiUsage,
  type AiProvider,
  type AiRequest,
  type AiResult,
  type AiUsageRecord,
  type AiUsageSink,
} from '../../packages/contracts/src/ai-contract.ts';
import { AiQueue, type AiQueueOptions, type AiQueueOutcome } from './ai-queue.ts';

// C.04 AI Runtime Router. Providers are tried in preference order (e.g. A100 model server first,
// external API second). A later provider is used only when an earlier one is unavailable or failed
// transiently, and the result then says so (FALLBACK_USED + fallback_from) so external answers are
// never reported as A100 answers. Every provider attempt is metered separately (C.06).
const FALLBACK_ON: ReadonlySet<ProviderCode> = new Set([
  'CONFIG_NOT_READY',
  'AUTH_FAILED',
  'RATE_LIMITED',
  'PROVIDER_DOWN',
  'TIMEOUT',
]);

export interface AiRouterOptions {
  providers: readonly AiProvider[];
  queue: AiQueueOptions;
  usage_sink?: AiUsageSink;
  clock?: () => Date;
}

export class AiRouter {
  private readonly queues = new Map<string, AiQueue>();
  private readonly clock: () => Date;
  private readonly options: AiRouterOptions;

  constructor(options: AiRouterOptions) {
    this.options = options;
    const ids = options.providers.map((p) => p.provider_id);
    if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_AI_PROVIDER');
    for (const provider of options.providers)
      this.queues.set(provider.provider_id, new AiQueue(provider, options.queue));
    this.clock = options.clock ?? (() => new Date());
  }

  status() {
    return this.options.providers.map((p) => ({
      provider_id: p.provider_id,
      execution_location: p.execution_location,
      model: p.model,
      config_ready: p.configReady(),
      ...this.queues.get(p.provider_id)!.status(),
    }));
  }

  async route(request: AiRequest): Promise<AiResult> {
    assertAiRequest(request);
    // A request with a photo goes only to providers that read images (M05.02).
    const ready = this.options.providers.filter((p) => p.configReady() && (!request.images || p.vision === true));
    if (!ready.length) {
      const now = this.clock().toISOString();
      const result: AiResult = {
        request_id: request.request_id,
        code: 'CONFIG_NOT_READY',
        message: 'NO_AI_PROVIDER_CONFIGURED',
        provider_id: 'none',
        execution_location: 'external',
        model: 'none',
        model_version: null,
        output: null,
        refusal: null,
        usage: emptyAiUsage(),
        attempts: 0,
        queued_ms: 0,
        run_ms: 0,
        fallback_from: null,
      };
      await this.record(request, result, now, now);
      return result;
    }
    let firstFailure: string | null = null;
    let last: AiResult | null = null;
    for (const provider of ready) {
      const started = this.clock().toISOString();
      const outcome = await this.queues.get(provider.provider_id)!.run(request);
      const result = this.toResult(request, outcome, firstFailure);
      await this.record(request, result, started, this.clock().toISOString());
      last = result;
      if (!FALLBACK_ON.has(outcome.result.code)) return result;
      firstFailure ??= provider.provider_id;
    }
    return last!;
  }

  private toResult(request: AiRequest, outcome: AiQueueOutcome, fallbackFrom: string | null): AiResult {
    const answered = outcome.result.code === 'SUCCESS' || outcome.result.code === 'PARTIAL';
    const fellBack = answered && fallbackFrom !== null;
    return {
      ...outcome.result,
      code: fellBack && outcome.result.code === 'SUCCESS' ? 'FALLBACK_USED' : outcome.result.code,
      request_id: request.request_id,
      attempts: outcome.attempts,
      queued_ms: outcome.queued_ms,
      run_ms: outcome.run_ms,
      fallback_from: fellBack ? fallbackFrom : null,
    };
  }

  private async record(request: AiRequest, result: AiResult, started_at: string, finished_at: string) {
    if (!this.options.usage_sink) return;
    const record: AiUsageRecord = {
      record_version: 1,
      request_id: request.request_id,
      trace_id: request.trace_id,
      task: request.task,
      lane: request.lane,
      provider_id: result.provider_id,
      execution_location: result.execution_location,
      model: result.model,
      model_version: result.model_version,
      code: result.code,
      fallback_from: result.fallback_from,
      attempts: result.attempts,
      queued_ms: result.queued_ms,
      run_ms: result.run_ms,
      input_chars: request.input.length,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      reasoning_tokens: result.usage.reasoning_tokens,
      request_bytes: result.usage.request_bytes,
      response_bytes: result.usage.response_bytes,
      started_at,
      finished_at,
    };
    // Metering must never break the user-facing request.
    try {
      await this.options.usage_sink.write(record);
    } catch {
      /* sink failure is ignored; the request result is still returned */
    }
  }
}

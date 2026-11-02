import type { ProviderCode } from '../../packages/contracts/src/provider-contract.ts';
import {
  emptyAiUsage,
  type AiLane,
  type AiProvider,
  type AiProviderResult,
  type AiRequest,
} from '../../packages/contracts/src/ai-contract.ts';

// C.05 One-provider execution queue. A single GPU (or a rate-limited external API) must not be flooded:
// requests wait for a bounded number of slots, interactive requests always go before batch work,
// each attempt has a hard timeout, and only transient failures are retried.
export interface AiQueueOptions {
  concurrency: number;
  max_queued: number;
  // Per-lane hard timeout per attempt: interactive requests must fail fast to the text/manual fallback.
  timeout_ms: Record<AiLane, number>;
  max_attempts: Record<AiLane, number>;
  backoff_ms: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface AiQueueOutcome {
  result: AiProviderResult;
  attempts: number;
  queued_ms: number;
  run_ms: number;
}

const RETRYABLE: ReadonlySet<ProviderCode> = new Set(['RATE_LIMITED', 'PROVIDER_DOWN', 'TIMEOUT']);

interface Job {
  request: AiRequest;
  enqueued_at: number;
  resolve: (outcome: AiQueueOutcome) => void;
}

export class AiQueue {
  private readonly lanes: Record<AiLane, Job[]> = { interactive: [], batch: [] };
  private active = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly provider: AiProvider;
  private readonly options: AiQueueOptions;

  constructor(provider: AiProvider, options: AiQueueOptions) {
    this.provider = provider;
    this.options = options;
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new TypeError('AI_QUEUE_CONCURRENCY');
    if (!Number.isInteger(options.max_queued) || options.max_queued < 0) throw new TypeError('AI_QUEUE_MAX_QUEUED');
    if (!(options.timeout_ms.interactive > 0) || !(options.timeout_ms.batch > 0))
      throw new TypeError('AI_QUEUE_TIMEOUT');
    for (const lane of ['interactive', 'batch'] as const)
      if (!Number.isInteger(options.max_attempts[lane]) || options.max_attempts[lane] < 1)
        throw new TypeError('AI_QUEUE_MAX_ATTEMPTS');
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  status() {
    return {
      active: this.active,
      queued_interactive: this.lanes.interactive.length,
      queued_batch: this.lanes.batch.length,
    };
  }

  run(request: AiRequest): Promise<AiQueueOutcome> {
    const waiting = this.lanes.interactive.length + this.lanes.batch.length;
    if (this.active >= this.options.concurrency && waiting >= this.options.max_queued)
      return Promise.resolve({
        result: this.failure('RATE_LIMITED', 'QUEUE_FULL'),
        attempts: 0,
        queued_ms: 0,
        run_ms: 0,
      });
    return new Promise((resolve) => {
      this.lanes[request.lane].push({ request, enqueued_at: this.now(), resolve });
      this.pump();
    });
  }

  private pump() {
    while (this.active < this.options.concurrency) {
      const job = this.lanes.interactive.shift() ?? this.lanes.batch.shift();
      if (!job) return;
      this.active++;
      void this.execute(job).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async execute(job: Job) {
    const started = this.now();
    const queued_ms = started - job.enqueued_at;
    const limit = this.options.max_attempts[job.request.lane];
    let attempts = 0;
    let result: AiProviderResult;
    for (;;) {
      attempts++;
      result = await this.attempt(job.request);
      if (!RETRYABLE.has(result.code) || attempts >= limit) break;
      await this.sleep(this.options.backoff_ms * 2 ** (attempts - 1));
    }
    job.resolve({ result, attempts, queued_ms, run_ms: this.now() - started });
  }

  private async attempt(request: AiRequest): Promise<AiProviderResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The race guarantees the timeout even when a provider ignores the abort signal.
    const timeout = new Promise<AiProviderResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(this.failure('TIMEOUT', 'QUEUE_TIMEOUT'));
      }, this.options.timeout_ms[request.lane]);
    });
    try {
      return await Promise.race([
        this.provider
          .generate(request, controller.signal)
          .catch(() => this.failure(controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_DOWN', 'PROVIDER_THREW')),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private failure(code: ProviderCode, message: string): AiProviderResult {
    return {
      code,
      message,
      provider_id: this.provider.provider_id,
      execution_location: this.provider.execution_location,
      model: this.provider.model,
      model_version: null,
      output: null,
      refusal: null,
      usage: emptyAiUsage(),
    };
  }
}

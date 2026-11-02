import type { AiUsageRecord } from '../../packages/contracts/src/ai-contract.ts';

// C.06 Usage summary per provider/model. Byte counts, tokens and latency stay separate values:
// they are not converted into contract metering units (the A100 "20기가" unit is still unconfirmed).
export interface AiUsageSummary {
  provider_id: string;
  model: string;
  requests: number;
  codes: Record<string, number>;
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  request_bytes: number;
  response_bytes: number;
  run_ms_p50: number | null;
  run_ms_p95: number | null;
  queued_ms_p95: number | null;
}

export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

export function summarizeUsage(records: readonly AiUsageRecord[]): AiUsageSummary[] {
  const groups = new Map<string, AiUsageRecord[]>();
  for (const record of records) {
    const key = `${record.provider_id}\u0000${record.model}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.values()].map((rows) => {
    const codes: Record<string, number> = {};
    for (const row of rows) codes[row.code] = (codes[row.code] ?? 0) + 1;
    const sum = (pick: (r: AiUsageRecord) => number | null) => rows.reduce((total, r) => total + (pick(r) ?? 0), 0);
    return {
      provider_id: rows[0]!.provider_id,
      model: rows[0]!.model,
      requests: rows.length,
      codes,
      attempts: sum((r) => r.attempts),
      input_tokens: sum((r) => r.input_tokens),
      output_tokens: sum((r) => r.output_tokens),
      reasoning_tokens: sum((r) => r.reasoning_tokens),
      request_bytes: sum((r) => r.request_bytes),
      response_bytes: sum((r) => r.response_bytes),
      run_ms_p50: percentile(
        rows.map((r) => r.run_ms),
        50,
      ),
      run_ms_p95: percentile(
        rows.map((r) => r.run_ms),
        95,
      ),
      queued_ms_p95: percentile(
        rows.map((r) => r.queued_ms),
        95,
      ),
    };
  });
}

export class MemoryUsageSink {
  readonly records: AiUsageRecord[] = [];
  write(record: AiUsageRecord) {
    this.records.push(record);
  }
}

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AiUsageRecord, AiUsageSink } from '../../packages/contracts/src/ai-contract.ts';

// C.06 Server-side usage log, one JSON line per provider attempt, partitioned by month to match the
// monthly metering reset. Records hold counts and sizes only (see AiUsageRecord), never prompt text.
export class JsonlUsageSink implements AiUsageSink {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  fileFor(record: AiUsageRecord): string {
    return join(this.directory, `ai-usage-${record.started_at.slice(0, 7)}.jsonl`);
  }

  async write(record: AiUsageRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await appendFile(this.fileFor(record), JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600 });
  }
}

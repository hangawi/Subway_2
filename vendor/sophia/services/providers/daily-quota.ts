import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 10/6 하루 호출 한도 (ODsay 무료 요금제는 하루 30회). Calls to a provider are counted per Seoul day in a small file
// under the server's var/ folder, so a restart or the connection check (another process) sees the same count. A
// call is taken before it is made; at the limit no call is made and the caller says so. Counting is not the
// provider's own meter (it may differ slightly); it keeps the app from failing silently.
export interface DailyQuota {
  readonly limit: number;
  // Takes one call; false when the day's calls are used up (nothing is taken then).
  take(): boolean;
  // Calls taken today.
  used(): number;
}
const SEOUL = 9 * 3_600_000;
const day = (now: number) => new Date(now + SEOUL).toISOString().slice(0, 10);

export function createFileDailyQuota(options: {
  name: string;
  limit: number;
  dir: string;
  clock?: () => number;
}): DailyQuota {
  const clock = options.clock ?? Date.now;
  const file = () => join(options.dir, `${options.name}-${day(clock())}.json`);
  const read = () => {
    try {
      const n = (JSON.parse(readFileSync(file(), 'utf8')) as { used?: unknown }).used;
      return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  };
  return {
    limit: options.limit,
    used: read,
    take() {
      const used = read();
      if (used >= options.limit) return false;
      try {
        mkdirSync(options.dir, { recursive: true });
        const target = file();
        const temp = `${target}.${process.pid}.tmp`;
        writeFileSync(temp, JSON.stringify({ used: used + 1 }));
        renameSync(temp, target);
      } catch {
        // A count that cannot be written must not stop the call; the provider's own limit still applies.
      }
      return true;
    },
  };
}

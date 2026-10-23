/** Value at percentile `p` (0–100) of an ascending-sorted array; 0 when empty. */
export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

/** Upper bounds (ms) of the latency histogram buckets; one more bucket catches everything above. */
export const LATENCY_BUCKETS = [1, 2, 5, 10, 20, 50, 100, 200, 500] as const;

export function histogram(values: readonly number[], bounds: readonly number[] = LATENCY_BUCKETS): number[] {
  const counts = Array.from({ length: bounds.length + 1 }, () => 0);
  for (const v of values) {
    const i = bounds.findIndex((b) => v <= b);
    counts[i < 0 ? bounds.length : i]! += 1;
  }
  return counts;
}

/** What a scene recorded in one second of stage time: named counters and named sample series. */
export interface Bucket {
  counts: Record<string, number>;
  samples: Record<string, number[]>;
}

const emptyBucket = (): Bucket => ({ counts: {}, samples: {} });

/** Per-second history of a run: drives timeline instruments and mission checks alike. */
export class Timeline {
  private buckets: Bucket[] = [];

  private at(ms: number): Bucket {
    const i = Math.max(0, Math.floor(ms / 1000));
    while (this.buckets.length <= i) this.buckets.push(emptyBucket());
    return this.buckets[i]!;
  }

  count(ms: number, key: string, n = 1): void {
    const b = this.at(ms);
    b.counts[key] = (b.counts[key] ?? 0) + n;
  }

  sample(ms: number, series: string, value: number): void {
    const b = this.at(ms);
    (b.samples[series] ??= []).push(value);
  }

  /** Bucket for second `i`, or an empty one. */
  second(i: number): Bucket {
    return this.buckets[i] ?? emptyBucket();
  }

  get length(): number {
    return this.buckets.length;
  }

  /** Whole seconds in [fromSec, toSec). */
  protected range(fromSec: number, toSec: number): number[] {
    const from = Math.max(0, Math.floor(fromSec));
    const to = Math.max(from, Math.floor(toSec));
    return Array.from({ length: to - from }, (_, i) => from + i);
  }

  /** Total of a counter over whole seconds [fromSec, toSec). */
  sum(fromSec: number, toSec: number, key: string): number {
    return this.range(fromSec, toSec).reduce((n, i) => n + (this.second(i).counts[key] ?? 0), 0);
  }

  /** The busiest single second for a counter. */
  peak(fromSec: number, toSec: number, key: string): number {
    return this.range(fromSec, toSec).reduce((n, i) => Math.max(n, this.second(i).counts[key] ?? 0), 0);
  }

  /** All samples of a series, sorted ascending. */
  values(fromSec: number, toSec: number, series: string): number[] {
    return this.range(fromSec, toSec)
      .flatMap((i) => this.second(i).samples[series] ?? [])
      .sort((a, b) => a - b);
  }

  /** Seconds in the window (at least 1, for rates). */
  seconds(fromSec: number, toSec: number): number {
    return this.range(fromSec, toSec).length || 1;
  }
}

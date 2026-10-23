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

/** Counters a scene records, bucketed per second of stage time. */
export interface Bucket {
  reads: number;
  hits: number;
  /** Reads from the simulated users only (excludes batch jobs), for hit-ratio goals. */
  userReads: number;
  userHits: number;
  writes: number;
  dbOps: number;
  failed: number;
  stale: number;
  lost: number;
  readMs: number[];
  writeMs: number[];
}

const emptyBucket = (): Bucket => ({ reads: 0, hits: 0, userReads: 0, userHits: 0, writes: 0, dbOps: 0, failed: 0, stale: 0, lost: 0, readMs: [], writeMs: [] });

export interface WindowStats {
  seconds: number;
  reads: number;
  hits: number;
  hitRatio: number;
  userHitRatio: number;
  writes: number;
  dbRate: number;
  peakDbRate: number;
  failed: number;
  stale: number;
  lost: number;
  readP50: number;
  readP95: number;
  readMean: number;
  writeP95: number;
}

type CountKey = Exclude<keyof Bucket, 'readMs' | 'writeMs'>;

/** Per-second history of a run: drives the timeline instrument and mission checks alike. */
export class Timeline {
  private buckets: Bucket[] = [];

  private at(ms: number): Bucket {
    const i = Math.max(0, Math.floor(ms / 1000));
    while (this.buckets.length <= i) this.buckets.push(emptyBucket());
    return this.buckets[i]!;
  }

  count(ms: number, key: CountKey, n = 1): void {
    this.at(ms)[key] += n;
  }

  latency(ms: number, kind: 'read' | 'write', value: number): void {
    (kind === 'read' ? this.at(ms).readMs : this.at(ms).writeMs).push(value);
  }

  /** Bucket for second `i`, or an empty one. */
  second(i: number): Bucket {
    return this.buckets[i] ?? emptyBucket();
  }

  get length(): number {
    return this.buckets.length;
  }

  /** Raw latency samples over whole seconds [fromSec, toSec). */
  samples(fromSec: number, toSec: number, kind: 'read' | 'write'): number[] {
    const out: number[] = [];
    for (let i = Math.max(0, Math.floor(fromSec)); i < Math.floor(toSec); i++) out.push(...(kind === 'read' ? this.second(i).readMs : this.second(i).writeMs));
    return out;
  }

  /** Aggregate over whole seconds [fromSec, toSec). */
  window(fromSec: number, toSec: number): WindowStats {
    const from = Math.max(0, Math.floor(fromSec));
    const to = Math.max(from, Math.floor(toSec));
    let reads = 0, hits = 0, userReads = 0, userHits = 0, writes = 0, db = 0, peak = 0, failed = 0, stale = 0, lost = 0;
    const readMs: number[] = [];
    const writeMs: number[] = [];
    for (let i = from; i < to; i++) {
      const b = this.second(i);
      reads += b.reads;
      hits += b.hits;
      userReads += b.userReads;
      userHits += b.userHits;
      writes += b.writes;
      db += b.dbOps;
      peak = Math.max(peak, b.dbOps);
      failed += b.failed;
      stale += b.stale;
      lost += b.lost;
      readMs.push(...b.readMs);
      writeMs.push(...b.writeMs);
    }
    readMs.sort((a, b) => a - b);
    writeMs.sort((a, b) => a - b);
    const seconds = to - from || 1;
    return {
      seconds,
      reads,
      hits,
      hitRatio: reads ? hits / reads : 0,
      userHitRatio: userReads ? userHits / userReads : 0,
      writes,
      dbRate: db / seconds,
      peakDbRate: peak,
      failed,
      stale,
      lost,
      readP50: percentile(readMs, 50),
      readP95: percentile(readMs, 95),
      readMean: readMs.length ? readMs.reduce((a, b) => a + b, 0) / readMs.length : 0,
      writeP95: percentile(writeMs, 95),
    };
  }
}

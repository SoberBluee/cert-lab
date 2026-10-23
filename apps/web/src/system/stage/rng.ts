/** Seeded randomness, so the same seed and controls always replay the same run. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Gap until the next event of a Poisson process with `perSecond` events a second, in ms. */
  gapMs(perSecond: number): number;
}

/** mulberry32: tiny, fast, and good enough for a teaching simulation. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    gapMs: (perSecond) => (perSecond <= 0 ? Infinity : (-Math.log(1 - next()) / perSecond) * 1000),
  };
}

/** Cumulative probabilities for a Zipf distribution over `n` ranks with exponent `s` (0 = uniform). */
export function zipfCdf(n: number, s: number): number[] {
  const weights = Array.from({ length: n }, (_, k) => 1 / Math.pow(k + 1, s));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return weights.map((w) => (acc += w / total));
}

/** Probability of each rank, from a CDF. */
export const probsOf = (cdf: number[]): number[] => cdf.map((c, i) => c - (i ? cdf[i - 1]! : 0));

/** The rank a uniform `r` falls into (binary search). */
export function sampleCdf(cdf: number[], r: number): number {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (r <= cdf[mid]!) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

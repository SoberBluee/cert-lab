export type LbAlgorithm = 'round-robin' | 'least-connections' | 'weighted' | 'ip-hash';

export interface Backend {
  id: string;
  weight: number;
  healthy: boolean;
}

export const DEFAULT_BACKENDS: Backend[] = [
  { id: 'A', weight: 2, healthy: true },
  { id: 'B', weight: 1, healthy: true },
  { id: 'C', weight: 1, healthy: true },
];

/** Deterministic small string hash (stable across runs). */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * The backend id for each of `count` sequential requests from `clientIp`.
 * Unhealthy backends never receive traffic.
 */
export function assignments(algo: LbAlgorithm, backends: Backend[], count: number, clientIp = '203.0.113.7'): string[] {
  const healthy = backends.filter((b) => b.healthy);
  if (!healthy.length || count <= 0) return [];
  const out: string[] = [];
  if (algo === 'ip-hash') {
    const target = healthy[hashString(clientIp) % healthy.length]!;
    return Array.from({ length: count }, () => target.id);
  }
  if (algo === 'weighted') {
    const wheel = healthy.flatMap((b) => Array.from({ length: Math.max(1, b.weight) }, () => b.id));
    return Array.from({ length: count }, (_, i) => wheel[i % wheel.length]!);
  }
  if (algo === 'least-connections') {
    // Each request holds a connection briefly; simulate by current counts.
    const counts = new Map(healthy.map((b) => [b.id, 0]));
    for (let i = 0; i < count; i++) {
      const pick = [...healthy].sort((a, b) => counts.get(a.id)! - counts.get(b.id)! || a.id.localeCompare(b.id))[0]!;
      out.push(pick.id);
      counts.set(pick.id, counts.get(pick.id)! + 1);
    }
    return out;
  }
  return Array.from({ length: count }, (_, i) => healthy[i % healthy.length]!.id);
}

export const countsOf = (ids: string[]): Record<string, number> =>
  ids.reduce<Record<string, number>>((acc, id) => ({ ...acc, [id]: (acc[id] ?? 0) + 1 }), {});

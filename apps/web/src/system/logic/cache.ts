export type EvictionPolicy = 'lru' | 'lfu' | 'fifo' | 'lifo' | 'mru' | 'random';

export const POLICIES: { id: EvictionPolicy; label: string; evicts: string }[] = [
  { id: 'lru', label: 'LRU', evicts: 'the entry used longest ago' },
  { id: 'lfu', label: 'LFU', evicts: 'the entry with the fewest hits' },
  { id: 'fifo', label: 'FIFO', evicts: 'the entry inserted first' },
  { id: 'lifo', label: 'LIFO', evicts: 'the entry inserted last' },
  { id: 'mru', label: 'MRU', evicts: 'the entry used most recently' },
  { id: 'random', label: 'Random', evicts: 'an entry picked at random' },
];

export interface CacheEntry {
  key: string;
  /** Version of the value held; compared with the database's to spot stale reads. */
  version: number;
  /** Access order (not time), so ties never happen. */
  insertedAt: number;
  usedAt: number;
  /** Stage times of the same, for display. */
  insertedMs: number;
  usedMs: number;
  hits: number;
  /** Stage time the entry expires, or null for no TTL. */
  expiresAt: number | null;
  /** Written here but not yet in the database (write-back). */
  dirty: boolean;
  /** Writes absorbed while dirty: what a crash would lose. */
  pending: number;
}

export type Lookup =
  | { hit: true; entry: CacheEntry; slot: number }
  /** `entry` is set for an expired entry kept for revalidation. */
  | { hit: false; reason: 'absent' | 'expired'; slot: number; entry?: CacheEntry };

export interface Placed {
  slot: number;
  evicted: CacheEntry | null;
}

/**
 * A fixed number of slots with an eviction policy. Entries keep their slot until they leave,
 * so the stage can draw slot i in the same place for its whole life.
 */
export class Cache {
  slots: (CacheEntry | null)[];
  policy: EvictionPolicy;
  private clock = 0;
  /** key → version an invalidation guaranteed; older fills are refused (a lease, in effect). */
  private tombstones = new Map<string, number>();

  constructor(
    capacity: number,
    policy: EvictionPolicy,
    private random: () => number = Math.random,
  ) {
    this.slots = Array.from({ length: capacity }, () => null);
    this.policy = policy;
  }

  get capacity(): number {
    return this.slots.length;
  }

  get size(): number {
    return this.slots.filter(Boolean).length;
  }

  entries(): CacheEntry[] {
    return this.slots.filter((e): e is CacheEntry => !!e);
  }

  find(key: string): number {
    return this.slots.findIndex((e) => e?.key === key);
  }

  has(key: string): boolean {
    return this.find(key) >= 0;
  }

  /**
   * A read: counts as a use on a hit. An entry whose TTL has run out is dropped, unless
   * `keepExpired` asks to keep it so the caller can revalidate it with the origin.
   */
  lookup(key: string, now: number, opts: { keepExpired?: boolean } = {}): Lookup {
    const slot = this.find(key);
    const entry = slot >= 0 ? this.slots[slot]! : null;
    if (!entry) return { hit: false, reason: 'absent', slot: -1 };
    if (entry.expiresAt !== null && entry.expiresAt <= now && !entry.dirty) {
      if (opts.keepExpired) return { hit: false, reason: 'expired', slot, entry };
      this.slots[slot] = null;
      return { hit: false, reason: 'expired', slot };
    }
    entry.usedAt = ++this.clock;
    entry.usedMs = now;
    entry.hits += 1;
    return { hit: true, entry, slot };
  }

  /** The slot the policy would empty next, or -1 if there is a free slot. */
  victim(): number {
    if (this.slots.some((e) => !e)) return -1;
    return this.pick(this.slots.map((_, i) => i));
  }

  private pick(candidates: number[]): number {
    if (this.policy === 'random') return candidates[Math.floor(this.random() * candidates.length)]!;
    let best = candidates[0]!;
    for (const i of candidates.slice(1)) {
      const a = this.slots[i]!;
      const b = this.slots[best]!;
      const better =
        this.policy === 'lru' ? a.usedAt < b.usedAt
        : this.policy === 'mru' ? a.usedAt > b.usedAt
        : this.policy === 'fifo' ? a.insertedAt < b.insertedAt
        : this.policy === 'lifo' ? a.insertedAt > b.insertedAt
        : a.hits < b.hits || (a.hits === b.hits && a.usedAt < b.usedAt);
      if (better) best = i;
    }
    return best;
  }

  /**
   * Store a value fetched from the database. Refused (null) if the cache already holds a newer
   * version, or an invalidation promised one: a slow read must not undo a newer write.
   */
  fill(key: string, version: number, now: number, ttlMs: number | null): Placed | null {
    const floor = this.tombstones.get(key);
    if (floor !== undefined && version < floor) return null;
    const at = this.find(key);
    if (at >= 0) {
      const e = this.slots[at]!;
      if (e.version > version || e.dirty) return null;
      e.version = version;
      e.expiresAt = ttlMs ? now + ttlMs : null;
      return { slot: at, evicted: null };
    }
    this.tombstones.delete(key);
    return this.place({ key, version, insertedAt: 0, usedAt: 0, insertedMs: now, usedMs: now, hits: 0, expiresAt: ttlMs ? now + ttlMs : null, dirty: false, pending: 0 });
  }

  /** A write that goes through the cache (write-through, or write-back with `dirty`). */
  write(key: string, version: number, now: number, ttlMs: number | null, dirty: boolean): Placed {
    this.tombstones.delete(key);
    const at = this.find(key);
    if (at >= 0) {
      const e = this.slots[at]!;
      e.version = Math.max(e.version, version);
      e.usedAt = ++this.clock;
      e.usedMs = now;
      e.expiresAt = ttlMs ? now + ttlMs : null;
      if (dirty) {
        e.dirty = true;
        e.pending += 1;
      }
      return { slot: at, evicted: null };
    }
    return this.place({ key, version, insertedAt: 0, usedAt: 0, insertedMs: now, usedMs: now, hits: 0, expiresAt: ttlMs ? now + ttlMs : null, dirty, pending: dirty ? 1 : 0 });
  }

  /** Delete a key because the database changed; fills older than `version` are refused afterwards. */
  invalidate(key: string, version: number): number {
    this.tombstones.set(key, Math.max(version, this.tombstones.get(key) ?? 0));
    const at = this.find(key);
    if (at >= 0) this.slots[at] = null;
    return at;
  }

  /** Mark entries clean once the database has their version. */
  flushed(written: { key: string; version: number }[]): void {
    for (const w of written) {
      const e = this.slots[this.find(w.key)];
      if (e && e.version <= w.version) {
        e.dirty = false;
        e.pending = 0;
      }
    }
  }

  /** Change capacity, keeping the entries the policy values most. Returns the ones dropped. */
  resize(capacity: number): CacheEntry[] {
    const dropped: CacheEntry[] = [];
    while (this.size > capacity) {
      const v = this.pick(this.slots.flatMap((e, i) => (e ? [i] : [])));
      dropped.push(this.slots[v]!);
      this.slots[v] = null;
    }
    // Entries keep their slot when it still exists; the rest fill the gaps.
    const next: (CacheEntry | null)[] = Array.from({ length: capacity }, () => null);
    const moved: CacheEntry[] = [];
    this.slots.forEach((e, i) => {
      if (e && i < capacity) next[i] = e;
      else if (e) moved.push(e);
    });
    for (const e of moved) next[next.indexOf(null)] = e;
    this.slots = next;
    return dropped;
  }

  /** Empty the cache (a flush or a crash). Returns what was in it. */
  clear(): CacheEntry[] {
    const all = this.entries();
    this.slots = this.slots.map(() => null);
    this.tombstones.clear();
    return all;
  }

  dirtyEntries(): CacheEntry[] {
    return this.entries().filter((e) => e.dirty);
  }

  private place(entry: CacheEntry): Placed {
    let slot = this.slots.indexOf(null);
    let evicted: CacheEntry | null = null;
    if (slot < 0) {
      slot = this.victim();
      evicted = this.slots[slot]!;
    }
    entry.insertedAt = entry.usedAt = ++this.clock;
    this.slots[slot] = entry;
    return { slot, evicted };
  }
}

/** Replay a key trace through a cache that fills instantly on a miss. */
export function replay(keys: readonly string[], capacity: number, policy: EvictionPolicy, random?: () => number): { hits: number; misses: number } {
  const cache = new Cache(capacity, policy, random);
  let hits = 0;
  keys.forEach((k, v) => {
    if (cache.lookup(k, 0).hit) hits++;
    else cache.fill(k, v, 0, null);
  });
  return { hits, misses: keys.length - hits };
}

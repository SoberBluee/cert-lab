import { Sim, type Req, type Tone } from '../stage/engine';
import type { Pt } from '../stage/geometry';
import type { StageLayout, StageNode, StageWire } from '../stage/layout';
import { percentile, Timeline } from '../stage/metrics';
import { Server, type ServerState } from '../stage/server';
import { sampleCdf, zipfCdf } from '../stage/rng';
import { Cache, type EvictionPolicy } from './cache';

export type Topology = 'single' | 'layers' | 'fleet';
export type WriteStrategy = 'db-only' | 'write-around' | 'write-through' | 'write-back';
export type FleetMode = 'local' | 'global' | 'distributed';

export const STRATEGIES: { id: WriteStrategy; label: string; blurb: string }[] = [
  { id: 'db-only', label: 'Database only', blurb: 'Writes go to the database and leave the cache alone.' },
  { id: 'write-around', label: 'Write-around', blurb: 'Writes go to the database, then delete the cached copy.' },
  { id: 'write-through', label: 'Write-through', blurb: 'Writes update the cache and the database before answering.' },
  { id: 'write-back', label: 'Write-back', blurb: 'Writes update the cache and answer; the database catches up later.' },
];

export interface CachingConfig {
  topology: Topology;
  cacheOn: boolean;
  capacity: number;
  policy: EvictionPolicy;
  /** 0 = entries never expire. Stage seconds. */
  ttlSec: number;
  ttlJitter: boolean;
  /** Requests per stage second. */
  rps: number;
  /** Zipf exponent: 0 = every key equally popular. */
  skew: number;
  keys: number;
  /**
   * zipf: popularity-weighted keys at random intervals. loop: a batch job reading k1, k2 … at a
   * steady rate, cycling over LOOP_EXTRA more keys than the cache holds.
   */
  pattern: 'zipf' | 'loop';
  /** Share of user requests that are writes (single topology only). */
  writeRatio: number;
  strategy: WriteStrategy;
  /** Write-back: copy each unflushed write to a second node before answering. */
  replica: boolean;
  /** One database fetch per missing key; other requests for it wait. */
  coalesce: boolean;
  /** Refresh popular entries shortly before they expire. */
  refreshAhead: boolean;
  /** Database operations per stage second it can serve. */
  dbCapacity: number;
  layers: { browser: boolean; cdn: boolean; app: boolean };
  fleetMode: FleetMode;
}

export const DEFAULT_CONFIG: CachingConfig = {
  topology: 'single',
  cacheOn: true,
  capacity: 8,
  policy: 'lru',
  ttlSec: 0,
  ttlJitter: false,
  rps: 6,
  skew: 1.1,
  keys: 30,
  pattern: 'zipf',
  writeRatio: 0,
  strategy: 'write-around',
  replica: false,
  coalesce: false,
  refreshAhead: false,
  dbCapacity: 5,
  layers: { browser: true, cdn: true, app: true },
  fleetMode: 'global',
};

export type NodeKind = 'users' | 'pass' | 'cache' | 'db' | 'replica';

export type { StageLayout, StageNode, StageWire };

const node = (id: string, label: string, kind: NodeKind, x: number, y: number, w: number, h: number): StageNode => ({ id, label, kind, x, y, w, h });
const wire = (from: string, to: string, pts: Pt[], stageMs: number, ms: number, id = `${from}-${to}`): StageWire => ({ id, from, to, pts, stageMs, ms });

/** Capacity of each cache node in the fixed-size topologies. */
const FIXED_CAPACITY: Record<string, number> = { browser: 3, cdn: 8, layersCache: 6, local: 4, global: 12 };

export function layoutFor(cfg: CachingConfig): StageLayout {
  if (cfg.topology === 'layers') {
    const y = 200;
    return {
      width: 820,
      height: 400,
      scale: 'Latency is end to end, from your browser.',
      nodes: [
        node('users', 'You', 'users', 10, 165, 70, 70),
        node('browser', 'Browser cache', 'cache', 130, 110, 110, 180),
        node('cdn', 'CDN edge', 'cache', 290, 110, 120, 180),
        node('app', 'App', 'pass', 460, 170, 70, 60),
        node('cache', 'App cache', 'cache', 580, 110, 110, 180),
        node('db', 'Database', 'db', 730, 155, 80, 90),
      ],
      wires: [
        wire('users', 'browser', [[80, y], [130, y]], 300, 0),
        wire('browser', 'cdn', [[240, y], [290, y]], 650, 20),
        wire('cdn', 'app', [[410, y], [460, y]], 650, 30),
        wire('app', 'cache', [[530, y], [580, y]], 350, 0.5),
        wire('cache', 'db', [[690, y], [730, y]], 450, 0.5),
      ],
    };
  }
  if (cfg.topology === 'fleet') {
    const ys = [75, 200, 325];
    const apps = ys.map((yc, i) => node(`app${i + 1}`, `App ${i + 1}`, 'pass', 262, yc - 25, 86, 50));
    const global = cfg.fleetMode === 'global';
    const caches = global
      ? [node('cache', 'Shared cache', 'cache', 422, 35, 140, 330)]
      : ys.map((yc, i) => node(`cache${i + 1}`, cfg.fleetMode === 'local' ? `Cache on app ${i + 1}` : `Shard ${i + 1}`, 'cache', 422, yc - 40, 140, 80));
    const wires: StageWire[] = [wire('users', 'lb', [[96, 200], [140, 200]], 400, 0)];
    ys.forEach((yc, i) => wires.push(wire('lb', `app${i + 1}`, [[210, 200], [236, 200], [236, yc], [262, yc]], 450, 0.2)));
    if (global) {
      ys.forEach((yc, i) => wires.push(wire(`app${i + 1}`, 'cache', [[348, yc], [422, yc]], 350, 0.5)));
      wires.push(wire('cache', 'db', [[562, 200], [660, 200]], 450, 0.5));
    } else {
      ys.forEach((yi, i) =>
        ys.forEach((yj, j) => {
          if (cfg.fleetMode === 'distributed' || i === j) wires.push(wire(`app${i + 1}`, `cache${j + 1}`, [[348, yi], [422, yj]], 350, 0.5));
        }),
      );
      ys.forEach((yc, j) => wires.push(wire(`cache${j + 1}`, 'db', [[562, yc], [611, yc], [611, 200], [660, 200]], 450, 0.5)));
    }
    return {
      width: 820,
      height: 400,
      scale: 'Latency is measured from the load balancer.',
      nodes: [node('users', 'Users', 'users', 12, 160, 84, 80), node('lb', 'LB', 'pass', 140, 170, 70, 60), ...apps, ...caches, node('db', 'Database', 'db', 660, 155, 140, 90)],
      wires,
    };
  }
  const y = 202;
  return {
    width: 820,
    height: 400,
    scale: 'Latency is measured at the app.',
    nodes: [
      node('users', 'Users', 'users', 20, 160, 96, 84),
      node('app', 'App', 'pass', 196, 172, 96, 60),
      node('cache', 'Cache', 'cache', 372, 96, 220, 208),
      node('db', 'Database', 'db', 672, 158, 128, 88),
      node('replica', 'Replica', 'replica', 412, 330, 140, 52),
    ],
    wires: [
      wire('users', 'app', [[116, y], [196, y]], 550, 0),
      wire('app', 'cache', [[292, y], [372, y]], 350, 0.5),
      wire('cache', 'db', [[592, y], [672, y]], 450, 0.5),
      wire('app', 'db', [[244, 172], [244, 52], [736, 52], [736, 158]], 1100, 0.5, 'bypass'),
      wire('cache', 'replica', [[482, 304], [482, 330]], 280, 0.5),
    ],
  };
}

const DB_WORKERS = 2;
const DB_MAX_QUEUE = 10;
const DB_QUERY_MS = 40;
const FLUSH_EVERY = 3000;
const SPIKE_MS = 6000;
const SCAN_RATE = 6;
/** A crashed fleet cache node is unreachable this long before it restarts empty. */
const FLEET_OUTAGE_MS = 3000;
/** How many more keys a loop has than the cache has slots. Fills land ~1.3 s after a miss, so a loop
 * only one or two keys longer than the cache would still hit under LRU. */
export const LOOP_EXTRA = 4;

interface CReq extends Req {
  /** From the simulated users, not a batch job or background work. */
  user: boolean;
  path: string[];
  /** Latest acknowledged write when the read reached the app: anything older is stale. */
  minVersion: number;
  version: number;
  servedBy?: string;
  /** Cache nodes that missed on the way in, to fill on the way back. */
  missed: string[];
}

/** A point where a freeze frame may pause the run before it happens. */
export type Moment =
  | { kind: 'lookup'; node: string; key: string; present: boolean; stale: boolean; req: CReq }
  | { kind: 'evict'; node: string; key: string; slot: number; victim: string }
  | { kind: 'lost'; node: string; count: number };

export interface Marker {
  at: number;
  label: string;
}

export type DbState = ServerState;

/** What the caching instruments and missions read over a window of whole seconds. */
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

/** The scene's per-second history, with the caching lesson's view of a window. */
export class CachingTimeline extends Timeline {
  latency(ms: number, kind: 'read' | 'write', value: number): void {
    this.sample(ms, kind, value);
  }

  window(fromSec: number, toSec: number): WindowStats {
    const sum = (k: string) => this.sum(fromSec, toSec, k);
    const reads = sum('reads');
    const userReads = sum('userReads');
    const readMs = this.values(fromSec, toSec, 'read');
    return {
      seconds: this.seconds(fromSec, toSec),
      reads,
      hits: sum('hits'),
      hitRatio: reads ? sum('hits') / reads : 0,
      userHitRatio: userReads ? sum('userHits') / userReads : 0,
      writes: sum('writes'),
      dbRate: sum('dbOps') / this.seconds(fromSec, toSec),
      peakDbRate: this.peak(fromSec, toSec, 'dbOps'),
      failed: sum('failed'),
      stale: sum('stale'),
      lost: sum('lost'),
      readP50: percentile(readMs, 50),
      readP95: percentile(readMs, 95),
      readMean: readMs.length ? readMs.reduce((a, b) => a + b, 0) / readMs.length : 0,
      writeP95: percentile(this.values(fromSec, toSec, 'write'), 95),
    };
  }
}

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/** The caching lesson's whole system: topology, caches, database, traffic and faults. */
export class CachingScene {
  readonly sim: Sim;
  readonly layout: StageLayout;
  readonly timeline = new CachingTimeline();
  readonly caches = new Map<string, Cache>();
  readonly markers: Marker[] = [];
  /** Hits and misses per cache node. */
  readonly nodeStats = new Map<string, { hits: number; misses: number }>();
  /** Replica copies of unflushed writes: key → version and write count. */
  readonly replica = new Map<string, { version: number; pending: number }>();
  /** Requests recently answered, newest last, so the Inspector can show them after they finish. */
  readonly finished: CReq[] = [];
  cfg: CachingConfig;
  freezeHook: ((m: Moment) => boolean) | null = null;
  frozen: Moment | null = null;

  private wires = new Map<string, StageWire>();
  private labels = new Map<string, string>();
  private cdf: number[] = [];
  private shift = 0;
  private spikeUntil = -1;
  private scanLeft = 0;
  private scanSeq = 0;
  private loopSeq = 0;
  private rr = 0;
  private issued = new Map<string, number>();
  private acked = new Map<string, number>();
  private dbVersion = new Map<string, number>();
  private database: Server;
  private inflight = new Map<string, CReq[]>();
  private refreshing = new Set<string>();
  private flushing = false;
  private pending: (() => void) | null = null;
  private downUntil = new Map<string, number>();

  constructor(cfg: CachingConfig, seed = 1) {
    this.cfg = { ...cfg, layers: { ...cfg.layers } };
    this.sim = new Sim(seed);
    this.database = new Server(this.sim, { name: 'Database', workers: DB_WORKERS, maxQueue: DB_MAX_QUEUE, modeledMs: DB_QUERY_MS, capacity: () => this.cfg.dbCapacity });
    this.layout = layoutFor(this.cfg);
    for (const w of this.layout.wires) this.wires.set(`${w.from}>${w.to}`, w);
    for (const n of this.layout.nodes) {
      this.labels.set(n.id, n.label);
      if (n.kind === 'cache') {
        this.caches.set(n.id, new Cache(this.capacityOf(n.id), this.cfg.policy, () => this.sim.rng.next()));
        this.nodeStats.set(n.id, { hits: 0, misses: 0 });
      }
    }
    this.cdf = zipfCdf(this.cfg.keys, this.cfg.skew);
    this.scheduleArrival();
    this.sim.after(FLUSH_EVERY, () => this.flushTick());
  }

  private capacityOf(id: string): number {
    if (this.cfg.topology === 'single') return this.cfg.capacity;
    if (this.cfg.topology === 'layers') return id === 'browser' ? FIXED_CAPACITY.browser! : id === 'cdn' ? FIXED_CAPACITY.cdn! : FIXED_CAPACITY.layersCache!;
    return this.cfg.fleetMode === 'global' ? FIXED_CAPACITY.global! : FIXED_CAPACITY.local!;
  }

  // ---- controls ----

  /** Apply control changes to a running scene. Topology changes need a new scene. */
  configure(patch: Partial<CachingConfig>): void {
    const prev = this.cfg;
    this.cfg = { ...prev, ...patch, layers: { ...prev.layers, ...patch.layers } };
    if (patch.capacity !== undefined && this.cfg.topology === 'single') {
      const dropped = this.caches.get('cache')!.resize(this.cfg.capacity);
      this.flushEntries(dropped.filter((e) => e.dirty));
    }
    if (patch.policy) for (const c of this.caches.values()) c.policy = patch.policy;
    if (patch.skew !== undefined || patch.keys !== undefined) this.cdf = zipfCdf(this.cfg.keys, this.cfg.skew);
  }

  /** Is this cache node caching right now? */
  active(id: string): boolean {
    if (this.isDown(id)) return false;
    if (this.cfg.topology === 'single') return this.cfg.cacheOn;
    if (this.cfg.topology === 'layers') return id === 'browser' ? this.cfg.layers.browser : id === 'cdn' ? this.cfg.layers.cdn : this.cfg.layers.app;
    return true;
  }

  /** A crashed node that hasn't restarted yet: requests pass straight through it. */
  isDown(id: string): boolean {
    return (this.downUntil.get(id) ?? -1) > this.sim.now;
  }

  get db(): DbState {
    return this.database.state;
  }

  /** Requests parked at a cache node, waiting for a fetch already in flight (coalescing). */
  waitingAt(id: string): number {
    let n = 0;
    for (const [k, list] of this.inflight) if (k.startsWith(`${id}|`)) n += list.length;
    return n;
  }

  labelOf(id: string): string {
    return this.labels.get(id) ?? id;
  }

  /** The key popularity the users are drawing from right now, most popular rank first. */
  keyRanking(): string[] {
    return Array.from({ length: this.cfg.keys }, (_, r) => `k${((r + this.shift) % this.cfg.keys) + 1}`);
  }

  get rankCdf(): number[] {
    return this.cdf;
  }

  // ---- faults ----

  /** Empty a cache (dirty entries are written out first, so nothing is lost). */
  flush(id = 'cache'): void {
    const cache = this.caches.get(id);
    if (!cache) return;
    this.flushEntries(cache.dirtyEntries());
    cache.clear();
    this.sim.emit({ kind: 'flush', node: id });
    this.mark('flush');
  }

  /**
   * Crash and restart a cache node: it comes back empty. Fleet nodes are unreachable for a few
   * seconds first. Unflushed write-back data is lost unless replicated.
   */
  crash(id = 'cache'): void {
    const cache = this.caches.get(id);
    if (!cache) return;
    const dirty = cache.dirtyEntries();
    cache.clear();
    if (this.cfg.topology === 'fleet') this.downUntil.set(id, this.sim.now + FLEET_OUTAGE_MS);
    this.sim.emit({ kind: 'crash', node: id });
    this.mark(`${this.labelOf(id).toLowerCase()} crash`);
    if (!dirty.length) return;
    if (id === 'cache' && this.cfg.replica && this.replica.size) {
      for (const [key, r] of this.replica) {
        const placed = cache.write(key, r.version, this.sim.now, this.ttl(), true);
        cache.slots[placed.slot]!.pending = r.pending;
      }
      this.sim.emit({ kind: 'restored', node: id, text: `${this.replica.size} restored from replica` });
      return;
    }
    const lost = dirty.reduce((n, e) => n + e.pending, 0);
    this.timeline.count(this.sim.now, 'lost', lost);
    this.sim.emit({ kind: 'lost', node: id, text: `${lost} write${lost === 1 ? '' : 's'} lost` });
    this.gate({ kind: 'lost', node: id, count: lost }, () => {});
  }

  /** Triple the traffic for a few seconds. */
  spike(): void {
    this.spikeUntil = this.sim.now + SPIKE_MS;
    this.mark('spike');
  }

  /** A batch job reads `count` cold keys, one after another. */
  scan(count = 48): void {
    const start = this.scanLeft === 0;
    this.scanLeft += count;
    this.mark('scan');
    if (start) this.scanTick();
  }

  /** Popularity moves: half the key space becomes the new hot set. */
  shiftPopularity(): void {
    this.shift = (this.shift + Math.floor(this.cfg.keys / 2)) % this.cfg.keys;
    this.mark('trend shift');
  }

  // ---- freeze frames ----

  /** Continue after a freeze frame. */
  resume(): void {
    const fn = this.pending;
    this.pending = null;
    this.frozen = null;
    this.sim.halted = false;
    fn?.();
  }

  private gate(m: Moment, fn: () => void): void {
    if (this.freezeHook?.(m)) {
      this.frozen = m;
      this.pending = fn;
      this.sim.halted = true;
    } else fn();
  }

  // ---- traffic ----

  private scheduleArrival(): void {
    const rate = this.cfg.rps * (this.sim.now < this.spikeUntil ? 3 : 1);
    const gap = this.cfg.pattern === 'loop' ? 1000 / rate : this.sim.rng.gapMs(rate);
    this.sim.after(gap, () => {
      this.arrival();
      this.scheduleArrival();
    });
  }

  private nextKey(): string {
    if (this.cfg.pattern === 'loop') return `k${(this.loopSeq++ % (this.cfg.capacity + LOOP_EXTRA)) + 1}`;
    const rank = sampleCdf(this.cdf, this.sim.rng.next());
    return `k${((rank + this.shift) % this.cfg.keys) + 1}`;
  }

  private arrival(): void {
    const key = this.nextKey();
    const write = this.cfg.topology === 'single' && this.cfg.writeRatio > 0 && this.sim.rng.next() < this.cfg.writeRatio;
    if (write) this.startWrite(key);
    else this.startRead(key, true);
  }

  private scanTick(): void {
    if (this.scanLeft <= 0) return;
    this.scanLeft--;
    this.startRead(`s${++this.scanSeq}`, false);
    this.sim.after(1000 / SCAN_RATE, () => this.scanTick());
  }

  private mark(label: string): void {
    this.markers.push({ at: this.sim.now, label });
  }

  private newReq(kind: string, origin: string, key: string | undefined, user: boolean, path: string[] = []): CReq {
    return Object.assign(this.sim.req(kind, origin, key), { user, path, minVersion: 0, version: 0, missed: [] });
  }

  private ttl(): number | null {
    if (!this.cfg.ttlSec) return null;
    const base = this.cfg.ttlSec * 1000;
    return this.cfg.ttlJitter ? base * (0.7 + this.sim.rng.next() * 0.6) : base;
  }

  /** Move along the wire between two adjacent nodes, whichever way it was drawn. */
  private travel(req: CReq, a: string, b: string, tone: Tone, then: () => void): void {
    const fwd = this.wires.get(`${a}>${b}`);
    const w = fwd ?? this.wires.get(`${b}>${a}`);
    if (!w) throw new Error(`no wire between ${a} and ${b}`);
    this.sim.send(req, w.id, { reverse: !fwd, stageMs: w.stageMs, modeledMs: w.ms, tone, label: `${this.labelOf(a)} → ${this.labelOf(b)}` }, then);
  }

  /** Travel through a list of nodes in order. */
  private walk(req: CReq, nodes: string[], tone: Tone, then: () => void): void {
    if (nodes.length < 2) return then();
    this.travel(req, nodes[0]!, nodes[1]!, tone, () => this.walk(req, nodes.slice(1), tone, then));
  }

  // ---- reads ----

  private readPath(key: string): string[] {
    if (this.cfg.topology === 'layers') return ['users', 'browser', 'cdn', 'app', 'cache', 'db'];
    if (this.cfg.topology === 'fleet') {
      const i = (this.rr++ % 3) + 1;
      const c = this.cfg.fleetMode === 'global' ? 'cache' : this.cfg.fleetMode === 'local' ? `cache${i}` : `cache${(hash(key) % 3) + 1}`;
      return ['users', 'lb', `app${i}`, c, 'db'];
    }
    return this.cfg.cacheOn ? ['users', 'app', 'cache', 'db'] : ['users', 'app', 'db'];
  }

  private startRead(key: string, user: boolean): void {
    const req = this.newReq('read', 'users', key, user, this.readPath(key));
    this.forward(req, 0);
  }

  private forward(req: CReq, i: number): void {
    this.travel(req, req.path[i]!, req.path[i + 1]!, 'request', () => this.arrive(req, i + 1));
  }

  private arrive(req: CReq, i: number): void {
    const id = req.path[i]!;
    if (id === 'app') req.minVersion = this.acked.get(req.key!) ?? 0;
    if (this.caches.has(id) && this.active(id)) {
      const cache = this.caches.get(id)!;
      const at = cache.find(req.key!);
      const entry = at >= 0 ? cache.slots[at]! : null;
      const live = !!entry && (entry.expiresAt === null || entry.expiresAt > this.sim.now || entry.dirty);
      this.gate({ kind: 'lookup', node: id, key: req.key!, present: live, stale: live && entry!.version < req.minVersion, req }, () => this.atCache(req, i));
      return;
    }
    if (id === 'db') {
      this.dbSubmit(
        req,
        () => {
          req.version = this.dbVersion.get(req.key!) ?? 0;
          req.servedBy = 'db';
          if (req.version < req.minVersion) req.stale = true;
          this.back(req, i, 'miss');
        },
        () => this.fail(req, i),
      );
      return;
    }
    this.forward(req, i);
  }

  private atCache(req: CReq, i: number): void {
    const id = req.path[i]!;
    const cache = this.caches.get(id)!;
    const stats = this.nodeStats.get(id)!;
    const r = cache.lookup(req.key!, this.sim.now);
    if (r.hit) {
      stats.hits++;
      this.sim.hop(req, `${this.labelOf(id)}: hit (slot ${r.slot + 1})`, 0.1);
      this.sim.emit({ kind: 'hit', node: id, key: req.key, slot: r.slot });
      req.version = r.entry.version;
      req.servedBy = id;
      if (req.version < req.minVersion) req.stale = true;
      this.maybeRefresh(id, r.entry.key, r.entry.expiresAt);
      this.back(req, i, 'hit');
      return;
    }
    stats.misses++;
    this.sim.hop(req, `${this.labelOf(id)}: ${r.reason === 'expired' ? 'expired (TTL ran out)' : 'miss'}`, 0.1);
    this.sim.emit({ kind: r.reason === 'expired' ? 'expire' : 'miss', node: id, key: req.key, slot: r.slot });
    req.missed.push(id);
    if (this.cfg.coalesce) {
      const k = `${id}|${req.key}`;
      const waiting = this.inflight.get(k);
      if (waiting) {
        waiting.push(req);
        this.sim.hop(req, `${this.labelOf(id)}: waits for the fetch already in flight`);
        return;
      }
      this.inflight.set(k, []);
    }
    this.forward(req, i);
  }

  private back(req: CReq, i: number, tone: Tone): void {
    if (i === 0) return this.complete(req);
    this.travel(req, req.path[i]!, req.path[i - 1]!, tone, () => this.arriveBack(req, i - 1, tone));
  }

  private arriveBack(req: CReq, i: number, tone: Tone): void {
    const id = req.path[i]!;
    if (!req.missed.includes(id)) return this.back(req, i, tone);
    if (req.failed) {
      this.release(id, req, 'fail');
      return this.back(req, i, 'fail');
    }
    const cache = this.caches.get(id)!;
    const fill = () => {
      const placed = cache.fill(req.key!, req.version, this.sim.now, this.ttl());
      if (placed) {
        if (placed.evicted) {
          this.sim.emit({ kind: 'evict', node: id, key: placed.evicted.key, slot: placed.slot });
          if (placed.evicted.dirty) this.flushEntries([placed.evicted]);
        }
        this.sim.emit({ kind: 'fill', node: id, key: req.key, slot: placed.slot });
        this.sim.hop(req, `${this.labelOf(id)}: stored in slot ${placed.slot + 1}${placed.evicted ? `, evicting ${placed.evicted.key}` : ''}`);
      }
      this.release(id, req, tone);
      this.back(req, i, tone);
    };
    const victim = cache.victim();
    if (victim >= 0 && !cache.has(req.key!) && this.active(id)) {
      this.gate({ kind: 'evict', node: id, key: req.key!, slot: victim, victim: cache.slots[victim]!.key }, fill);
    } else fill();
  }

  /** Answer the requests that were waiting at `id` for this fetch. */
  private release(id: string, req: CReq, tone: Tone): void {
    const k = `${id}|${req.key}`;
    const waiting = this.inflight.get(k);
    if (!waiting) return;
    this.inflight.delete(k);
    for (const w of waiting) {
      w.version = req.version;
      w.servedBy = req.servedBy;
      w.failed = req.failed;
      if (w.version < w.minVersion) w.stale = true;
      w.missed = w.missed.filter((m) => m !== id);
      this.back(w, w.path.indexOf(id), req.failed ? 'fail' : tone);
    }
  }

  private fail(req: CReq, i: number): void {
    req.failed = true;
    this.sim.hop(req, 'Database: overloaded, request rejected');
    this.sim.emit({ kind: 'reject', node: 'db', key: req.key });
    this.back(req, i, 'fail');
  }

  private maybeRefresh(id: string, key: string, expiresAt: number | null): void {
    if (!this.cfg.refreshAhead || expiresAt === null || !this.cfg.ttlSec) return;
    const k = `${id}|${key}`;
    if (this.refreshing.has(k) || expiresAt - this.sim.now > this.cfg.ttlSec * 1000 * 0.35) return;
    this.refreshing.add(k);
    const req = this.newReq('refresh', id, key, false);
    this.sim.hop(req, `${this.labelOf(id)}: ${key} expires soon, refresh it in the background`);
    this.walk(req, [id, 'db'], 'control', () =>
      this.dbSubmit(
        req,
        () => {
          req.version = this.dbVersion.get(key) ?? 0;
          this.walk(req, ['db', id], 'control', () => {
            const placed = this.caches.get(id)!.fill(key, req.version, this.sim.now, this.ttl());
            if (placed) this.sim.emit({ kind: 'refresh', node: id, key, slot: placed.slot });
            this.refreshing.delete(k);
            req.done = true;
          });
        },
        () => {
          this.refreshing.delete(k);
          req.done = true;
        },
      ),
    );
  }

  // ---- writes (single topology) ----

  private startWrite(key: string): void {
    const req = this.newReq('write', 'users', key, true, ['users', 'app']);
    this.travel(req, 'users', 'app', 'write', () => {
      const v = (this.issued.get(key) ?? 0) + 1;
      this.issued.set(key, v);
      req.version = v;
      this.sim.hop(req, `App: write ${key} v${v}`);
      const ack = () => {
        this.acked.set(key, Math.max(this.acked.get(key) ?? 0, v));
        this.walk(req, ['app', 'users'], 'write', () => this.complete(req));
      };
      const failFrom = (nodes: string[]) => {
        req.failed = true;
        this.sim.hop(req, 'Database: overloaded, write rejected');
        this.sim.emit({ kind: 'reject', node: 'db', key });
        this.walk(req, nodes, 'fail', () => this.complete(req));
      };
      const strategy = this.cfg.cacheOn ? this.cfg.strategy : 'db-only';
      const cache = this.caches.get('cache')!;

      if (strategy === 'db-only' || strategy === 'write-around') {
        this.walk(req, ['app', 'db'], 'write', () =>
          this.dbSubmit(
            req,
            () => {
              this.commit(key, v);
              this.walk(req, ['db', 'app'], 'write', () => {
                if (strategy === 'db-only') return ack();
                this.walk(req, ['app', 'cache'], 'control', () => {
                  const slot = cache.invalidate(key, v);
                  this.sim.hop(req, `Cache: delete ${key}${slot < 0 ? ' (not cached)' : ''}`);
                  if (slot >= 0) this.sim.emit({ kind: 'invalidate', node: 'cache', key, slot });
                  this.walk(req, ['cache', 'app'], 'control', ack);
                });
              });
            },
            () => failFrom(['db', 'app', 'users']),
          ),
        );
        return;
      }

      this.walk(req, ['app', 'cache'], 'write', () => {
        const placed = cache.write(key, v, this.sim.now, this.ttl(), strategy === 'write-back');
        if (placed.evicted) {
          this.sim.emit({ kind: 'evict', node: 'cache', key: placed.evicted.key, slot: placed.slot });
          if (placed.evicted.dirty) this.flushEntries([placed.evicted]);
        }
        this.sim.emit({ kind: 'write', node: 'cache', key, slot: placed.slot });
        if (strategy === 'write-through') {
          this.sim.hop(req, `Cache: stored ${key} v${v}, now the database`);
          this.walk(req, ['cache', 'db'], 'write', () =>
            this.dbSubmit(
              req,
              () => {
                this.commit(key, v);
                this.walk(req, ['db', 'cache', 'app'], 'write', ack);
              },
              () => {
                cache.invalidate(key, 0);
                failFrom(['db', 'cache', 'app', 'users']);
              },
            ),
          );
          return;
        }
        this.sim.hop(req, `Cache: stored ${key} v${v}, marked dirty`);
        if (!this.cfg.replica) return this.walk(req, ['cache', 'app'], 'write', ack);
        this.walk(req, ['cache', 'replica'], 'write', () => {
          const r = this.replica.get(key);
          this.replica.set(key, { version: Math.max(r?.version ?? 0, v), pending: (r?.pending ?? 0) + 1 });
          this.sim.hop(req, `Replica: copy of ${key} v${v}`);
          this.walk(req, ['replica', 'cache', 'app'], 'write', ack);
        });
      });
    });
  }

  private commit(key: string, v: number): void {
    this.dbVersion.set(key, Math.max(this.dbVersion.get(key) ?? 0, v));
  }

  private flushTick(): void {
    this.sim.after(FLUSH_EVERY, () => this.flushTick());
    const cache = this.caches.get('cache');
    if (this.flushing || !cache) return;
    const dirty = cache.dirtyEntries();
    if (dirty.length) this.flushEntries(dirty, true);
  }

  /** Send dirty entries to the database in one batch. */
  private flushEntries(entries: { key: string; version: number; pending: number }[], periodic = false): void {
    if (!entries.length) return;
    const items = entries.map((e) => ({ key: e.key, version: e.version }));
    const req = this.newReq('flush', 'cache', undefined, false);
    req.count = entries.reduce((n, e) => n + Math.max(1, e.pending), 0);
    this.sim.hop(req, `Cache: flush ${req.count} write${req.count === 1 ? '' : 's'} (${items.map((i) => i.key).join(', ')})`);
    if (periodic) this.flushing = true;
    const cache = this.caches.get('cache')!;
    // Leaving the cache: the batch now owns these writes, so a crash can't lose them.
    cache.flushed(items);
    for (const i of items) this.replica.delete(i.key);
    this.sim.emit({ kind: 'flush-out', node: 'cache' });
    this.walk(req, ['cache', 'db'], 'flush', () =>
      this.dbSubmit(
        req,
        () => {
          items.forEach((i) => this.commit(i.key, i.version));
          this.walk(req, ['db', 'cache'], 'flush', () => {
            if (periodic) this.flushing = false;
            req.done = true;
          });
        },
        () => {
          // The database refused the batch: the writes go back to being dirty in the cache.
          for (const i of items) {
            const at = cache.find(i.key);
            const e = at >= 0 ? cache.slots[at]! : null;
            if (e && e.version <= i.version) {
              e.dirty = true;
              e.pending = Math.max(1, e.pending);
            }
          }
          if (periodic) this.flushing = false;
          req.done = true;
        },
      ),
    );
  }

  // ---- database ----

  private dbSubmit(req: CReq, done: () => void, rejected: () => void): void {
    this.timeline.count(this.sim.now, 'dbOps');
    this.database.submit(req, req.kind === 'read' || req.kind === 'refresh' ? 'query' : 'write', done, rejected);
  }

  // ---- results ----

  private complete(req: CReq): void {
    req.done = true;
    const now = this.sim.now;
    this.finished.push(req);
    if (this.finished.length > 40) this.finished.shift();
    if (req.failed) {
      this.timeline.count(now, 'failed');
      return;
    }
    if (req.kind === 'write') {
      this.timeline.count(now, 'writes');
      this.timeline.latency(now, 'write', req.modeledMs);
      return;
    }
    const hit = !!req.servedBy && req.servedBy !== 'db';
    this.timeline.count(now, 'reads');
    if (hit) this.timeline.count(now, 'hits');
    if (req.user) {
      this.timeline.count(now, 'userReads');
      if (hit) this.timeline.count(now, 'userHits');
    }
    this.timeline.latency(now, 'read', req.modeledMs);
    if (req.stale) {
      this.timeline.count(now, 'stale');
      this.sim.emit({ kind: 'stale', node: 'users', key: req.key });
    }
  }
}

export type CachingReq = CReq;

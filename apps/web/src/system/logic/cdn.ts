import { Sim, type Req, type Tone } from '../stage/engine';
import { CITIES, rttMs, stageMsFor, type CityId, type LatLon } from '../stage/geo';
import type { StageLayout } from '../stage/layout';
import { percentile, Timeline } from '../stage/metrics';
import { sampleCdf, zipfCdf } from '../stage/rng';
import { Server, type ServerState } from '../stage/server';
import { Cache } from './cache';
import { cdnLayout, ORIGIN, pinId, popId, PROVIDERS, routeId, SHIELD, type ProviderId } from './cdnMap';

export type CachingRule = 'all' | 'static' | 'headers';
export type Steering = 'anycast' | 'dns';
export type DeliveryMode = 'pull' | 'push';
export type CatalogId = 'site' | 'docs' | 'video';

export interface CdnConfig {
  cdnOn: boolean;
  provider: ProviderId;
  /** The provider's PoPs that are switched on. */
  pops: CityId[];
  origin: CityId;
  /** Cities with users; each pin stands for many users there. */
  pins: CityId[];
  /** Requests per stage second from each pin. */
  rps: number;
  catalog: CatalogId;
  /** How long edges keep static content (the origin's max-age), stage seconds. */
  ttlSec: number;
  /** On expiry, ask the origin "has it changed?" instead of fetching it again. */
  revalidate: boolean;
  /** A cache tier beside the origin that all edges fetch through. */
  shield: boolean;
  mode: DeliveryMode;
  /** Deployable files get a new name per version (app.v2.js), so a deploy is a new URL. */
  versioned: boolean;
  /** On a deploy, tell every edge to drop its copy of the old file. */
  purgeOnDeploy: boolean;
  /** What edges may cache: everything, static files only, or what each response's Cache-Control says. */
  rule: CachingRule;
  /** How users find an edge: anycast routing, or DNS answers they cache for `dnsTtlSec`. */
  steering: Steering;
  dnsTtlSec: number;
  /** Count the TCP and TLS handshakes of a new connection. */
  handshakes: boolean;
  /** Origin operations per stage second. */
  originCapacity: number;
  /** Pins in countries that block the CDN's domain: they go straight to the origin. */
  blocked: CityId[];
  /** Most PoPs that may be switched on (a mission's budget), or null for no limit. */
  popBudget: number | null;
}

export const DEFAULT_CDN: CdnConfig = {
  cdnOn: true,
  provider: 'global',
  pops: [...PROVIDERS.global.pops],
  origin: 'ash',
  pins: ['sfo', 'lon', 'bom', 'sin', 'syd'],
  rps: 1,
  catalog: 'site',
  ttlSec: 30,
  revalidate: false,
  shield: false,
  mode: 'pull',
  versioned: false,
  purgeOnDeploy: false,
  rule: 'static',
  steering: 'anycast',
  dnsTtlSec: 30,
  handshakes: false,
  originCapacity: 40,
  blocked: [],
  popBudget: null,
};

export interface ContentObject {
  key: string;
  size: number;
  /** static: the same for everyone; dynamic: changes often, same for everyone; private: different per user. */
  kind: 'static' | 'dynamic' | 'private';
  /** Changes when the site is deployed. */
  deployable?: boolean;
  /** Cache-Control max-age the origin sends for dynamic content, s. */
  maxAge?: number;
}

interface Group {
  weight: number;
  /** Zipf skew of popularity within the group. */
  skew: number;
  objects: ContentObject[];
}

const KB = 1000;
const MB = 1_000_000;
const many = (n: number, f: (i: number) => ContentObject) => Array.from({ length: n }, (_, i) => f(i + 1));

export const CATALOGS: Record<CatalogId, { label: string; edgeSlots: number; groups: Group[] }> = {
  site: {
    label: 'Web shop',
    edgeSlots: 40,
    groups: [
      { weight: 3, skew: 0, objects: [{ key: 'logo.png', size: 20 * KB, kind: 'static' }] },
      { weight: 3, skew: 0, objects: [{ key: 'app.js', size: 200 * KB, kind: 'static', deployable: true }] },
      { weight: 3, skew: 1, objects: many(20, (i) => ({ key: `video/seg-${i}`, size: 2 * MB, kind: 'static' })) },
      { weight: 2, skew: 0, objects: [{ key: 'api/prices', size: 5 * KB, kind: 'dynamic', maxAge: 2 }] },
      { weight: 1, skew: 0, objects: [{ key: '/cart', size: 8 * KB, kind: 'private' }] },
    ],
  },
  docs: { label: 'Docs site', edgeSlots: 40, groups: [{ weight: 1, skew: 0.3, objects: many(20, (i) => ({ key: `docs/page-${i}`, size: 30 * KB, kind: 'static' })) }] },
  video: { label: 'Video library', edgeSlots: 150, groups: [{ weight: 1, skew: 0.8, objects: many(2000, (i) => ({ key: `video/seg-${i}`, size: 2 * MB, kind: 'static' })) }] },
};

/** Users per city, so a city's requests come from different people (it matters for private pages). */
const USERS_PER_PIN = 50;
const EDGE_SERVE_MS = 2;
const ORIGIN_SERVE_MS = 20;
const ORIGIN_RENDER_MS = 60;
const NOT_MODIFIED_BYTES = 300;
/** How long routing takes to notice a dead PoP (anycast convergence, DNS health checks). */
const DETECT_MS = 2000;
const PRICES_EVERY_MS = 3000;

export type CdnOutcome = 'hit' | 'revalidated' | 'miss' | 'pass' | 'direct';

export interface CdnReq extends Req {
  pin: CityId;
  user: string;
  obj: ContentObject;
  pop: CityId | null;
  /** The origin's version of the object when the request started: anything older is stale. */
  minVersion: number;
  version: number;
  outcome?: CdnOutcome;
  /** Served someone else's private page. */
  leak?: boolean;
}

/** A point where a freeze frame may pause the run before it happens. */
export type CdnMoment =
  | {
      kind: 'edge-lookup';
      node: string;
      key: string;
      present: boolean;
      fresh: boolean;
      stale: boolean;
      leak: boolean;
      /** Version the edge holds, if any, and the origin's. */
      cachedVersion: number | null;
      originVersion: number;
      req: CdnReq;
    }
  | { kind: 'dead-pop'; node: string; pin: CityId };

interface Upstream {
  version: number;
  notModified: boolean;
  failed: boolean;
  /** For private pages: whose page this is. */
  owner?: string;
}

export interface CityLatency {
  p50: number;
  p95: number;
  n: number;
}

export interface CdnStats {
  seconds: number;
  reads: number;
  failed: number;
  /** Of the requests edges looked up, the share they answered (fresh or revalidated). */
  hitRatio: number;
  originOps: number;
  originRate: number;
  originMB: number;
  cdnMB: number;
  revalidations: number;
  notModified: number;
  /** Responses older than the origin's version of a deployable file. */
  stale: number;
  /** The same for dynamic content (prices). */
  staleDynamic: number;
  leaks: number;
  staticP50: number;
  staticP95: number;
  byCity: Partial<Record<CityId, CityLatency>>;
  /** Average stored at edges (and the shield) over the window. */
  storedMB: number;
  /** Illustrative cost: origin egress, CDN egress and storage. */
  credits: { origin: number; cdn: number; storage: number };
}

export interface Marker {
  at: number;
  label: string;
}

/** The CDN lesson's whole system: origin, edges, shield, users, routing and faults. */
export class CdnScene {
  readonly sim: Sim;
  readonly timeline = new Timeline();
  readonly markers: Marker[] = [];
  /** One cache per PoP of the provider, whether switched on or not. */
  readonly edges = new Map<CityId, Cache>();
  readonly shieldCache: Cache;
  /** Hits and lookups per PoP, for its badge. */
  readonly edgeStats = new Map<CityId, { hits: number; lookups: number }>();
  /** PoPs that have died, and when. */
  readonly dead = new Map<CityId, number>();
  /** Recent answered requests, newest last. */
  readonly finished: CdnReq[] = [];
  cfg: CdnConfig;
  layout: StageLayout;
  freezeHook: ((m: CdnMoment) => boolean) | null = null;
  frozen: CdnMoment | null = null;

  private pending: (() => void) | null = null;
  private origin: Server;
  private versions = new Map<string, number>();
  private sizes = new Map<string, number>();
  /** `${node}|${key}` → the user whose private page is cached there. */
  private owners = new Map<string, string>();
  /** Each user's cached DNS answer, by user id. */
  private dns = new Map<string, { pop: CityId | null; expires: number }>();
  private inflight = new Map<string, { waiters: CdnReq[] }>();
  private groupCdf: number[] = [];
  private objectCdfs: number[][] = [];

  constructor(cfg: CdnConfig, seed = 1) {
    // Only the provider's PoPs can be on (a provider switch may leave others in the list).
    const offered = PROVIDERS[cfg.provider].pops;
    this.cfg = { ...cfg, pops: cfg.pops.filter((c) => offered.includes(c)), pins: [...cfg.pins], blocked: [...cfg.blocked] };
    this.sim = new Sim(seed);
    this.layout = cdnLayout(this.cfg.pins, this.cfg.origin, this.cfg.provider);
    this.origin = new Server(this.sim, { name: 'Origin', workers: 4, maxQueue: 40, modeledMs: ORIGIN_SERVE_MS, capacity: () => this.cfg.originCapacity });
    const catalog = CATALOGS[this.cfg.catalog];
    const staticCount = catalog.groups.flatMap((g) => g.objects).filter((o) => o.kind === 'static').length;
    // Push stores everything everywhere, so a pushed edge needs room for every static file.
    const slots = this.cfg.mode === 'push' ? Math.max(catalog.edgeSlots, staticCount + 4) : catalog.edgeSlots;
    for (const c of PROVIDERS[this.cfg.provider].pops) {
      this.edges.set(c, new Cache(slots, 'lru', () => this.sim.rng.next()));
      this.edgeStats.set(c, { hits: 0, lookups: 0 });
    }
    this.shieldCache = new Cache(slots * 2, 'lru', () => this.sim.rng.next());
    const total = catalog.groups.reduce((n, g) => n + g.weight, 0);
    let acc = 0;
    this.groupCdf = catalog.groups.map((g) => (acc += g.weight / total));
    this.objectCdfs = catalog.groups.map((g) => zipfCdf(g.objects.length, g.skew));
    for (const o of catalog.groups.flatMap((g) => g.objects)) this.versions.set(o.key, 1);
    for (const c of this.cfg.pins) this.startPin(c);
    this.sim.after(PRICES_EVERY_MS, () => this.tickPrices());
    this.sim.after(1000, () => this.tickStorage());
    if (this.cfg.mode === 'push' && this.cfg.cdnOn) this.publish();
  }

  // ---- controls ----

  /** Apply control changes to a running scene. Provider, origin, catalog and mode need a new scene. */
  configure(patch: Partial<CdnConfig>): void {
    const prev = this.cfg;
    this.cfg = { ...prev, ...patch };
    if (patch.pins) {
      this.layout = cdnLayout(this.cfg.pins, this.cfg.origin, this.cfg.provider);
      for (const c of this.cfg.pins) if (!prev.pins.includes(c)) this.startPin(c);
    }
    // Switching a PoP off takes effect at once, whatever the steering.
    if (patch.pops || patch.cdnOn !== undefined) for (const [user, d] of this.dns) if (d.pop && !this.cfg.pops.includes(d.pop)) this.dns.delete(user);
    if (patch.steering || patch.dnsTtlSec !== undefined) this.dns.clear();
  }

  /** Version the origin currently has of an object. */
  versionOf(key: string): number {
    return this.versions.get(key) ?? 1;
  }

  get originState(): ServerState {
    return this.origin.state;
  }

  isDead(c: CityId): boolean {
    return this.dead.has(c);
  }

  /** Bytes an edge holds right now. */
  storedAt(c: CityId): number {
    return this.edges.get(c)!.entries().reduce((n, e) => n + (this.sizes.get(e.key) ?? 0), 0);
  }

  // ---- faults and events ----

  /** Ship a new version of every deployable file. */
  deploy(): void {
    const catalog = CATALOGS[this.cfg.catalog];
    const files = catalog.groups.flatMap((g) => g.objects).filter((o) => o.deployable);
    if (!files.length) return;
    for (const f of files) this.versions.set(f.key, this.versionOf(f.key) + 1);
    this.mark(`deploy v${this.versionOf(files[0]!.key)}`);
    if (!this.cfg.cdnOn) return;
    if (this.cfg.mode === 'push') return this.pushTo(this.cfg.pops, files);
    if (!this.cfg.purgeOnDeploy || this.cfg.versioned) return;
    for (const c of this.cfg.pops) {
      const req = this.sim.req('purge', ORIGIN);
      this.leg(req, ORIGIN, popId(c), true, 'control', () => {
        for (const f of files) {
          const slot = this.edges.get(c)!.invalidate(f.key, this.versionOf(f.key));
          if (slot >= 0) this.sim.emit({ kind: 'purge', node: popId(c), key: f.key, slot });
        }
        req.done = true;
      });
    }
    if (this.cfg.shield) for (const f of files) this.shieldCache.invalidate(f.key, this.versionOf(f.key));
  }

  /** A PoP goes down. Routing notices after a couple of seconds; DNS answers cached by users keep pointing at it until they expire. */
  failPop(c: CityId): void {
    if (this.dead.has(c)) return;
    this.dead.set(c, this.sim.now);
    this.edges.get(c)!.clear();
    this.sim.emit({ kind: 'crash', node: popId(c) });
    this.mark(`${CITIES[c].name} edge down`);
  }

  restorePop(c: CityId): void {
    this.dead.delete(c);
  }

  // ---- routing ----

  private healthy(c: CityId): boolean {
    const died = this.dead.get(c);
    return this.cfg.pops.includes(c) && (died === undefined || this.sim.now - died < DETECT_MS);
  }

  private nearest(pin: CityId): CityId | null {
    let best: CityId | null = null;
    for (const c of this.cfg.pops) if (this.healthy(c) && (!best || rttMs(CITIES[pin], CITIES[c]) < rttMs(CITIES[pin], CITIES[best]))) best = c;
    return best;
  }

  private cachedAnswer(user: string): CityId | null | undefined {
    const d = this.dns.get(user);
    return d && d.expires > this.sim.now && (!d.pop || this.cfg.pops.includes(d.pop)) ? d.pop : undefined;
  }

  /**
   * Which PoP `user` (in `pin`) reaches now, or null to go straight to the origin. Under DNS
   * steering each user keeps the answer they got for the DNS TTL, even if that PoP dies.
   */
  resolve(pin: CityId, user: string): CityId | null {
    if (!this.cfg.cdnOn || this.cfg.blocked.includes(pin)) return null;
    if (this.cfg.steering === 'anycast') return this.nearest(pin);
    const cached = this.cachedAnswer(user);
    if (cached !== undefined) return cached;
    const pop = this.nearest(pin);
    this.dns.set(user, { pop, expires: this.sim.now + this.cfg.dnsTtlSec * 1000 });
    return pop;
  }

  /** Where a city's users are going right now: under DNS, some may still hold an old answer. */
  private destinations(pin: CityId): (CityId | null)[] {
    if (!this.cfg.cdnOn || this.cfg.blocked.includes(pin)) return [null];
    const out = new Set<CityId | null>([this.nearest(pin)]);
    if (this.cfg.steering === 'dns') for (const user of this.dns.keys()) if (user.startsWith(`${pin}#`) && this.cachedAnswer(user) !== undefined) out.add(this.cachedAnswer(user)!);
    return [...out];
  }

  /** The routes in use right now, for drawing. */
  routesInUse(): Set<string> {
    const out = new Set<string>();
    for (const pin of this.cfg.pins) {
      for (const pop of this.destinations(pin)) {
        if (!pop) {
          out.add(routeId(pinId(pin), ORIGIN));
          continue;
        }
        out.add(routeId(pinId(pin), popId(pop)));
        if (this.cfg.shield) out.add(routeId(popId(pop), SHIELD)).add(routeId(SHIELD, ORIGIN));
        else out.add(routeId(popId(pop), ORIGIN));
      }
    }
    for (const t of this.sim.travels.values()) out.add(t.wire);
    return out;
  }

  // ---- freeze frames ----

  resume(): void {
    const fn = this.pending;
    this.pending = null;
    this.frozen = null;
    this.sim.halted = false;
    fn?.();
  }

  private gate(m: CdnMoment, fn: () => void): void {
    if (this.freezeHook?.(m)) {
      this.frozen = m;
      this.pending = fn;
      this.sim.halted = true;
    } else fn();
  }

  // ---- traffic ----

  private startPin(c: CityId): void {
    this.sim.after(this.sim.rng.gapMs(this.cfg.rps), () => {
      if (!this.cfg.pins.includes(c)) return;
      this.arrival(c);
      this.startPin(c);
    });
  }

  private pick(): ContentObject {
    const groups = CATALOGS[this.cfg.catalog].groups;
    const g = sampleCdf(this.groupCdf, this.sim.rng.next());
    return groups[g]!.objects[sampleCdf(this.objectCdfs[g]!, this.sim.rng.next())]!;
  }

  /** The URL a request asks for: versioned names put the version in the file name. */
  private urlFor(obj: ContentObject, version: number): string {
    return this.cfg.versioned && obj.deployable ? obj.key.replace(/(\.\w+)$/, `.v${version}$1`) : obj.key;
  }

  private mark(label: string): void {
    this.markers.push({ at: this.sim.now, label });
  }

  private placeOf(node: string): LatLon & { name: string } {
    if (node === ORIGIN) return { ...CITIES[this.cfg.origin], name: 'Origin' };
    if (node === SHIELD) return { ...CITIES[this.cfg.origin], name: 'Origin shield' };
    const c = CITIES[node.slice(4) as CityId];
    return node.startsWith('pop-') ? { ...c, name: `${c.name} edge` } : c;
  }

  /** One trip along the route between two nodes; `back` runs it from `to` to `from`. */
  private leg(req: Req, from: string, to: string, back: boolean, tone: Tone, then: () => void): void {
    const a = this.placeOf(from);
    const b = this.placeOf(to);
    this.sim.send(req, routeId(from, to), { reverse: back, stageMs: stageMsFor(a, b), modeledMs: rttMs(a, b) / 2, tone, label: back ? `${b.name} → ${a.name}` : `${a.name} → ${b.name}` }, then);
  }

  private arrival(pin: CityId): void {
    const obj = this.pick();
    const version = this.versionOf(obj.key);
    const req: CdnReq = Object.assign(this.sim.req('read', pinId(pin), this.urlFor(obj, version)), {
      size: obj.size,
      pin,
      user: `${pin}#${this.sim.rng.int(USERS_PER_PIN) + 1}`,
      obj,
      pop: null,
      minVersion: version,
      version: 0,
    });
    const pop = this.resolve(pin, req.user);
    req.pop = pop;
    if (this.cfg.handshakes) {
      const peer = pop ? this.placeOf(popId(pop)) : this.placeOf(ORIGIN);
      this.sim.hop(req, `New connection to ${peer.name}: TCP + TLS handshakes (2 round trips)`, 2 * rttMs(CITIES[pin], peer));
    }
    if (!pop) {
      req.outcome = 'direct';
      this.leg(req, pinId(pin), ORIGIN, false, 'request', () =>
        this.serveAtOrigin(req, null, (res) => {
          if (res.failed) return this.fail(req, pinId(pin), ORIGIN);
          req.version = res.version;
          this.leg(req, pinId(pin), ORIGIN, true, 'miss', () => this.complete(req));
        }),
      );
      return;
    }
    this.leg(req, pinId(pin), popId(pop), false, 'request', () => this.atEdge(req, pop));
  }

  /** How long an edge may keep this object, in ms; undefined if it mustn't cache it at all. */
  private ttlFor(obj: ContentObject): number | null | undefined {
    if (this.cfg.mode === 'push') return obj.kind === 'static' ? null : undefined;
    const ttl = this.cfg.ttlSec * 1000;
    if (this.cfg.rule === 'all') return ttl;
    if (obj.kind === 'static') return ttl;
    if (this.cfg.rule === 'headers' && obj.kind === 'dynamic') return (obj.maxAge ?? 0) * 1000;
    return undefined;
  }

  private atEdge(req: CdnReq, pop: CityId): void {
    const node = popId(pop);
    if (this.dead.has(pop)) {
      this.gate({ kind: 'dead-pop', node, pin: req.pin }, () => this.fail(req, pinId(req.pin), node, `${this.placeOf(node).name}: down, the connection times out`));
      return;
    }
    const ttl = this.ttlFor(req.obj);
    if (ttl === undefined) {
      // Not cacheable here: the edge only forwards it.
      req.outcome = 'pass';
      this.sim.hop(req, `${this.placeOf(node).name}: not cached, forward to the origin`, EDGE_SERVE_MS);
      this.upstream(req, pop, null, undefined, (res) => this.answer(req, pop, res, 'miss'));
      return;
    }
    const cache = this.edges.get(pop)!;
    const stats = this.edgeStats.get(pop)!;
    const key = req.key!;
    const at = cache.find(key);
    const entry = at >= 0 ? cache.slots[at]! : null;
    const fresh = !!entry && (entry.expiresAt === null || entry.expiresAt > this.sim.now);
    const owner = this.owners.get(`${node}|${key}`);
    const leak = fresh && req.obj.kind === 'private' && !!owner && owner !== req.user;
    const moment = { kind: 'edge-lookup' as const, node, key, present: !!entry, fresh, stale: fresh && entry!.version < req.minVersion, leak, cachedVersion: entry?.version ?? null, originVersion: req.minVersion, req };
    this.gate(moment, () => {
      stats.lookups++;
      this.timeline.count(this.sim.now, 'edgeLookups');
      const r = cache.lookup(key, this.sim.now, { keepExpired: this.cfg.revalidate && this.cfg.mode === 'pull' });
      if (r.hit) {
        stats.hits++;
        req.outcome = 'hit';
        req.version = r.entry.version;
        req.leak = leak;
        this.sim.hop(req, `${this.placeOf(node).name}: hit`, EDGE_SERVE_MS);
        this.sim.emit({ kind: 'hit', node, key, slot: r.slot });
        return this.answer(req, pop, { version: r.entry.version, notModified: false, failed: false }, 'hit');
      }
      if (this.cfg.mode === 'push') {
        // Not pushed (yet): a push CDN doesn't fetch, so the edge forwards it.
        req.outcome = 'pass';
        this.sim.hop(req, `${this.placeOf(node).name}: not pushed here, forward to the origin`, EDGE_SERVE_MS);
        return this.upstream(req, pop, null, undefined, (res) => this.answer(req, pop, res, 'miss'));
      }
      const kept = r.entry;
      this.sim.hop(req, `${this.placeOf(node).name}: ${kept ? `expired, ask the origin if ${key} changed` : 'miss'}`, EDGE_SERVE_MS);
      this.sim.emit({ kind: kept ? 'expire' : 'miss', node, key, slot: r.slot });
      if (kept) this.timeline.count(this.sim.now, 'revalidations');
      // Collapsed forwarding: one fetch per key per edge, later requests wait for it.
      const flight = `${node}|${key}`;
      const waiting = this.inflight.get(flight);
      if (waiting) {
        waiting.waiters.push(req);
        this.sim.hop(req, `${this.placeOf(node).name}: wait for the fetch already in flight`);
        return;
      }
      this.inflight.set(flight, { waiters: [] });
      this.upstream(req, pop, kept ? kept.version : null, ttl, (res) => {
        const waiters = this.inflight.get(flight)?.waiters ?? [];
        this.inflight.delete(flight);
        if (!res.failed) {
          const placed = cache.fill(key, res.version, this.sim.now, ttl);
          if (placed) {
            this.sizes.set(key, req.obj.size);
            if (req.obj.kind === 'private') this.owners.set(flight, res.owner ?? req.user);
            this.sim.emit({ kind: 'fill', node, key, slot: placed.slot });
          }
          if (res.notModified) stats.hits++;
        }
        const tone: Tone = res.notModified ? 'hit' : 'miss';
        req.outcome = res.notModified ? 'revalidated' : 'miss';
        this.answer(req, pop, res, tone);
        for (const w of waiters) {
          w.outcome = req.outcome;
          w.leak = req.obj.kind === 'private' && (res.owner ?? req.user) !== w.user;
          this.answer(w, pop, res, tone);
        }
      });
    });
  }

  /**
   * Fetch for an edge: through the shield if there is one, else from the origin. A known
   * `condVersion` makes it a conditional request, answered 304 if nothing changed.
   */
  private upstream(req: CdnReq, pop: CityId, condVersion: number | null, ttl: number | null | undefined, done: (res: Upstream) => void): void {
    const node = popId(pop);
    const tone: Tone = condVersion !== null ? 'control' : 'miss';
    const fromOrigin = (via: string, then: (res: Upstream) => void) =>
      this.leg(req, via, ORIGIN, false, tone, () =>
        this.serveAtOrigin(req, condVersion, (res) => this.leg(req, via, ORIGIN, true, res.failed ? 'fail' : res.notModified ? 'control' : 'miss', () => then(res))),
      );
    if (!this.cfg.shield || this.cfg.mode === 'push') return fromOrigin(node, done);
    this.leg(req, node, SHIELD, false, tone, () => {
      const cacheable = ttl !== undefined && req.obj.kind !== 'private';
      const r = cacheable ? this.shieldCache.lookup(req.key!, this.sim.now) : null;
      const back = (res: Upstream) => this.leg(req, node, SHIELD, true, res.notModified ? 'control' : res.failed ? 'fail' : 'miss', () => done(res));
      if (r?.hit) {
        this.sim.hop(req, 'Origin shield: hit', EDGE_SERVE_MS);
        return back({ version: r.entry.version, notModified: condVersion === r.entry.version, failed: false });
      }
      this.sim.hop(req, `Origin shield: ${cacheable ? 'miss' : 'forward'}`, EDGE_SERVE_MS);
      fromOrigin(SHIELD, (res) => {
        if (cacheable && !res.failed) {
          this.shieldCache.fill(req.key!, res.version, this.sim.now, ttl ?? null);
          this.sizes.set(req.key!, req.obj.size);
        }
        back(res);
      });
    });
  }

  private serveAtOrigin(req: CdnReq, condVersion: number | null, then: (res: Upstream) => void): void {
    this.timeline.count(this.sim.now, 'originOps');
    const dynamic = req.obj.kind !== 'static';
    this.origin.submit(
      req,
      dynamic ? 'build the response' : 'serve the file',
      () => {
        if (dynamic) this.sim.hop(req, 'Origin: render', ORIGIN_RENDER_MS);
        // A versioned URL names one version, which never changes.
        const version = this.cfg.versioned && req.obj.deployable ? req.minVersion : this.versionOf(req.obj.key);
        const notModified = condVersion !== null && condVersion === version;
        if (notModified) {
          this.timeline.count(this.sim.now, 'notModified');
          this.sim.hop(req, 'Origin: 304 Not Modified');
        }
        this.timeline.count(this.sim.now, 'originBytes', notModified ? NOT_MODIFIED_BYTES : req.obj.size);
        then({ version, notModified, failed: false, owner: req.user });
      },
      () => then({ version: 0, notModified: false, failed: true }),
    );
  }

  /** Edge → user. */
  private answer(req: CdnReq, pop: CityId, res: Upstream, tone: Tone): void {
    if (res.failed) return this.fail(req, pinId(req.pin), popId(pop));
    req.version = res.version;
    this.timeline.count(this.sim.now, 'cdnBytes', req.obj.size);
    this.leg(req, pinId(req.pin), popId(pop), true, tone, () => this.complete(req));
  }

  private fail(req: CdnReq, from: string, to: string, why = 'Origin: overloaded, request rejected'): void {
    req.failed = true;
    this.sim.hop(req, why);
    this.sim.emit({ kind: 'reject', node: to });
    this.leg(req, from, to, true, 'fail', () => this.complete(req));
  }

  private complete(req: CdnReq): void {
    req.done = true;
    const now = this.sim.now;
    this.finished.push(req);
    if (this.finished.length > 200) this.finished.shift();
    this.timeline.count(now, 'reads');
    if (req.failed) return this.timeline.count(now, 'failed');
    if (req.outcome === 'hit' || req.outcome === 'revalidated') this.timeline.count(now, 'edgeHits');
    this.timeline.sample(now, `lat:${req.pin}`, req.modeledMs);
    if (req.obj.kind === 'static') {
      this.timeline.sample(now, 'static', req.modeledMs);
      this.timeline.sample(now, `static:${req.pin}`, req.modeledMs);
    }
    if (req.version < req.minVersion) this.timeline.count(now, req.obj.kind === 'dynamic' ? 'staleDynamic' : 'stale');
    if (req.leak) {
      this.timeline.count(now, 'leaks');
      this.sim.emit({ kind: 'leak', node: pinId(req.pin), key: req.key });
    }
  }

  // ---- push ----

  /** Push every static file to every PoP that's switched on. */
  publish(): void {
    const files = CATALOGS[this.cfg.catalog].groups.flatMap((g) => g.objects).filter((o) => o.kind === 'static');
    this.mark('publish');
    this.pushTo(this.cfg.pops, files);
  }

  private pushTo(pops: CityId[], files: ContentObject[]): void {
    for (const c of pops) {
      const req = Object.assign(this.sim.req('push', ORIGIN), { count: files.length, size: Math.max(...files.map((f) => f.size)) });
      this.timeline.count(this.sim.now, 'originBytes', files.reduce((n, f) => n + f.size, 0));
      this.leg(req, popId(c), ORIGIN, true, 'flush', () => {
        const cache = this.edges.get(c)!;
        for (const f of files) {
          const key = this.urlFor(f, this.versionOf(f.key));
          cache.write(key, this.versionOf(f.key), this.sim.now, null, false);
          this.sizes.set(key, f.size);
        }
        this.sim.emit({ kind: 'pushed', node: popId(c), text: `${files.length} file${files.length === 1 ? '' : 's'}` });
        req.done = true;
      });
    }
  }

  // ---- clocks ----

  private tickPrices(): void {
    this.versions.set('api/prices', this.versionOf('api/prices') + 1);
    this.sim.after(PRICES_EVERY_MS, () => this.tickPrices());
  }

  private tickStorage(): void {
    let bytes = 0;
    for (const c of this.cfg.pops) bytes += this.storedAt(c);
    if (this.cfg.shield) bytes += this.shieldCache.entries().reduce((n, e) => n + (this.sizes.get(e.key) ?? 0), 0);
    this.timeline.sample(this.sim.now, 'storedMB', bytes / MB);
    this.sim.after(1000, () => this.tickStorage());
  }

  // ---- results ----

  /** What the instruments and missions read over whole seconds [fromSec, toSec). */
  stats(fromSec: number, toSec: number): CdnStats {
    const t = this.timeline;
    const sum = (k: string) => t.sum(fromSec, toSec, k);
    const seconds = t.seconds(fromSec, toSec);
    const lookups = sum('edgeLookups');
    const statics = t.values(fromSec, toSec, 'static');
    const byCity: Partial<Record<CityId, CityLatency>> = {};
    for (const c of this.cfg.pins) {
      const v = t.values(fromSec, toSec, `static:${c}`);
      if (v.length) byCity[c] = { p50: percentile(v, 50), p95: percentile(v, 95), n: v.length };
    }
    const stored = t.values(fromSec, toSec, 'storedMB');
    const storedMB = stored.length ? stored.reduce((a, b) => a + b, 0) / stored.length : 0;
    const originMB = sum('originBytes') / MB;
    const cdnMB = sum('cdnBytes') / MB;
    return {
      seconds,
      reads: sum('reads'),
      failed: sum('failed'),
      // Hits are counted when answered and lookups when made, so a window's edges can tip it past 1.
      hitRatio: lookups ? Math.min(1, sum('edgeHits') / lookups) : 0,
      originOps: sum('originOps'),
      originRate: sum('originOps') / seconds,
      originMB,
      cdnMB,
      revalidations: sum('revalidations'),
      notModified: sum('notModified'),
      stale: sum('stale'),
      staleDynamic: sum('staleDynamic'),
      leaks: sum('leaks'),
      staticP50: percentile(statics, 50),
      staticP95: percentile(statics, 95),
      byCity,
      storedMB,
      credits: { origin: originMB * 0.09, cdn: cdnMB * 0.06, storage: storedMB * seconds * 0.002 },
    };
  }
}

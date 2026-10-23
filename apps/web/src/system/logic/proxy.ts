import { Sim, type Req, type Tone } from '../stage/engine';
import { percentile, Timeline } from '../stage/metrics';
import { Server, type ServerState } from '../stage/server';
import { Cache } from './cache';
import {
  ADDR,
  addressesOf,
  BACKENDS,
  countryOf,
  CUSTOMERS,
  FILES,
  FWD,
  LAPTOPS,
  NAMES,
  PROXY_LAYOUT,
  REV,
  routeId,
  SCRAPER,
  SITES,
  STANDBY,
  type Backend,
  type Country,
  type Laptop,
  type Site,
} from './proxyMap';

export type TlsMode = 'terminate' | 'reencrypt' | 'passthrough';
export type Compression = 'off' | 'backend' | 'proxy';

export interface ProxyConfig {
  /** The office sends its traffic through its forward proxy. */
  fwdOn: boolean;
  /** Transparent mode: the forward proxy adds X-Forwarded-For with the laptop's own address. */
  transparent: boolean;
  /** Which country the forward proxy's traffic leaves from. */
  egress: Country;
  /** The forward proxy refuses requests to blocked.example. */
  filter: boolean;
  /** The shop's traffic arrives at a reverse proxy; otherwise shop.example lists every backend. */
  revOn: boolean;
  /**
   * terminate: the proxy decrypts, and talks plain HTTP inside the data centre. reencrypt: it
   * decrypts, then encrypts again to the backends over kept-open connections. passthrough: it
   * forwards the encrypted bytes untouched, so it can't read paths or headers.
   */
  tls: TlsMode;
  /** The reverse proxy sends /static/* to the file store (it has to read the path to do this). */
  routes: boolean;
  /** Where text responses are gzipped, if anywhere. */
  compression: Compression;
  /** The reverse proxy keeps responses for /, /api/catalog and /static/* for `cacheTtlSec`. */
  cache: boolean;
  cacheTtlSec: number;
  /** Requests a second each client address may make (a token bucket), or null for no limit. */
  rateLimit: number | null;
  /** Client addresses the reverse proxy refuses outright. */
  blocklist: string[];
  /** A standby proxy that takes over the shop's address when the first one dies. */
  standby: boolean;
  /** How often the standby checks the first proxy is alive, stage seconds. */
  healthCheckSec: number;
  /** How many app servers are running. */
  backends: 1 | 2 | 3;
  /** Requests per stage second from each laptop. */
  officeRps: number;
  /** Requests per stage second from each of the six customers. */
  customerRps: number;
  scraperRps: number;
}

export const DEFAULT_PROXY: ProxyConfig = {
  fwdOn: true,
  transparent: false,
  egress: 'de',
  filter: true,
  revOn: true,
  tls: 'terminate',
  routes: true,
  compression: 'proxy',
  cache: false,
  cacheTtlSec: 10,
  rateLimit: null,
  blocklist: [],
  standby: false,
  healthCheckSec: 3,
  backends: 3,
  officeRps: 0.6,
  customerRps: 0.4,
  scraperRps: 4,
};

export type Destination = Site | 'shop';
/** ok; refused by the office filter; refused by a geo-restricted site; failed; throttled (429); on the shop's blocklist (403). */
export type Outcome = 'ok' | 'blocked' | 'geo' | 'failed' | 'limited' | 'denied';

export interface ProxyReq extends Req {
  /** The party that sent it: a laptop, a customer or the scraper. */
  client: string;
  dest: Destination;
  /** Nodes visited, in order, so the response can retrace them. */
  path: string[];
  outcome?: Outcome;
  /** Without a reverse proxy: the backend shop.example's DNS answer pointed to. */
  backend?: Backend;
  /** The reverse proxy that handled it. */
  proxy?: string;
  /** Answered from the reverse proxy's cache. */
  cached?: boolean;
  /** The proxy should keep the response on its way back. */
  fill?: boolean;
  compressed?: boolean;
}

/** A point where a freeze frame may pause the run before it happens. */
export type ProxyMoment =
  /** A client is about to send a request to the shop, straight from its own machine. */
  | { kind: 'depart'; node: string; req: ProxyReq }
  /** At the forward proxy, the reverse proxy or a site, before it acts on the request. */
  | { kind: 'arrive'; node: string; req: ProxyReq; cachedCopy: boolean }
  /** The reverse proxy is about to answer 429 to this client address. */
  | { kind: 'limited'; node: string; req: ProxyReq; addr: string }
  | { kind: 'proxy-down'; node: string };

export interface ProxyStats {
  seconds: number;
  answered: number;
  failed: number;
  /** Throttled with 429, in total and of real users (not the scraper). */
  limited: number;
  limitedReal: number;
  /** Refused by the shop's blocklist, in total and of real users. */
  denied: number;
  deniedReal: number;
  /** Failed shop requests (the proxy was down, or a queue overflowed). */
  shopFailed: number;
  /** The office's requests to video.example, and how many it answered. */
  officeVideo: number;
  officeVideoOk: number;
  /** The office's requests that blocked.example answered. */
  officeReachedBlocked: number;
  blocked: number;
  geo: number;
  /** Answered from the reverse proxy's cache. */
  cached: number;
  scraperTotal: number;
  scraperServed: number;
  /** Requests that reached the app servers, and /static requests among them. */
  appRequests: number;
  staticAtApps: number;
  /** CPU of the running app servers, averaged, and of the active reverse proxy (0–1). */
  appCpu: number;
  proxyCpu: number;
  /** Bytes the shop sent to clients, after any compression. */
  egressMB: number;
  customerP50: number;
  customerP95: number;
}

const SHOP_HOST = 'shop.example';
const SHOP_PATHS: [string, number][] = [
  ['/', 2],
  ['/api/catalog', 2],
  ['/static/logo.png', 3],
  ['/cart', 1],
];
const OFFICE_DESTS: [Destination, number][] = [
  ['news', 3],
  ['video', 2],
  ['blocked', 1],
  ['shop', 3],
];
const HOSTS: Record<Site, string> = { news: 'news.example', video: 'video.example', blocked: 'blocked.example' };

/** What each shop path sends back. */
const BODIES: Record<string, { bytes: number; text: boolean; cacheable: boolean }> = {
  '/': { bytes: 60_000, text: true, cacheable: true },
  '/api/catalog': { bytes: 40_000, text: true, cacheable: true },
  '/static/logo.png': { bytes: 20_000, text: false, cacheable: true },
  '/cart': { bytes: 10_000, text: true, cacheable: false },
};
const GZIP_RATIO = 0.25;

/**
 * CPU work in modeled ms. Illustrative, chosen so offloading moves expensive work to where it's
 * cheap: a proxy resumes TLS sessions and keeps connections open, a backend handshakes each time.
 */
const WORK = {
  app: 8,
  staticAtApp: 3,
  file: 3,
  tlsAtBackend: 12,
  tlsReuseAtBackend: 4,
  tlsAtProxy: 4,
  gzip: 4,
  forward: 1,
};

/** On-screen time for one hop at 1×: these are short hops on one diagram. */
const STAGE_MS = 520;
const HOP_MS = 10;
const APP_WORKERS = 2;
const PROXY_WORKERS = 4;
/** A dead proxy without a standby comes back after this long. */
const RESTART_MS = 20_000;
/** A rate limiter's bucket holds this many seconds of requests, so a client may burst a little. */
const BURST_SEC = 3;

const pick = <T>(rng: () => number, weighted: [T, number][]): T => {
  let r = rng() * weighted.reduce((n, [, w]) => n + w, 0);
  return (weighted.find(([, w]) => (r -= w) < 0) ?? weighted[0]!)[0];
};

/** The proxy lesson's world: an office, the internet and a shop's data centre. */
export class ProxyScene {
  readonly sim: Sim;
  readonly timeline = new Timeline();
  readonly layout = PROXY_LAYOUT;
  /** Every address each party has seen on requests it received (or, for clients, connected to). */
  readonly seen = new Map<string, Set<string>>();
  /** Requests the forward proxy has logged, per laptop: it sees everything that passes through. */
  readonly proxyLog = new Map<Laptop, number>();
  readonly finished: ProxyReq[] = [];
  /** Labelled moments for the timeline: the proxy dying, the standby taking over, the restart. */
  readonly markers: { at: number; label: string }[] = [];
  cfg: ProxyConfig;
  freezeHook: ((m: ProxyMoment) => boolean) | null = null;
  frozen: ProxyMoment | null = null;
  /** When the first reverse proxy died, if it's down. */
  proxyDownAt: number | null = null;

  private pending: (() => void) | null = null;
  private servers = new Map<string, Server>();
  private caches = new Map<string, Cache>();
  /** Whether each proxy's cached copy of a path was stored gzipped: a hit is sent as it was kept. */
  private storedGzipped = new Map<string, boolean>();
  /** Token buckets per proxy and client address. */
  private buckets = new Map<string, { tokens: number; at: number }>();
  private rr = 0;

  constructor(cfg: ProxyConfig, seed = 1) {
    this.cfg = { ...cfg, blocklist: [...cfg.blocklist] };
    this.sim = new Sim(seed);
    const cpu = (id: string) => (ms: number) => this.timeline.count(this.sim.now, `cpu:${id}`, ms);
    for (const b of [...BACKENDS, FILES]) {
      this.servers.set(b, new Server(this.sim, { name: NAMES[b]!, workers: APP_WORKERS, maxQueue: 20, modeledMs: WORK.app, capacity: () => 40, onWork: cpu(b) }));
    }
    for (const p of [REV, STANDBY]) {
      this.servers.set(p, new Server(this.sim, { name: NAMES[p]!, workers: PROXY_WORKERS, maxQueue: 60, modeledMs: WORK.forward, capacity: () => 400, onWork: cpu(p) }));
      this.caches.set(p, new Cache(16, 'lru', () => this.sim.rng.next()));
    }
    for (const l of LAPTOPS) this.loop(() => this.cfg.officeRps, () => this.officeRequest(l));
    for (const addr of ADDR.customers) this.loop(() => this.cfg.customerRps, () => this.shopRequest(CUSTOMERS, addr));
    this.loop(() => this.cfg.scraperRps, () => this.shopRequest(SCRAPER, ADDR.scraper, '/api/catalog'));
  }

  configure(patch: Partial<ProxyConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
  }

  resume(): void {
    const fn = this.pending;
    this.pending = null;
    this.frozen = null;
    this.sim.halted = false;
    fn?.();
  }

  private gate(m: ProxyMoment, fn: () => void): void {
    if (this.freezeHook?.(m)) {
      this.frozen = m;
      this.pending = fn;
      this.sim.halted = true;
    } else fn();
  }

  serverState(id: string): ServerState | undefined {
    return this.servers.get(id)?.state;
  }

  /** Can the reverse proxy read requests? Not if TLS passes straight through it. */
  get readsRequests(): boolean {
    return this.cfg.tls !== 'passthrough';
  }

  /** The nodes on stage right now: proxies that are off, and backends not running, aren't there. */
  present(id: string): boolean {
    if (id === FWD) return this.cfg.fwdOn;
    if (id === REV) return this.cfg.revOn;
    if (id === STANDBY) return this.cfg.revOn && this.cfg.standby;
    if (id === FILES) return this.cfg.revOn && this.cfg.routes;
    if (BACKENDS.includes(id as Backend)) return BACKENDS.indexOf(id as Backend) < this.cfg.backends;
    return true;
  }

  // ---- the reverse proxy's failures ----

  /** The first reverse proxy dies. A standby takes over after its next health check; without one, it restarts after 20 s. */
  failProxy(): void {
    if (this.proxyDownAt !== null) return;
    this.proxyDownAt = this.sim.now;
    this.sim.emit({ kind: 'crash', node: REV });
    this.markers.push({ at: this.sim.now, label: 'proxy dies' });
    if (this.cfg.standby) {
      this.sim.after(this.cfg.healthCheckSec * 1000, () => {
        if (this.activeProxy() === STANDBY) this.markers.push({ at: this.sim.now, label: 'standby takes over' });
      });
    }
    this.sim.after(RESTART_MS, () => {
      this.proxyDownAt = null;
      this.markers.push({ at: this.sim.now, label: 'proxy back' });
    });
    this.gate({ kind: 'proxy-down', node: REV }, () => {});
  }

  isDown(id: string): boolean {
    return id === REV && this.proxyDownAt !== null;
  }

  /** Which proxy holds the shop's address now: the first, the standby once it notices, or nobody. */
  activeProxy(): string | null {
    if (this.proxyDownAt === null) return REV;
    if (this.cfg.standby && this.sim.now - this.proxyDownAt >= this.cfg.healthCheckSec * 1000) return STANDBY;
    return null;
  }

  // ---- what parties know ----

  /** Has `party` seen any address of node `id`? */
  knows(party: string, id: string): boolean {
    const s = this.seen.get(party);
    return !!s && addressesOf(id).some((a) => s.has(a));
  }

  /** The address `party` knows node `id` by, if any. */
  knownAs(party: string, id: string): string | undefined {
    const s = this.seen.get(party);
    return s ? addressesOf(id).find((a) => s.has(a)) : undefined;
  }

  /** Office addresses that some website has learned (from the source or from X-Forwarded-For). */
  leakedOfficeAddresses(): string[] {
    const out = new Set<string>();
    for (const site of SITES) for (const a of this.seen.get(site) ?? []) if (Object.values(ADDR.laptop).includes(a)) out.add(a);
    return [...out];
  }

  /** Shop addresses that clients have connected to: one with a reverse proxy, every backend's without. */
  exposedShopAddresses(): string[] {
    const shop = [ADDR.revPublic, ...Object.values(ADDR.appPublic)];
    const out = new Set<string>();
    for (const c of [...LAPTOPS, CUSTOMERS, SCRAPER]) for (const a of this.seen.get(c) ?? []) if (shop.includes(a)) out.add(a);
    return [...out];
  }

  /** The routes in use right now, for drawing. */
  routesInUse(): Set<string> {
    const out = new Set<string>();
    const proxy = this.activeProxy() ?? REV;
    const shopIn = (from: string) => {
      if (this.cfg.revOn) {
        out.add(routeId(from, proxy));
        for (const b of BACKENDS.slice(0, this.cfg.backends)) out.add(routeId(proxy, b));
        if (this.cfg.routes && this.readsRequests) out.add(routeId(proxy, FILES));
      } else for (const b of BACKENDS.slice(0, this.cfg.backends)) out.add(routeId(from, b));
    };
    for (const l of LAPTOPS) {
      if (this.cfg.fwdOn) out.add(routeId(l, FWD));
      else for (const s of SITES) out.add(routeId(l, s));
    }
    if (this.cfg.fwdOn) for (const s of SITES) out.add(routeId(FWD, s));
    if (this.cfg.fwdOn) shopIn(FWD);
    else for (const l of LAPTOPS) shopIn(l);
    shopIn(CUSTOMERS);
    shopIn(SCRAPER);
    for (const t of this.sim.travels.values()) out.add(t.wire);
    return out;
  }

  // ---- traffic ----

  private loop(rate: () => number, fire: () => void): void {
    const r = rate();
    this.sim.after(r > 0 ? this.sim.rng.gapMs(r) : 1000, () => {
      if (rate() > 0) fire();
      this.loop(rate, fire);
    });
  }

  private see(party: string, ...addrs: (string | undefined)[]): void {
    const s = this.seen.get(party) ?? new Set<string>();
    for (const a of addrs) for (const part of (a ?? '').split(',').map((x) => x.trim())) if (part) s.add(part);
    this.seen.set(party, s);
  }

  private leg(req: ProxyReq, from: string, to: string, tone: Tone, then: () => void): void {
    req.path.push(to);
    this.sim.send(req, routeId(from, to), { stageMs: STAGE_MS, modeledMs: HOP_MS, tone, label: `${NAMES[from]} → ${NAMES[to]}` }, then);
  }

  private newReq(client: string, src: string, dest: Destination, host: string, path: string): ProxyReq {
    const req: ProxyReq = Object.assign(this.sim.req('read', client, `${host}${path}`), { client, dest, path: [client], encrypted: true });
    req.fields = { src, dst: '', host, path };
    return req;
  }

  private officeRequest(laptop: Laptop): void {
    const dest = pick(() => this.sim.rng.next(), OFFICE_DESTS);
    const host = dest === 'shop' ? SHOP_HOST : HOSTS[dest];
    const path = dest === 'shop' ? pick(() => this.sim.rng.next(), SHOP_PATHS) : '/';
    const req = this.newReq(laptop, ADDR.laptop[laptop], dest, host, path);
    if (!this.cfg.fwdOn) return this.toDestination(req, laptop);
    // The browser connects to the proxy inside the office and asks it to fetch the page.
    req.fields!.dst = ADDR.fwdInside;
    this.see(laptop, ADDR.fwdInside);
    this.leg(req, laptop, FWD, 'request', () =>
      this.gate({ kind: 'arrive', node: FWD, req, cachedCopy: false }, () => {
        this.proxyLog.set(laptop, (this.proxyLog.get(laptop) ?? 0) + 1);
        if (this.cfg.filter && dest === 'blocked') {
          this.sim.hop(req, 'Forward proxy: blocked by policy (403)');
          this.sim.emit({ kind: 'blocked', node: FWD });
          return this.respond(req, 'blocked', 'fail');
        }
        req.fields!.src = ADDR.egress[this.cfg.egress];
        req.fields!.dst = dest === 'shop' ? this.shopAddress(req) : ADDR.site[dest];
        if (this.cfg.transparent) req.fields!['x-forwarded-for'] = ADDR.laptop[laptop];
        this.sim.hop(req, `Forward proxy: logged, sent on from ${ADDR.egress[this.cfg.egress]}${this.cfg.transparent ? ', adding X-Forwarded-For' : ''}`);
        this.sim.emit({ kind: 'rewrite', node: FWD, text: `${ADDR.laptop[laptop]} → ${ADDR.egress[this.cfg.egress]}` });
        this.toDestination(req, FWD);
      }),
    );
  }

  private shopRequest(client: string, src: string, path?: string): void {
    const req = this.newReq(client, src, 'shop', SHOP_HOST, path ?? pick(() => this.sim.rng.next(), SHOP_PATHS));
    this.toDestination(req, client);
  }

  /** From `from` (a client or the forward proxy) on to the site or the shop. */
  private toDestination(req: ProxyReq, from: string): void {
    if (req.dest === 'shop') return this.toShop(req, from);
    const site = req.dest;
    req.fields!.dst = ADDR.site[site];
    if (from === req.client) this.see(req.client, ADDR.site[site]);
    this.leg(req, from, site, 'request', () =>
      this.gate({ kind: 'arrive', node: site, req, cachedCopy: false }, () => {
        this.see(site, req.fields!.src, req.fields!['x-forwarded-for']);
        if (site === 'video' && countryOf(req.fields!.src!) !== 'uk') {
          this.sim.hop(req, 'video.example: not available in your country (451)');
          this.sim.emit({ kind: 'geo', node: site });
          return this.respond(req, 'geo', 'fail');
        }
        this.sim.hop(req, `${HOSTS[site]}: page`, 20);
        this.respond(req, 'ok', 'hit');
      }),
    );
  }

  /**
   * The address shop.example resolves to: the reverse proxy's, or without one, one of the
   * backends' (its DNS lists them all, and clients take turns).
   */
  private shopAddress(req: ProxyReq): string {
    if (this.cfg.revOn) return ADDR.revPublic;
    req.backend ??= BACKENDS[this.rr++ % this.cfg.backends]!;
    return ADDR.appPublic[req.backend];
  }

  private toShop(req: ProxyReq, from: string): void {
    if (from === req.client) {
      // Where shop.example points is decided as the client connects, so a freeze frame can ask.
      req.fields!.dst = this.shopAddress(req);
      this.see(req.client, req.fields!.dst);
      return this.gate({ kind: 'depart', node: from, req }, () => this.connectToShop(req, from));
    }
    req.fields!.dst = this.shopAddress(req);
    this.connectToShop(req, from);
  }

  private connectToShop(req: ProxyReq, from: string): void {
    if (!this.cfg.revOn) {
      const b = req.backend!;
      this.leg(req, from, b, 'request', () => this.atBackend(req, b));
      return;
    }
    const proxy = this.activeProxy();
    if (!proxy) {
      // Nobody holds the shop's address: the connection times out at the dead proxy.
      this.leg(req, from, REV, 'request', () => {
        this.sim.hop(req, 'Reverse proxy: down, the connection times out');
        this.respond(req, 'failed', 'fail');
      });
      return;
    }
    req.proxy = proxy;
    this.leg(req, from, proxy, 'request', () =>
      this.gate({ kind: 'arrive', node: proxy, req, cachedCopy: this.holdsFresh(proxy, req.fields!.path!) }, () => this.atProxy(req, proxy)),
    );
  }

  /** Does `proxy` hold an unexpired copy of `path`? */
  holdsFresh(proxy: string, path: string): boolean {
    const e = this.caches.get(proxy)?.entries().find((x) => x.key === path);
    return !!e && (e.expiresAt === null || e.expiresAt > this.sim.now);
  }

  private takeToken(proxy: string, addr: string, rate: number): boolean {
    const k = `${proxy}|${addr}`;
    const size = Math.max(1, rate * BURST_SEC);
    const b = this.buckets.get(k) ?? { tokens: size, at: this.sim.now };
    b.tokens = Math.min(size, b.tokens + ((this.sim.now - b.at) / 1000) * rate);
    b.at = this.sim.now;
    this.buckets.set(k, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private atProxy(req: ProxyReq, proxy: string): void {
    if (this.isDown(proxy)) {
      this.sim.hop(req, `${NAMES[proxy]}: died with the request inside`);
      return this.respond(req, 'failed', 'fail');
    }
    const f = req.fields!;
    const client = f.src!;
    // Addresses are visible even to a proxy that can't decrypt, so these work in every TLS mode.
    if (this.cfg.blocklist.includes(client)) {
      this.sim.hop(req, `${NAMES[proxy]}: ${client} is blocked (403)`);
      this.sim.emit({ kind: 'denied', node: proxy });
      return this.respond(req, 'denied', 'fail');
    }
    if (this.cfg.rateLimit !== null && !this.takeToken(proxy, client, this.cfg.rateLimit)) {
      this.gate({ kind: 'limited', node: proxy, req, addr: client }, () => {
        this.sim.hop(req, `${NAMES[proxy]}: too many requests from ${client} (429)`);
        this.sim.emit({ kind: 'limited', node: proxy });
        this.respond(req, 'limited', 'miss');
      });
      return;
    }
    const reads = this.readsRequests;
    const body = BODIES[f.path!]!;
    const gzipHere = reads && this.cfg.compression === 'proxy' && body.text;
    const cost = WORK.forward + (reads ? WORK.tlsAtProxy : 0) + (gzipHere ? WORK.gzip : 0);
    this.servers.get(proxy)!.submit(
      req,
      reads ? 'decrypt and read the request' : 'pass the encrypted bytes along',
      () => {
        if (this.isDown(proxy)) {
          this.sim.hop(req, `${NAMES[proxy]}: died with the request inside`);
          return this.respond(req, 'failed', 'fail');
        }
        const cache = this.caches.get(proxy)!;
        const cacheable = reads && this.cfg.cache && body.cacheable;
        if (cacheable && cache.lookup(f.path!, this.sim.now).hit) {
          req.cached = true;
          req.compressed = gzipHere || !!this.storedGzipped.get(`${proxy}|${f.path}`);
          this.sim.hop(req, `${NAMES[proxy]}: answered from its cache`);
          this.sim.emit({ kind: 'cache-hit', node: proxy });
          return this.respond(req, 'ok', 'hit');
        }
        req.fill = cacheable;
        req.compressed = gzipHere;
        const toFiles = reads && this.cfg.routes && f.path!.startsWith('/static/');
        const target = toFiles ? FILES : BACKENDS[this.rr++ % this.cfg.backends]!;
        // The proxy opens its own connection inside the data centre. If it can read the request,
        // it adds who the client was; if TLS passes through, the backend only ever sees the proxy.
        if (reads) f['x-forwarded-for'] = f['x-forwarded-for'] ? `${f['x-forwarded-for']}, ${f.src}` : f.src!;
        f.src = proxy === STANDBY ? ADDR.standbyPrivate : ADDR.revPrivate;
        f.dst = target === FILES ? ADDR.files : ADDR.appPrivate[target as Backend];
        req.encrypted = this.cfg.tls !== 'terminate';
        const what = target === FILES ? 'route /static to the file store' : `forward to ${NAMES[target]}`;
        this.sim.hop(req, `${NAMES[proxy]}: ${what}${reads ? ', adding X-Forwarded-For' : ' (still encrypted)'}`);
        this.leg(req, proxy, target, 'request', () => this.atBackend(req, target));
      },
      () => this.respond(req, 'failed', 'fail'),
      cost / WORK.forward,
    );
  }

  private atBackend(req: ProxyReq, id: string): void {
    const f = req.fields!;
    const body = BODIES[f.path!]!;
    const isStatic = f.path!.startsWith('/static/');
    this.see(id, f.src, f['x-forwarded-for']);
    this.timeline.count(this.sim.now, `requests:${id}`);
    this.timeline.count(this.sim.now, `path:${f.path}`);
    if (id !== FILES) {
      this.timeline.count(this.sim.now, 'appRequests');
      if (isStatic) this.timeline.count(this.sim.now, 'staticAtApps');
    }
    // TLS work lands here unless the proxy ended it: a full handshake without a proxy or with
    // passthrough, a cheap resumed one when the proxy re-encrypts.
    const tls = !this.cfg.revOn || this.cfg.tls === 'passthrough' ? WORK.tlsAtBackend : this.cfg.tls === 'reencrypt' ? WORK.tlsReuseAtBackend : 0;
    const gzipHere = this.cfg.compression === 'backend' && body.text;
    if (gzipHere) req.compressed = true;
    const ms = (id === FILES ? WORK.file : isStatic ? WORK.staticAtApp : WORK.app) + tls + (gzipHere ? WORK.gzip : 0);
    this.servers.get(id)!.submit(
      req,
      id === FILES ? 'read the file' : isStatic ? 'serve a static file' : 'handle the request',
      () => this.respond(req, 'ok', 'hit'),
      () => this.respond(req, 'failed', 'fail'),
      ms / WORK.app,
    );
  }

  /** Walk back along the path the request came, keeping a copy at the proxy if asked to. */
  private respond(req: ProxyReq, outcome: Outcome, tone: Tone): void {
    req.outcome = outcome;
    // Refusals and failures travel back as a ✕, in their tone's colour.
    if (outcome !== 'ok') req.failed = true;
    const path = req.fields?.path;
    req.fields = undefined;
    if (req.dest === 'shop' && outcome === 'ok' && path) {
      const body = BODIES[path]!;
      const bytes = req.compressed ? body.bytes * GZIP_RATIO : body.bytes;
      req.size = bytes;
      this.timeline.count(this.sim.now, 'egressBytes', bytes);
    }
    const back = (i: number) => {
      if (i <= 0) return this.complete(req);
      const to = req.path[i]!;
      const from = req.path[i - 1]!;
      if (to === req.proxy && req.fill && path) {
        this.caches.get(to)!.fill(path, 1, this.sim.now, this.cfg.cacheTtlSec * 1000);
        this.storedGzipped.set(`${to}|${path}`, !!req.compressed);
        req.fill = false;
      }
      this.sim.send(req, routeId(from, to), { reverse: true, stageMs: STAGE_MS, modeledMs: HOP_MS, tone, label: `${NAMES[to]} → ${NAMES[from] ?? from}` }, () => {
        if (from === req.proxy) req.encrypted = true;
        back(i - 1);
      });
    };
    back(req.path.length - 1);
  }

  private complete(req: ProxyReq): void {
    req.done = true;
    if (req.outcome !== 'ok') req.failed = true;
    this.finished.push(req);
    if (this.finished.length > 200) this.finished.shift();
    const now = this.sim.now;
    this.timeline.count(now, `outcome:${req.outcome}`);
    if (req.cached) this.timeline.count(now, 'cached');
    if (req.outcome === 'limited') this.timeline.count(now, `limited:${req.client}`);
    if (LAPTOPS.includes(req.client as Laptop)) this.timeline.count(now, `office:${req.dest}:${req.outcome}`);
    if (req.dest === 'shop') {
      this.timeline.count(now, `shop:${req.outcome}`);
      this.timeline.count(now, 'shop:total');
      if (req.client === SCRAPER) {
        this.timeline.count(now, 'scraperTotal');
        if (req.outcome === 'ok') this.timeline.count(now, 'scraperServed');
      } else if (req.outcome === 'limited') this.timeline.count(now, 'limitedReal');
      else if (req.outcome === 'denied') this.timeline.count(now, 'deniedReal');
    }
    if (req.outcome === 'ok') this.timeline.sample(now, `lat:${req.client === CUSTOMERS ? 'customers' : req.client}`, req.modeledMs);
  }

  // ---- results ----

  /** CPU of one node over whole seconds [fromSec, toSec), 0–1. */
  cpu(id: string, fromSec: number, toSec: number): number {
    const workers = id === REV || id === STANDBY ? PROXY_WORKERS : APP_WORKERS;
    return this.timeline.sum(fromSec, toSec, `cpu:${id}`) / (workers * 1000 * this.timeline.seconds(fromSec, toSec));
  }

  /** What the instruments and missions read over whole seconds [fromSec, toSec). */
  stats(fromSec: number, toSec: number): ProxyStats {
    const t = this.timeline;
    const sum = (k: string) => t.sum(fromSec, toSec, k);
    const apps = BACKENDS.slice(0, this.cfg.backends);
    const lat = t.values(fromSec, toSec, 'lat:customers');
    return {
      seconds: t.seconds(fromSec, toSec),
      answered: sum('outcome:ok'),
      failed: sum('outcome:failed'),
      limited: sum('outcome:limited'),
      limitedReal: sum('limitedReal'),
      denied: sum('outcome:denied'),
      deniedReal: sum('deniedReal'),
      shopFailed: sum('shop:failed'),
      officeVideo: (['ok', 'geo', 'failed', 'blocked'] as const).reduce((n, o) => n + sum(`office:video:${o}`), 0),
      officeVideoOk: sum('office:video:ok'),
      officeReachedBlocked: sum('office:blocked:ok'),
      blocked: sum('outcome:blocked'),
      geo: sum('outcome:geo'),
      cached: sum('cached'),
      scraperTotal: sum('scraperTotal'),
      scraperServed: sum('scraperServed'),
      appRequests: sum('appRequests'),
      staticAtApps: sum('staticAtApps'),
      appCpu: apps.reduce((n, b) => n + this.cpu(b, fromSec, toSec), 0) / apps.length,
      proxyCpu: Math.max(this.cpu(REV, fromSec, toSec), this.cpu(STANDBY, fromSec, toSec)),
      egressMB: sum('egressBytes') / 1_000_000,
      customerP50: percentile(lat, 50),
      customerP95: percentile(lat, 95),
    };
  }
}

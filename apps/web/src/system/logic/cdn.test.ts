import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CITIES, rttMs, type CityId } from '../stage/geo';
import { CdnScene, DEFAULT_CDN, type CdnConfig } from './cdn';
import { PROVIDERS } from './cdnMap';

const run = (patch: Partial<CdnConfig>, secs: number, script: [number, (s: CdnScene) => void][] = [], seed = 1) => {
  const s = new CdnScene({ ...DEFAULT_CDN, ...patch }, seed);
  for (const [at, fn] of script) s.sim.at(at * 1000, () => fn(s));
  s.sim.advance(secs * 1000);
  return s;
};

const EVERYWHERE: CityId[] = ['sfo', 'nyc', 'sao', 'lon', 'fra', 'dxb', 'sin', 'tyo', 'syd'];

describe('CDN: distance', () => {
  it('without a CDN, latency is the round trip to the origin plus its serve time', () => {
    const w = run({ cdnOn: false }, 30).stats(5, 30);
    assert.ok(Math.abs(w.byCity.syd!.p50 - (rttMs(CITIES.syd, CITIES.ash) + 20)) < 3, `${w.byCity.syd!.p50}`);
    assert.ok(w.byCity.syd!.p50 > w.byCity.lon!.p50 * 2);
  });

  it('a warm edge in Sydney answers Sydney users in a few milliseconds', () => {
    const w = run({ ttlSec: 120 }, 60).stats(20, 60);
    assert.ok(w.byCity.syd!.p50 < 40, `${w.byCity.syd!.p50}`);
  });

  it('a cold miss through an edge is no faster than going direct, unless handshakes count', () => {
    const first = (s: CdnScene, outcome: string) => s.finished.find((r) => r.pin === 'syd' && r.outcome === outcome && r.obj.kind === 'static')!.modeledMs;
    const direct = first(run({ cdnOn: false }, 10), 'direct');
    const viaEdge = first(run({}, 10), 'miss');
    assert.ok(viaEdge >= direct, `edge ${viaEdge} vs direct ${direct}`);
    const directHs = first(run({ cdnOn: false, handshakes: true }, 10), 'direct');
    const viaEdgeHs = first(run({ handshakes: true }, 10), 'miss');
    // Handshakes cost round trips to whoever you connect to: a nearby edge, or the far origin.
    assert.ok(viaEdgeHs < directHs / 2, `edge ${viaEdgeHs} vs direct ${directHs}`);
  });

  it('users with no PoP near them are slower with the CDN than without', () => {
    const brazil = { origin: 'sao' as const, provider: 'regional' as const, pops: [...PROVIDERS.regional.pops], pins: ['sao' as CityId] };
    const off = run({ ...brazil, cdnOn: false }, 40).stats(10, 40).byCity.sao!.p50;
    const on = run(brazil, 40).stats(10, 40).byCity.sao!.p50;
    assert.ok(on > off * 3, `with CDN ${on}, without ${off}`);
  });
});

describe('CDN: the origin', () => {
  it('revalidation turns expiries into tiny 304s', () => {
    const full = run({ catalog: 'docs', ttlSec: 3 }, 60).stats(10, 60);
    const reval = run({ catalog: 'docs', ttlSec: 3, revalidate: true }, 60).stats(10, 60);
    assert.ok(reval.notModified > 50);
    assert.ok(reval.originMB < full.originMB / 2, `${reval.originMB} vs ${full.originMB}`);
    assert.ok(reval.hitRatio > full.hitRatio + 0.3);
  });

  it('push never misses on pushed files, and stores every file at every PoP', () => {
    const w = run({ catalog: 'docs', mode: 'push' }, 40).stats(5, 40);
    assert.equal(w.originOps, 0);
    // 20 pages of 30 KB at 8 PoPs.
    assert.ok(Math.abs(w.storedMB - 4.8) < 0.01, `${w.storedMB}`);
  });

  it('push stores a long-tail library everywhere; pull stores what gets asked for', () => {
    const pull = run({ catalog: 'video', pins: EVERYWHERE }, 30).stats(10, 30);
    const push = run({ catalog: 'video', pins: EVERYWHERE, mode: 'push' }, 30).stats(10, 30);
    assert.ok(push.storedMB > pull.storedMB * 50, `${push.storedMB} vs ${pull.storedMB}`);
  });

  it('an origin shield funnels the edges’ misses into one cache', () => {
    const edges = run({ catalog: 'docs', pins: EVERYWHERE, ttlSec: 10 }, 60).stats(10, 60);
    const shielded = run({ catalog: 'docs', pins: EVERYWHERE, ttlSec: 10, shield: true }, 60).stats(10, 60);
    assert.ok(shielded.originOps < edges.originOps * 0.4, `${shielded.originOps} vs ${edges.originOps}`);
  });
});

describe('CDN: changes and mistakes', () => {
  const deploy: [number, (s: CdnScene) => void][] = [[10, (s) => s.deploy()]];

  it('after a deploy, a long TTL keeps serving the old file; a purge or versioned names don’t', () => {
    assert.ok(run({ ttlSec: 60 }, 40, deploy).stats(12, 40).stale > 10);
    assert.equal(run({ ttlSec: 60, purgeOnDeploy: true }, 40, deploy).stats(12, 40).stale, 0);
    assert.equal(run({ ttlSec: 60, versioned: true }, 40, deploy).stats(12, 40).stale, 0);
  });

  it('a 1-second TTL is fresh but sends the origin much more work', () => {
    const short = run({ ttlSec: 1 }, 40, deploy).stats(12, 40);
    const long = run({ ttlSec: 60, versioned: true }, 40, deploy).stats(12, 40);
    assert.ok(short.originOps > long.originOps * 1.5, `${short.originOps} vs ${long.originOps}`);
  });

  it('caching everything hands one user’s cart to another, and serves old prices', () => {
    const all = run({ rule: 'all' }, 40).stats(5, 40);
    assert.ok(all.leaks > 0 && all.staleDynamic > 0, `${all.leaks} leaks, ${all.staleDynamic} stale prices`);
    const staticOnly = run({ rule: 'static' }, 40).stats(5, 40);
    assert.equal(staticOnly.leaks + staticOnly.staleDynamic, 0);
    assert.equal(run({ rule: 'headers' }, 40).stats(5, 40).leaks, 0);
  });

  it('a dead PoP fails requests until routing notices: briefly with anycast, for the DNS TTL with DNS', () => {
    // Each user keeps their own DNS answer, so a long TTL strands everyone who looked it up recently.
    const europe = { pins: ['lon', 'fra'] as CityId[], rps: 2 };
    const die: [number, (s: CdnScene) => void][] = [[15, (s) => s.failPop('lon')]];
    const failed = (patch: Partial<CdnConfig>) => run({ ...europe, ...patch }, 45, die).stats(15, 45).failed;
    const anycast = failed({ steering: 'anycast' });
    const dnsLong = failed({ steering: 'dns', dnsTtlSec: 30 });
    const dnsShort = failed({ steering: 'dns', dnsTtlSec: 5 });
    assert.ok(anycast <= 7, `anycast ${anycast}`);
    assert.ok(dnsLong >= 17, `dns 30 s: ${dnsLong}`);
    assert.ok(dnsShort < dnsLong / 2, `dns 5 s: ${dnsShort}`);
  });
});

describe('CDN scene', () => {
  it('gives the same result whether run in one go or frame by frame', () => {
    const a = run({ revalidate: true, shield: true, ttlSec: 5 }, 30);
    const b = new CdnScene({ ...DEFAULT_CDN, revalidate: true, shield: true, ttlSec: 5 }, 1);
    for (let t = 0; t < 30_000; t += 16.7) b.sim.advance(16.7);
    assert.deepEqual(b.stats(0, 30), a.stats(0, 30));
  });

  it('only sends requests along routes the map has', () => {
    for (const patch of [{}, { cdnOn: false }, { shield: true }, { mode: 'push' as const }, { origin: 'sao' as const, provider: 'regional' as const, pops: [...PROVIDERS.regional.pops] }]) {
      const s = new CdnScene({ ...DEFAULT_CDN, ...patch }, 1);
      const ids = new Set(s.layout.wires.map((w) => w.id));
      for (let t = 0; t < 20_000; t += 100) {
        s.sim.advance(100);
        for (const tr of s.sim.travels.values()) assert.ok(ids.has(tr.wire), `${JSON.stringify(patch)}: ${tr.wire}`);
      }
    }
  });

  it('moves a pin without restarting, and the new city starts sending', () => {
    const s = run({ pins: ['lon'] }, 10);
    s.configure({ pins: ['tyo'] });
    s.sim.advance(20_000);
    const w = s.stats(15, 30);
    assert.ok(w.byCity.tyo && !w.byCity.lon, JSON.stringify(Object.keys(w.byCity)));
  });
});

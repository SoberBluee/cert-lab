import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PROXY, ProxyScene, type ProxyConfig } from './proxy';
import { ADDR, REV } from './proxyMap';

const run = (patch: Partial<ProxyConfig>, secs = 30, seed = 1) => {
  const s = new ProxyScene({ ...DEFAULT_PROXY, ...patch }, seed);
  s.sim.advance(secs * 1000);
  return s;
};

describe('proxy: the forward proxy', () => {
  it('hides the office from websites, unless it adds X-Forwarded-For', () => {
    assert.equal(run({ fwdOn: false }).leakedOfficeAddresses().length, 3);
    const proxied = run({});
    assert.equal(proxied.leakedOfficeAddresses().length, 0);
    assert.deepEqual([...proxied.seen.get('news')!], [ADDR.egress.de]);
    assert.equal(run({ transparent: true }).leakedOfficeAddresses().length, 3);
  });

  it('decides geo access by the country it exits from, and filters what the office may visit', () => {
    const outcomes = (s: ProxyScene, o: string) => s.timeline.sum(0, 30, `outcome:${o}`);
    assert.ok(outcomes(run({}), 'geo') > 0);
    assert.equal(outcomes(run({ egress: 'uk' }), 'geo'), 0);
    const filtered = run({});
    assert.ok(outcomes(filtered, 'blocked') > 0);
    assert.equal(filtered.seen.get('blocked'), undefined, 'blocked.example never hears from the office');
    assert.ok(run({ filter: false }).seen.get('blocked')!.size > 0);
  });

  it('logs every request that passes through it', () => {
    const s = run({});
    const office = s.finished.filter((r) => ['alice', 'bob', 'kiosk'].includes(r.client)).length;
    assert.ok([...s.proxyLog.values()].reduce((a, b) => a + b, 0) >= office);
  });
});

describe('proxy: the reverse proxy', () => {
  it('exposes one address for the shop instead of every backend’s', () => {
    assert.deepEqual(run({}).exposedShopAddresses(), [ADDR.revPublic]);
    assert.equal(run({ revOn: false }).exposedShopAddresses().length, 3);
  });

  it('tells the backends who the client was with X-Forwarded-For, from its own private address', () => {
    const s = run({});
    const app = s.seen.get('app1')!;
    assert.ok(app.has(ADDR.revPrivate));
    assert.ok(app.has(ADDR.scraper));
    assert.ok(!app.has(ADDR.laptop.alice), 'the office is still hidden behind its forward proxy');
  });

  it('routes /static to the file store when told to', () => {
    const routed = run({}).timeline.sum(0, 30, 'requests:files');
    assert.ok(routed > 0);
    assert.equal(run({ routes: false }).timeline.sum(0, 30, 'requests:files'), 0);
  });
});

const SEEDS = [1, 2, 3, 4];
const sum = (s: ProxyScene, key: string, from = 0, to = 30) => s.timeline.sum(from, to, key);
const CACHEABLE = ['/', '/api/catalog', '/static/logo.png'];
const OFFICE = ['alice', 'bob', 'kiosk'];

describe('proxy: offloading work to the reverse proxy', () => {
  it('cuts backend CPU by at least 40% when it terminates TLS, and takes the work on itself', () => {
    for (const seed of SEEDS) {
      const pass = run({ tls: 'passthrough' }, 30, seed).stats(0, 30);
      const term = run({ tls: 'terminate' }, 30, seed).stats(0, 30);
      const re = run({ tls: 'reencrypt' }, 30, seed).stats(0, 30);
      assert.ok(term.appCpu <= pass.appCpu * 0.6, `seed ${seed}: ${term.appCpu} vs ${pass.appCpu}`);
      assert.ok(term.appCpu < re.appCpu && re.appCpu < pass.appCpu, `seed ${seed}: re-encrypting sits between the two`);
      assert.ok(term.proxyCpu > pass.proxyCpu * 3, `seed ${seed}: the proxy does the decrypting`);
    }
  });

  it('can’t route, cache, compress or add X-Forwarded-For when TLS passes straight through', () => {
    for (const seed of SEEDS) {
      const s = run({ tls: 'passthrough', cache: true, compression: 'proxy' }, 30, seed);
      const st = s.stats(0, 30);
      assert.equal(st.cached, 0);
      assert.equal(sum(s, 'requests:files'), 0, 'no path to route by');
      assert.ok(st.staticAtApps > 0, '/static lands on the app servers');
      assert.ok(st.egressMB >= run({ compression: 'off' }, 30, seed).stats(0, 30).egressMB * 0.98, 'nothing was gzipped');
      assert.deepEqual([...s.seen.get('app1')!], [ADDR.revPrivate], 'the backends only ever see the proxy');
    }
  });

  it('won’t answer from a cached copy once it can no longer read the request', () => {
    const s = new ProxyScene({ ...DEFAULT_PROXY, cache: true, cacheTtlSec: 60 }, 1);
    s.sim.advance(10_000);
    assert.ok(s.holdsFresh(REV, '/static/logo.png'));
    s.configure({ tls: 'passthrough' });
    s.sim.advance(5_000);
    assert.ok(s.holdsFresh(REV, '/static/logo.png'), 'the copy is still there');
    assert.equal(sum(s, 'cached', 11, 15), 0);
  });

  it('cuts egress by more than 60% when it gzips text responses', () => {
    for (const seed of SEEDS) {
      const off = run({ compression: 'off' }, 30, seed).stats(0, 30).egressMB;
      const proxy = run({ compression: 'proxy' }, 30, seed).stats(0, 30).egressMB;
      const backend = run({ compression: 'backend' }, 30, seed);
      assert.ok(proxy < off * 0.4, `seed ${seed}: ${proxy} vs ${off}`);
      assert.ok(Math.abs(backend.stats(0, 30).egressMB - proxy) < 0.05 * off, 'the same bytes, wherever it’s done');
      assert.ok(backend.stats(0, 30).appCpu > run({ compression: 'proxy' }, 30, seed).stats(0, 30).appCpu, 'but the backends pay for it');
    }
  });

  it('keeps more than 70% of cacheable requests off the backends, and never caches the cart', () => {
    for (const seed of SEEDS) {
      const off = run({ cache: false }, 30, seed);
      const on = run({ cache: true }, 30, seed);
      const reach = (s: ProxyScene) => CACHEABLE.reduce((n, p) => n + sum(s, `path:${p}`), 0);
      assert.ok(reach(on) < reach(off) * 0.3, `seed ${seed}: ${reach(on)} vs ${reach(off)}`);
      assert.equal(sum(on, 'path:/cart'), sum(off, 'path:/cart'), 'every /cart still reaches a backend');
      assert.ok(on.finished.every((r) => !(r.cached && r.key!.endsWith('/cart'))));
    }
  });

  it('sends a cached copy as it was stored, gzipped by the backends or not', () => {
    for (const seed of SEEDS) {
      const plain = run({ compression: 'backend' }, 30, seed).stats(0, 30).egressMB;
      const cached = run({ compression: 'backend', cache: true }, 30, seed).stats(0, 30).egressMB;
      assert.ok(cached < plain * 1.1, `seed ${seed}: ${cached} vs ${plain}`);
    }
  });
});

describe('proxy: guarding the door', () => {
  // The office's laptops each send half a shop request a second; through the forward proxy they
  // all arrive as 203.0.113.5, together one and a half a second.
  const crowd = { officeRps: 1.5, scraperRps: 20 };

  it('throttles the whole office with a limit below its combined rate, though each laptop is under it', () => {
    for (const seed of SEEDS) {
      const low = run({ ...crowd, rateLimit: 1 }, 30, seed);
      assert.ok(OFFICE.every((l) => sum(low, `limited:${l}`) > 0), `seed ${seed}: every laptop gets 429s`);
      const high = run({ ...crowd, rateLimit: 3 }, 30, seed).stats(0, 30);
      assert.equal(high.limitedReal, 0, `seed ${seed}: nobody real is throttled above the office's rate`);
      assert.ok(high.scraperServed <= high.scraperTotal * 0.2, `seed ${seed}: ${high.scraperServed}/${high.scraperTotal} scraper requests served`);
    }
  });

  it('refuses a blocked address outright, and nobody else', () => {
    for (const seed of SEEDS) {
      const st = run({ ...crowd, blocklist: [ADDR.scraper] }, 30, seed).stats(0, 30);
      assert.equal(st.scraperServed, 0);
      assert.equal(st.denied, st.scraperTotal);
      assert.equal(st.limited, 0);
    }
  });

  it('limits and blocks by address even when TLS passes through', () => {
    const st = run({ ...crowd, tls: 'passthrough', rateLimit: 3 }).stats(0, 30);
    assert.ok(st.scraperServed <= st.scraperTotal * 0.2);
  });

  const dying = (patch: Partial<ProxyConfig>, seed: number) => {
    const s = new ProxyScene({ ...DEFAULT_PROXY, ...patch }, seed);
    s.sim.at(10_000, () => s.failProxy());
    s.sim.advance(30_000);
    return s;
  };

  it('fails every shop request while the only proxy is down', () => {
    for (const seed of SEEDS) {
      const s = dying({}, seed);
      assert.equal(sum(s, 'shop:ok', 12, 30), 0, `seed ${seed}`);
      assert.ok(sum(s, 'shop:failed', 12, 30) > 0);
      assert.ok(sum(s, 'outcome:ok', 12, 30) > 0, 'the rest of the internet carries on');
    }
  });

  it('with a standby, fails requests for about one health-check interval, then carries on', () => {
    for (const seed of SEEDS) {
      for (const healthCheckSec of [3, 10]) {
        const s = dying({ standby: true, healthCheckSec }, seed);
        // The seconds in which shop requests failed: from the crash until requests sent just
        // before the standby took over have come back.
        const failing = Array.from({ length: 30 }, (_, i) => i).filter((i) => sum(s, 'shop:failed', i, i + 1) > 0);
        const span = failing.at(-1)! - failing[0]! + 1;
        assert.ok(span >= healthCheckSec && span <= healthCheckSec + 2, `seed ${seed}, ${healthCheckSec} s check: failures for ${span} s`);
        assert.ok(sum(s, 'shop:ok', 12 + healthCheckSec, 30) > 0, 'the standby answers');
        assert.ok(s.seen.get('app1')!.has(ADDR.standbyPrivate));
      }
    }
  });

  it('brings the first proxy back after it restarts', () => {
    const s = dying({}, 1);
    s.sim.advance(10_000);
    assert.equal(s.activeProxy(), REV);
    assert.ok(sum(s, 'shop:ok', 32, 40) > 0);
  });
});

describe('proxy: more than a load balancer', () => {
  it('with one backend, still cuts p95 by terminating TLS and caching', () => {
    for (const seed of SEEDS) {
      const plain = run({ backends: 1, tls: 'passthrough', compression: 'backend', customerRps: 1 }, 30, seed).stats(0, 30);
      const offloaded = run({ backends: 1, tls: 'terminate', compression: 'proxy', cache: true, customerRps: 1 }, 30, seed).stats(0, 30);
      assert.ok(offloaded.customerP95 < plain.customerP95 * 0.8, `seed ${seed}: ${offloaded.customerP95} vs ${plain.customerP95}`);
    }
  });
});

describe('proxy scene', () => {
  it('records the envelope at every hop, rewritten by both proxies', () => {
    const r = run({}).finished.find((x) => x.client === 'alice' && x.dest === 'shop')!;
    const srcs = r.trail.flatMap((h) => (h.fields ? [h.fields.src] : []));
    assert.deepEqual([...new Set(srcs)], [ADDR.laptop.alice, ADDR.egress.de, ADDR.revPrivate]);
  });

  it('only sends requests along routes the stage has, and gives the same run however it’s chopped', () => {
    const patches: Partial<ProxyConfig>[] = [
      {},
      { fwdOn: false },
      { revOn: false },
      { fwdOn: false, revOn: false, backends: 1 },
      { tls: 'passthrough', cache: true },
      { standby: true },
      { standby: true, fwdOn: false, rateLimit: 1 },
    ];
    for (const patch of patches) {
      const s = new ProxyScene({ ...DEFAULT_PROXY, ...patch }, 1);
      s.sim.at(6_000, () => s.failProxy());
      const ids = new Set(s.layout.wires.map((w) => w.id));
      for (let t = 0; t < 20_000; t += 100) {
        s.sim.advance(100);
        for (const tr of s.sim.travels.values()) assert.ok(ids.has(tr.wire), `${JSON.stringify(patch)}: ${tr.wire}`);
      }
    }
    const modules: Partial<ProxyConfig> = { cache: true, rateLimit: 2, standby: true, scraperRps: 10 };
    const a = new ProxyScene({ ...DEFAULT_PROXY, ...modules }, 1);
    a.sim.at(8_000, () => a.failProxy());
    a.sim.advance(20_000);
    const b = new ProxyScene({ ...DEFAULT_PROXY, ...modules }, 1);
    b.sim.at(8_000, () => b.failProxy());
    for (let t = 0; t < 20_000; t += 16.7) b.sim.advance(Math.min(16.7, 20_000 - b.sim.now));
    assert.deepEqual(b.finished.map((r) => [r.id, r.outcome, r.cached]), a.finished.map((r) => [r.id, r.outcome, r.cached]));
  });
});

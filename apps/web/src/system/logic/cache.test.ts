import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mulberry32, sampleCdf, zipfCdf } from '../stage/rng';
import { Cache, replay } from './cache';

const loop = (n: number, rounds: number) => Array.from({ length: n * rounds }, (_, i) => `k${(i % n) + 1}`);

const zipfTrace = (len: number, keys: number, s: number, seed = 1, offset = 0) => {
  const rng = mulberry32(seed);
  const cdf = zipfCdf(keys, s);
  return Array.from({ length: len }, () => `k${((sampleCdf(cdf, rng.next()) + offset) % keys) + 1}`);
};

describe('cache eviction policies', () => {
  it('evicts what each policy says it evicts', () => {
    const victimAfter = (policy: ConstructorParameters<typeof Cache>[1]) => {
      const c = new Cache(3, policy);
      c.fill('a', 1, 0, null);
      c.fill('b', 1, 0, null);
      c.fill('c', 1, 0, null);
      c.lookup('a', 0);
      c.lookup('a', 0);
      c.lookup('b', 0);
      return c.slots[c.victim()]!.key;
    };
    assert.equal(victimAfter('lru'), 'c'); // used longest ago (never, after insert)
    assert.equal(victimAfter('mru'), 'b'); // used most recently
    assert.equal(victimAfter('fifo'), 'a'); // inserted first
    assert.equal(victimAfter('lifo'), 'c'); // inserted last
    assert.equal(victimAfter('lfu'), 'c'); // fewest hits
  });

  it('teaches the loop puzzle: LRU and FIFO get nothing from a loop one bigger than the cache, MRU and LIFO keep most of it', () => {
    const trace = loop(10, 20);
    assert.equal(replay(trace, 8, 'lru').hits, 0);
    assert.equal(replay(trace, 8, 'fifo').hits, 0);
    assert.ok(replay(trace, 8, 'mru').hits / trace.length > 0.5);
    assert.ok(replay(trace, 8, 'lifo').hits / trace.length > 0.5);
  });

  it('teaches the nightly scan: a pass over cold keys pushes LRU\'s hot set out, LFU keeps it', () => {
    const warm = zipfTrace(400, 30, 1.1);
    const during = zipfTrace(80, 30, 1.1, 2);
    const userHitsDuringScan = (policy: 'lru' | 'lfu') => {
      const c = new Cache(8, policy);
      const read = (k: string) => c.lookup(k, 0).hit || (c.fill(k, 1, 0, null), false);
      warm.forEach(read);
      // The batch job reads one cold key between each user request.
      return during.filter((k, i) => {
        const hit = read(k);
        read(`scan${i}`);
        return hit;
      }).length;
    };
    const lfu = userHitsDuringScan('lfu');
    const lru = userHitsDuringScan('lru');
    assert.ok(lfu > lru * 1.5, `lfu ${lfu} vs lru ${lru}`);
  });

  it('teaches the trending topic: when popularity shifts, LFU clings to old favourites and LRU adapts', () => {
    const before = zipfTrace(600, 30, 1.1, 1);
    const shifted = zipfTrace(300, 30, 1.1, 2, 15);
    const tail = (policy: 'lru' | 'lfu') => {
      const c = new Cache(8, policy);
      let hits = 0;
      [...before, ...shifted].forEach((k, i) => {
        const hit = c.lookup(k, 0).hit;
        if (!hit) c.fill(k, 1, 0, null);
        if (hit && i >= before.length + 100) hits++;
      });
      return hits;
    };
    assert.ok(tail('lru') > tail('lfu') * 1.5, `lru ${tail('lru')} vs lfu ${tail('lfu')}`);
  });

  it('shows when not to cache: a skewed workload hits often, a uniform one rarely', () => {
    const skewed = replay(zipfTrace(3000, 200, 1.1), 16, 'lru');
    const uniform = replay(zipfTrace(3000, 200, 0), 16, 'lru');
    assert.ok(skewed.hits / 3000 > 0.4, `skewed ${skewed.hits / 3000}`);
    assert.ok(uniform.hits / 3000 < 0.15, `uniform ${uniform.hits / 3000}`);
  });
});

describe('cache entries', () => {
  it('expires entries after their TTL', () => {
    const c = new Cache(2, 'lru');
    c.fill('a', 1, 0, 1000);
    assert.equal(c.lookup('a', 999).hit, true);
    const r = c.lookup('a', 1000);
    assert.equal(r.hit, false);
    assert.equal(!r.hit && r.reason, 'expired');
  });

  it('refuses a slow fill older than a newer write or an invalidation', () => {
    const c = new Cache(2, 'lru');
    c.write('a', 2, 0, null, false);
    assert.equal(c.fill('a', 1, 0, null), null);
    c.invalidate('b', 5);
    assert.equal(c.fill('b', 4, 0, null), null);
    assert.notEqual(c.fill('b', 5, 0, null), null);
  });

  it('tracks dirty writes until they are flushed', () => {
    const c = new Cache(2, 'lru');
    c.write('a', 1, 0, null, true);
    c.write('a', 2, 0, null, true);
    assert.deepEqual(c.dirtyEntries().map((e) => [e.key, e.pending]), [['a', 2]]);
    c.flushed([{ key: 'a', version: 2 }]);
    assert.equal(c.dirtyEntries().length, 0);
  });

  it('keeps slots in place when resizing, dropping what the policy values least', () => {
    const c = new Cache(4, 'lru');
    ['a', 'b', 'c', 'd'].forEach((k) => c.fill(k, 1, 0, null));
    c.lookup('a', 0);
    c.lookup('c', 0);
    const dropped = c.resize(2).map((e) => e.key).sort();
    assert.deepEqual(dropped, ['b', 'd']);
    assert.deepEqual(c.slots.map((e) => e?.key), ['a', 'c']);
    c.resize(3);
    assert.deepEqual(c.slots.map((e) => e?.key ?? null), ['a', 'c', null]);
  });
});

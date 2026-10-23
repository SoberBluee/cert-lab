import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CachingScene, DEFAULT_CONFIG, type CachingConfig } from './caching';
import { CHAPTERS, FREEZE_FRAMES, MISSIONS, runMission, startMission } from './cachingLesson';

const scene = (patch: Partial<CachingConfig>, seed = 1) => new CachingScene({ ...DEFAULT_CONFIG, ...patch }, seed);
const after = (s: CachingScene, secs: number) => {
  s.sim.advance(secs * 1000);
  return s;
};

describe('caching missions', () => {
  for (const m of MISSIONS) {
    it(`${m.id}: the starting setup and the naive answer fail, the solution passes`, () => {
      assert.equal(runMission(m).pass, false, `starting setup passed: ${runMission(m).detail}`);
      const naive = runMission(m, m.naive);
      assert.equal(naive.pass, false, `naive passed: ${naive.detail}`);
      const solved = runMission(m, m.solution);
      assert.equal(solved.pass, true, `solution failed: ${solved.detail}`);
    });
  }

  it('only lets a mission change the controls it offers', () => {
    const m = MISSIONS.find((x) => x.id === 'nightly-scan')!;
    // Capacity is not one of its controls, so a bigger cache can't be used to cheat.
    assert.deepEqual(runMission(m, { capacity: 16 }), runMission(m));
  });

  it('gives the same result whether run headless or frame by frame', () => {
    const m = MISSIONS.find((x) => x.id === 'fast-safe-writes')!;
    const live = startMission(m, m.solution);
    for (let t = 0; t < m.seconds * 1000; t += 16.7) live.sim.advance(16.7);
    assert.deepEqual(m.check(live), runMission(m, m.solution));
  });

  it('only refers to chapters that exist', () => {
    const ids = new Set(CHAPTERS.map((c) => c.id));
    for (const m of MISSIONS) assert.ok(ids.has(m.chapter), m.id);
    for (const f of FREEZE_FRAMES) assert.ok(ids.has(f.chapter), f.id);
  });
});

describe('caching scene', () => {
  it('sends every read to the database with the cache off', () => {
    const w = after(scene({ cacheOn: false, rps: 4, dbCapacity: 20 }), 20).timeline.window(5, 20);
    assert.equal(w.hitRatio, 0);
    assert.ok(Math.abs(w.dbRate - 4) < 1, `db ${w.dbRate}`);
  });

  it('absorbs most reads for a skewed workload and few for a uniform one', () => {
    const skewed = after(scene({ capacity: 12, skew: 1.3, dbCapacity: 20 }), 25).timeline.window(8, 25);
    const uniform = after(scene({ capacity: 12, skew: 0, dbCapacity: 20 }), 25).timeline.window(8, 25);
    assert.ok(skewed.hitRatio > 0.6, `skewed ${skewed.hitRatio}`);
    assert.ok(uniform.hitRatio < 0.5, `uniform ${uniform.hitRatio}`);
  });

  it('makes hits about a millisecond and misses about one database query', () => {
    const w = after(scene({ capacity: 12, dbCapacity: 20 }), 20).timeline.window(5, 20);
    assert.ok(w.readP50 < 2, `p50 ${w.readP50}`);
    assert.ok(w.readP95 > 40, `p95 ${w.readP95}`);
  });

  it('loses exactly the unflushed write-back writes in a crash, and none with a replica', () => {
    const s = after(scene({ writeRatio: 0.4, strategy: 'write-back', capacity: 12 }), 10);
    const dirty = s.caches.get('cache')!.dirtyEntries().reduce((n, e) => n + e.pending, 0);
    assert.ok(dirty > 0);
    s.crash('cache');
    assert.equal(s.timeline.window(0, 11).lost, dirty);

    const r = after(scene({ writeRatio: 0.4, strategy: 'write-back', capacity: 12, replica: true }), 10);
    const keep = r.caches.get('cache')!.dirtyEntries().length;
    r.crash('cache');
    assert.equal(r.timeline.window(0, 11).lost, 0);
    assert.equal(r.caches.get('cache')!.dirtyEntries().length, keep);
  });

  it('serves stale reads when writes skip the cache, and none with write-around or write-through', () => {
    const stale = (strategy: CachingConfig['strategy']) => after(scene({ writeRatio: 0.25, strategy, capacity: 12 }), 25).timeline.window(0, 25).stale;
    assert.ok(stale('db-only') > 5);
    assert.equal(stale('write-around'), 0);
    assert.equal(stale('write-through'), 0);
  });

  it('coalescing sends fewer queries to the database after a flush', () => {
    const db = (coalesce: boolean) => {
      const s = scene({ rps: 12, capacity: 16, coalesce, dbCapacity: 30 });
      s.sim.at(10_000, () => s.flush('cache'));
      return after(s, 16).timeline.window(10, 13).dbRate;
    };
    assert.ok(db(true) < db(false) * 0.7, `coalesce ${db(true)} vs ${db(false)}`);
  });

  it('pauses on a freeze frame and carries on where it stopped', () => {
    const s = scene({ capacity: 8 });
    let paused = 0;
    s.freezeHook = (m) => m.kind === 'lookup' && paused++ === 0;
    s.sim.advance(10_000);
    assert.ok(s.frozen && s.frozen.kind === 'lookup');
    const at = s.sim.now;
    s.sim.advance(5_000);
    assert.equal(s.sim.now, at, 'the clock stays put while frozen');
    s.resume();
    s.sim.advance(5_000);
    assert.ok(s.sim.now > at);
  });

  it('builds every topology with a wire for each hop', () => {
    for (const patch of [{}, { cacheOn: false }, { topology: 'layers' as const }, ...(['local', 'global', 'distributed'] as const).map((fleetMode) => ({ topology: 'fleet' as const, fleetMode }))]) {
      const s = after(scene({ ...patch, writeRatio: patch.topology ? 0 : 0.2 }), 15);
      assert.ok(s.timeline.window(0, 15).reads > 20, JSON.stringify(patch));
    }
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Sim } from './engine';
import { offsetPolyline, pointAt, toPath } from './geometry';
import { histogram, percentile, Timeline } from './metrics';
import { mulberry32, sampleCdf, zipfCdf } from './rng';

describe('stage engine', () => {
  it('runs events in time order, then in the order they were scheduled', () => {
    const sim = new Sim(1);
    const order: string[] = [];
    sim.after(20, () => order.push('b'));
    sim.after(10, () => order.push('a'));
    sim.after(20, () => order.push('c'));
    sim.advance(100);
    assert.deepEqual(order, ['a', 'b', 'c']);
    assert.equal(sim.now, 100);
  });

  it('does not depend on how the clock is chopped into frames', () => {
    const run = (frame: number) => {
      const sim = new Sim(7);
      const seen: number[] = [];
      const tick = () => {
        seen.push(Math.round(sim.now));
        if (seen.length < 50) sim.after(sim.rng.gapMs(5), tick);
      };
      tick();
      for (let t = 0; t < 20_000; t += frame) sim.advance(frame);
      return seen;
    };
    assert.deepEqual(run(16), run(97));
  });

  it('tracks a request in flight and records its hops', () => {
    const sim = new Sim(1);
    const req = sim.req('read', 'users', 'k1');
    let arrived = false;
    sim.send(req, 'users-app', { stageMs: 500, modeledMs: 2, tone: 'request', label: 'users → app' }, () => (arrived = true));
    sim.advance(250);
    assert.equal(sim.travels.size, 1);
    sim.advance(250);
    assert.equal(arrived, true);
    assert.equal(sim.travels.size, 0);
    assert.deepEqual(req.trail.map((h) => h.label), ['users → app']);
    assert.equal(req.modeledMs, 2);
  });

  it('stops straight after the event that halts it', () => {
    const sim = new Sim(1);
    const order: number[] = [];
    sim.after(10, () => order.push(1));
    sim.after(20, () => {
      order.push(2);
      sim.halted = true;
    });
    sim.after(30, () => order.push(3));
    sim.advance(100);
    assert.deepEqual(order, [1, 2]);
    assert.equal(sim.now, 20);
    sim.halted = false;
    sim.advance(100);
    assert.deepEqual(order, [1, 2, 3]);
  });

  it('steps to the next scheduled moment', () => {
    const sim = new Sim(1);
    sim.after(40, () => {});
    assert.equal(sim.step(), true);
    assert.equal(sim.now, 40);
    assert.equal(sim.step(), false);
  });
});

describe('stage rng and metrics', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    assert.deepEqual([a.next(), a.next(), a.int(10)], [b.next(), b.next(), b.int(10)]);
  });

  it('samples Zipf ranks with the most popular first', () => {
    const cdf = zipfCdf(30, 1.1);
    assert.ok(Math.abs(cdf[29]! - 1) < 1e-9);
    const rng = mulberry32(3);
    const counts = Array.from({ length: 30 }, () => 0);
    for (let i = 0; i < 20_000; i++) counts[sampleCdf(cdf, rng.next())]! += 1;
    assert.ok(counts[0]! > counts[1]! && counts[1]! > counts[9]! && counts[9]! > counts[29]!);
    const uniform = zipfCdf(4, 0);
    assert.deepEqual(uniform.map((c) => +c.toFixed(2)), [0.25, 0.5, 0.75, 1]);
  });

  it('computes percentiles and histograms', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    assert.equal(percentile(v, 50), 5);
    assert.equal(percentile(v, 95), 100);
    assert.deepEqual(histogram([0.5, 1, 40, 900]), [2, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('aggregates per-second buckets over a window', () => {
    const t = new Timeline();
    t.count(500, 'reads', 4);
    t.count(500, 'hits', 3);
    t.count(1500, 'dbOps', 6);
    t.latency(1500, 'read', 40);
    const w = t.window(0, 2);
    assert.equal(w.hitRatio, 0.75);
    assert.equal(w.dbRate, 3);
    assert.equal(w.peakDbRate, 6);
    assert.equal(w.readP95, 40);
  });

  it('offsets wires into lanes and walks along them', () => {
    const lane = offsetPolyline([[0, 0], [100, 0]], 5);
    assert.deepEqual(lane, [[0, -5], [100, -5]]);
    const corner = offsetPolyline([[0, 0], [100, 0], [100, -100]], 5);
    assert.deepEqual(corner[1], [95, -5]);
    const p = toPath([[0, 0], [100, 0], [100, 100]]);
    assert.deepEqual(pointAt(p, 0.75), [100, 50]);
  });
});

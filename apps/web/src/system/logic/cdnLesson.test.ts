import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chapterConfig } from '../stage/lesson';
import { CdnScene, type CdnConfig } from './cdn';
import { CDN, CHAPTERS, FREEZE_FRAMES, MISSIONS, runMission, startMission } from './cdnLesson';

describe('CDN missions', () => {
  for (const m of MISSIONS) {
    it(`${m.id}: the starting setup and the naive answer fail, the solution passes`, () => {
      assert.equal(runMission(m).pass, false, `starting setup passed: ${runMission(m).detail}`);
      const naive = runMission(m, m.naive);
      assert.equal(naive.pass, false, `naive passed: ${naive.detail}`);
      const solved = runMission(m, m.solution);
      assert.equal(solved.pass, true, `solution failed: ${solved.detail}`);
    });
  }

  it('hold on other seeds too, so the pass marks aren’t luck', () => {
    for (const m of MISSIONS) {
      for (const seed of [2, 3, 4]) {
        assert.equal(runMission(m, m.solution, seed).pass, true, `${m.id} solution, seed ${seed}: ${runMission(m, m.solution, seed).detail}`);
        assert.equal(runMission(m, m.naive, seed).pass, false, `${m.id} naive, seed ${seed}: ${runMission(m, m.naive, seed).detail}`);
      }
    }
  });

  it('only take the choices for the controls they offer', () => {
    const m = MISSIONS.find((x) => x.id === 'cut-egress')!;
    // The CDN's edges aren't one of its controls, so switching them all off can't be used to cheat.
    assert.deepEqual(runMission(m, { pops: [] }), runMission(m));
  });

  it('give the same result whether run headless or frame by frame', () => {
    const m = MISSIONS.find((x) => x.id === 'ship-v2')!;
    const live = startMission(m, m.solution);
    for (let t = 0; t < m.seconds * 1000; t += 16.7) live.sim.advance(Math.min(16.7, m.seconds * 1000 - live.sim.now));
    assert.deepEqual(m.check(live), runMission(m, m.solution));
  });

  it('refuse a PoP selection over budget', () => {
    const m = MISSIONS.find((x) => x.id === 'under-80')!;
    const over = runMission(m, { pops: ['nyc', 'lon', 'sin', 'syd', 'tyo'] });
    assert.equal(over.pass, false);
    assert.match(over.detail, /budget/);
  });
});

describe('CDN freeze frames', () => {
  /** What it takes, beyond the chapter's starting setup, for each frame's moment to happen. */
  const trigger: Record<string, { patch: Partial<CdnConfig>; at?: [number, (s: CdnScene) => void] }> = {
    'cdn-cold-edge': { patch: { cdnOn: true } },
    'cdn-warm-edge': { patch: { cdnOn: true } },
    'cdn-stale': { patch: {}, at: [5, (s) => s.deploy()] },
    'cdn-leak': { patch: { rule: 'all' } },
    'cdn-dead-edge': { patch: {}, at: [5, (s) => s.failPop('lon')] },
  };

  for (const f of FREEZE_FRAMES) {
    it(`${f.id} can fire in its chapter`, () => {
      const t = trigger[f.id]!;
      const s = new CdnScene({ ...chapterConfig(CDN, f.chapter), ...t.patch }, 1);
      if (t.at) s.sim.at(t.at[0] * 1000, () => t.at![1](s));
      s.freezeHook = (m) => f.when(m, s);
      s.sim.advance(60_000);
      assert.ok(s.frozen, 'never fired');
      assert.ok(f.prompt(s.frozen!, s).length > 20);
      if (f.answer.kind === 'choice') assert.ok(f.answer.options(s.frozen!, s).some((o) => o.id === (f.answer as { correct: (m: typeof s.frozen, x: CdnScene) => string }).correct(s.frozen, s)));
    });
  }

  it('belong to chapters that exist, as do the missions', () => {
    const ids = new Set(CHAPTERS.map((c) => c.id));
    for (const x of [...FREEZE_FRAMES, ...MISSIONS]) assert.ok(ids.has(x.chapter), x.id);
  });
});

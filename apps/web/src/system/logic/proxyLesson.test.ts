import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chapterConfig } from '../stage/lesson';
import { ProxyScene, type ProxyConfig } from './proxy';
import { ADDR } from './proxyMap';
import { CHAPTERS, FREEZE_FRAMES, MISSIONS, PROXY, runMission, startMission } from './proxyLesson';

const mission = (id: string) => MISSIONS.find((x) => x.id === id)!;

describe('proxy missions', () => {
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

  it('accept the other right answers, and refuse the other wrong ones', () => {
    const cases: [string, Partial<ProxyConfig>, boolean][] = [
      ['office-policy', { filter: true }, false],
      ['front-door', { routes: true }, false],
      ['offload', { tls: 'terminate' }, true],
      ['offload', { tls: 'terminate', cache: true }, true],
      ['offload', { cache: true, compression: 'proxy' }, false],
      ['scraper', { blocklist: [ADDR.scraper] }, true],
      ['scraper', { rateLimit: 10 }, false],
      ['scraper', { blocklist: [ADDR.egress.de] }, false],
      ['failover', { standby: true, healthCheckSec: 1 }, true],
    ];
    for (const [id, choices, pass] of cases) assert.equal(runMission(mission(id), choices).pass, pass, `${id} ${JSON.stringify(choices)}: ${runMission(mission(id), choices).detail}`);
  });

  it('only take the choices for the controls they offer', () => {
    // The scraper's rate isn't one of this mission's controls, so switching it off can't be used to cheat.
    const m = mission('scraper');
    assert.deepEqual(runMission(m, { scraperRps: 0 }), runMission(m));
  });

  it('give the same result whether run headless or frame by frame', () => {
    const m = mission('failover');
    const live = startMission(m, m.solution);
    for (let t = 0; t < m.seconds * 1000; t += 16.7) live.sim.advance(Math.min(16.7, m.seconds * 1000 - live.sim.now));
    assert.deepEqual(m.check(live), runMission(m, m.solution));
  });
});

describe('proxy freeze frames', () => {
  /** What it takes, beyond the chapter's starting setup, for each frame's moment to happen. */
  const trigger: Record<string, { patch: Partial<ProxyConfig>; at?: [number, (s: ProxyScene) => void] }> = {
    'proxy-source': { patch: { fwdOn: true } },
    'proxy-connect': { patch: { revOn: true } },
    'proxy-blind-cache': { patch: { cache: true }, at: [5, (s) => s.configure({ tls: 'passthrough' })] },
    'proxy-shared-ip': { patch: { rateLimit: 1 } },
    'proxy-down': { patch: {}, at: [5, (s) => s.failProxy()] },
  };

  for (const f of FREEZE_FRAMES) {
    it(`${f.id} can fire in its chapter`, () => {
      const t = trigger[f.id]!;
      const s = new ProxyScene({ ...chapterConfig(PROXY, f.chapter), ...t.patch }, 1);
      if (t.at) s.sim.at(t.at[0] * 1000, () => t.at![1](s));
      s.freezeHook = (m) => f.when(m, s);
      s.sim.advance(60_000);
      assert.ok(s.frozen, 'never fired');
      assert.ok(f.prompt(s.frozen!, s).length > 20);
      if (f.answer.kind === 'choice') assert.ok(f.answer.options(s.frozen!, s).some((o) => o.id === (f.answer as { correct: (m: typeof s.frozen, x: ProxyScene) => string }).correct(s.frozen, s)));
      if (f.answer.kind === 'node') assert.ok(s.layout.nodes.some((n) => n.id === (f.answer as { correct: (m: typeof s.frozen, x: ProxyScene) => string }).correct(s.frozen, s)));
    });
  }

  it('point at the machine the phone really connects to, and only ask once there’s a proxy to point at', () => {
    const f = FREEZE_FRAMES.find((x) => x.id === 'proxy-connect')!;
    if (f.answer.kind !== 'node') throw new Error('expected a node answer');
    const s = new ProxyScene({ ...chapterConfig(PROXY, 'reverse'), revOn: true }, 1);
    s.freezeHook = (m) => f.when(m, s);
    s.sim.advance(10_000);
    const answer = f.answer.correct(s.frozen!, s);
    s.freezeHook = null;
    const req = s.frozen!.kind === 'depart' ? s.frozen!.req : null;
    s.resume();
    s.sim.advance(2_000);
    assert.equal(req!.path[1], answer);
    const direct = new ProxyScene(chapterConfig(PROXY, 'reverse'), 1);
    direct.freezeHook = (m) => f.when(m, direct);
    direct.sim.advance(10_000);
    assert.equal(direct.frozen, null);
  });

  it('belong to chapters that exist, as do the missions', () => {
    const ids = new Set(CHAPTERS.map((c) => c.id));
    for (const x of [...FREEZE_FRAMES, ...MISSIONS]) assert.ok(ids.has(x.chapter), x.id);
  });
});

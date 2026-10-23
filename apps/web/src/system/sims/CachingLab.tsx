import { useEffect, useMemo, useRef, useState } from 'react';
import { btnCls, card, useTopicProgress } from '../components';
import { CachingScene, LOOP_EXTRA, type CachingConfig, type CachingReq, type Moment, type StageNode } from '../logic/caching';
import {
  CHAPTERS,
  CHAPTER_MAP,
  FREEZE_FRAMES,
  MISSION_MAP,
  MISSIONS,
  chapterConfig,
  startMission,
  type ChapterId,
  type FaultId,
  type FreezeFrame,
  type MissionResult,
} from '../logic/cachingLesson';
import { ChapterTabs, FreezePrompt } from '../stage/ChapterShell';
import { Inspector } from '../stage/Inspector';
import { Counter, InstrumentCard, LatencyHistogram, LoadBar, Ring, Timeline } from '../stage/instruments';
import { histogram } from '../stage/metrics';
import { MissionBanner, MissionList, type MissionPhase } from '../stage/Missions';
import { PlaybackBar, useFrameLoop, usePrefersReducedMotion } from '../stage/playback';
import { probsOf } from '../stage/rng';
import { Stage, TONE_COLOR } from '../stage/Stage';
import { Control } from './caching/controls';
import { Bursts, CacheNode, DbNode, PassNode, RANK_CAPTION, ReplicaNode, UsersNode } from './caching/nodes';

type Mode = { kind: 'free' } | { kind: 'mission'; id: string; phase: MissionPhase; result: MissionResult | null };

interface Freeze {
  frame: FreezeFrame;
  moment: Moment;
  prompt: string;
  answered: { correct: boolean; explain: string } | null;
}

const FAULTS: Record<FaultId, { label: string; run: (s: CachingScene) => void }> = {
  flush: { label: 'Flush the cache', run: (s) => s.flush(s.caches.has('cache') ? 'cache' : [...s.caches.keys()][0]) },
  crash: { label: 'Crash the cache', run: (s) => s.crash(s.caches.has('cache') ? 'cache' : 'cache2') },
  spike: { label: 'Traffic spike (3×)', run: (s) => s.spike() },
  scan: { label: 'Start the nightly scan', run: (s) => s.scan(60) },
  shift: { label: 'Shift popularity', run: (s) => s.shiftPopularity() },
};

/** Changing these redraws the stage, so they need a fresh scene. */
const needsRebuild = (p: Partial<CachingConfig>) => p.topology !== undefined || p.fleetMode !== undefined;

function KeyStrip({ scene }: { scene: CachingScene }) {
  const loop = scene.cfg.pattern === 'loop' && scene.cfg.topology === 'single';
  const keys = loop ? Array.from({ length: scene.cfg.capacity + LOOP_EXTRA }, (_, i) => `k${i + 1}`) : scene.keyRanking();
  const probs = loop ? keys.map(() => 1) : probsOf(scene.rankCdf);
  const max = Math.max(...probs);
  const cached = new Set<string>();
  for (const c of scene.caches.values()) for (const e of c.entries()) cached.add(e.key);
  return (
    <div className="flex items-end gap-3" aria-hidden>
      <div className="flex h-8 flex-1 items-end gap-px">
        {keys.map((k, i) => (
          <div key={k} title={`${k}${cached.has(k) ? ' (cached)' : ''}`} className={`flex-1 rounded-t-sm ${cached.has(k) ? 'bg-teal-400' : 'bg-zinc-700'}`} style={{ height: `${12 + (probs[i]! / max) * 88}%` }} />
        ))}
      </div>
      <p className="w-44 text-[11px] leading-tight text-zinc-500">{loop ? 'Loop: every key equally often, in order.' : 'Key popularity, hottest first. Teal: in a cache right now.'}</p>
    </div>
  );
}

function Legend() {
  const dot = (color: string) => <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400" aria-label="Legend">
      <li className="flex items-center gap-1.5">{dot(TONE_COLOR.request)} request</li>
      <li className="flex items-center gap-1.5">{dot(TONE_COLOR.hit)} answered by a cache</li>
      <li className="flex items-center gap-1.5">{dot(TONE_COLOR.miss)} missed, went to the database</li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: TONE_COLOR.write }} /> write
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rotate-45 border border-red-400" style={{ background: TONE_COLOR.hit }} /> stale data
      </li>
      <li className="flex items-center gap-1.5">
        <span className="font-bold text-red-500">✕</span> failed
      </li>
      <li className="flex items-center gap-1.5">{dot(TONE_COLOR.flush)} write-back batch</li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOR.control }} /> background work
      </li>
    </ul>
  );
}

/** The caching lesson: five chapters on one live stage, with missions and freeze frames. */
export function CachingLab() {
  const { progress, update } = useTopicProgress();
  const reduced = usePrefersReducedMotion();
  const [chapterId, setChapterId] = useState<ChapterId>('hit-miss');
  const [mode, setMode] = useState<Mode>({ kind: 'free' });
  const [choices, setChoices] = useState<Partial<CachingConfig>>({});
  const [seed, setSeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<CachingReq | null>(null);
  const [menu, setMenu] = useState<{ node: string; x: number; y: number } | null>(null);
  const [freeze, setFreeze] = useState<Freeze | null>(null);

  const progressRef = useRef(progress);
  progressRef.current = progress;
  const shown = useRef(new Set<string>());
  const pendingFreeze = useRef<{ frame: FreezeFrame; moment: Moment } | null>(null);
  const heatRef = useRef<Record<string, number>>({});

  const chapter = CHAPTER_MAP.get(chapterId)!;
  const mission = mode.kind === 'mission' ? MISSION_MAP.get(mode.id)! : null;

  const freeScene = (cfg: CachingConfig, s: number, ch: ChapterId) => {
    const scene = new CachingScene(cfg, s);
    scene.freezeHook = (m) => {
      const frame = FREEZE_FRAMES.find((f) => f.chapter === ch && !progressRef.current.freeze[f.id] && !shown.current.has(f.id) && f.when(m, scene));
      if (!frame) return false;
      shown.current.add(frame.id);
      pendingFreeze.current = { frame, moment: m };
      return true;
    };
    return scene;
  };
  const [scene, setScene] = useState(() => freeScene(chapterConfig('hit-miss'), 1, 'hit-miss'));

  const resetView = () => {
    setSelected(null);
    setMenu(null);
    setFreeze(null);
    pendingFreeze.current = null;
    heatRef.current = {};
  };

  const goChapter = (id: ChapterId) => {
    resetView();
    setChapterId(id);
    setMode({ kind: 'free' });
    setScene(freeScene(chapterConfig(id), seed, id));
    setPlaying(!reduced);
  };

  const enterMission = (id: string, keepChoices = false) => {
    const m = MISSION_MAP.get(id)!;
    resetView();
    const c = keepChoices ? choices : {};
    if (!keepChoices) setChoices({});
    setMode({ kind: 'mission', id, phase: 'setup', result: null });
    setScene(startMission(m, c));
    setPlaying(false);
  };

  const patch = (p: Partial<CachingConfig>) => {
    if (mode.kind === 'mission') {
      if (mode.phase !== 'setup') return;
      const next = { ...choices, ...p };
      setChoices(next);
      setScene(startMission(mission!, next));
      return;
    }
    if (needsRebuild(p)) {
      resetView();
      setScene(freeScene({ ...scene.cfg, ...p }, seed, chapterId));
    } else {
      scene.configure(p);
      refresh();
    }
  };

  const takeFreeze = () => {
    const pf = pendingFreeze.current;
    if (!pf) return;
    pendingFreeze.current = null;
    const note = pf.frame.answer.kind === 'note';
    const explain = pf.frame.explain(pf.moment, scene);
    setFreeze({ ...pf, prompt: pf.frame.prompt(pf.moment, scene), answered: note ? { correct: true, explain } : null });
    if (note) update((p) => ({ ...p, freeze: { ...p.freeze, [pf.frame.id]: { correct: true } } }));
  };

  const finishMission = () => {
    if (mode.kind !== 'mission' || mode.phase !== 'running') return;
    const result = mission!.check(scene);
    setMode({ ...mode, phase: 'done', result });
    setPlaying(false);
    if (result.pass) update((p) => ({ ...p, missions: { ...p.missions, [mission!.id]: true } }));
  };

  const advance = (dt: number) => {
    if (mode.kind === 'mission') {
      if (mode.phase !== 'running') return;
      const end = mission!.seconds * 1000;
      scene.sim.advance(Math.min(dt, end - scene.sim.now));
      if (scene.sim.now >= end) finishMission();
      return;
    }
    scene.sim.advance(dt);
    takeFreeze();
  };

  const running = playing && !reduced && !freeze && (mode.kind === 'free' || mode.phase === 'running');
  const refresh = useFrameLoop(running, (dt) => {
    advance(dt * speed);
    // Wires glow with how many dots are on them, smoothed so they don't flicker.
    const counts: Record<string, number> = {};
    for (const t of scene.sim.travels.values()) counts[t.wire] = (counts[t.wire] ?? 0) + 1;
    for (const w of scene.layout.wires) heatRef.current[w.id] = (heatRef.current[w.id] ?? 0) * 0.94 + ((counts[w.id] ?? 0) / 6) * 0.06;
  });

  // Start playing once the prediction above has been answered and the lab unlocks.
  const unlocked = !!progress.prediction;
  useEffect(() => {
    if (unlocked) setPlaying(!reduced);
  }, [reduced, unlocked]);

  const step = () => {
    if (mode.kind === 'mission' && mode.phase !== 'running') return;
    if (reduced) advance(1000);
    else {
      const sig = () => `${scene.sim.travels.size}:${[...scene.sim.travels.keys()].pop() ?? 0}:${scene.sim.events.length}`;
      const before = sig();
      const end = mission ? mission.seconds * 1000 : Infinity;
      for (let i = 0; i < 500 && !scene.sim.halted && scene.sim.nextAt <= end; i++) {
        scene.sim.step();
        if (sig() !== before) break;
      }
      if (mission && scene.sim.now >= end) finishMission();
      takeFreeze();
    }
    refresh();
  };

  const reset = () => {
    if (mode.kind === 'mission') return enterMission(mode.id, true);
    resetView();
    setSeed((s) => s + 1);
    setScene(freeScene(scene.cfg, seed + 1, chapterId));
  };

  const answer = (choice: string) => {
    if (!freeze || freeze.answered) return;
    const { frame, moment } = freeze;
    const correct = frame.answer.kind === 'node' ? choice === frame.answer.node : frame.answer.kind === 'slot' ? moment.kind === 'evict' && choice === `slot:${moment.slot}` : true;
    setFreeze({ ...freeze, answered: { correct, explain: frame.explain(moment, scene) } });
    update((p) => ({ ...p, freeze: { ...p.freeze, [frame.id]: { correct } } }));
  };

  const continueFreeze = () => {
    setFreeze(null);
    scene.resume();
    takeFreeze();
    refresh();
  };

  const picking = !!freeze && !freeze.answered && freeze.frame.answer.kind !== 'note';
  const pickSlot = picking && freeze!.frame.answer.kind === 'slot';

  // ---- instruments, recomputed a few times a second ----
  const now = scene.sim.now;
  const tick = Math.floor(now / 250);
  const stats = useMemo(() => {
    const t = scene.timeline;
    const nowS = now / 1000;
    const recent = t.window(nowS - 5, nowS);
    const reads = t.samples(nowS - 5, nowS, 'read');
    const span = 30;
    const start = Math.max(0, Math.floor(nowS) - span);
    const secs = Array.from({ length: span }, (_, i) => t.second(start + i));
    return {
      recent,
      hist: histogram(reads),
      dbNow: t.window(nowS - 3, nowS).dbRate,
      bars: secs.map((b) => b.dbOps),
      ratio: secs.map((b) => (b.reads ? b.hits / b.reads : null)),
      markers: scene.markers.filter((m) => m.at / 1000 >= start).map((m) => ({ at: m.at / 1000 - start, label: m.label })),
    };
  }, [scene, tick]);

  const controlIds = mode.kind === 'mission' ? mission!.controls : chapter.controls;
  // The replica only matters where its control is offered.
  const showReplica = controlIds.includes('replica');
  const layout = useMemo(() => {
    if (showReplica) return scene.layout;
    const nodes = scene.layout.nodes.filter((n) => n.kind !== 'replica');
    // Without the replica the bottom of the stage is empty, so trim it.
    const height = Math.min(scene.layout.height, Math.max(...nodes.map((n) => n.y + n.h)) + 28);
    return { ...scene.layout, height, nodes, wires: scene.layout.wires.filter((w) => w.to !== 'replica') };
  }, [scene, showReplica]);
  // Totals change on faults too (a crash loses writes without the clock moving), so not memoized.
  const total = scene.timeline.window(0, now / 1000 + 1);
  const events = scene.sim.recent(3500);
  const singleUser = scene.cfg.topology === 'layers';
  const heat = { ...heatRef.current };

  const renderNode = (n: StageNode) => {
    switch (n.kind) {
      case 'users':
        return <UsersNode n={n} single={singleUser} />;
      case 'cache':
        return <CacheNode n={n} scene={scene} events={events} onPickSlot={pickSlot ? (i) => answer(`slot:${i}`) : undefined} />;
      case 'db':
        return <DbNode n={n} scene={scene} rate={stats.dbNow} />;
      case 'replica':
        return <ReplicaNode n={n} scene={scene} />;
      default:
        return <PassNode n={n} />;
    }
  };

  const frameClass = (n: StageNode) => {
    const tone = n.kind === 'cache' ? 'tone-cache' : n.kind === 'db' ? 'tone-db' : n.kind === 'replica' ? 'tone-replica' : '';
    const target = freeze && !freeze.answered && freeze.moment.node === n.id ? 'is-focus' : '';
    return `${tone} ${scene.isDown(n.id) ? 'is-down' : ''} ${target}`;
  };

  const onNodeClick = (id: string, at: { x: number; y: number }) => {
    if (picking) {
      if (!pickSlot) answer(id);
      return;
    }
    const faults = mode.kind === 'free' ? chapter.faults.filter((f) => f === 'flush' || f === 'crash') : [];
    if (scene.caches.has(id) && faults.length) setMenu({ node: id, ...at });
    else setMenu(null);
  };

  const missionsHere = MISSIONS.filter((m) => m.chapter === chapterId);
  const chapterDone = (id: ChapterId) => MISSIONS.filter((m) => m.chapter === id).every((m) => progress.missions[m.id]);
  const controlsLocked = mode.kind === 'mission' && mode.phase !== 'setup';

  const controls = (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
      {controlIds.map((id) => (
        <Control key={id} id={id} cfg={scene.cfg} onPatch={patch} disabled={controlsLocked} />
      ))}
    </div>
  );

  const answerKind = freeze?.frame.answer.kind;
  const nodeChoices = answerKind === 'node' ? layout.nodes.filter((n) => n.kind !== 'replica').map((n) => ({ id: n.id, label: n.label })) : [];
  const slotChoices =
    answerKind === 'slot'
      ? scene.caches.get(freeze!.moment.node)!.slots.map((e, i) => ({ id: `slot:${i}`, label: `Slot ${i + 1}${e ? ` (${e.key})` : ''}` }))
      : [];

  const focusNode = freeze && !freeze.answered && freeze.moment.kind === 'lookup' ? layout.nodes.find((n) => n.id === freeze.moment.node) : undefined;

  return (
    <div className="space-y-3">
      <ChapterTabs chapters={CHAPTERS.map((c) => ({ id: c.id, title: c.title, done: chapterDone(c.id) }))} active={chapterId} onSelect={(id) => goChapter(id as ChapterId)} />

      <div className={card}>
        <p className="text-sm text-zinc-300">{chapter.concept}</p>
        <p className="mt-1.5 text-xs text-zinc-400">
          <span className="text-indigo-300">Try this:</span> {chapter.tryThis}
        </p>
      </div>

      {mission && mode.kind === 'mission' && (
        <MissionBanner
          mission={mission}
          phase={mode.phase}
          progress={scene.sim.now / (mission.seconds * 1000)}
          result={mode.result}
          controls={controls}
          onRun={() => {
            setMode({ ...mode, phase: 'running' });
            setPlaying(true);
          }}
          onRetry={() => enterMission(mission.id, true)}
          onExit={() => goChapter(chapterId)}
        />
      )}

      {freeze && <FreezePrompt prompt={freeze.prompt} choices={[...nodeChoices, ...slotChoices]} answered={freeze.answered} onChoose={answer} onContinue={continueFreeze} />}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_272px]">
        <div className="min-w-0 space-y-2">
          <div className="relative rounded-xl border border-zinc-800 bg-zinc-950 p-2" onClick={(e) => !(e.target as Element).closest('[data-node]') && setMenu(null)}>
            <Stage
              layout={layout}
              travels={[...scene.sim.travels.values()]}
              now={now}
              renderNode={renderNode}
              frameClass={frameClass}
              heat={heat}
              picking={picking && !pickSlot}
              onNodeClick={onNodeClick}
              onPacketClick={(req) => {
                setSelected(req as CachingReq);
                setPlaying(false);
              }}
              selectedReq={selected?.id ?? null}
              label={`Caching stage: ${layout.nodes.map((n) => n.label).join(', ')}. Hit ratio ${Math.round(stats.recent.hitRatio * 100)}%, database ${stats.dbNow.toFixed(1)} operations a second.`}
              overlay={
                <>
                  <Bursts scene={scene} events={events} nodes={layout.nodes} />
                  {focusNode && <circle className="stage-pulse" cx={focusNode.x} cy={focusNode.y + focusNode.h / 2} r={9} fill="none" stroke="#38bdf8" strokeWidth={2} />}
                </>
              }
            />
            {menu && (
              <div
                className="absolute z-10 w-44 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
                style={{ left: `${menu.x * 100}%`, top: `${menu.y * 100}%` }}
                role="menu"
                aria-label={`${scene.labelOf(menu.node)} actions`}
                onClick={(e) => e.stopPropagation()}
              >
                {chapter.faults.includes('flush') && (
                  <button type="button" role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800" onClick={() => (scene.flush(menu.node), setMenu(null), refresh())}>
                    Flush {scene.labelOf(menu.node).toLowerCase()}
                  </button>
                )}
                {chapter.faults.includes('crash') && (
                  <button type="button" role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-sm text-red-300 hover:bg-zinc-800" onClick={() => (scene.crash(menu.node), takeFreeze(), setMenu(null), refresh())}>
                    Crash {scene.labelOf(menu.node).toLowerCase()}
                  </button>
                )}
              </div>
            )}
            <p className="px-1 pt-1 text-[11px] text-zinc-500">
              {controlIds.includes('policy') && `${RANK_CAPTION[scene.cfg.policy]} `}
              {layout.scale} Dots move at a teaching pace; every number shown is the modeled latency. Click a dot to inspect it{mode.kind === 'free' && chapter.faults.some((f) => f === 'flush' || f === 'crash') ? ', or a cache to break it' : ''}.
            </p>
          </div>

          {scene.cfg.topology !== 'fleet' && <KeyStrip scene={scene} />}
          <Legend />

          <PlaybackBar
            playing={running}
            reduced={reduced}
            onToggle={() => setPlaying((p) => !p)}
            onStep={step}
            speed={speed}
            onSpeed={setSpeed}
            onReset={reset}
            now={now}
            disabled={!!freeze || (mode.kind === 'mission' && mode.phase !== 'running')}
            stepLabel="Next event"
          />

          {mode.kind === 'free' && (
            <div className={`${card} space-y-3`}>
              {controls}
              {chapter.faults.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
                  <span className="text-xs tracking-wide text-zinc-500 uppercase">Break it</span>
                  {chapter.faults.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={btnCls}
                      onClick={() => {
                        FAULTS[f].run(scene);
                        takeFreeze();
                        refresh();
                      }}
                    >
                      {FAULTS[f].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {selected && <Inspector req={selected} onClose={() => setSelected(null)} describe={(r) => ((r as CachingReq).servedBy ? `answered by ${scene.labelOf((r as CachingReq).servedBy!)}` : '')} />}
        </div>

        <aside className="space-y-2" aria-label="Instruments">
          <InstrumentCard title="Hit ratio" aside={<span className="text-[11px] text-zinc-500">last 5 s</span>}>
            <Ring value={stats.recent.reads ? stats.recent.hitRatio : null} label={stats.recent.reads ? `${stats.recent.hits} of ${stats.recent.reads} reads answered by a cache` : 'Waiting for reads to finish.'} />
          </InstrumentCard>
          <InstrumentCard title="Database load">
            <LoadBar value={stats.dbNow} capacity={scene.cfg.dbCapacity} unit="ops/s" note={scene.db.queue ? `${scene.db.queue} waiting in its queue (max ${scene.db.maxQueue})` : 'Queue empty.'} />
          </InstrumentCard>
          <InstrumentCard title="Read latency" aside={<span className="text-[11px] text-zinc-500">last 5 s, ms</span>}>
            <LatencyHistogram counts={stats.hist} p50={stats.recent.readP50} p95={stats.recent.readP95} />
            {stats.recent.writes > 0 && <p className="mt-1 text-xs text-zinc-400">Write p95 <span className="font-mono text-zinc-100">{stats.recent.writeP95.toFixed(1)} ms</span></p>}
          </InstrumentCard>
          <div className="grid grid-cols-3 gap-1.5" aria-live="polite">
            <Counter label="failed" value={total.failed} tone="red" />
            <Counter label="stale reads" value={total.stale} tone="amber" />
            <Counter label="writes lost" value={total.lost} tone="violet" />
          </div>
          <InstrumentCard title="Last 30 s" aside={<span className="text-[11px] text-zinc-500">bars: DB ops · line: hit ratio</span>}>
            <Timeline bars={stats.bars} ratio={stats.ratio} markers={stats.markers} barMax={Math.max(scene.cfg.dbCapacity * 2, ...stats.bars)} seconds={30} />
          </InstrumentCard>
        </aside>
      </div>

      {mode.kind === 'free' && <MissionList missions={missionsHere} passed={progress.missions} onStart={(id) => enterMission(id)} />}
    </div>
  );
}

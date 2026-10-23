import { useMemo, useState } from 'react';
import { CachingScene, LOOP_EXTRA, type CachingReq, type StageNode } from '../logic/caching';
import { CACHING, type FaultId } from '../logic/cachingLesson';
import { Inspector } from '../stage/Inspector';
import { Counter, InstrumentCard, LatencyHistogram, LoadBar, Ring, Timeline } from '../stage/instruments';
import { LessonLayout } from '../stage/LessonLayout';
import { histogram } from '../stage/metrics';
import { probsOf } from '../stage/rng';
import { Stage, TONE_COLOR } from '../stage/Stage';
import { useLessonRunner } from '../stage/useLessonRunner';
import { Control } from './caching/controls';
import { Bursts, CacheNode, DbNode, PassNode, RANK_CAPTION, ReplicaNode, UsersNode } from './caching/nodes';

const FAULTS: Record<FaultId, { label: string; run: (s: CachingScene) => void }> = {
  flush: { label: 'Flush the cache', run: (s) => s.flush(s.caches.has('cache') ? 'cache' : [...s.caches.keys()][0]) },
  crash: { label: 'Crash the cache', run: (s) => s.crash(s.caches.has('cache') ? 'cache' : 'cache2') },
  spike: { label: 'Traffic spike (3×)', run: (s) => s.spike() },
  scan: { label: 'Start the nightly scan', run: (s) => s.scan(60) },
  shift: { label: 'Shift popularity', run: (s) => s.shiftPopularity() },
};

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
  const r = useLessonRunner(CACHING);
  const { scene, now, freeze, mode, chapter } = r;
  const [menu, setMenu] = useState<{ node: string; x: number; y: number } | null>(null);

  // ---- instruments, recomputed a few times a second ----
  const tick = Math.floor(now / 250);
  const stats = useMemo(() => {
    const t = scene.timeline;
    const nowS = now / 1000;
    const span = 30;
    const start = Math.max(0, Math.floor(nowS) - span);
    const secs = Array.from({ length: span }, (_, i) => t.second(start + i).counts);
    return {
      recent: t.window(nowS - 5, nowS),
      hist: histogram(t.values(nowS - 5, nowS, 'read')),
      dbNow: t.window(nowS - 3, nowS).dbRate,
      bars: secs.map((c) => c.dbOps ?? 0),
      ratio: secs.map((c) => (c.reads ? (c.hits ?? 0) / c.reads : null)),
      markers: scene.markers.filter((m) => m.at / 1000 >= start).map((m) => ({ at: m.at / 1000 - start, label: m.label })),
    };
  }, [scene, tick]);

  // The replica only matters where its control is offered.
  const showReplica = r.controlIds.includes('replica');
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

  const renderNode = (n: StageNode) => {
    switch (n.kind) {
      case 'users':
        return <UsersNode n={n} single={scene.cfg.topology === 'layers'} />;
      case 'cache':
        return <CacheNode n={n} scene={scene} events={events} onPickSlot={r.picking === 'slot' ? (i) => r.answer(`slot:${i}`) : undefined} />;
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

  const breakable = mode.kind === 'free' && chapter.faults.some((f) => f === 'flush' || f === 'crash');
  const onNodeClick = (id: string, at: { x: number; y: number }) => {
    if (r.picking) {
      if (r.picking === 'node') r.answer(id);
      return;
    }
    setMenu(scene.caches.has(id) && breakable ? { node: id, ...at } : null);
  };

  const freezeChoices =
    freeze?.frame.answer.kind === 'node'
      ? layout.nodes.filter((n) => n.kind !== 'replica').map((n) => ({ id: n.id, label: n.label }))
      : freeze?.frame.answer.kind === 'slot'
        ? scene.caches.get(freeze.moment.node)!.slots.map((e, i) => ({ id: `slot:${i}`, label: `Slot ${i + 1}${e ? ` (${e.key})` : ''}` }))
        : [];

  const focusNode = freeze && !freeze.answered && freeze.moment.kind === 'lookup' ? layout.nodes.find((n) => n.id === freeze.moment.node) : undefined;
  const selected = r.selected as CachingReq | null;

  const stage = (
    <div className="relative rounded-xl border border-zinc-800 bg-zinc-950 p-2" onClick={(e) => !(e.target as Element).closest('[data-node]') && setMenu(null)}>
      <Stage
        layout={layout}
        travels={[...scene.sim.travels.values()]}
        now={now}
        renderNode={renderNode}
        frameClass={frameClass}
        heat={r.heat}
        picking={r.picking === 'node'}
        onNodeClick={onNodeClick}
        onPacketClick={r.select}
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
            <button type="button" role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800" onClick={() => (r.act((s) => s.flush(menu.node)), setMenu(null))}>
              Flush {scene.labelOf(menu.node).toLowerCase()}
            </button>
          )}
          {chapter.faults.includes('crash') && (
            <button type="button" role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-sm text-red-300 hover:bg-zinc-800" onClick={() => (r.act((s) => s.crash(menu.node)), setMenu(null))}>
              Crash {scene.labelOf(menu.node).toLowerCase()}
            </button>
          )}
        </div>
      )}
      <p className="px-1 pt-1 text-[11px] text-zinc-500">
        {r.controlIds.includes('policy') && `${RANK_CAPTION[scene.cfg.policy]} `}
        {layout.scale} Dots move at a teaching pace; every number shown is the modeled latency. Click a dot to inspect it{breakable ? ', or a cache to break it' : ''}.
      </p>
    </div>
  );

  return (
    <LessonLayout
      runner={r}
      stage={stage}
      belowStage={
        <>
          {scene.cfg.topology !== 'fleet' && <KeyStrip scene={scene} />}
          <Legend />
        </>
      }
      controls={
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          {r.controlIds.map((id) => (
            <Control key={id} id={id} cfg={scene.cfg} onPatch={r.patch} disabled={r.controlsLocked} />
          ))}
        </div>
      }
      faults={chapter.faults.map((f) => ({ id: f, label: FAULTS[f].label, run: () => r.act(FAULTS[f].run) }))}
      freezeChoices={freezeChoices}
      inspector={selected && <Inspector req={selected} onClose={r.clearSelected} describe={(q) => ((q as CachingReq).servedBy ? `answered by ${scene.labelOf((q as CachingReq).servedBy!)}` : '')} />}
      instruments={
        <>
          <InstrumentCard title="Hit ratio" aside={<span className="text-[11px] text-zinc-500">last 5 s</span>}>
            <Ring value={stats.recent.reads ? stats.recent.hitRatio : null} label={stats.recent.reads ? `${stats.recent.hits} of ${stats.recent.reads} reads answered by a cache` : 'Waiting for reads to finish.'} />
          </InstrumentCard>
          <InstrumentCard title="Database load">
            <LoadBar value={stats.dbNow} capacity={scene.cfg.dbCapacity} unit="ops/s" note={scene.db.queue ? `${scene.db.queue} waiting in its queue (max ${scene.db.maxQueue})` : 'Queue empty.'} />
          </InstrumentCard>
          <InstrumentCard title="Read latency" aside={<span className="text-[11px] text-zinc-500">last 5 s, ms</span>}>
            <LatencyHistogram counts={stats.hist} p50={stats.recent.readP50} p95={stats.recent.readP95} />
            {stats.recent.writes > 0 && (
              <p className="mt-1 text-xs text-zinc-400">
                Write p95 <span className="font-mono text-zinc-100">{stats.recent.writeP95.toFixed(1)} ms</span>
              </p>
            )}
          </InstrumentCard>
          <div className="grid grid-cols-3 gap-1.5" aria-live="polite">
            <Counter label="failed" value={total.failed} tone="red" />
            <Counter label="stale reads" value={total.stale} tone="amber" />
            <Counter label="writes lost" value={total.lost} tone="violet" />
          </div>
          <InstrumentCard title="Last 30 s" aside={<span className="text-[11px] text-zinc-500">bars: DB ops · line: hit ratio</span>}>
            <Timeline bars={stats.bars} ratio={stats.ratio} markers={stats.markers} barMax={Math.max(scene.cfg.dbCapacity * 2, ...stats.bars)} seconds={30} />
          </InstrumentCard>
        </>
      }
    />
  );
}

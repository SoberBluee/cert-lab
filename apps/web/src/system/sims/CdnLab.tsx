import { useMemo, useState } from 'react';
import { CdnScene, CATALOGS, type CdnReq } from '../logic/cdn';
import { cityOf, ORIGIN, PROVIDERS, SHIELD } from '../logic/cdnMap';
import { CDN, type FaultId } from '../logic/cdnLesson';
import { CITIES, nearestCity, PIN_CITIES, rttMs, type CityId } from '../stage/geo';
import type { Pt } from '../stage/geometry';
import { Inspector } from '../stage/Inspector';
import { Counter, InstrumentCard, LatencyBars, LoadBar, Ring, StackBar, Timeline } from '../stage/instruments';
import type { StageNode } from '../stage/layout';
import { LessonLayout, type FaultButton } from '../stage/LessonLayout';
import { Stage, TONE_COLOR } from '../stage/Stage';
import { useLessonRunner } from '../stage/useLessonRunner';
import { Control } from './cdn/controls';
import { MapBackground, MapBursts, OriginNode, PinNode, PopNode, ShieldNode } from './cdn/map';

/** The edge serving a city's users right now, by anycast's rule (nearest healthy edge that's on). */
function servingEdge(s: CdnScene, pin: CityId): CityId | null {
  let best: CityId | null = null;
  for (const c of s.cfg.pops) if (!s.isDead(c) && (!best || rttMs(CITIES[pin], CITIES[c]) < rttMs(CITIES[pin], CITIES[best]))) best = c;
  return best;
}

/** One-click faults for a chapter, worded for the current setup. */
function faultButtons(s: CdnScene, faults: FaultId[], act: (fn: (s: CdnScene) => void) => void): FaultButton[] {
  const out: FaultButton[] = [];
  const hasDeployable = CATALOGS[s.cfg.catalog].groups.some((g) => g.objects.some((o) => o.deployable));
  if (faults.includes('deploy') && hasDeployable) out.push({ id: 'deploy', label: `Deploy app.js v${s.versionOf('app.js') + 1}`, run: () => act((x) => x.deploy()) });
  if (faults.includes('failPop')) {
    const target = s.cfg.pins.map((p) => servingEdge(s, p)).find(Boolean);
    if (target) out.push({ id: 'failPop', label: `Fail the ${CITIES[target].name} edge`, run: () => act((x) => x.failPop(target)) });
    const dead = [...s.dead.keys()];
    if (dead.length) out.push({ id: 'restore', label: 'Bring failed edges back', run: () => act((x) => dead.forEach((c) => x.restorePop(c))) });
  }
  if (faults.includes('block')) {
    const pin = s.cfg.pins.includes('bom') ? 'bom' : s.cfg.pins.at(-1);
    if (pin) {
      const blocked = s.cfg.blocked.includes(pin);
      out.push({
        id: 'block',
        label: blocked ? `Unblock the CDN in ${CITIES[pin].name}` : `${CITIES[pin].name} blocks the CDN`,
        run: () => act((x) => x.configure({ blocked: blocked ? x.cfg.blocked.filter((b) => b !== pin) : [...x.cfg.blocked, pin] })),
      });
    }
  }
  return out;
}

function Legend() {
  const dot = (color: string, size = 10) => <span className="inline-block rounded-full" style={{ background: color, width: size, height: size }} />;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400" aria-label="Legend">
      <li className="flex items-center gap-1.5">{dot(TONE_COLOR.request)} request</li>
      <li className="flex items-center gap-1.5">{dot(TONE_COLOR.hit)} answered by an edge</li>
      <li className="flex items-center gap-1.5">{dot(TONE_COLOR.miss)} fetched from the origin</li>
      <li className="flex items-center gap-1.5">{dot(TONE_COLOR.control, 6)} “has it changed?” and 304s</li>
      <li className="flex items-center gap-1.5">{dot(TONE_COLOR.flush)} push or purge</li>
      <li className="flex items-center gap-1.5">
        <span className="font-bold text-red-500">✕</span> failed
      </li>
      <li>Dot size: how big the file is.</li>
    </ul>
  );
}

/** The CDN lesson: a world map of users, edges and one origin, in five chapters. */
export function CdnLab() {
  const r = useLessonRunner(CDN);
  const { scene, now, freeze, mode, chapter } = r;
  const cfg = scene.cfg;
  const [menu, setMenu] = useState<{ city: CityId; x: number; y: number } | null>(null);
  const [ghost, setGhost] = useState<Pt | null>(null);

  // ---- instruments, recomputed a few times a second ----
  const tick = Math.floor(now / 250);
  const stats = useMemo(() => {
    const nowS = now / 1000;
    const span = 30;
    const start = Math.max(0, Math.floor(nowS) - span);
    const secs = Array.from({ length: span }, (_, i) => scene.timeline.second(start + i).counts);
    return {
      recent: scene.stats(nowS - 8, nowS),
      bars: secs.map((c) => c.originOps ?? 0),
      ratio: secs.map((c) => (c.edgeLookups ? Math.min(1, (c.edgeHits ?? 0) / c.edgeLookups) : null)),
      markers: scene.markers.filter((m) => m.at / 1000 >= start).map((m) => ({ at: m.at / 1000 - start, label: m.label })),
    };
  }, [scene, tick]);
  // Totals move on faults too (a leak, a failure), so not memoized.
  const total = scene.stats(0, now / 1000 + 1);
  const events = scene.sim.recent(3000);

  // The shield only appears when it's on.
  const layout = useMemo(() => (cfg.shield ? scene.layout : { ...scene.layout, nodes: scene.layout.nodes.filter((n) => n.id !== SHIELD) }), [scene, scene.layout, cfg.shield]);

  const editingPops = r.controlIds.includes('pops') && !r.controlsLocked;
  const canFail = mode.kind === 'free' && chapter.faults.includes('failPop');

  const togglePop = (c: CityId) => {
    if (cfg.pops.includes(c)) return r.patch({ pops: cfg.pops.filter((p) => p !== c) });
    if (cfg.popBudget !== null && cfg.pops.length >= cfg.popBudget) return;
    r.patch({ pops: [...cfg.pops, c] });
  };

  const popActions = (c: CityId) => [
    ...(editingPops ? [{ label: cfg.pops.includes(c) ? 'Switch this edge off' : 'Switch this edge on', run: () => togglePop(c) }] : []),
    ...(canFail ? [scene.isDead(c) ? { label: 'Bring it back', run: () => r.act((s) => s.restorePop(c)) } : { label: 'Fail this edge', run: () => r.act((s) => s.failPop(c)) }] : []),
  ];

  const onNodeClick = (id: string, at: { x: number; y: number }) => {
    if (r.picking === 'node') return r.answer(id);
    if (!id.startsWith('pop-')) return setMenu(null);
    const acts = popActions(cityOf(id));
    if (acts.length === 1) {
      acts[0]!.run();
      setMenu(null);
    } else setMenu(acts.length ? { city: cityOf(id), ...at } : null);
  };

  const movePin = (id: string, at: Pt, done: boolean) => {
    if (!done) return setGhost(at);
    setGhost(null);
    const from = cityOf(id);
    const to = nearestCity(at, PIN_CITIES.filter((c) => c === from || !cfg.pins.includes(c)));
    if (to !== from) r.patch({ pins: cfg.pins.map((c) => (c === from ? to : c)) });
  };

  const renderNode = (n: StageNode) => {
    if (n.kind === 'origin') return <OriginNode n={n} load={`${CITIES[cfg.origin].name} · ${stats.recent.originRate.toFixed(1)} ops/s`} />;
    if (n.kind === 'shield') return <ShieldNode n={n} hitRatio={null} />;
    const city = cityOf(n.id);
    if (n.kind === 'pop') {
      const e = scene.edgeStats.get(city)!;
      return <PopNode n={n} city={city} on={cfg.cdnOn && cfg.pops.includes(city)} dead={scene.isDead(city)} hitRatio={e.lookups ? e.hits / e.lookups : null} />;
    }
    return <PinNode n={n} city={city} latency={stats.recent.byCity[city]?.p50 ?? null} showName={!PROVIDERS[cfg.provider].pops.includes(city)} />;
  };

  const focus = freeze && !freeze.answered ? layout.nodes.find((n) => n.id === freeze.moment.node) : undefined;
  const freezeChoices =
    freeze?.frame.answer.kind === 'node'
      ? [ORIGIN, ...(cfg.shield ? [SHIELD] : []), freeze.moment.node].map((id) => ({ id, label: id === ORIGIN ? 'The origin' : id === SHIELD ? 'The origin shield' : `The ${CITIES[cityOf(id)].name} edge` }))
      : [];

  const cityRows = cfg.pins.flatMap((c) => {
    const v = stats.recent.byCity[c];
    return v ? [{ label: CITIES[c].name, p50: v.p50, p95: v.p95 }] : [];
  });
  const latencyCard = (
    <InstrumentCard title="Latency by city" aside={<span className="text-[11px] text-zinc-500">static files, last 8 s, ms</span>}>
      <LatencyBars rows={cityRows} />
      <p className="mt-1.5 text-[11px] text-zinc-500">Bar: median. Tick: p95.</p>
    </InstrumentCard>
  );
  const perMinute = 60 / stats.recent.seconds;
  const selected = r.selected as CdnReq | null;

  const stage = (
    <div className="space-y-2">
      {/* On narrow screens the map's badges are too small to read, so the numbers come first. */}
      <div className="lg:hidden">{latencyCard}</div>
      <div className="relative rounded-xl border border-zinc-800 bg-zinc-950 p-2" onClick={(e) => !(e.target as Element).closest('[data-node]') && setMenu(null)}>
        <Stage
          layout={layout}
          travels={[...scene.sim.travels.values()]}
          now={now}
          renderNode={renderNode}
          drawFrame={() => false}
          background={<MapBackground origin={cfg.origin} />}
          visibleWires={scene.routesInUse()}
          lane={2.5}
          heat={r.heat}
          picking={r.picking === 'node'}
          draggable={(n) => n.kind === 'pin' && mode.kind === 'free' && !r.picking}
          onNodeDrag={movePin}
          onNodeClick={onNodeClick}
          onPacketClick={r.select}
          selectedReq={selected?.id ?? null}
          label={`CDN map: origin in ${CITIES[cfg.origin].name}; ${cfg.cdnOn ? `${cfg.pops.length} edges on` : 'CDN off'}; users in ${cfg.pins.map((c) => CITIES[c].name).join(', ')}. Edge hit ratio ${Math.round(stats.recent.hitRatio * 100)}%.`}
          overlay={
            <>
              <MapBursts events={events} nodes={layout.nodes} now={now} />
              {focus && <circle className="stage-pulse" cx={focus.x + focus.w / 2} cy={focus.y + focus.h / 2} r={11} fill="none" stroke="#38bdf8" strokeWidth={2} />}
              {ghost && <circle cx={ghost[0]} cy={ghost[1]} r={10} fill="none" stroke="#e4e4e7" strokeDasharray="3 2" />}
            </>
          }
        />
        {menu && (
          <div
            className="absolute z-10 w-48 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
            style={{ left: `${menu.x * 100}%`, top: `${menu.y * 100}%` }}
            role="menu"
            aria-label={`${CITIES[menu.city].name} edge`}
            onClick={(e) => e.stopPropagation()}
          >
            {popActions(menu.city).map((a) => (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                className={`block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-800 ${a.label.startsWith('Fail') ? 'text-red-300' : 'text-zinc-200'}`}
                onClick={() => (a.run(), setMenu(null))}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        <p className="px-1 pt-1 text-[11px] text-zinc-500">
          Latency is end to end, from each user; routes are drawn as arcs that never cross the date line, but use the true distance. Click a dot to follow it
          {editingPops || canFail ? ', click an edge to switch or fail it' : ''}
          {mode.kind === 'free' ? ', and drag a user to another city' : ''}.
        </p>
      </div>
    </div>
  );

  return (
    <LessonLayout
      runner={r}
      stage={stage}
      belowStage={<Legend />}
      controls={
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          {r.controlIds.map((id) => (
            <Control key={id} id={id} cfg={cfg} onPatch={r.patch} disabled={r.controlsLocked} />
          ))}
        </div>
      }
      faults={mode.kind === 'free' ? faultButtons(scene, chapter.faults, r.act) : []}
      freezeChoices={freezeChoices}
      inspector={selected && <Inspector req={selected} onClose={r.clearSelected} describe={(q) => (q as CdnReq).outcome ?? ''} />}
      instruments={
        <>
          <div className="hidden lg:block">{latencyCard}</div>
          <InstrumentCard title="Edge hit ratio" aside={<span className="text-[11px] text-zinc-500">last 8 s</span>}>
            <Ring value={cfg.cdnOn ? stats.recent.hitRatio : null} label={cfg.cdnOn ? 'of requests the edges looked up, answered without a full trip to the origin' : 'CDN off: every request goes to the origin.'} />
          </InstrumentCard>
          <InstrumentCard title="Origin">
            <LoadBar value={stats.recent.originRate} capacity={cfg.originCapacity} unit="ops/s" note={`${(stats.recent.originMB / stats.recent.seconds).toFixed(2)} MB/s out · ${(stats.recent.cdnMB / stats.recent.seconds).toFixed(2)} MB/s delivered by edges`} />
          </InstrumentCard>
          <InstrumentCard title="Cost" aside={<span className="text-[11px] text-zinc-500">illustrative credits</span>}>
            <StackBar
              unit="credits/min"
              parts={[
                { label: 'origin egress', value: stats.recent.credits.origin * perMinute, color: '#818cf8' },
                { label: 'CDN egress', value: stats.recent.credits.cdn * perMinute, color: '#2dd4bf' },
                { label: 'edge storage', value: stats.recent.credits.storage * perMinute, color: '#c4b5fd' },
              ]}
            />
            <p className="mt-1 text-[11px] text-zinc-500">Edges store {stats.recent.storedMB >= 1000 ? `${(stats.recent.storedMB / 1000).toFixed(1)} GB` : `${stats.recent.storedMB.toFixed(1)} MB`}.</p>
          </InstrumentCard>
          <div className="grid grid-cols-3 gap-1.5" aria-live="polite">
            <Counter label="stale app.js" value={total.stale} tone="amber" />
            <Counter label="leaked carts" value={total.leaks} tone="violet" />
            <Counter label="failed" value={total.failed} tone="red" />
          </div>
          <InstrumentCard title="Last 30 s" aside={<span className="text-[11px] text-zinc-500">bars: origin ops · line: edge hits</span>}>
            <Timeline bars={stats.bars} ratio={stats.ratio} markers={stats.markers} barMax={Math.max(10, ...stats.bars)} seconds={30} />
          </InstrumentCard>
        </>
      }
    />
  );
}

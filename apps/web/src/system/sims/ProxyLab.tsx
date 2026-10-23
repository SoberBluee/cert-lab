import { useMemo, useState } from 'react';
import type { ProxyReq, ProxyScene } from '../logic/proxy';
import type { Req } from '../stage/engine';
import { PROXY, type ChapterId, type FaultId } from '../logic/proxyLesson';
import { ADDR, BACKENDS, FILES, FWD, LAPTOPS, NAMES, REV, SCRAPER, SITES, STANDBY, type Laptop } from '../logic/proxyMap';
import { Inspector } from '../stage/Inspector';
import { Counter, InstrumentCard, Timeline } from '../stage/instruments';
import type { StageNode } from '../stage/layout';
import { LessonLayout, type FaultButton } from '../stage/LessonLayout';
import { Stage, TONE_COLOR } from '../stage/Stage';
import { useLessonRunner } from '../stage/useLessonRunner';
import { Segmented } from '../stage/widgets';
import { addressOwner, Control } from './proxy/controls';
import { VIEWERS, viewOf, type Viewer } from './proxy/lens';
import { AppNode, BotNode, ClientsNode, FilesNode, ForwardProxyNode, LaptopNode, ProxyBursts, ReverseProxyNode, SiteNode, StandbyNode, ZonesBackground } from './proxy/nodes';

const isSite = (id: string) => (SITES as readonly string[]).includes(id);

/** What each chapter is about; everything else is drawn dimmer. */
const FOCUS: Record<ChapterId, ((id: string) => boolean) | null> = {
  forward: (id) => LAPTOPS.includes(id as Laptop) || id === FWD || isSite(id),
  reverse: (id) => !isSite(id),
  offload: (id) => !isSite(id) && !LAPTOPS.includes(id as Laptop) && id !== FWD,
  guard: (id) => !isSite(id),
  sandbox: null,
};

const OUTCOME: Record<string, string> = {
  ok: 'Answered',
  blocked: 'Refused by the office filter (403)',
  geo: 'Refused: not available in that country (451)',
  limited: 'Too many requests from that address (429)',
  denied: 'Refused by the shop’s blocklist (403)',
  failed: 'Failed',
};

const describe = (q: Req) => {
  const p = q as ProxyReq;
  return p.outcome ? `${OUTCOME[p.outcome]}${p.cached ? ' from the proxy’s cache' : ''}` : '';
};

/** The address the shop would see from a client node, so clicking it can block that address. */
function blockable(s: ProxyScene, id: string): string | null {
  if (id === SCRAPER) return ADDR.scraper;
  if (id === FWD) return ADDR.egress[s.cfg.egress];
  if (LAPTOPS.includes(id as Laptop) && !s.cfg.fwdOn) return ADDR.laptop[id as Laptop];
  return null;
}

function faultButtons(s: ProxyScene, faults: FaultId[], act: (fn: (s: ProxyScene) => void) => void): FaultButton[] {
  if (!faults.includes('killProxy') || !s.cfg.revOn || s.isDown(REV)) return [];
  return [{ id: 'killProxy', label: 'Kill the reverse proxy', run: () => act((x) => x.failProxy()) }];
}

function Legend() {
  const dot = (color: string, size = 10, ring = false) => (
    <span className="inline-block rounded-full" style={{ background: color, width: size, height: size, boxShadow: ring ? `0 0 0 1.5px #09090b, 0 0 0 2.7px ${color}` : undefined }} />
  );
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400" aria-label="Legend">
      <li className="flex items-center gap-1.5">{dot(TONE_COLOR.request, 10, true)} request (ring: encrypted)</li>
      <li className="flex items-center gap-1.5">{dot(TONE_COLOR.hit)} answered</li>
      <li className="flex items-center gap-1.5">
        <span className="font-bold text-red-500">✕</span> refused or failed
      </li>
      <li className="flex items-center gap-1.5">
        <span className="font-bold text-amber-400">✕</span> too many requests (429)
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 rounded-full border border-dashed border-zinc-500" /> a module the proxy can’t use: it can’t read the request
      </li>
      <li>Dot size: response size, so gzip shrinks them.</li>
    </ul>
  );
}

/** A labelled 0–1 bar. */
function Meter({ label, value, note }: { label: string; value: number; note?: string }) {
  const over = value > 0.8;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-zinc-300">{label}</span>
        <span className={`font-mono ${over ? 'text-red-400' : 'text-zinc-100'}`}>
          {Math.round(value * 100)}%{note && <span className="text-zinc-500"> {note}</span>}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-zinc-800" role="meter" aria-label={`${label} ${Math.round(value * 100)}%`} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full transition-[width] duration-200 ${over ? 'bg-red-500' : 'bg-indigo-400'}`} style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );
}

/** The proxy lesson: an office behind a forward proxy, the internet, and a shop behind a reverse proxy. */
export function ProxyLab() {
  const r = useLessonRunner(PROXY);
  const { scene, now, freeze, mode, chapter } = r;
  const cfg = scene.cfg;
  const [viewer, setViewer] = useState<Viewer>('everyone');

  // ---- instruments, recomputed a few times a second ----
  const tick = Math.floor(now / 250);
  const stats = useMemo(() => {
    const nowS = now / 1000;
    const span = 30;
    const start = Math.max(0, Math.floor(nowS) - span);
    const secs = Array.from({ length: span }, (_, i) => scene.timeline.second(start + i).counts);
    return {
      recent: scene.stats(Math.floor(nowS) - 10, Math.floor(nowS)),
      cpu: (id: string) => scene.cpu(id, Math.floor(nowS) - 3, Math.floor(nowS)),
      bars: secs.map((c) => c.appRequests ?? 0),
      ratio: secs.map((c) => (c['shop:total'] ? (c['shop:ok'] ?? 0) / c['shop:total'] : null)),
      markers: scene.markers.filter((m) => m.at / 1000 >= start).map((m) => ({ at: m.at / 1000 - start, label: m.label })),
    };
  }, [scene, tick]);
  const w = stats.recent;
  const events = scene.sim.recent(1500);

  // Proxies that are off and servers that aren't running aren't on stage at all.
  const layout = useMemo(
    () => ({ ...scene.layout, nodes: scene.layout.nodes.filter((n) => scene.present(n.id)) }),
    [scene, cfg.fwdOn, cfg.revOn, cfg.routes, cfg.backends, cfg.standby],
  );
  const view = (id: string) => viewOf(scene, viewer, id);
  const focus = FOCUS[r.chapterId as ChapterId];
  const visible = new Set([...scene.routesInUse()].filter((id) => layout.wires.some((x) => x.id === id && view(x.from).state !== 'unknown' && view(x.to).state !== 'unknown')));

  const canBlock = r.controlIds.includes('blocklist') && !r.controlsLocked && cfg.revOn;
  const toggleBlock = (addr: string) => r.patch({ blocklist: cfg.blocklist.includes(addr) ? cfg.blocklist.filter((a) => a !== addr) : [...cfg.blocklist, addr] });

  const onNodeClick = (id: string) => {
    if (r.picking === 'node') return r.answer(id);
    const addr = blockable(scene, id);
    if (canBlock && addr) toggleBlock(addr);
  };

  const renderNode = (n: StageNode) => {
    const v = view(n.id);
    const body = (() => {
      switch (n.kind) {
        case 'laptop':
          return <LaptopNode n={n} view={v} />;
        case 'fproxy':
          return <ForwardProxyNode n={n} scene={scene} view={v} now={now} />;
        case 'rproxy':
          return <ReverseProxyNode n={n} scene={scene} view={v} cpu={stats.cpu(n.id)} />;
        case 'standby':
          return <StandbyNode n={n} scene={scene} view={v} cpu={stats.cpu(n.id)} />;
        case 'site':
          return <SiteNode n={n} scene={scene} view={v} />;
        case 'clients':
          return <ClientsNode n={n} view={v} />;
        case 'bot':
          return <BotNode n={n} view={v} />;
        case 'app':
          return <AppNode n={n} view={v} cpu={stats.cpu(n.id)} />;
        default:
          return <FilesNode n={n} view={v} />;
      }
    })();
    const addr = blockable(scene, n.id);
    const blocked = !!addr && cfg.revOn && cfg.blocklist.includes(addr);
    const opacity = v.state === 'unknown' ? 0.18 : focus && !focus(n.id) ? 0.45 : 1;
    return (
      <g opacity={opacity}>
        {body}
        {blocked && (
          <text x={n.x + n.w - 6} y={n.y + n.h - 8} textAnchor="end" dominantBaseline="central" className="fill-red-300 text-[8px] font-semibold">
            ⛔ blocked
          </text>
        )}
      </g>
    );
  };

  const frameClass = (n: StageNode) => {
    const tone = n.kind === 'fproxy' || n.kind === 'rproxy' || n.kind === 'standby' ? 'tone-proxy' : n.kind === 'app' || n.kind === 'files' ? 'tone-db' : '';
    const v = view(n.id).state;
    const blockTarget = canBlock && !!blockable(scene, n.id) ? 'stage-pick' : '';
    return `${tone} ${scene.isDown(n.id) ? 'is-down' : ''} ${v === 'unknown' ? 'is-faded' : v === 'self' ? 'is-focus' : ''} ${blockTarget}`;
  };

  const target = freeze && !freeze.answered ? layout.nodes.find((n) => n.id === freeze.moment.node) : undefined;
  const freezeChoices =
    freeze?.frame.answer.kind === 'node' ? [...(cfg.revOn ? [REV] : []), ...BACKENDS.slice(0, cfg.backends)].map((id) => ({ id, label: id === REV ? 'The reverse proxy' : NAMES[id]! })) : [];

  const seen = viewer === 'everyone' ? [] : [...(scene.seen.get(viewer) ?? [])];
  const lensCard = (
    <InstrumentCard title="Whose view?">
      <Segmented<Viewer> label="Seen by" value={viewer} options={VIEWERS} onChange={setViewer} />
      {viewer === 'everyone' ? (
        <p className="mt-2 text-xs text-zinc-400">Pick someone to redraw the stage as they know it, from the envelopes they’ve actually received.</p>
      ) : (
        <>
          <p className="mt-2 text-xs text-zinc-400">{VIEWERS.find((x) => x.id === viewer)!.label} has seen:</p>
          <ul className="mt-1 space-y-0.5 font-mono text-xs text-zinc-200">{seen.length ? seen.map((a) => <li key={a}>{a}</li>) : <li className="text-zinc-500">nothing yet</li>}</ul>
        </>
      )}
    </InstrumentCard>
  );

  const downFor = scene.proxyDownAt === null ? null : (now - scene.proxyDownAt) / 1000;
  const selected = r.selected as ProxyReq | null;

  const stage = (
    <div className="space-y-2">
      {/* On narrow screens the stage's labels are small, so the lens comes first. */}
      <div className="lg:hidden">{lensCard}</div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-2">
        <Stage
          layout={layout}
          travels={[...scene.sim.travels.values()]}
          now={now}
          renderNode={renderNode}
          frameClass={frameClass}
          background={<ZonesBackground />}
          visibleWires={visible}
          lane={3}
          heat={r.heat}
          picking={r.picking === 'node'}
          onNodeClick={onNodeClick}
          onPacketClick={r.select}
          selectedReq={selected?.id ?? null}
          label={`Proxy stage, seen by ${VIEWERS.find((x) => x.id === viewer)!.label}. Forward proxy ${cfg.fwdOn ? 'on' : 'off'}, reverse proxy ${cfg.revOn ? (scene.isDown(REV) ? 'down' : 'on') : 'off'}${cfg.revOn ? `, TLS ${cfg.tls}` : ''}. App servers at ${Math.round(w.appCpu * 100)}% CPU.`}
          overlay={
            <>
              <ProxyBursts events={events} nodes={layout.nodes} now={now} />
              {target && <rect className="stage-pulse" x={target.x - 4} y={target.y - 4} width={target.w + 8} height={target.h + 8} rx={12} fill="none" stroke="#38bdf8" strokeWidth={2} />}
            </>
          }
        />
        <p className="px-1 pt-1 text-[11px] text-zinc-500">
          Addresses are from the documentation ranges, and CPU costs are illustrative. Click a dot to read its envelope at every hop{canBlock ? ', and click the scraper or the office to block its address' : ''}.
          {viewer !== 'everyone' && ' Faded: things this party has no way of knowing exist.'}
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
      inspector={selected && <Inspector req={selected} onClose={r.clearSelected} describe={describe} />}
      instruments={
        <>
          <div className="hidden lg:block">{lensCard}</div>
          <div className="grid grid-cols-3 gap-1.5" aria-live="polite">
            <Counter label="office addresses sites learned" value={scene.leakedOfficeAddresses().length} tone="red" />
            <Counter label="shop addresses exposed" value={scene.exposedShopAddresses().length} tone="amber" />
            <Counter label="failed" value={scene.stats(0, now / 1000 + 1).failed} tone="red" />
          </div>
          <InstrumentCard title="Outcomes" aside={<span className="text-[11px] text-zinc-500">last 10 s</span>}>
            <ul className="space-y-0.5 text-xs text-zinc-300">
              <li>
                Answered: <span className="font-mono">{w.answered}</span>
                {cfg.cache && <span className="text-zinc-400">, {w.cached} from the proxy’s cache</span>}
              </li>
              <li>
                Refused by the office filter: <span className="font-mono">{w.blocked}</span>
              </li>
              <li>
                Refused by video.example (wrong country): <span className="font-mono">{w.geo}</span>
              </li>
              <li>
                Too many requests (429): <span className="font-mono">{w.limited}</span>
                <span className={w.limitedReal ? 'text-amber-300' : 'text-zinc-400'}>, {w.limitedReal} real users</span>
              </li>
              <li>
                Refused by the shop’s blocklist: <span className="font-mono">{w.denied}</span>
                {cfg.blocklist.length > 0 && <span className="text-zinc-400"> ({cfg.blocklist.map(addressOwner).join(', ')})</span>}
              </li>
              <li>
                Scraper served: <span className="font-mono">{w.scraperServed}</span> of {w.scraperTotal}
              </li>
              <li>
                Failed: <span className={`font-mono ${w.failed ? 'text-red-300' : ''}`}>{w.failed}</span>
              </li>
            </ul>
          </InstrumentCard>
          <InstrumentCard title="The shop" aside={<span className="text-[11px] text-zinc-500">last 10 s</span>}>
            <div className="space-y-2">
              <Meter label={`App servers (${cfg.backends})`} value={w.appCpu} note="CPU" />
              {cfg.revOn && <Meter label={scene.activeProxy() === STANDBY ? 'Standby proxy' : 'Reverse proxy'} value={w.proxyCpu} note="CPU" />}
              <p className="text-xs text-zinc-400">
                Sent to clients: <span className="font-mono text-zinc-200">{(w.egressMB / w.seconds).toFixed(2)} MB/s</span>
                <br />
                Customer p95: <span className="font-mono text-zinc-200">{w.customerP95 ? `${Math.round(w.customerP95)} ms` : '–'}</span>
                {cfg.revOn && cfg.routes && scene.readsRequests && (
                  <>
                    <br />
                    File store: <span className="font-mono text-zinc-200">{scene.timeline.sum(Math.floor(now / 1000) - 10, Math.floor(now / 1000), `requests:${FILES}`)}</span> requests
                  </>
                )}
              </p>
              {downFor !== null && (
                <p className="text-xs text-red-300" role="status">
                  The reverse proxy has been down {downFor.toFixed(1)} s.{' '}
                  {scene.activeProxy() === STANDBY ? 'The standby has taken over.' : cfg.standby ? 'The standby hasn’t noticed yet.' : 'Every shop request fails until it restarts at 20 s.'}
                </p>
              )}
            </div>
          </InstrumentCard>
          <InstrumentCard title="Last 30 s" aside={<span className="text-[11px] text-zinc-500">bars: app requests · line: answered</span>}>
            <Timeline bars={stats.bars} ratio={stats.ratio} markers={stats.markers} barMax={Math.max(10, ...stats.bars)} seconds={30} />
          </InstrumentCard>
        </>
      }
    />
  );
}

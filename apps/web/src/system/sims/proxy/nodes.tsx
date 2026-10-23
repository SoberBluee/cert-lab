import type { ReactNode } from 'react';
import type { ProxyScene } from '../../logic/proxy';
import { ADDR, COUNTRY_NAMES, REV, ZONES, HEIGHT, type Backend, type Laptop, type Site } from '../../logic/proxyMap';
import type { StageEvent } from '../../stage/engine';
import type { StageNode } from '../../stage/layout';
import type { View } from './lens';

const ZONE_FILL: Record<string, string> = { office: '#0d1320', internet: '#0b0b0d', dc: '#120f1f' };

/** The three zones as bands, with their names. */
export function ZonesBackground() {
  return (
    <g aria-hidden>
      {ZONES.map((z, i) => (
        <g key={z.id}>
          <rect x={z.x} y={0} width={z.w} height={HEIGHT} fill={ZONE_FILL[z.id]} />
          {i > 0 && <line x1={z.x} y1={0} x2={z.x} y2={HEIGHT} stroke="#3f3f46" strokeDasharray="4 4" />}
          <text x={z.x + 8} y={14} dominantBaseline="central" className="fill-zinc-500 text-[10px] font-semibold tracking-wide">
            {z.label}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Name and address lines, swapped for what a lens viewer knows: an address, and its name only if the viewer knows it. */
function Labels({ n, title, sub, view }: { n: StageNode; title: string; sub?: string; view: View }) {
  const t = view.address ?? title;
  const s = view.address ? (view.named ? n.label : 'address only') : view.state === 'self' ? 'you' : sub;
  return (
    <>
      <text x={n.x + 8} y={n.y + 14} dominantBaseline="central" className={view.address ? 'fill-amber-100 font-mono text-[9px] font-semibold' : 'fill-zinc-100 text-[11px] font-semibold'}>
        {t}
      </text>
      {s && (
        <text x={n.x + 8} y={n.y + 28} dominantBaseline="central" className={`text-[9px] ${view.state === 'self' ? 'fill-sky-300' : 'fill-zinc-400'} ${view.named ? '' : 'font-mono'}`}>
          {s}
        </text>
      )}
    </>
  );
}

/** A module chip: on, off, or unavailable (dashed: the proxy can't read the request, so it can't do this). */
type ChipState = 'on' | 'off' | 'na';
const chip = (x: number, y: number, label: string, state: ChipState | boolean, key: string, title?: string): ReactNode => {
  const st = state === true ? 'on' : state === false ? 'off' : state;
  return (
    <g key={key}>
      {title && <title>{title}</title>}
      <rect x={x} y={y} width={60} height={14} rx={7} fill={st === 'on' ? '#422006' : '#18181b'} stroke={st === 'on' ? '#f59e0b' : '#3f3f46'} strokeDasharray={st === 'na' ? '3 2' : undefined} />
      <text x={x + 30} y={y + 7} textAnchor="middle" dominantBaseline="central" className={`text-[8px] ${st === 'on' ? 'fill-amber-100' : st === 'na' ? 'fill-zinc-600 line-through' : 'fill-zinc-500'}`}>
        {label}
      </text>
    </g>
  );
};

/** A thin CPU bar. */
const cpuBar = (x: number, y: number, w: number, cpu: number): ReactNode => (
  <g aria-hidden>
    <rect x={x} y={y} width={w} height={4} rx={2} fill="#27272a" />
    <rect x={x} y={y} width={w * Math.min(1, cpu)} height={4} rx={2} fill={cpu > 0.8 ? '#ef4444' : '#818cf8'} />
  </g>
);

export function LaptopNode({ n, view }: { n: StageNode; view: View }) {
  return (
    <g>
      <rect x={n.x + n.w - 26} y={n.y + 11} width={16} height={11} rx={1.5} fill="#27272a" stroke="#71717a" aria-hidden />
      <rect x={n.x + n.w - 29} y={n.y + 23} width={22} height={3} rx={1} fill="#71717a" aria-hidden />
      <Labels n={n} title={n.label} sub={ADDR.laptop[n.id as Laptop]} view={view} />
    </g>
  );
}

/**
 * The forward proxy, with a readout of the last address it rewrote: in from a laptop, out as
 * itself. It flashes as each request passes.
 */
export function ForwardProxyNode({ n, scene, view, now }: { n: StageNode; scene: ProxyScene; view: View; now: number }) {
  const c = scene.cfg;
  const logged = [...scene.proxyLog.values()].reduce((a, b) => a + b, 0);
  const last = [...scene.sim.events].reverse().find((e) => e.kind === 'rewrite');
  const [inAddr, outAddr] = last?.text?.split(' → ') ?? ['–', ADDR.egress[c.egress]];
  const fresh = !!last && now - last.at < 700;
  return (
    <g>
      <Labels n={n} title="Forward" sub="proxy" view={view} />
      <text x={n.x + 8} y={n.y + 41} dominantBaseline="central" className={`font-mono text-[8px] ${fresh ? 'fill-amber-200' : 'fill-zinc-400'}`}>
        {inAddr}
      </text>
      <text x={n.x + 6} y={n.y + 52} dominantBaseline="central" className={`font-mono text-[8px] ${fresh ? 'fill-amber-200' : 'fill-zinc-400'}`}>
        → {outAddr}
      </text>
      <text x={n.x + 8} y={n.y + 63} dominantBaseline="central" className="fill-zinc-500 text-[8px]">
        exits in {COUNTRY_NAMES[c.egress]}
      </text>
      {chip(n.x + 4, n.y + 72, 'filter', c.filter, 'f')}
      {chip(n.x + 4, n.y + 90, c.transparent ? 'adds XFF' : 'strips XFF', c.transparent, 'x')}
      <text x={n.x + 8} y={n.y + n.h - 12} dominantBaseline="central" className="fill-zinc-400 text-[8px]">
        logged {logged}
      </text>
    </g>
  );
}

const TLS_CHIP = { terminate: 'ends TLS', reencrypt: 're-encrypts', passthrough: 'passes TLS' } as const;
const CANT_READ = 'TLS passes straight through, so the proxy can’t read the request';

/**
 * The reverse proxy and the modules it runs. Those that need to read the request (routes, gzip,
 * cache) go dashed when TLS passes through; limits and blocks work on addresses, so they don't.
 */
export function ReverseProxyNode({ n, scene, view, cpu }: { n: StageNode; scene: ProxyScene; view: View; cpu: number }) {
  const c = scene.cfg;
  const reads = scene.readsRequests;
  const needsReading = (on: boolean): ChipState => (reads ? (on ? 'on' : 'off') : 'na');
  const fresh = c.cache && reads ? ['/', '/api/catalog', '/static/logo.png'].filter((p) => scene.holdsFresh(REV, p)).length : 0;
  const limit = c.rateLimit !== null ? `${c.rateLimit}/s limit` : c.blocklist.length ? `blocks ${c.blocklist.length}` : 'limit';
  const down = scene.isDown(REV);
  const modules: [string, ChipState | boolean, string?][] = [
    [TLS_CHIP[c.tls], true],
    ['routes', needsReading(c.routes), reads ? undefined : CANT_READ],
    ['gzip', needsReading(c.compression === 'proxy'), reads ? undefined : CANT_READ],
    [c.cache && reads ? `cache · ${fresh}` : 'cache', needsReading(c.cache), reads ? undefined : CANT_READ],
    [limit, c.rateLimit !== null || c.blocklist.length > 0],
    ['standby', c.standby],
  ];
  return (
    <g>
      <Labels n={n} title="Reverse" sub="proxy" view={view} />
      <text x={n.x + 8} y={n.y + 42} dominantBaseline="central" className={`font-mono text-[8px] ${down ? 'fill-red-300 font-semibold' : 'fill-zinc-400'}`}>
        {down ? '✕ down' : ADDR.revPublic}
      </text>
      {cpuBar(n.x + 8, n.y + 50, n.w - 16, down ? 0 : cpu)}
      {modules.map(([label, state, title], i) => chip(n.x + 12, n.y + 60 + i * 18, label, state, String(i), title))}
    </g>
  );
}

/** The standby proxy: it watches the first one, and takes over the shop's address when that dies. */
export function StandbyNode({ n, scene, view, cpu }: { n: StageNode; scene: ProxyScene; view: View; cpu: number }) {
  const active = scene.activeProxy() === n.id;
  const downFor = scene.proxyDownAt === null ? null : (scene.sim.now - scene.proxyDownAt) / 1000;
  const status = active ? 'has the address' : downFor !== null ? `notices in ${Math.max(0, scene.cfg.healthCheckSec - downFor).toFixed(1)} s` : `checks every ${scene.cfg.healthCheckSec} s`;
  return (
    <g>
      <Labels n={n} title={n.label} sub={ADDR.standbyPrivate} view={view} />
      <text x={n.x + 8} y={n.y + 40} dominantBaseline="central" className={`text-[8px] ${active ? 'fill-emerald-300 font-semibold' : downFor !== null ? 'fill-amber-200' : 'fill-zinc-500'}`}>
        {status}
      </text>
      {active && cpuBar(n.x + 8, n.y + 46, n.w - 16, cpu)}
    </g>
  );
}

export function SiteNode({ n, scene, view }: { n: StageNode; scene: ProxyScene; view: View }) {
  const sub = n.id === 'video' ? 'UK addresses only' : n.id === 'blocked' && scene.cfg.fwdOn && scene.cfg.filter ? 'blocked by the office' : ADDR.site[n.id as Site];
  return <Labels n={n} title={n.label} sub={sub} view={view} />;
}

export function ClientsNode({ n, view }: { n: StageNode; view: View }) {
  return (
    <g>
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={n.x + n.w - 62 + (i % 3) * 18} y={n.y + 8 + Math.floor(i / 3) * 20} width={10} height={16} rx={2.5} fill="#27272a" stroke="#71717a" aria-hidden />
      ))}
      <Labels n={n} title={n.label} sub="6 phones, 6 addresses" view={view} />
    </g>
  );
}

export function BotNode({ n, view }: { n: StageNode; view: View }) {
  return (
    <g>
      <rect x={n.x + n.w - 26} y={n.y + 9} width={18} height={14} rx={3} fill="#27272a" stroke="#f87171" aria-hidden />
      <circle cx={n.x + n.w - 21} cy={n.y + 16} r={1.8} fill="#f87171" aria-hidden />
      <circle cx={n.x + n.w - 13} cy={n.y + 16} r={1.8} fill="#f87171" aria-hidden />
      <Labels n={n} title={n.label} sub={ADDR.scraper} view={view} />
    </g>
  );
}

export function AppNode({ n, view, cpu }: { n: StageNode; view: View; cpu: number }) {
  const over = cpu > 0.8;
  return (
    <g>
      <Labels n={n} title={n.label} sub={ADDR.appPrivate[n.id as Backend]} view={view} />
      <rect x={n.x + 8} y={n.y + 38} width={n.w - 16} height={6} rx={3} fill="#27272a" aria-hidden />
      <rect x={n.x + 8} y={n.y + 38} width={(n.w - 16) * Math.min(1, cpu)} height={6} rx={3} fill={over ? '#ef4444' : '#818cf8'} aria-hidden />
      <text x={n.x + n.w - 8} y={n.y + 14} textAnchor="end" dominantBaseline="central" className="fill-zinc-400 font-mono text-[9px]">
        CPU {Math.round(cpu * 100)}%
      </text>
    </g>
  );
}

export function FilesNode({ n, view }: { n: StageNode; view: View }) {
  return <Labels n={n} title={n.label} sub={ADDR.files} view={view} />;
}

const BURST: Record<string, { ms: number; color: string }> = {
  blocked: { ms: 600, color: '#ef4444' },
  geo: { ms: 600, color: '#ef4444' },
  denied: { ms: 600, color: '#ef4444' },
  limited: { ms: 500, color: '#f59e0b' },
  crash: { ms: 900, color: '#ef4444' },
};

/** Short-lived bursts: refusals (the office filter, a geo-restricted site, the shop's limits) and a proxy dying. */
export function ProxyBursts({ events, nodes, now }: { events: StageEvent[]; nodes: StageNode[]; now: number }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: ReactNode[] = [];
  // Only the newest burst of each kind per node: a scraper throttled 40 times a second would
  // otherwise stack its rings into a solid halo.
  const drawn = new Set<string>();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    const n = byId.get(e.node);
    if (!n || drawn.has(`${e.node}|${e.kind}`)) continue;
    drawn.add(`${e.node}|${e.kind}`);
    const age = now - e.at;
    const b = BURST[e.kind];
    if (b && age < b.ms) {
      const f = age / b.ms;
      const grow = e.kind === 'crash' ? 12 : 6;
      out.push(<rect key={i} x={n.x - f * grow} y={n.y - f * grow} width={n.w + f * grow * 2} height={n.h + f * grow * 2} rx={10} fill="none" stroke={b.color} strokeWidth={2} opacity={1 - f} />);
    }
  }
  return <g aria-hidden>{out}</g>;
}

import { memo, type ReactNode } from 'react';
import { originBox } from '../../logic/cdnMap';
import type { StageEvent } from '../../stage/engine';
import { CITIES, landDots, MAP_HEIGHT, MAP_WIDTH, project, type CityId } from '../../stage/geo';
import type { Pt } from '../../stage/geometry';
import type { StageNode } from '../../stage/layout';

const center = (n: StageNode): Pt => [n.x + n.w / 2, n.y + n.h / 2];

/** The dot-matrix continents, plus the origin's leader line. Static, so drawn once. */
export const MapBackground = memo(function MapBackground({ origin = 'ash' }: { origin?: CityId }) {
  const dots = landDots();
  const o = originBox(origin);
  return (
    <g aria-hidden>
      <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#0a0a0c" />
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.1} fill="#27272a" />
      ))}
      <line x1={o.anchor[0]} y1={o.anchor[1]} x2={o.x + 8} y2={o.y} stroke="#6366f1" strokeDasharray="2 2" />
      <circle cx={o.anchor[0]} cy={o.anchor[1]} r={2.5} fill="#818cf8" />
    </g>
  );
});

const hexagon = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

/** A text label beside a point, on the side the city prefers. */
function CityLabel({ c, at, text, tone }: { c: CityId; at: Pt; text: string; tone: string }) {
  const side = CITIES[c].label;
  const [x, y] = at;
  const dx = side === 'left' ? -13 : side === 'right' ? 13 : 0;
  const dy = side === 'above' ? -14 : side === 'below' ? 16 : 0;
  return (
    <text x={x + dx} y={y + dy} textAnchor={side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle'} dominantBaseline="central" className={`text-[10px] ${tone}`}>
      {text}
    </text>
  );
}

/** An edge location: a hexagon, teal when on, with its hit ratio; red with a cross when it has died. */
export function PopNode({ n, city, on, hitRatio, dead = false }: { n: StageNode; city: CityId; on: boolean; hitRatio: number | null; dead?: boolean }) {
  const [cx, cy] = center(n);
  if (dead)
    return (
      <g>
        <polygon points={hexagon(cx, cy, 9)} fill="#2a0d0d" stroke="#ef4444" strokeWidth={1.5} />
        <path d={`M ${cx - 3.5} ${cy - 3.5} L ${cx + 3.5} ${cy + 3.5} M ${cx - 3.5} ${cy + 3.5} L ${cx + 3.5} ${cy - 3.5}`} stroke="#fca5a5" strokeWidth={1.5} />
        <CityLabel c={city} at={[cx, cy]} text={`${n.label} (down)`} tone="fill-red-300" />
      </g>
    );
  return (
    <g opacity={on ? 1 : 0.45}>
      <polygon points={hexagon(cx, cy, 9)} fill={on ? '#0b2a28' : '#18181b'} stroke={on ? '#2dd4bf' : '#52525b'} strokeWidth={1.5} strokeDasharray={on ? undefined : '2 2'} />
      {on && hitRatio !== null && (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="fill-teal-100 font-mono text-[7px]">
          {Math.round(hitRatio * 100)}
        </text>
      )}
      <CityLabel c={city} at={[cx, cy]} text={n.label} tone={on ? 'fill-teal-200' : 'fill-zinc-500'} />
    </g>
  );
}

/** The origin data centre. */
export function OriginNode({ n, load }: { n: StageNode; load?: string }) {
  return (
    <g>
      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} fill="#16143a" stroke="#6366f1" />
      <text x={n.x + 8} y={n.y + 11} dominantBaseline="central" className="fill-indigo-100 text-[10px] font-semibold">
        Origin
      </text>
      <text x={n.x + 8} y={n.y + 22} dominantBaseline="central" className="fill-indigo-300 text-[8px]">
        {load ?? 'Ashburn, US East'}
      </text>
    </g>
  );
}

/** The origin shield: a cache tier beside the origin. */
export function ShieldNode({ n, hitRatio }: { n: StageNode; hitRatio: number | null }) {
  return (
    <g>
      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={5} fill="#0b2a28" stroke="#2dd4bf" />
      <text x={n.x + 8} y={n.y + n.h / 2} dominantBaseline="central" className="fill-teal-100 text-[9px] font-semibold">
        Origin shield{hitRatio !== null ? ` · ${Math.round(hitRatio * 100)}%` : ''}
      </text>
    </g>
  );
}

const badgeTone = (ms: number) => (ms < 50 ? { fill: '#064e3b', stroke: '#34d399', text: 'fill-emerald-100' } : ms < 150 ? { fill: '#451a03', stroke: '#fbbf24', text: 'fill-amber-100' } : { fill: '#450a0a', stroke: '#f87171', text: 'fill-red-100' });

/** A user pin: a person marker at the city, with its latency badge above. */
export function PinNode({ n, city, latency, showName }: { n: StageNode; city: CityId; latency: number | null; showName: boolean }) {
  const [x, y] = project(CITIES[city]);
  const tone = latency === null ? null : badgeTone(latency);
  return (
    <g>
      <circle cx={x} cy={y} r={2.5} fill="#e4e4e7" />
      <circle cx={x} cy={y - 20} r={4} fill="#d4d4d8" />
      <path d={`M ${x - 6} ${y - 9} q 0 -7 6 -7 q 6 0 6 7 z`} fill="#d4d4d8" />
      {tone && latency !== null && (
        <g>
          <rect x={x - 19} y={y - 43} width={38} height={14} rx={7} fill={tone.fill} stroke={tone.stroke} strokeWidth={1} />
          <text x={x} y={y - 36} textAnchor="middle" dominantBaseline="central" className={`font-mono text-[9px] font-semibold ${tone.text}`}>
            {Math.round(latency)} ms
          </text>
        </g>
      )}
      {showName && <CityLabel c={city} at={[x, y]} text={n.label} tone="fill-zinc-300" />}
    </g>
  );
}

const RING: Record<string, string> = { hit: '#34d399', fill: '#fbbf24', purge: '#c4b5fd', expire: '#a1a1aa', reject: '#ef4444' };

/** Short-lived bursts and labels on the map: hits, fills, purges, crashes, leaks and pushes. */
export function MapBursts({ events, nodes, now }: { events: StageEvent[]; nodes: StageNode[]; now: number }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: ReactNode[] = [];
  events.forEach((e, i) => {
    const n = byId.get(e.node);
    if (!n) return;
    const age = now - e.at;
    const [cx, cy] = n.kind === 'pin' ? project(CITIES[n.id.slice(4) as CityId]) : center(n);
    if (RING[e.kind] && age < 500) {
      const f = age / 500;
      out.push(<circle key={i} cx={cx} cy={cy} r={6 + f * 14} fill="none" stroke={RING[e.kind]} strokeWidth={2} opacity={1 - f} />);
    } else if (e.kind === 'crash' && age < 900) {
      const f = age / 900;
      out.push(<circle key={i} cx={cx} cy={cy} r={8 + f * 26} fill="none" stroke="#ef4444" strokeWidth={2.5} opacity={1 - f} />);
    } else if ((e.kind === 'leak' || e.kind === 'pushed') && age < 2500) {
      const f = age / 2500;
      out.push(
        <text key={i} x={cx} y={cy - 48 - f * 8} textAnchor="middle" className={`text-[10px] font-semibold ${e.kind === 'leak' ? 'fill-red-300' : 'fill-violet-200'}`} opacity={1 - f}>
          {e.kind === 'leak' ? 'someone else’s cart!' : `+${e.text}`}
        </text>,
      );
      if (e.kind === 'leak' && age < 600) out.push(<circle key={`${i}r`} cx={cx} cy={cy} r={6 + (age / 600) * 16} fill="none" stroke="#ef4444" strokeWidth={2} opacity={1 - age / 600} />);
    }
  });
  return <g aria-hidden>{out}</g>;
}

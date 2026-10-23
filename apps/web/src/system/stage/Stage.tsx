import { useMemo, useRef, type PointerEvent, type ReactNode } from 'react';
import type { Req, Tone, Travel } from './engine';
import { offsetPolyline, pointAt, subPath, svgPoints, toPath, type Path, type Pt } from './geometry';
import type { StageLayout, StageNode } from './layout';

/** Dot colours; shapes carry meaning too, so colour is never the only cue. */
export const TONE_COLOR: Record<Tone, string> = {
  request: '#38bdf8',
  write: '#a78bfa',
  hit: '#34d399',
  miss: '#fbbf24',
  fail: '#ef4444',
  flush: '#c4b5fd',
  control: '#a1a1aa',
};

const DEFAULT_LANE = 6;
/** Length of a dot's trail, in stage units. */
const TRAIL = 22;

interface WirePaths {
  id: string;
  center: Pt[];
  fwd: Path;
  rev: Path;
}

function wirePaths(layout: StageLayout, lane: number): Map<string, WirePaths> {
  return new Map(
    layout.wires.map((w) => [
      w.id,
      { id: w.id, center: w.pts, fwd: toPath(offsetPolyline(w.pts, lane)), rev: toPath(offsetPolyline([...w.pts].reverse(), lane)) },
    ]),
  );
}

/** Dot radius for a payload: bigger payloads draw bigger, within reason. */
const radiusFor = (bytes?: number) => (bytes ? Math.max(3, Math.min(7.5, 2.5 + Math.log10(bytes / 1000) * 1.5)) : 5);

function Packet({ t, pos, tail, selected, onClick }: { t: Travel; pos: Pt; tail: Pt[]; selected: boolean; onClick?: (req: Req) => void }) {
  const color = TONE_COLOR[t.tone];
  const [x, y] = pos;
  const shape = t.req.stale ? (
    <rect x={x - 5} y={y - 5} width={10} height={10} fill={color} stroke="#f87171" strokeWidth={1.5} transform={`rotate(45 ${x} ${y})`} />
  ) : t.tone === 'fail' || t.req.failed ? (
    <g stroke={color} strokeWidth={2.5} strokeLinecap="round">
      <line x1={x - 4.5} y1={y - 4.5} x2={x + 4.5} y2={y + 4.5} />
      <line x1={x - 4.5} y1={y + 4.5} x2={x + 4.5} y2={y - 4.5} />
    </g>
  ) : t.req.kind === 'write' ? (
    <rect x={x - 4.5} y={y - 4.5} width={9} height={9} rx={2} fill={color} />
  ) : t.tone === 'flush' ? (
    <g>
      <circle cx={x} cy={y} r={9} fill={color} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill="#2e1065">
        {t.req.count ?? ''}
      </text>
    </g>
  ) : t.tone === 'control' ? (
    <circle cx={x} cy={y} r={3} fill={color} />
  ) : (
    <circle cx={x} cy={y} r={radiusFor(t.req.size)} fill={color} />
  );
  return (
    <g
      className={onClick ? 'cursor-pointer' : undefined}
      onClick={
        onClick &&
        ((e) => {
          e.stopPropagation();
          onClick(t.req);
        })
      }
    >
      <polyline points={svgPoints(tail)} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      {shape}
      {t.req.encrypted && t.tone !== 'fail' && !t.req.failed && <circle cx={x} cy={y} r={radiusFor(t.req.size) + 2.5} fill="none" stroke={color} strokeWidth={1.2} />}
      {selected && <circle cx={x} cy={y} r={11} fill="none" stroke="#f4f4f5" strokeWidth={1.5} />}
      {onClick && <circle cx={x} cy={y} r={11} fill="transparent" />}
    </g>
  );
}

function Wires({ layout, heat, lane, visible }: { layout: StageLayout; heat: Record<string, number>; lane: number; visible?: ReadonlySet<string> }) {
  return (
    <g aria-hidden>
      {layout.wires.map((w) => {
        if (visible && !visible.has(w.id)) return null;
        const h = Math.min(1, heat[w.id] ?? 0);
        const color = h > 0.15 ? `rgba(251, 191, 36, ${0.35 + h * 0.5})` : '#3f3f46';
        return (
          <g key={w.id}>
            <polyline points={svgPoints(offsetPolyline(w.pts, lane))} fill="none" stroke={color} strokeWidth={1 + h * 3} strokeLinejoin="round" />
            <polyline points={svgPoints(offsetPolyline([...w.pts].reverse(), lane))} fill="none" stroke={color} strokeWidth={1 + h * 3} strokeLinejoin="round" />
          </g>
        );
      })}
    </g>
  );
}

export interface StageProps {
  layout: StageLayout;
  travels: readonly Travel[];
  now: number;
  /** Inner drawing for a node, in stage coordinates. */
  renderNode: (n: StageNode) => ReactNode;
  /** Extra classes for a node's frame (tone, dimmed, down…). */
  frameClass?: (n: StageNode) => string;
  /** 0–1 per wire id: how hot the wire draws. */
  heat?: Record<string, number>;
  onNodeClick?: (id: string, at: { x: number; y: number }) => void;
  onPacketClick?: (req: Req) => void;
  selectedReq?: number | null;
  /** In pick mode nodes outline on hover, for freeze-frame answers. */
  picking?: boolean;
  /** Drawn on top of everything: bursts, markers. */
  overlay?: ReactNode;
  label: string;
  /** Drawn under everything, such as a map. */
  background?: ReactNode;
  /** Only these wires are drawn (dots still travel on the others). All, if unset. */
  visibleWires?: ReadonlySet<string>;
  /** Gap between a wire's two lanes, either side of its centre line. */
  lane?: number;
  /** Whether a node gets the standard rounded frame; nodes that draw their own shape return false. */
  drawFrame?: (n: StageNode) => boolean;
  /** Nodes that can be dragged, and where they are dragged to (`done` on release). */
  draggable?: (n: StageNode) => boolean;
  onNodeDrag?: (id: string, at: Pt, done: boolean) => void;
}

/** A live architecture diagram: wires, travelling dots, and nodes that draw their own state. */
export function Stage({
  layout,
  travels,
  now,
  renderNode,
  frameClass,
  heat = {},
  onNodeClick,
  onPacketClick,
  selectedReq,
  picking,
  overlay,
  label,
  background,
  visibleWires,
  lane = DEFAULT_LANE,
  drawFrame,
  draggable,
  onNodeDrag,
}: StageProps) {
  const paths = useMemo(() => wirePaths(layout, lane), [layout, lane]);
  const svg = useRef<SVGSVGElement>(null);
  // A press that moves more than a few units is a drag, and doesn't also count as a click.
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);

  const toStage = (e: PointerEvent): Pt => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };
  const dragHandlers = (n: StageNode) =>
    onNodeDrag && draggable?.(n)
      ? {
          onPointerDown: (e: PointerEvent<SVGGElement>) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const [x, y] = toStage(e);
            drag.current = { id: n.id, x, y, moved: false };
          },
          onPointerMove: (e: PointerEvent<SVGGElement>) => {
            const d = drag.current;
            if (!d || d.id !== n.id) return;
            const p = toStage(e);
            if (!d.moved && Math.hypot(p[0] - d.x, p[1] - d.y) < 4) return;
            d.moved = true;
            onNodeDrag(n.id, p, false);
          },
          onPointerUp: (e: PointerEvent<SVGGElement>) => {
            const d = drag.current;
            if (d?.moved) onNodeDrag(n.id, toStage(e), true);
            // The click that follows this release belongs to the drag; forget the drag after it.
            setTimeout(() => {
              if (drag.current === d) drag.current = null;
            });
          },
        }
      : {};

  const packets: ReactNode[] = [];
  for (const t of travels) {
    const p = paths.get(t.wire);
    if (!p) continue;
    const path = t.reverse ? p.rev : p.fwd;
    const f = Math.max(0, Math.min(1, (now - t.depart) / Math.max(1, t.arrive - t.depart)));
    const d = f * path.length;
    packets.push(<Packet key={t.id} t={t} pos={pointAt(path, f)} tail={subPath(path, d - TRAIL, d)} selected={selectedReq === t.req.id} onClick={onPacketClick} />);
  }
  return (
    <svg ref={svg} viewBox={`0 0 ${layout.width} ${layout.height}`} className="block h-auto w-full select-none" role="img" aria-label={label}>
      {background}
      <Wires layout={layout} heat={heat} lane={lane} visible={visibleWires} />
      <g>{packets}</g>
      {layout.nodes.map((n) => (
        <g
          key={n.id}
          data-node={n.id}
          className={`${draggable?.(n) ? 'cursor-grab touch-none' : onNodeClick ? 'cursor-pointer' : ''} ${picking ? 'stage-pick' : ''}`}
          onClick={
            onNodeClick &&
            (() => {
              if (drag.current?.moved) return;
              onNodeClick(n.id, { x: (n.x + n.w / 2) / layout.width, y: (n.y + n.h) / layout.height });
            })
          }
          {...dragHandlers(n)}
        >
          {drawFrame?.(n) !== false && <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={10} className={`stage-frame ${frameClass?.(n) ?? ''}`} />}
          {renderNode(n)}
        </g>
      ))}
      {overlay}
    </svg>
  );
}

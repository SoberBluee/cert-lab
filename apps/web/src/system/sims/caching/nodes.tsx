import type { ReactNode } from 'react';
import type { CacheEntry, EvictionPolicy } from '../../logic/cache';
import type { CachingScene, StageNode } from '../../logic/caching';
import type { StageEvent } from '../../stage/engine';

export interface SlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Narrow boxes put their sub-label on a second line. */
const narrow = (n: StageNode) => n.w < 160;

/** Where each slot of a cache node is drawn: a grid that fits the box. */
export function slotRects(n: StageNode, capacity: number): SlotRect[] {
  const pad = 8;
  const top = narrow(n) ? 38 : 26;
  const gap = 5;
  const cw = n.w - pad * 2;
  const ch = n.h - top - pad;
  let cols = Math.max(1, Math.min(capacity, Math.floor((cw + gap) / (44 + gap))));
  let rows = Math.ceil(capacity / cols);
  // Prefer fewer, taller rows when the box is tall and narrow.
  while (rows > 1 && (ch - gap * (rows - 1)) / rows < 22 && cols < capacity) {
    cols++;
    rows = Math.ceil(capacity / cols);
  }
  const w = (cw - gap * (cols - 1)) / cols;
  const h = Math.min(36, (ch - gap * (rows - 1)) / rows);
  return Array.from({ length: capacity }, (_, i) => ({ x: n.x + pad + (i % cols) * (w + gap), y: n.y + top + Math.floor(i / cols) * (h + gap), w, h }));
}

const FLASH: Record<string, { stroke: string; dash?: string }> = {
  hit: { stroke: '#34d399' },
  evict: { stroke: '#ef4444' },
  fill: { stroke: '#fbbf24' },
  write: { stroke: '#a78bfa' },
  invalidate: { stroke: '#f87171', dash: '3 2' },
  refresh: { stroke: '#38bdf8' },
  expire: { stroke: '#71717a', dash: '3 2' },
};

const FLASH_MS = 450;

function TtlRing({ x, y, left }: { x: number; y: number; left: number }) {
  const r = 4;
  const c = 2 * Math.PI * r;
  return (
    <g aria-hidden>
      <circle cx={x} cy={y} r={r} fill="none" stroke="#27272a" strokeWidth={2} />
      <circle cx={x} cy={y} r={r} fill="none" stroke={left < 0.3 ? '#f87171' : '#5eead4'} strokeWidth={2} strokeDasharray={`${c * Math.max(0, left)} ${c}`} transform={`rotate(-90 ${x} ${y})`} />
    </g>
  );
}

/** What a slot's corner shows: whatever the eviction policy ranks entries by. */
export function slotRank(policy: EvictionPolicy, e: CacheEntry, now: number): { text: string; title: string } {
  const ago = (ms: number) => `${Math.max(0, (now - ms) / 1000).toFixed(1)}s`;
  if (policy === 'lru' || policy === 'mru') return { text: ago(e.usedMs), title: `last used ${ago(e.usedMs)} ago` };
  if (policy === 'fifo' || policy === 'lifo') return { text: ago(e.insertedMs), title: `stored ${ago(e.insertedMs)} ago` };
  return { text: `×${e.hits}`, title: `${e.hits} hits` };
}

export const RANK_CAPTION: Record<EvictionPolicy, string> = {
  lru: 'Slot corners: seconds since last use.',
  mru: 'Slot corners: seconds since last use.',
  fifo: 'Slot corners: seconds since stored.',
  lifo: 'Slot corners: seconds since stored.',
  lfu: 'Slot corners: hit count.',
  random: 'Slot corners: hit count.',
};

function Slot({ r, entry, flash, now, ttlMs, policy, onPick, index }: { r: SlotRect; entry: CacheEntry | null; flash?: StageEvent; now: number; ttlMs: number; policy: EvictionPolicy; onPick?: (slot: number) => void; index: number }) {
  const f = flash ? FLASH[flash.kind] : undefined;
  const expired = !!entry && entry.expiresAt !== null && entry.expiresAt <= now && !entry.dirty;
  const small = r.w < 40;
  return (
    <g
      className={onPick ? 'stage-pick-slot cursor-pointer' : undefined}
      onClick={
        onPick &&
        ((e) => {
          e.stopPropagation();
          onPick(index);
        })
      }
    >
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={4}
        fill={entry && !expired ? '#0f2e2b' : '#111113'}
        stroke={f?.stroke ?? (entry ? '#115e59' : '#27272a')}
        strokeWidth={f ? 2 : 1}
        strokeDasharray={f?.dash ?? (entry ? undefined : '3 3')}
      />
      {entry ? (
        <>
          <text x={r.x + (small ? r.w / 2 : 6)} y={r.y + r.h / 2} dominantBaseline="central" textAnchor={small ? 'middle' : 'start'} className={`font-mono text-[11px] ${expired ? 'fill-zinc-500' : 'fill-teal-100'}`}>
            {entry.key}
          </text>
          {!small && (
            <text x={r.x + r.w - 5} y={r.y + r.h - 6} textAnchor="end" className="fill-teal-400/80 font-mono text-[9px]">
              <title>{slotRank(policy, entry, now).title}</title>
              {slotRank(policy, entry, now).text}
            </text>
          )}
          {entry.expiresAt !== null && ttlMs > 0 && !small && <TtlRing x={r.x + r.w - 7} y={r.y + 7} left={(entry.expiresAt - now) / ttlMs} />}
          {entry.dirty && (
            <g aria-hidden>
              <circle cx={r.x + 5} cy={r.y + 5} r={3} fill="#a78bfa" />
              {entry.pending > 1 && (
                <text x={r.x + 10} y={r.y + 6} dominantBaseline="central" className="fill-violet-300 text-[8px]">
                  {entry.pending}
                </text>
              )}
            </g>
          )}
        </>
      ) : (
        <text x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor="middle" dominantBaseline="central" className="fill-zinc-700 text-[10px]">
          empty
        </text>
      )}
    </g>
  );
}

function Label({ n, children, sub }: { n: StageNode; children?: ReactNode; sub?: string }) {
  return (
    <>
      <text x={n.x + 10} y={n.y + 15} dominantBaseline="central" className="fill-zinc-100 text-[12px] font-semibold">
        {n.label}
      </text>
      {sub &&
        (narrow(n) ? (
          <text x={n.x + 10} y={n.y + 28} dominantBaseline="central" className="fill-zinc-400 text-[10px]">
            {sub}
          </text>
        ) : (
          <text x={n.x + n.w - 9} y={n.y + 15} dominantBaseline="central" textAnchor="end" className="fill-zinc-400 text-[10px]">
            {sub}
          </text>
        ))}
      {children}
    </>
  );
}

export function CacheNode({ n, scene, events, onPickSlot }: { n: StageNode; scene: CachingScene; events: StageEvent[]; onPickSlot?: (slot: number) => void }) {
  const cache = scene.caches.get(n.id)!;
  const rects = slotRects(n, cache.capacity);
  const flashes = new Map<number, StageEvent>();
  for (const e of events) if (e.node === n.id && e.slot !== undefined && e.slot >= 0 && FLASH[e.kind] && scene.sim.now - e.at < FLASH_MS) flashes.set(e.slot, e);
  const stats = scene.nodeStats.get(n.id)!;
  const lookups = stats.hits + stats.misses;
  const active = scene.active(n.id);
  const down = scene.isDown(n.id);
  const waiting = scene.waitingAt(n.id);
  const sub = scene.cfg.topology === 'single' ? `${cache.size}/${cache.capacity}` : lookups ? `${Math.round((stats.hits / lookups) * 100)}% hits` : `${cache.capacity} slots`;
  return (
    <g>
      <Label n={n} sub={sub} />
      <g opacity={active ? 1 : 0.35}>
        {rects.map((r, i) => (
          <Slot key={i} r={r} index={i} entry={cache.slots[i] ?? null} flash={flashes.get(i)} now={scene.sim.now} ttlMs={scene.cfg.ttlSec * 1000} policy={cache.policy} onPick={onPickSlot} />
        ))}
      </g>
      {!active && (
        <g>
          <rect x={n.x + n.w / 2 - 48} y={n.y + n.h / 2 - 12} width={96} height={24} rx={12} fill={down ? '#450a0a' : '#18181b'} stroke={down ? '#ef4444' : '#52525b'} />
          <text x={n.x + n.w / 2} y={n.y + n.h / 2} textAnchor="middle" dominantBaseline="central" className={`text-[11px] font-semibold ${down ? 'fill-red-200' : 'fill-zinc-300'}`}>
            {down ? 'restarting…' : 'cache off'}
          </text>
        </g>
      )}
      {waiting > 0 && (
        <g aria-hidden>
          {Array.from({ length: Math.min(waiting, 8) }, (_, i) => (
            <circle key={i} cx={n.x + 6} cy={n.y + n.h - 10 - i * 9} r={3.5} fill="#fbbf24" />
          ))}
          <text x={n.x + 13} y={n.y + n.h - 10} dominantBaseline="central" className="fill-amber-200 text-[9px]">
            {waiting} waiting
          </text>
        </g>
      )}
    </g>
  );
}

export function DbNode({ n, scene, rate }: { n: StageNode; scene: CachingScene; rate: number }) {
  const db = scene.db;
  const over = rate > scene.cfg.dbCapacity;
  const cx = n.x + 10;
  return (
    <g>
      <Label n={n} />
      <g aria-hidden>
        {Array.from({ length: db.workers }, (_, i) => (
          <rect key={i} x={cx + i * 16} y={n.y + 28} width={12} height={12} rx={2} fill={i < db.busy ? '#fbbf24' : '#27272a'} stroke="#3f3f46" />
        ))}
        <text x={cx + db.workers * 16 + 2} y={n.y + 34} dominantBaseline="central" className="fill-zinc-500 text-[9px]">
          busy
        </text>
        {Array.from({ length: db.maxQueue }, (_, i) => (
          <circle key={i} cx={cx + 4 + (i % 5) * 10} cy={n.y + 52 + Math.floor(i / 5) * 9} r={3.2} fill={i < db.queue ? (db.queue >= db.maxQueue ? '#ef4444' : '#fbbf24') : '#1f1f23'} />
        ))}
        {n.w > 100 && (
          <text x={cx + 56} y={n.y + 56} dominantBaseline="central" className={`text-[9px] ${db.queue ? 'fill-amber-200' : 'fill-zinc-500'}`}>
            {db.queue ? `${db.queue} queued` : 'queue'}
          </text>
        )}
      </g>
      <text x={n.x + 10} y={n.y + n.h - 9} dominantBaseline="central" className={`font-mono text-[10px] ${over ? 'fill-red-300' : 'fill-zinc-400'}`}>
        {rate.toFixed(1)}/s of {scene.cfg.dbCapacity}
      </text>
    </g>
  );
}

export function UsersNode({ n, single }: { n: StageNode; single?: boolean }) {
  const people = single ? [[n.x + n.w / 2, n.y + n.h / 2 - 4]] : [0, 1, 2, 3, 4, 5].map((i) => [n.x + n.w / 2 + ((i % 3) - 1) * 22, n.y + 26 + Math.floor(i / 3) * 24]);
  return (
    <g>
      {people.map(([x, y], i) => (
        <g key={i} aria-hidden fill="#71717a">
          <circle cx={x} cy={y! - 5} r={4.5} />
          <rect x={x! - 6.5} y={y! + 1} width={13} height={9} rx={4.5} />
        </g>
      ))}
      <text x={n.x + n.w / 2} y={n.y + n.h - 10} textAnchor="middle" dominantBaseline="central" className="fill-zinc-200 text-[12px] font-semibold">
        {n.label}
      </text>
    </g>
  );
}

export function PassNode({ n }: { n: StageNode }) {
  return (
    <text x={n.x + n.w / 2} y={n.y + n.h / 2} textAnchor="middle" dominantBaseline="central" className="fill-zinc-100 text-[12px] font-semibold">
      {n.label}
    </text>
  );
}

export function ReplicaNode({ n, scene }: { n: StageNode; scene: CachingScene }) {
  const on = scene.cfg.replica && scene.cfg.strategy === 'write-back' && scene.cfg.cacheOn;
  const copies = [...scene.replica.values()].reduce((a, r) => a + r.pending, 0);
  return (
    <g opacity={on ? 1 : 0.3}>
      <Label n={n} />
      <text x={n.x + 10} y={n.y + 36} dominantBaseline="central" className="fill-violet-200 text-[10px]">
        {on ? `${copies} unflushed write${copies === 1 ? '' : 's'} copied` : 'off'}
      </text>
    </g>
  );
}

/** Short-lived bursts and labels drawn over the stage. */
export function Bursts({ scene, events, nodes }: { scene: CachingScene; events: StageEvent[]; nodes: StageNode[] }) {
  const now = scene.sim.now;
  const out: ReactNode[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  events.forEach((e, i) => {
    const n = byId.get(e.node);
    if (!n) return;
    const age = now - e.at;
    if ((e.kind === 'hit' || e.kind === 'evict') && e.slot !== undefined && e.slot >= 0 && age < FLASH_MS) {
      const cache = scene.caches.get(n.id);
      const r = cache && slotRects(n, cache.capacity)[e.slot];
      if (!r) return;
      const f = age / FLASH_MS;
      out.push(<circle key={i} cx={r.x + r.w / 2} cy={r.y + r.h / 2} r={6 + f * 18} fill="none" stroke={e.kind === 'hit' ? '#34d399' : '#ef4444'} strokeWidth={2} opacity={1 - f} />);
    } else if ((e.kind === 'reject' || e.kind === 'crash' || e.kind === 'flush') && age < 700) {
      const f = age / 700;
      out.push(<rect key={i} x={n.x - f * 8} y={n.y - f * 8} width={n.w + f * 16} height={n.h + f * 16} rx={12} fill="none" stroke={e.kind === 'flush' ? '#fbbf24' : '#ef4444'} strokeWidth={2} opacity={1 - f} />);
    } else if ((e.kind === 'lost' || e.kind === 'restored') && age < 3500 && e.text) {
      out.push(
        <text key={i} x={n.x + n.w / 2} y={n.y - 8 - (age / 3500) * 10} textAnchor="middle" className={`text-[12px] font-semibold ${e.kind === 'lost' ? 'fill-red-300' : 'fill-emerald-300'}`} opacity={1 - age / 3500}>
          {e.text}
        </text>,
      );
    }
  });
  return <g aria-hidden>{out}</g>;
}

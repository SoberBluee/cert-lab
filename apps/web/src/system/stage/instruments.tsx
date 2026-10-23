import type { ReactNode } from 'react';
import { LATENCY_BUCKETS } from './metrics';

export const panel = 'rounded-xl border border-zinc-800 bg-zinc-900/60 p-3';

export function InstrumentCard({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={panel} aria-label={title}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">{title}</h3>
        {aside}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A donut for a 0–1 ratio. */
export function Ring({ value, label, color = '#34d399', size = 64 }: { value: number | null; label: string; color?: string; size?: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272a" strokeWidth={8} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeDasharray={`${c * v} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeLinecap={v > 0 ? 'round' : 'butt'}
        />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="fill-zinc-100 text-[13px] font-semibold">
          {value === null ? '–' : `${Math.round(v * 100)}%`}
        </text>
      </svg>
      <p className="text-xs leading-snug text-zinc-400">{label}</p>
    </div>
  );
}

/** Load against a capacity line; turns red over capacity. */
export function LoadBar({ value, capacity, max, unit, note }: { value: number; capacity: number; max?: number; unit: string; note?: ReactNode }) {
  const top = max ?? Math.max(capacity * 2, value);
  const over = value > capacity;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className={`font-mono font-semibold ${over ? 'text-red-400' : 'text-zinc-100'}`}>
          {value.toFixed(1)}
          <span className="text-xs font-normal text-zinc-500"> {unit}</span>
        </span>
        <span className="text-xs text-zinc-500">capacity {capacity}</span>
      </div>
      <div className="relative mt-1.5 h-2.5 rounded-full bg-zinc-800" role="meter" aria-valuenow={Math.round(value * 10) / 10} aria-valuemin={0} aria-valuemax={top} aria-label={`Load ${value.toFixed(1)} ${unit}, capacity ${capacity}`}>
        <div className={`h-full rounded-full transition-[width] duration-200 ${over ? 'bg-red-500' : 'bg-indigo-400'}`} style={{ width: `${Math.min(100, (value / top) * 100)}%` }} />
        <div className="absolute top-[-3px] h-[16px] w-0.5 bg-zinc-300" style={{ left: `${(capacity / top) * 100}%` }} aria-hidden />
      </div>
      {note && <p className="mt-1 text-xs text-zinc-500">{note}</p>}
    </div>
  );
}

const bucketLabel = (i: number) => (i === LATENCY_BUCKETS.length ? `>${LATENCY_BUCKETS.at(-1)}` : i === 0 ? `≤${LATENCY_BUCKETS[0]}` : `${LATENCY_BUCKETS[i]}`);

/** Latency histogram on log-spaced buckets, with p50 and p95 called out. */
export function LatencyHistogram({ counts, p50, p95, empty = 'No answers yet.' }: { counts: number[]; p50: number; p95: number; empty?: string }) {
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return <p className="text-xs text-zinc-500">{empty}</p>;
  return (
    <div>
      <div className="flex h-16 items-end gap-0.5" aria-hidden>
        {counts.map((c, i) => (
          <div key={i} className="flex-1 rounded-t-sm bg-sky-500/70" style={{ height: `${(c / max) * 100}%`, minHeight: c ? 2 : 0 }} title={`${bucketLabel(i)} ms: ${c}`} />
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-[9px] text-zinc-500" aria-hidden>
        {counts.map((_, i) => (
          <span key={i} className="flex-1 text-center">
            {bucketLabel(i)}
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-zinc-400">
        p50 <span className="font-mono text-zinc-100">{fmtMs(p50)}</span> · p95 <span className="font-mono text-zinc-100">{fmtMs(p95)}</span>
      </p>
    </div>
  );
}

export const fmtMs = (ms: number) => (ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`);

/** A small counter that lights up when non-zero. */
export function Counter({ label, value, tone }: { label: string; value: number; tone: 'red' | 'amber' | 'violet' }) {
  const on = value > 0;
  const toneCls = { red: 'text-red-300 border-red-900/70 bg-red-950/40', amber: 'text-amber-200 border-amber-900/70 bg-amber-950/40', violet: 'text-violet-200 border-violet-900/70 bg-violet-950/40' }[tone];
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${on ? toneCls : 'border-zinc-800 text-zinc-500'}`}>
      <div className="font-mono text-base leading-none font-semibold">{value}</div>
      <div className="mt-1 text-[11px] leading-tight">{label}</div>
    </div>
  );
}

/** Per-second history: bars for one series, a line for a 0–1 ratio, and labelled markers. */
export function Timeline({ bars, ratio, markers, barMax, seconds }: { bars: number[]; ratio: (number | null)[]; markers: { at: number; label: string }[]; barMax: number; seconds: number }) {
  const w = 240;
  const h = 56;
  const bw = w / seconds;
  const pts = ratio.map((r, i) => (r === null ? null : `${(i + 0.5) * bw},${h - r * (h - 4) - 2}`)).filter(Boolean);
  return (
    <svg viewBox={`0 0 ${w} ${h + 12}`} className="block w-full" aria-hidden>
      {bars.map((b, i) => (
        <rect key={i} x={i * bw + 0.5} y={h - (Math.min(b, barMax) / barMax) * h} width={Math.max(1, bw - 1)} height={(Math.min(b, barMax) / barMax) * h} fill="#6366f1" fillOpacity={0.45} />
      ))}
      {pts.length > 1 && <polyline points={pts.join(' ')} fill="none" stroke="#34d399" strokeWidth={1.5} strokeLinejoin="round" />}
      {markers.map((m, i) => (
        <g key={i}>
          <line x1={m.at * bw} y1={0} x2={m.at * bw} y2={h} stroke="#f87171" strokeDasharray="2 2" />
          <text x={Math.min(w - 2, m.at * bw + 2)} y={h + 10} className="fill-red-300 text-[8px]" textAnchor={m.at * bw > w - 40 ? 'end' : 'start'}>
            {m.label}
          </text>
        </g>
      ))}
      <line x1={0} y1={h} x2={w} y2={h} stroke="#3f3f46" />
    </svg>
  );
}

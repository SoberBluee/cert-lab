import type { Req } from './engine';
import { fmtMs, panel } from './instruments';

/** Hop-by-hop waterfall of one request's modeled latency, like the network tab in browser devtools. */
export function Inspector({ req, onClose, describe }: { req: Req; onClose: () => void; describe?: (req: Req) => string }) {
  const total = Math.max(0.1, req.modeledMs);
  let acc = 0;
  const status = req.failed ? 'Failed' : req.done ? (req.stale ? 'Answered, with stale data' : 'Answered') : 'In flight';
  return (
    <section className={panel} aria-label={`Request ${req.id} details`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            Request #{req.id} <span className="font-normal text-zinc-400">· {req.kind}{req.key ? ` ${req.key}` : ''}</span>
          </h3>
          <p className={`text-xs ${req.failed ? 'text-red-300' : req.stale ? 'text-amber-200' : 'text-zinc-400'}`}>
            {status}
            {describe ? ` · ${describe(req)}` : ''} · {fmtMs(req.modeledMs)} so far
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded px-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" aria-label="Close request details">
          ✕
        </button>
      </div>
      <ol className="mt-2 space-y-1">
        {req.trail.map((h, i) => {
          const left = (acc / total) * 100;
          acc += h.ms;
          return (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_88px_52px] items-center gap-2 text-xs">
              <span className="truncate text-zinc-300" title={h.label}>
                {h.label}
              </span>
              <span className="relative h-2 rounded-sm bg-zinc-800" aria-hidden>
                {h.ms > 0 && <span className="absolute inset-y-0 rounded-sm bg-sky-400" style={{ left: `${left}%`, width: `${Math.max(2, (h.ms / total) * 100)}%` }} />}
              </span>
              <span className="text-right font-mono text-zinc-400">{h.ms ? fmtMs(h.ms) : '–'}</span>
            </li>
          );
        })}
      </ol>
      {!req.done && <p className="mt-2 text-xs text-zinc-500">Still travelling: new hops appear as it moves.</p>}
    </section>
  );
}

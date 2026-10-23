import type { Hop, Req } from './engine';
import { fmtMs, panel } from './instruments';

/** What changed in the envelope at this hop: every field for the first hop, only changes after that. */
function changes(prev: Hop['fields'], next: Hop['fields']): [string, string][] {
  if (!next) return [];
  return Object.entries(next).filter(([k, v]) => !prev || prev[k] !== v);
}

/** Hop-by-hop waterfall of one request's modeled latency, like the network tab in browser devtools. Envelopes, if tracked, show what each hop changed. */
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
          const changed = changes(i ? req.trail[i - 1]!.fields : undefined, h.fields);
          return (
            <li key={i} className="text-xs">
              <div className="grid grid-cols-[minmax(0,1fr)_88px_52px] items-center gap-2">
                <span className="truncate text-zinc-300" title={h.label}>
                  {h.label}
                </span>
                <span className="relative h-2 rounded-sm bg-zinc-800" aria-hidden>
                  {h.ms > 0 && <span className="absolute inset-y-0 rounded-sm bg-sky-400" style={{ left: `${left}%`, width: `${Math.max(2, (h.ms / total) * 100)}%` }} />}
                </span>
                <span className="text-right font-mono text-zinc-400">{h.ms ? fmtMs(h.ms) : '–'}</span>
              </div>
              {changed.length > 0 && (
                <dl className="mt-0.5 mb-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-3 font-mono text-[11px]">
                  {changed.map(([k, v]) => (
                    <div key={k} className="flex gap-1">
                      <dt className="text-zinc-500">{k}</dt>
                      <dd className={i ? 'text-amber-200' : 'text-zinc-300'}>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ol>
      {!req.done && <p className="mt-2 text-xs text-zinc-500">Still travelling: new hops appear as it moves.</p>}
    </section>
  );
}

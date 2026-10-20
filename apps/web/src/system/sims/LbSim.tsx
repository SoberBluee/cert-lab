import { useMemo, useState } from 'react';
import { EventLog, StepControls, card, selectCls, useStepper } from '../components';
import { DEFAULT_BACKENDS, assignments, countsOf, type LbAlgorithm } from '../logic/lb';

const REQUESTS = 12;

export function LbSim() {
  const [algo, setAlgo] = useState<LbAlgorithm>('round-robin');
  const [down, setDown] = useState<string[]>([]);
  const backends = useMemo(() => DEFAULT_BACKENDS.map((b) => ({ ...b, healthy: !down.includes(b.id) })), [down]);
  const plan = useMemo(() => assignments(algo, backends, REQUESTS), [algo, backends]);
  const s = useStepper(plan.length);
  const shown = plan.slice(0, s.index + 1);
  const counts = countsOf(shown);
  const current = s.index >= 0 ? plan[s.index] : undefined;

  const toggle = (id: string) => {
    setDown((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
    s.reset();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-zinc-300">
          Algorithm
          <select value={algo} onChange={(e) => { setAlgo(e.target.value as LbAlgorithm); s.reset(); }} className={`${selectCls} ml-2`} aria-label="Load balancing algorithm">
            <option value="round-robin">Round robin</option>
            <option value="least-connections">Least connections</option>
            <option value="weighted">Weighted (A counts double)</option>
            <option value="ip-hash">IP hash (sticky client)</option>
          </select>
        </label>
        <span className="text-sm text-zinc-400">{REQUESTS} requests from one client (203.0.113.7)</span>
      </div>
      <p className="text-sm text-zinc-400">
        Step the requests and watch the distribution. Then mark a backend down and reset: health checks should keep traffic away from it. Try IP hash last — one client sticks to one backend.
      </p>

      <div className="flex flex-wrap gap-2" aria-label="Backends">
        {backends.map((b) => (
          <div key={b.id} className={`rounded-lg border px-3 py-2 text-sm ${current === b.id ? 'border-sky-600 bg-sky-950/50 text-sky-100' : down.includes(b.id) ? 'border-red-800 bg-red-950/40 text-red-300' : 'border-zinc-800 bg-zinc-900/60 text-zinc-300'}`} aria-current={current === b.id ? 'step' : undefined}>
            <span className="font-medium">Backend {b.id}</span> <span className="text-xs text-zinc-500">weight {b.weight}</span>
            <span className="ml-2 font-mono">{counts[b.id] ?? 0} req</span>
            <button type="button" onClick={() => toggle(b.id)} className="ml-2 text-xs text-sky-400 hover:text-sky-300" aria-label={`Toggle backend ${b.id} health`}>
              {down.includes(b.id) ? 'mark healthy' : 'mark down'}
            </button>
          </div>
        ))}
      </div>

      <StepControls s={s} total={plan.length} />
      <EventLog
        entries={shown.map((id, i) => ({ label: `Request ${i + 1} → Backend ${id}`, detail: `via ${algo}; counts now A=${countsOf(plan.slice(0, i + 1)).A ?? 0} B=${countsOf(plan.slice(0, i + 1)).B ?? 0} C=${countsOf(plan.slice(0, i + 1)).C ?? 0}` }))}
      />
      {s.done && (
        <div className={card} role="status">
          <p className="text-sm text-zinc-300">
            <span className="font-medium text-zinc-100">Result:</span> {plan.length} requests split A={counts.A ?? 0}, B={counts.B ?? 0}, C={counts.C ?? 0}
            {down.length > 0 ? ` with ${down.join(', ')} down and receiving none.` : '.'}
            {algo === 'ip-hash' && ' One client IP always hashes to the same backend — sticky, but uneven if a few clients dominate.'}
            {algo === 'weighted' && ' A has weight 2, so it should take about half the traffic.'}
          </p>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { EventLog, StepControls, card, useStepper } from '../components';
import { OSI_LAYERS, osiJourney } from '../logic/osi';

export function OsiSim() {
  const steps = useMemo(() => osiJourney(), []);
  const s = useStepper(steps.length);
  const current = s.index >= 0 ? steps[s.index] : undefined;
  const [selected, setSelected] = useState(4);
  const layer = OSI_LAYERS.find((l) => l.n === selected)!;

  const stack = (side: 'sender' | 'receiver') => (
    <div className="flex-1 space-y-1" aria-label={`${side} stack`}>
      <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">{side}</p>
      {OSI_LAYERS.map((l) => {
        const activeSide = current?.side === side;
        const active = activeSide && current?.layer === l.n;
        return (
          <button
            key={l.n}
            type="button"
            onClick={() => setSelected(l.n)}
            aria-pressed={selected === l.n}
            className={`block w-full rounded-md border px-3 py-2 text-left text-sm transition ${
              active
                ? 'border-sky-600 bg-sky-950/50 text-sky-100'
                : selected === l.n
                  ? 'border-indigo-700 bg-indigo-950/40 text-indigo-100'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600'
            }`}
          >
            L{l.n} {l.name} <span className="text-xs text-zinc-500">· {l.pdu}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">
        Step the journey of one HTTP request: down the sender stack (each layer wraps the payload), across as bits, up the receiver stack (each layer unwraps). Click any layer to inspect it.
      </p>
      <div className="flex gap-4">
        {stack('sender')}
        <div className="flex items-center text-zinc-600" aria-hidden>⇄</div>
        {stack('receiver')}
      </div>

      <div className={card} aria-label="Layer detail">
        <h3 className="text-sm font-semibold text-zinc-100">L{layer.n} {layer.name}</h3>
        <dl className="mt-2 grid gap-1 text-sm text-zinc-300 sm:grid-cols-2">
          <div><dt className="text-zinc-500">Role</dt><dd>{layer.role}</dd></div>
          <div><dt className="text-zinc-500">PDU / adds</dt><dd>{layer.pdu} — {layer.header}</dd></div>
          <div><dt className="text-zinc-500">Example</dt><dd>{layer.example}</dd></div>
          <div><dt className="text-zinc-500">If it fails</dt><dd>{layer.failure}</dd></div>
        </dl>
      </div>

      <StepControls s={s} total={steps.length} />
      <EventLog entries={steps.slice(0, s.index + 1).map((x) => ({ label: `${x.side}: ${x.label}`, detail: x.detail }))} />
      {current && (
        <p className="text-sm text-zinc-300" role="status">
          <span className="font-medium text-zinc-100">What just happened?</span> {current.detail}
        </p>
      )}
    </div>
  );
}

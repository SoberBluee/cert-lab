import { useState, type ReactNode } from 'react';
import { btnCls } from '../components';

export interface MissionView {
  id: string;
  title: string;
  brief: string;
  goal: string;
  hint: string;
  debrief: string;
  seconds: number;
}

export type MissionPhase = 'setup' | 'running' | 'done';

export function MissionList({ missions, passed, onStart }: { missions: MissionView[]; passed: Record<string, true>; onStart: (id: string) => void }) {
  if (!missions.length) return null;
  return (
    <section aria-label="Missions" className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
        Missions · {missions.filter((m) => passed[m.id]).length} of {missions.length} passed
      </h3>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {missions.map((m) => (
          <div key={m.id} className={`rounded-xl border p-3 ${passed[m.id] ? 'border-emerald-800/70 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-900/60'}`}>
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-semibold text-zinc-100">{m.title}</h4>
              {passed[m.id] && <span className="shrink-0 rounded-full bg-emerald-900/60 px-2 py-0.5 text-[11px] text-emerald-200">✓ passed</span>}
            </div>
            <p className="mt-1 text-xs text-zinc-400">{m.brief}</p>
            <p className="mt-1.5 text-xs text-zinc-300">
              <span className="text-zinc-500">Goal:</span> {m.goal}
            </p>
            <button type="button" className={`${btnCls} mt-2`} onClick={() => onStart(m.id)}>
              {passed[m.id] ? 'Play again' : 'Try it'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The mission in progress: brief and goal, the allowed controls, then the run and its result. */
export function MissionBanner({
  mission,
  phase,
  progress,
  result,
  onRun,
  onRetry,
  onExit,
  controls,
}: {
  mission: MissionView;
  phase: MissionPhase;
  progress: number;
  result: { pass: boolean; detail: string } | null;
  onRun: () => void;
  onRetry: () => void;
  onExit: () => void;
  controls: ReactNode;
}) {
  const [hint, setHint] = useState(false);
  return (
    <section className="rounded-xl border border-indigo-800/70 bg-indigo-950/30 p-3" aria-label={`Mission: ${mission.title}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] tracking-wide text-indigo-300 uppercase">Mission</p>
          <h3 className="text-sm font-semibold text-zinc-100">{mission.title}</h3>
        </div>
        <button type="button" className="text-xs text-zinc-400 hover:text-zinc-100" onClick={onExit}>
          ← Back to free play
        </button>
      </div>
      <p className="mt-1 text-sm text-zinc-300">{mission.brief}</p>
      <p className="mt-1 text-sm text-zinc-200">
        <span className="text-indigo-300">Goal:</span> {mission.goal}
      </p>

      {phase === 'setup' && (
        <div className="mt-3 space-y-3">
          <div>{controls}</div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500" onClick={onRun}>
              ▶ Run mission ({mission.seconds} s)
            </button>
            <button type="button" className="text-xs text-sky-400 hover:text-sky-300" onClick={() => setHint((h) => !h)}>
              {hint ? 'Hide hint' : 'Show hint'}
            </button>
          </div>
          {hint && <p className="text-xs text-zinc-400">{mission.hint}</p>}
        </div>
      )}

      {phase === 'running' && (
        <div className="mt-3" role="status">
          <div className="h-2 rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-zinc-400">Running… controls are locked until the end. Speed it up with the playback buttons.</p>
        </div>
      )}

      {phase === 'done' && result && (
        <div className={`mt-3 rounded-lg border p-3 ${result.pass ? 'border-emerald-800 bg-emerald-950/40' : 'border-amber-800 bg-amber-950/30'}`} role="status">
          <p className={`text-sm font-semibold ${result.pass ? 'text-emerald-200' : 'text-amber-200'}`}>{result.pass ? 'Mission passed' : 'Not yet'}</p>
          <p className="mt-0.5 text-sm text-zinc-300">{result.detail}</p>
          <p className="mt-1.5 text-sm text-zinc-400">{result.pass ? mission.debrief : `Hint: ${mission.hint}`}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btnCls} onClick={onRetry}>
              {result.pass ? 'Run it again' : 'Change and retry'}
            </button>
            <button type="button" className={btnCls} onClick={onExit}>
              Back to free play
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

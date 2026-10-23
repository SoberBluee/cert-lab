import { useEffect, useRef } from 'react';
import { btnCls } from '../components';

export function ChapterTabs({ chapters, active, onSelect }: { chapters: { id: string; title: string; done: boolean }[]; active: string; onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Chapters" className="flex flex-wrap gap-1.5">
      {chapters.map((c, i) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c.id)}
          aria-current={active === c.id ? 'step' : undefined}
          className={`rounded-full border px-3 py-1 text-sm transition ${
            active === c.id ? 'border-indigo-500 bg-indigo-950/60 text-indigo-100' : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100'
          }`}
        >
          <span className={`mr-1.5 font-mono text-xs ${c.done ? 'text-emerald-400' : 'text-zinc-500'}`}>{c.done ? '✓' : i + 1}</span>
          {c.title}
        </button>
      ))}
    </nav>
  );
}

/**
 * A freeze frame: the run is paused and the learner answers by clicking the stage (or one of the
 * buttons, which do the same for keyboard and touch users).
 */
export function FreezePrompt({
  prompt,
  choices,
  answered,
  onChoose,
  onContinue,
}: {
  prompt: string;
  /** Empty for a note that only needs Continue. */
  choices: { id: string; label: string }[];
  answered: { correct: boolean; explain: string } | null;
  onChoose: (id: string) => void;
  onContinue: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // It appears mid-run, often while the learner is looking at the stage below it.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);
  return (
    <div ref={ref} className="rounded-xl border border-sky-700 bg-sky-950/50 p-3" role="dialog" aria-label="Paused: predict what happens">
      <p className="text-[11px] tracking-wide text-sky-300 uppercase">Paused · predict</p>
      <p className="mt-0.5 text-sm text-zinc-100">{prompt}</p>
      {!answered && choices.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-zinc-400">Click it on the stage, or:</span>
          {choices.map((c) => (
            <button key={c.id} type="button" className="rounded-md border border-sky-800 bg-sky-950 px-2 py-1 text-xs text-sky-100 hover:border-sky-500" onClick={() => onChoose(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {(answered || !choices.length) && (
        <div className="mt-2">
          {answered && choices.length > 0 && <p className={`text-sm font-medium ${answered.correct ? 'text-emerald-300' : 'text-amber-200'}`}>{answered.correct ? 'Right.' : 'Not quite.'}</p>}
          {answered && <p className="text-sm text-zinc-300">{answered.explain}</p>}
          <button type="button" className={`${btnCls} mt-2`} onClick={onContinue}>
            Continue ▸
          </button>
        </div>
      )}
    </div>
  );
}

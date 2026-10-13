import { useEffect, useRef, useState } from 'react';
import type { LearnStepProgress, LessonStepView, SessionView } from '@cka/schema';
import { formatDuration } from '../hooks';
import { Button, ErrorBanner, Markdown } from './ui';

const DRILL_KEY = 'cka.learn.drill';

function useDrill(): [boolean, (on: boolean) => void] {
  const [drill, setDrill] = useState(() => localStorage.getItem(DRILL_KEY) === '1');
  useEffect(() => localStorage.setItem(DRILL_KEY, drill ? '1' : '0'), [drill]);
  return [drill, setDrill];
}

function Command({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
      <pre className="flex-1 px-3 py-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-zinc-200">{command}</pre>
      <button
        className="shrink-0 border-l border-zinc-800 px-2.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        onClick={() => {
          navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

function StepMarker({ n, progress, current }: { n: number; progress?: LearnStepProgress; current: boolean }) {
  if (progress?.done && progress.skipped) {
    return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-600 text-xs text-zinc-400">–</span>;
  }
  if (progress?.done) {
    return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-emerald-950">✓</span>;
  }
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
        current ? 'border-sky-500 text-sky-300' : 'border-zinc-700 text-zinc-500'
      }`}
    >
      {n}
    </span>
  );
}

function Step({ step, n, progress, current, drill }: { step: LessonStepView; n: number; progress?: LearnStepProgress; current: boolean; drill: boolean }) {
  const [shown, setShown] = useState(false);
  const [hint, setHint] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current]);
  const done = progress?.done;
  const frame = current
    ? 'border-sky-800 bg-sky-950/30'
    : done && !progress?.skipped
      ? 'border-emerald-900/70 bg-emerald-950/20'
      : 'border-zinc-800/70 bg-transparent';
  return (
    <li ref={ref} className={`rounded-lg border px-3 py-2.5 transition ${frame}`}>
      <div className="flex items-start gap-3">
        <StepMarker n={n} progress={progress} current={current} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-baseline gap-2">
            <h3
              className={`text-sm font-semibold ${done ? (progress?.skipped ? 'text-zinc-500' : 'text-emerald-300') : current ? 'text-zinc-100' : 'text-zinc-500'}`}
            >
              {step.title}
            </h3>
            {step.node !== 'controlplane' && <span className="font-mono text-xs text-zinc-500">on {step.node}</span>}
          </div>
          {current && (
            <>
              {step.explain && <Markdown>{step.explain}</Markdown>}
              {drill && !shown ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setShown(true)}>
                    Show command
                  </Button>
                  {step.hint && !hint && (
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setHint(true)}>
                      Hint
                    </Button>
                  )}
                </div>
              ) : (
                <Command command={step.command} />
              )}
              {hint && step.hint && <p className="text-xs text-zinc-400">{step.hint}</p>}
              {progress?.failure && (
                <p className="rounded-md border border-amber-800/60 bg-amber-950/30 px-2.5 py-1.5 text-xs text-amber-200">{progress.failure}</p>
              )}
              {!progress?.failure && progress?.lastCommand && (
                <p className="text-xs text-zinc-500">
                  Matched <code className="font-mono text-zinc-400">{progress.lastCommand}</code>, checking the result…
                </p>
              )}
              {progress?.attempt && (
                <p className="text-xs break-all text-zinc-500">
                  <code className="font-mono text-zinc-400">{progress.attempt.command}</code> didn't count: {progress.attempt.reason}.
                </p>
              )}
            </>
          )}
          {done && !progress?.skipped && progress?.lastCommand && (
            <code className="block truncate font-mono text-xs text-emerald-200/70" title={progress.lastCommand}>
              $ {progress.lastCommand}
            </code>
          )}
        </div>
      </div>
    </li>
  );
}

/** Left side of a lesson: the steps, which turn green as the learner's commands complete them. */
export function LessonPane({
  session,
  onSkip,
  skipping,
  onReset,
  onEnd,
  error,
}: {
  session: SessionView;
  onSkip: () => void;
  skipping: boolean;
  onReset: () => void;
  onEnd: () => void;
  error: unknown;
}) {
  const [drill, setDrill] = useDrill();
  const lesson = session.lesson;
  const learn = session.learn;
  if (!lesson || !learn) return <div className="p-4 text-sm text-zinc-500">This lesson no longer exists on disk.</div>;
  const doneCount = learn.steps.filter((s) => s.done).length;
  const complete = learn.current >= lesson.steps.length;
  const tookS = learn.completedAt && session.readyAt ? (Date.parse(learn.completedAt) - Date.parse(session.readyAt)) / 1000 : undefined;
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
      <header className="space-y-2 border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate font-semibold text-zinc-100" title={lesson.title}>
            {lesson.title}
          </h1>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300" title="Hide commands until you ask for them">
            <button
              type="button"
              role="switch"
              aria-checked={drill}
              onClick={() => setDrill(!drill)}
              className={`relative h-4 w-7 rounded-full transition ${drill ? 'bg-sky-500' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${drill ? 'left-[14px]' : 'left-0.5'}`} />
            </button>
            Drill
          </label>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / lesson.steps.length) * 100}%` }} />
        </div>
        <div className="text-xs text-zinc-500">
          {doneCount}/{lesson.steps.length} steps · run the commands in the terminal; each step turns green when it is done
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <ErrorBanner error={error} />
        {complete && (
          <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2.5 text-sm text-emerald-200">
            Lesson complete{tookS !== undefined ? ` in ${formatDuration(tookS)}` : ''}. Reset to drill it again from a clean cluster.
          </div>
        )}
        <ol className="space-y-2">
          {lesson.steps.map((s, i) => (
            <Step key={s.id} step={s} n={i + 1} progress={learn.steps[i]} current={i === learn.current && session.state === 'running'} drill={drill} />
          ))}
        </ol>
      </div>
      <footer className="flex flex-wrap gap-2 border-t border-zinc-800 px-4 py-2.5">
        <Button
          disabled={complete || skipping || session.state !== 'running'}
          onClick={onSkip}
          title="Runs this step's command for you, so the next steps still work, and moves on"
        >
          {skipping ? 'Running it for you…' : 'Skip step'}
        </Button>
        <Button onClick={onReset}>Start over</Button>
        <Button variant="danger" className="ml-auto" onClick={onEnd}>
          End
        </Button>
      </footer>
    </section>
  );
}

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { isComplete, loadProgress, missionsNeeded, revisitIds, saveProgress, type TopicProgress } from './progress';
import type { QuizQuestion, SystemTopic } from './types';

export const card = 'rounded-xl border border-zinc-800 bg-zinc-900/60 p-4';
export const selectCls = 'rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-200';
export const btnCls = 'rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50';

/** Step / play / pause / reset over `total` steps. Reduced-motion: Play advances one step at a time manually. */
export function useStepper(total: number) {
  const [index, setIndex] = useState(-1); // -1 = nothing has happened yet
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  const stop = () => {
    setPlaying(false);
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  };
  const reset = () => {
    stop();
    setIndex(-1);
  };
  const step = () => setIndex((i) => Math.min(total - 1, i + 1));

  useEffect(() => stop, []);
  useEffect(() => {
    if (index >= total - 1) setPlaying(false);
  }, [index, total]);

  const play = () => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      step();
      return;
    }
    if (playing) {
      stop();
      return;
    }
    if (index >= total - 1) setIndex(-1);
    setPlaying(true);
    timer.current = window.setInterval(() => setIndex((i) => Math.min(total - 1, i + 1)), 1100);
  };

  return { index, playing, step, play, reset, done: index >= total - 1 };
}

export function StepControls({ s, total }: { s: ReturnType<typeof useStepper>; total: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Simulation playback">
      <button type="button" className={btnCls} onClick={s.step} disabled={s.done} aria-label="Step forward">
        Step →
      </button>
      <button type="button" className={btnCls} onClick={s.play} aria-label={s.playing ? 'Pause' : 'Play'}>
        {s.playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" className={btnCls} onClick={s.reset} aria-label="Reset simulation">
        Reset
      </button>
      <span className="text-xs text-zinc-500" aria-live="polite">
        {s.index < 0 ? 'Ready — step or play.' : `Step ${s.index + 1} of ${total}${s.done ? ' — done' : ''}`}
      </span>
    </div>
  );
}

export function EventLog({ entries, emptyText = 'Nothing yet. Step or play the simulation.' }: { entries: { label: string; detail: string }[]; emptyText?: string }) {
  return (
    <div className={card} aria-label="Event log">
      <h3 className="text-sm font-semibold text-zinc-200">Event log</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{emptyText}</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {entries.map((e, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium text-sky-300">{e.label}</span> <span className="text-zinc-400">— {e.detail}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Nodes({ nodes, active, down = [] }: { nodes: string[]; active?: string; down?: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Components">
      {nodes.map((n, i) => (
        <span key={n} className="flex items-center gap-2">
          <span
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              down.includes(n)
                ? 'border-red-800 bg-red-950/40 text-red-300 line-through'
                : active === n
                  ? 'border-sky-600 bg-sky-950/50 text-sky-100'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-300'
            }`}
            aria-current={active === n ? 'step' : undefined}
          >
            {n}
            {down.includes(n) && <span className="ml-1 text-xs no-underline"> (down)</span>}
          </span>
          {i < nodes.length - 1 && <span className="text-zinc-600" aria-hidden>→</span>}
        </span>
      ))}
    </div>
  );
}

function QuestionCard({
  q,
  saved,
  onAnswer,
}: {
  q: QuizQuestion;
  saved?: { selected: number; correct: boolean };
  onAnswer: (selected: number, correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<number | null>(saved?.selected ?? null);
  const [showHint, setShowHint] = useState(false);
  const answered = picked !== null;
  const correct = answered && picked === q.answer;
  return (
    <div className={card}>
      <p className="text-sm font-medium text-zinc-100">{q.prompt}</p>
      <div className="mt-3 space-y-2" role="radiogroup" aria-label={q.prompt}>
        {q.choices.map((c, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={picked === i}
            disabled={answered}
            onClick={() => {
              setPicked(i);
              onAnswer(i, i === q.answer);
            }}
            className={`block w-full rounded-md border px-3 py-2 text-left text-sm transition disabled:cursor-default ${
              answered && i === q.answer
                ? 'border-emerald-700 bg-emerald-950/40 text-emerald-100'
                : answered && i === picked
                  ? 'border-red-800 bg-red-950/40 text-red-100'
                  : picked === i
                    ? 'border-sky-700 bg-sky-950/40 text-sky-100'
                    : 'border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:border-zinc-600'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      {q.hint && !answered && (
        <button type="button" className="mt-2 text-xs text-sky-400 hover:text-sky-300" onClick={() => setShowHint((v) => !v)}>
          {showHint ? 'Hide hint' : 'Show hint'}
        </button>
      )}
      {showHint && !answered && <p className="mt-1 text-xs text-zinc-400">{q.hint}</p>}
      {answered && (
        <p className={`mt-3 text-sm ${correct ? 'text-emerald-300' : 'text-amber-200'}`} role="status">
          {correct ? 'Correct. ' : 'Not quite. '}
          {q.explain}
        </p>
      )}
    </div>
  );
}

export function SourceLinks({ topic }: { topic: SystemTopic }) {
  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-zinc-200">References</h3>
      <p className="mt-1 text-xs text-zinc-500">Original explanations above; go deeper in the sources. Karan Pratap Singh's repo is CC BY-NC-ND, so it is linked, not copied.</p>
      <ul className="mt-2 space-y-1">
        {topic.sourceReferences.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer" className="text-sm text-sky-400 hover:text-sky-300">
              {s.label} ↗
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ProgressApi {
  progress: TopicProgress;
  update: (change: (p: TopicProgress) => TopicProgress) => void;
}

const ProgressContext = createContext<ProgressApi | null>(null);

/** The current topic's saved progress, for sims that record missions and freeze frames. */
export function useTopicProgress(): ProgressApi {
  const api = useContext(ProgressContext);
  if (!api) throw new Error('useTopicProgress must be used inside SimShell');
  return api;
}

/** Objectives → concepts → prediction (gates the sim) → sim → recall → recap + sources. */
export function SimShell({ topic, children }: { topic: SystemTopic; children: ReactNode }) {
  const [progress, setProgress] = useState<TopicProgress>(() => loadProgress(topic.id));
  const update = (change: (p: TopicProgress) => TopicProgress) =>
    setProgress((prev) => {
      const next = change(prev);
      const full = { ...next, completed: isComplete(topic, next) };
      saveProgress(topic.id, full);
      return full;
    });
  const predictionDone = !!progress.prediction;
  const answeredCount = Object.keys(progress.answers).length;
  const score = Object.values(progress.answers).filter((a) => a.correct).length;
  const revisit = revisitIds(progress);
  const missions = topic.missions ?? [];
  const passed = missions.filter((m) => progress.missions[m.id]).length;

  return (
    <ProgressContext.Provider value={{ progress, update }}>
    <div className={`mx-auto space-y-5 ${missions.length ? 'max-w-6xl' : 'max-w-4xl'}`}>
      <div>
        <p className="text-xs tracking-wide text-indigo-400 uppercase">
          System Labs · {topic.level} · ~{topic.estimatedMinutes} min
        </p>
        <h1 className="mt-1 text-xl font-semibold text-zinc-100">{topic.title}</h1>
        <p className="mt-1 text-sm text-zinc-400">{topic.introduction}</p>
      </div>

      <div className={card}>
        <h2 className="text-sm font-semibold text-zinc-200">By the end you can</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
          {topic.learningObjectives.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
        {topic.prerequisites.length > 0 && <p className="mt-2 text-xs text-zinc-500">Builds on: {topic.prerequisites.join(', ')}</p>}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {topic.concepts.map((c) => (
          <div key={c.title} className={card}>
            <h3 className="text-sm font-semibold text-zinc-100">{c.title}</h3>
            <p className="mt-1 text-sm text-zinc-400">{c.body}</p>
          </div>
        ))}
      </div>

      <section aria-label="Predict" className="space-y-2">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">1 · Predict</h2>
        <QuestionCard
          q={topic.prediction}
          saved={progress.prediction}
          onAnswer={(selected, correct) => update((p) => ({ ...p, prediction: { selected, correct } }))}
        />
        {!predictionDone && <p className="text-xs text-zinc-500">Answer the prediction to unlock the simulation — guessing wrong is part of it.</p>}
      </section>

      <section aria-label="Simulate" className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">2 · Simulate</h2>
        <fieldset disabled={!predictionDone} className={!predictionDone ? 'pointer-events-none opacity-50' : undefined}>
          {children}
        </fieldset>
      </section>

      <section aria-label="Recall" className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">3 · Recall</h2>
        {topic.quiz.map((q) => (
          <QuestionCard
            key={q.id}
            q={q}
            saved={progress.answers[q.id]}
            onAnswer={(selected, correct) => update((p) => ({ ...p, answers: { ...p.answers, [q.id]: { selected, correct } } }))}
          />
        ))}
        {answeredCount > 0 && (
          <p className="text-sm text-zinc-300" role="status">
            Score so far: {score} of {answeredCount} answered
            {progress.completed ? ' — topic complete.' : '.'}
            {revisit.length > 0 && <span className="text-amber-300"> Revisit: {revisit.join(', ')}.</span>}
          </p>
        )}
        {missions.length > 0 && !progress.completed && (
          <p className="text-xs text-zinc-500">
            Missions passed: {passed} of {missions.length}. Completing the topic takes every recall question and {missionsNeeded(topic)} missions.
          </p>
        )}
      </section>

      <div className={card}>
        <h2 className="text-sm font-semibold text-zinc-200">Recap</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
          {topic.recap.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <SourceLinks topic={topic} />
    </div>
    </ProgressContext.Provider>
  );
}

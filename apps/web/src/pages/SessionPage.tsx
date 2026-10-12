import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SessionView } from '@cka/schema';
import { api } from '../api';
import { ConnectionPanel } from '../components/ConnectionPanel';
import { GradeResultView } from '../components/GradeResultView';
import { ReferencePanel } from '../components/ReferencePanel';
import { Button, buttonClass, Card, ErrorBanner, Markdown, StateBadge } from '../components/ui';
import { formatDuration, sessionKey, useNow, useSession } from '../hooks';

const TerminalPanel = lazy(() => import('../components/Terminal').then((m) => ({ default: m.TerminalPanel })));

function Stopwatch({ session }: { session: SessionView }) {
  const now = useNow();
  if (!session.readyAt) return <span className="font-mono text-2xl text-zinc-600">--:--</span>;
  const end = session.endedAt ? Date.parse(session.endedAt) : now;
  return <span className="font-mono text-2xl text-zinc-100 tabular-nums">{formatDuration((end - Date.parse(session.readyAt)) / 1000)}</span>;
}

function ProgressLog({ session, compact }: { session: SessionView; compact?: boolean }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [session.progress.length]);
  return (
    <ol ref={ref} className={`space-y-1 overflow-y-auto font-mono text-xs ${compact ? 'max-h-40' : 'max-h-80'}`}>
      {session.progress.map((p, i) => (
        <li key={i} className="flex gap-3">
          <span className="shrink-0 text-zinc-600">{new Date(p.at).toLocaleTimeString()}</span>
          <span className={i === session.progress.length - 1 && session.state === 'provisioning' ? 'text-amber-300' : 'text-zinc-400'}>
            {p.message}
          </span>
        </li>
      ))}
    </ol>
  );
}

const FOCUS_KEY = 'cka.focus';

/** Question tabs for multi-task scenarios; renders nothing for a single task. */
function QuestionTabs({ session, active, onSelect }: { session: SessionView; active: number; onSelect: (i: number) => void }) {
  if (session.tasks.length < 2) return null;
  const scores = new Map(session.lastGrade?.tasks?.map((t) => [t.id, t]));
  return (
    <div className="flex flex-wrap gap-1.5">
      {session.tasks.map((t, i) => {
        const s = scores.get(t.id);
        const mark = s ? (s.score === s.maxScore ? 'bg-emerald-400' : s.score > 0 ? 'bg-amber-400' : 'bg-red-400') : undefined;
        return (
          <button
            key={t.id}
            title={t.title}
            onClick={() => onSelect(i)}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition ${
              i === active
                ? 'border-sky-700 bg-sky-950/60 text-sky-100'
                : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            }`}
          >
            {mark && <span className={`h-1.5 w-1.5 rounded-full ${mark}`} />}
            Q{i + 1} · {t.points} pt
          </button>
        );
      })}
    </div>
  );
}

/** The active task's text and its revealed hints. */
function TaskBody({ session, active }: { session: SessionView; active: number }) {
  const task = session.tasks[active];
  if (!task) return <div className="text-zinc-500">Loading task…</div>;
  const multi = session.tasks.length > 1;
  return (
    <div className="space-y-4">
      {multi && (
        <div>
          <h3 className="font-semibold text-zinc-100">
            Question {active + 1}: {task.title}
          </h3>
          {task.context && <div className="mt-0.5 font-mono text-xs text-zinc-500">context {task.context}</div>}
        </div>
      )}
      <Markdown>{task.markdown}</Markdown>
      {task.hintsRevealed.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            Hints ({task.hintsRevealed.length}/{task.hintsTotal})
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
            {task.hintsRevealed.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** Left side of focus mode: everything needed to work through the task next to the terminal. */
function TaskPane(props: {
  session: SessionView;
  active: number;
  onSelect: (i: number) => void;
  grading: boolean;
  canGrade: boolean;
  canHint: boolean;
  onGrade: () => void;
  onHint: () => void;
  error: unknown;
}) {
  const { session } = props;
  const task = session.tasks[props.active];
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
      <header className="space-y-2 border-b border-zinc-800 px-4 py-2.5">
        <h1 className="truncate font-semibold text-zinc-100" title={session.scenarioTitle}>
          {session.scenarioTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Stopwatch session={session} />
          <div className="ml-auto flex gap-2">
            <Button variant="primary" shortcut="g" disabled={!props.canGrade} onClick={props.onGrade}>
              {props.grading ? 'Grading…' : 'Grade'}
            </Button>
            <Button shortcut="h" disabled={!props.canHint} onClick={props.onHint}>
              Hint {task?.hintsRevealed.length ?? 0}/{task?.hintsTotal ?? 0}
            </Button>
          </div>
        </div>
        <QuestionTabs session={session} active={props.active} onSelect={props.onSelect} />
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <ErrorBanner error={props.error} />
        {props.grading && <div className="text-sm text-sky-300">Grading… unmet checks are retried for up to 30 seconds.</div>}
        <TaskBody session={session} active={props.active} />
        {session.solution && (
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-amber-400 uppercase">Solution</h2>
            <Markdown>{session.solution}</Markdown>
          </div>
        )}
        {session.lastGrade && (
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Result</h2>
            <GradeResultView result={session.lastGrade} />
          </div>
        )}
      </div>
    </section>
  );
}

/** Shown after End: final score and a way to retry. */
function EndedSummary({ ended, onDismiss }: { ended: SessionView; onDismiss: () => void }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => api.start(ended.scenarioId),
    onSuccess: (view) => {
      qc.setQueryData(sessionKey, view);
      onDismiss();
    },
  });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card title="Session ended">
        <h2 className="mb-4 text-xl font-semibold text-zinc-100">{ended.scenarioTitle}</h2>
        {ended.lastGrade ? (
          <GradeResultView result={ended.lastGrade} />
        ) : (
          <p className="text-sm text-zinc-400">The session ended without being graded.</p>
        )}
        <div className="mt-3 text-xs text-zinc-500">
          {ended.hintsRevealed.length} hint{ended.hintsRevealed.length === 1 ? '' : 's'} used
          {ended.solutionViewed && ' · solution viewed (assisted)'}
        </div>
        <ErrorBanner error={retry.error} />
        <div className="mt-5 flex gap-2">
          <Button variant="primary" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? 'Starting…' : 'Retry scenario'}
          </Button>
          <Link to="/" className={buttonClass()}>
            Back to scenarios
          </Link>
          <Link to="/history" className={buttonClass('ghost')}>
            History
          </Link>
        </div>
      </Card>
    </div>
  );
}

export function SessionPage() {
  const qc = useQueryClient();
  const { data: session, isLoading } = useSession();
  const [ended, setEnded] = useState<SessionView | null>(null);
  const scenario = useQuery({
    queryKey: ['scenario', session?.scenarioId],
    queryFn: () => api.scenario(session!.scenarioId),
    enabled: !!session,
  });

  const setSession = (v: SessionView | null) => qc.setQueryData(sessionKey, v);
  const grade = useMutation({ mutationFn: api.grade });
  const hint = useMutation({ mutationFn: api.hint, onSuccess: setSession });
  const solution = useMutation({ mutationFn: api.solution, onSuccess: setSession });
  const reset = useMutation({ mutationFn: api.reset, onSuccess: setSession });
  const end = useMutation({
    mutationFn: api.end,
    onSuccess: (v) => {
      setEnded(v);
      setSession(null);
    },
  });
  const mutations = [grade, hint, solution, reset, end];
  const error = mutations.find((m) => m.error)?.error;

  const [activeTask, setActiveTask] = useState(0);
  const tasksKey = session ? `${session.id}:${session.tasks.length}` : '';
  useEffect(() => setActiveTask(0), [tasksKey]);
  const task = session?.tasks[activeTask] ?? session?.tasks[0];

  const state = session?.state;
  const canGrade = state === 'running' && !grade.isPending;
  const canHint =
    (state === 'running' || state === 'grading') && !!task && task.hintsRevealed.length < task.hintsTotal && session?.mode === 'practice';
  const canReset = state === 'running' || state === 'failed';
  const canSolution = !!session && session.mode === 'practice' && !session.solutionViewed && !!scenario.data?.hasSolution && state !== 'provisioning';

  const doReset = () => {
    if (canReset && confirm('Reset the lab? The snapshot is restored and your changes are lost.')) reset.mutate();
  };
  const doSolution = () => {
    if (canSolution && confirm('Reveal the solution? This attempt will be marked as assisted.')) solution.mutate();
  };
  const doEnd = () => {
    if (confirm('End the session and stop the lab VMs?')) end.mutate();
  };

  const handlers = useRef({ grade: () => {}, hint: () => {}, reset: () => {} });
  handlers.current = {
    grade: () => canGrade && grade.mutate(),
    hint: () => canHint && hint.mutate(task?.id),
    reset: doReset,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.metaKey || e.ctrlKey || e.altKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'g') handlers.current.grade();
      if (e.key === 'h') handlers.current.hint();
      if (e.key === 'r') handlers.current.reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [focus, setFocus] = useState(() => localStorage.getItem(FOCUS_KEY) === '1');
  const live = state === 'running' || state === 'grading';
  const focusActive = focus && live && !!session?.connection;
  useEffect(() => {
    localStorage.setItem(FOCUS_KEY, focus ? '1' : '0');
  }, [focus]);
  useEffect(() => {
    if (!focusActive) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = prev;
    };
  }, [focusActive]);

  if (ended && !session) return <EndedSummary ended={ended} onDismiss={() => setEnded(null)} />;
  if (isLoading) return <div className="text-zinc-500">Loading…</div>;
  if (!session) {
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <p className="mb-4 text-zinc-400">No active session.</p>
        <Link to="/" className={buttonClass('primary')}>
          Choose a scenario
        </Link>
      </div>
    );
  }

  const lastGrade = session.lastGrade;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div className="min-w-64 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-lg font-semibold text-zinc-100">{session.scenarioTitle}</h1>
            <StateBadge state={session.state} />
          </div>
          <div className="mt-0.5 font-mono text-xs text-zinc-500">
            {session.scenarioId} · {session.mode}
            {scenario.data && ` · ${scenario.data.points} pts · ~${scenario.data.estimatedMinutes} min`}
          </div>
        </div>
        <Stopwatch session={session} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" shortcut="g" disabled={!canGrade} onClick={() => grade.mutate()}>
            {state === 'grading' ? 'Grading…' : 'Grade'}
          </Button>
          <Button shortcut="h" disabled={!canHint} onClick={() => hint.mutate(task?.id)}>
            Hint {task?.hintsRevealed.length ?? 0}/{task?.hintsTotal ?? 0}
          </Button>
          <Button shortcut="r" disabled={!canReset || reset.isPending} onClick={doReset}>
            Reset
          </Button>
          <Button disabled={!canSolution} onClick={doSolution}>
            Solution
          </Button>
          <Button variant="danger" disabled={end.isPending} onClick={doEnd}>
            {end.isPending ? 'Ending…' : 'End'}
          </Button>
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => mutations.forEach((m) => m.reset())} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {live && session.connection && (
            <div
              className={
                focusActive
                  ? 'fixed inset-x-0 top-0 z-40 grid h-dvh grid-cols-[minmax(320px,38%)_minmax(0,1fr)] gap-3 bg-zinc-950 p-3'
                  : ''
              }
            >
              {focusActive && (
                <TaskPane
                  key="task"
                  session={session}
                  active={activeTask}
                  onSelect={setActiveTask}
                  grading={state === 'grading' || grade.isPending}
                  canGrade={canGrade}
                  canHint={canHint}
                  onGrade={() => grade.mutate()}
                  onHint={() => hint.mutate(task?.id)}
                  error={error}
                />
              )}
              <Suspense key="terminal" fallback={<div className="text-sm text-zinc-500">Loading terminal…</div>}>
                <TerminalPanel
                  key={`${session.id}-${session.readyAt}`}
                  session={session}
                  fullscreen={focusActive}
                  onToggleFullscreen={() => setFocus((f) => !f)}
                />
              </Suspense>
            </div>
          )}

          {session.state === 'failed' && (
            <Card title="Session failed" className="border-red-900">
              <p className="mb-3 text-sm whitespace-pre-wrap text-red-300">{session.error}</p>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => reset.mutate()} disabled={reset.isPending}>
                  Reset and retry
                </Button>
                <Button variant="danger" onClick={() => end.mutate()}>
                  End session
                </Button>
              </div>
            </Card>
          )}

          {session.state === 'provisioning' && (
            <Card title="Preparing the lab">
              <ProgressLog session={session} />
            </Card>
          )}

          {(session.state === 'grading' || grade.isPending) && (
            <div className="rounded-xl border border-sky-900 bg-sky-950/30 px-4 py-3 text-sm text-sky-200">
              Grading… checks that are not yet satisfied are retried for up to 30 seconds.
            </div>
          )}

          {lastGrade && (
            <Card title="Result">
              <GradeResultView result={lastGrade} />
            </Card>
          )}

          <Card title={session.tasks.length > 1 ? `Tasks (${session.tasks.length} questions)` : 'Task'}>
            <div className="space-y-4">
              <QuestionTabs session={session} active={activeTask} onSelect={setActiveTask} />
              <TaskBody session={session} active={activeTask} />
            </div>
          </Card>

          {session.solution && (
            <Card title="Solution" className="border-amber-900/60">
              <Markdown>{session.solution}</Markdown>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <ConnectionPanel session={session} />
          {session.state !== 'provisioning' && session.progress.length > 0 && (
            <Card title="Provisioning log">
              <ProgressLog session={session} compact />
            </Card>
          )}
          <ReferencePanel />
        </aside>
      </div>
    </div>
  );
}

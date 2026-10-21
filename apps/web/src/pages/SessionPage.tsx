import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SessionView } from '@cka/schema';
import { api } from '../api';
import { ConnectionPanel } from '../components/ConnectionPanel';
import { GradeResultView } from '../components/GradeResultView';
import { LessonPane } from '../components/LessonPane';
import { ReferencePanel } from '../components/ReferencePanel';
import { SPLIT_MIN_PX, SplitHandle, useSplit } from '../components/SplitHandle';
import { Button, buttonClass, Card, ErrorBanner, Markdown, StateBadge } from '../components/ui';
import { formatDuration, sessionKey, useBlindGrading, useNow, useSession } from '../hooks';
import { SECTIONS, useSection } from '../section';

const TerminalPanel = lazy(() => import('../components/Terminal').then((m) => ({ default: m.TerminalPanel })));

const WARN_MS = 15 * 60_000;
const CRITICAL_MS = 5 * 60_000;

/** Exam mode: time left until the deadline, amber under 15 minutes and red under 5. */
function Countdown({ session }: { session: SessionView }) {
  const now = useNow();
  if (!session.deadlineAt) return <span className="font-mono text-2xl text-zinc-600">--:--</span>;
  const left = Date.parse(session.deadlineAt) - now;
  const color = left <= CRITICAL_MS ? 'text-red-400' : left <= WARN_MS ? 'text-amber-300' : 'text-zinc-100';
  return (
    <span className={`font-mono text-2xl tabular-nums ${color}`} title="Time left; the exam is submitted automatically at 0:00">
      {formatDuration(left / 1000)}
    </span>
  );
}

/** One-off warnings when 15 and 5 minutes are left; each can be dismissed. */
function ExamWarning({ session }: { session: SessionView }) {
  const now = useNow();
  const [dismissed, setDismissed] = useState(0);
  if (!session.deadlineAt) return null;
  const left = Date.parse(session.deadlineAt) - now;
  const level = left <= CRITICAL_MS ? CRITICAL_MS : left <= WARN_MS ? WARN_MS : 0;
  if (!level || dismissed === level) return null;
  const critical = level === CRITICAL_MS;
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm ${
        critical ? 'border-red-800 bg-red-950/40 text-red-200' : 'border-amber-800 bg-amber-950/40 text-amber-200'
      }`}
    >
      <span>
        {critical ? '5 minutes left.' : '15 minutes left.'} The exam is submitted automatically when the timer reaches 0:00.
      </span>
      <button className="ml-auto text-xs opacity-70 hover:opacity-100" onClick={() => setDismissed(level)}>
        Dismiss
      </button>
    </div>
  );
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
          <span
            className={i === session.progress.length - 1 && (session.state === 'provisioning' || session.preparingTask) ? 'text-amber-300' : 'text-zinc-400'}
          >
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
  const scores = new Map(session.mode === 'mock' ? [] : session.lastGrade?.tasks?.map((t) => [t.id, t]));
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
              i === active ? 'border-sky-700 bg-sky-950/60 text-sky-100' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            }`}
          >
            {mark && <span className={`h-1.5 w-1.5 rounded-full ${mark}`} />}Q{i + 1} · {t.points} pt
          </button>
        );
      })}
    </div>
  );
}

/** Shown instead of a task's text until its deferred setup has run. */
function PreparingTask({ session, active, onOpen }: { session: SessionView; active: number; onOpen: () => void }) {
  if (!session.preparingTask) {
    return (
      <div className="space-y-3 text-sm text-zinc-400">
        <p>This question is set up when you start it.</p>
        <Button variant="primary" disabled={session.state !== 'running'} onClick={onOpen}>
          Set up question {active + 1}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-amber-300">Preparing question {active + 1}… the terminal stays usable meanwhile.</p>
      <ProgressLog session={{ ...session, progress: session.progress.slice(-4) }} compact />
    </div>
  );
}

/** The active task's text and its revealed hints. */
function TaskBody({ session, active, onOpen }: { session: SessionView; active: number; onOpen: () => void }) {
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
      {task.ready ? <Markdown>{task.markdown}</Markdown> : <PreparingTask session={session} active={active} onOpen={onOpen} />}
      {session.mode !== 'mock' && task.hintsRevealed.length > 0 && (
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
  onOpen: () => void;
  grading: boolean;
  canGrade: boolean;
  canHint: boolean;
  onGrade: () => void;
  onHint: () => void;
  canSubmit: boolean;
  onSubmit: () => void;
  error: unknown;
  blind: boolean;
}) {
  const { session } = props;
  const task = session.tasks[props.active];
  const exam = session.mode === 'mock';
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
      <header className="space-y-2 border-b border-zinc-800 px-4 py-2.5">
        <h1 className="truncate font-semibold text-zinc-100" title={session.scenarioTitle}>
          {session.scenarioTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {exam && <Countdown session={session} />}
          <div className="ml-auto flex gap-2">
            {exam ? (
              <Button variant="primary" disabled={!props.canSubmit} onClick={props.onSubmit}>
                {props.grading ? 'Submitting…' : 'Submit exam'}
              </Button>
            ) : (
              <>
                <Button variant="primary" shortcut="g" disabled={!props.canGrade} onClick={props.onGrade}>
                  {props.grading ? 'Grading…' : 'Grade'}
                </Button>
                <Button shortcut="h" disabled={!props.canHint} onClick={props.onHint}>
                  Hint {task?.hintsRevealed.length ?? 0}/{task?.hintsTotal ?? 0}
                </Button>
              </>
            )}
          </div>
        </div>
        <QuestionTabs session={session} active={props.active} onSelect={props.onSelect} />
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <ErrorBanner error={props.error} />
        {exam && <ExamWarning session={session} />}
        {props.grading && (
          <div className="text-sm text-sky-300">
            {exam ? 'Submitting… your answers are being checked.' : 'Grading… unmet checks are retried for up to 30 seconds.'}
          </div>
        )}
        <TaskBody session={session} active={props.active} onOpen={props.onOpen} />
        {!exam && session.solution && (
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-amber-400 uppercase">Solution</h2>
            <Markdown>{session.solution}</Markdown>
          </div>
        )}
        {!exam && session.lastGrade && (
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Result</h2>
            <GradeResultView result={session.lastGrade} blind={props.blind} />
          </div>
        )}
      </div>
    </section>
  );
}

/** Shown after End: final score and a way to retry. */
function EndedSummary({ ended, onDismiss }: { ended: SessionView; onDismiss: () => void }) {
  const qc = useQueryClient();
  const playground = ended.mode === 'playground';
  const exam = ended.mode === 'mock';
  const lesson = ended.mode === 'learn' ? ended.lesson : undefined;
  const retry = useMutation({
    mutationFn: () =>
      playground ? api.startPlayground() : lesson ? api.startLesson(lesson.id) : api.start(ended.scenarioId, exam ? 'mock' : 'practice'),
    onSuccess: (view) => {
      qc.setQueryData(sessionKey, view);
      onDismiss();
    },
  });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card title={playground ? 'Playground ended' : lesson ? 'Lesson ended' : exam ? 'Exam result' : 'Session ended'}>
        <h2 className="mb-4 text-xl font-semibold text-zinc-100">{ended.scenarioTitle}</h2>
        {playground ? (
          <p className="text-sm text-zinc-400">The lab VMs are stopped. A new playground starts from a clean cluster.</p>
        ) : lesson ? (
          <p className="text-sm text-zinc-400">
            {ended.learn?.steps.filter((st) => st.done && !st.skipped).length ?? 0} of {lesson.steps.length} steps done. The lab VMs are stopped.
          </p>
        ) : (
          <>
            {ended.lastGrade ? (
              <GradeResultView result={ended.lastGrade} />
            ) : (
              <p className="text-sm text-zinc-400">{exam ? 'The exam ended without being submitted.' : 'The session ended without being graded.'}</p>
            )}
            <div className="mt-3 text-xs text-zinc-500">
              {exam && ended.readyAt && ended.endedAt ? (
                `exam mode · finished in ${formatDuration((Date.parse(ended.endedAt) - Date.parse(ended.readyAt)) / 1000)}`
              ) : (
                <>
                  {ended.hintsRevealed.length} hint{ended.hintsRevealed.length === 1 ? '' : 's'} used
                  {ended.solutionViewed && ' · solution viewed (assisted)'}
                </>
              )}
            </div>
          </>
        )}
        <ErrorBanner error={retry.error} />
        <div className="mt-5 flex gap-2">
          <Button variant="primary" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? 'Starting…' : playground ? 'Start a new playground' : lesson ? 'Drill it again' : exam ? 'Retake exam' : 'Retry scenario'}
          </Button>
          <Link to={lesson ? `${SECTIONS[lesson.track].base}/learn` : '/'} className={buttonClass()}>
            {lesson ? 'Back to lessons' : 'Back to scenarios'}
          </Link>
          {lesson?.track !== 'linux' && (
            <Link to="/history" className={buttonClass('ghost')}>
              History
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}

export function SessionPage() {
  const qc = useQueryClient();
  const section = useSection();
  const { data: session, isLoading } = useSession();
  const [ended, setEnded] = useState<SessionView | null>(null);
  const [blindSetting] = useBlindGrading();
  const playground = session?.mode === 'playground';
  const learn = session?.mode === 'learn';
  const scenario = useQuery({
    queryKey: ['scenario', session?.scenarioId],
    queryFn: () => api.scenario(session!.scenarioId),
    enabled: !!session && !playground && !learn,
  });

  const setSession = (v: SessionView | null) => qc.setQueryData(sessionKey, v);
  const grade = useMutation({ mutationFn: api.grade });
  const hint = useMutation({ mutationFn: api.hint, onSuccess: setSession });
  const solution = useMutation({ mutationFn: api.solution, onSuccess: setSession });
  const reset = useMutation({ mutationFn: api.reset, onSuccess: setSession });
  const reroll = useMutation({ mutationFn: api.reroll, onSuccess: setSession });
  const end = useMutation({
    mutationFn: api.end,
    onSuccess: (v) => {
      setEnded(v);
      setSession(null);
    },
  });
  const submit = useMutation({
    mutationFn: api.submit,
    onSuccess: (v) => {
      setEnded(v);
      setSession(null);
    },
  });
  const openTask = useMutation({ mutationFn: api.openTask, onSuccess: setSession });
  const skip = useMutation({ mutationFn: api.skipStep, onSuccess: setSession });
  const mutations = [grade, hint, solution, reset, reroll, end, submit, openTask, skip];
  const error = mutations.find((m) => m.error)?.error;

  const [activeTask, setActiveTask] = useState(0);
  const tasksKey = session ? `${session.id}:${session.tasks.length}` : '';
  useEffect(() => setActiveTask(0), [tasksKey]);
  const task = session?.tasks[activeTask] ?? session?.tasks[0];

  const state = session?.state;
  const openActive = () => task && !task.ready && state === 'running' && openTask.mutate(task.id);
  const selectTask = (i: number) => {
    setActiveTask(i);
    const t = session?.tasks[i];
    if (t && !t.ready && state === 'running') openTask.mutate(t.id);
  };
  const exam = session?.mode === 'mock';
  const canGrade = state === 'running' && !grade.isPending && !session?.preparingTask && !playground && !learn && !exam;
  const canHint = (state === 'running' || state === 'grading') && !!task && task.hintsRevealed.length < task.hintsTotal && session?.mode === 'practice';
  const canReset = exam ? state === 'failed' : state === 'running' || state === 'failed';
  const canSolution = !!session && session.mode === 'practice' && !session.solutionViewed && !!scenario.data?.hasSolution && state !== 'provisioning';
  const canSubmit = exam && state === 'running' && !submit.isPending;

  const doReset = () => {
    if (canReset && confirm('Reset the lab? The snapshot is restored and your changes are lost.')) reset.mutate();
  };
  const canReroll = !!session?.rerollable && (state === 'running' || state === 'failed') && !reroll.isPending && !reset.isPending;
  const doReroll = () => {
    if (canReroll && confirm('Roll a new variant? The snapshot is restored and a different version of the question is set up.')) reroll.mutate();
  };
  const doSolution = () => {
    if (canSolution && confirm('Reveal the solution? This attempt will be marked as assisted.')) solution.mutate();
  };
  const doEnd = () => {
    const msg = exam ? 'Abandon the exam without a score and stop the lab VMs?' : 'End the session and stop the lab VMs?';
    if (confirm(msg)) end.mutate();
  };
  const doSubmit = () => {
    if (canSubmit && confirm('Submit the exam? Your answers are checked once and the lab VMs are stopped.')) submit.mutate();
  };

  const autoSubmitted = useRef<string | null>(null);
  const submitNow = useRef(() => {});
  submitNow.current = () => {
    if (!session || autoSubmitted.current === session.id || session.state !== 'running' || session.preparingTask || submit.isPending) return;
    autoSubmitted.current = session.id;
    submit.mutate(undefined, { onError: () => (autoSubmitted.current = null) });
  };
  const deadlineAt = session?.deadlineAt;
  useEffect(() => {
    if (!deadlineAt) return;
    const t = setTimeout(() => submitNow.current(), Math.max(0, Date.parse(deadlineAt) - Date.now()));
    return () => clearTimeout(t);
  }, [deadlineAt, state, session?.preparingTask]);

  const handlers = useRef({ grade: () => {}, hint: () => {}, reset: () => {} });
  handlers.current = {
    grade: () => !exam && canGrade && grade.mutate(),
    hint: () => !exam && canHint && hint.mutate(task?.id),
    reset: () => !exam && doReset(),
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
  const focusActive = (focus || learn) && live && !!session?.connection;
  const [split, setSplit] = useSplit();
  const focusRef = useRef<HTMLDivElement>(null);
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
        <Link to={section === 'linux' ? '/linux/learn' : '/'} className={buttonClass('primary')}>
          {section === 'linux' ? 'Choose a lesson' : 'Choose a scenario'}
        </Link>
      </div>
    );
  }

  const lastGrade = session.lastGrade;
  // Blind practice grading: check names stay hidden until the solution is shown.
  const blind = blindSetting && session.mode === 'practice' && !session.solutionViewed;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div className="min-w-64 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-lg font-semibold text-zinc-100">{session.scenarioTitle}</h1>
            <StateBadge state={session.state} />
          </div>
          <div className="mt-0.5 font-mono text-xs text-zinc-500">
            {playground ? (
              'free practice · nothing is graded'
            ) : learn ? (
              'lesson · follow the steps in the terminal'
            ) : (
              <>
                {session.scenarioId} · {exam ? 'exam' : session.mode}
                {scenario.data && ` · ${scenario.data.points} pts · ~${scenario.data.estimatedMinutes} min`}
              </>
            )}
          </div>
        </div>
        {exam && <Countdown session={session} />}
        <div className="flex flex-wrap gap-2">
          {exam && (
            <Button variant="primary" disabled={!canSubmit} onClick={doSubmit}>
              {submit.isPending || state === 'grading' ? 'Submitting…' : 'Submit exam'}
            </Button>
          )}
          {!playground && !learn && !exam && (
            <>
              <Button variant="primary" shortcut="g" disabled={!canGrade} onClick={() => grade.mutate()}>
                {state === 'grading' ? 'Grading…' : 'Grade'}
              </Button>
              <Button shortcut="h" disabled={!canHint} onClick={() => hint.mutate(task?.id)}>
                Hint {task?.hintsRevealed.length ?? 0}/{task?.hintsTotal ?? 0}
              </Button>
            </>
          )}
          {!exam && (
            <Button shortcut="r" disabled={!canReset || reset.isPending} onClick={doReset}>
              Reset
            </Button>
          )}
          {session.rerollable && (
            <Button disabled={!canReroll} onClick={doReroll} title="Restore the snapshot and set up a different variant of this question">
              {reroll.isPending ? 'Rolling…' : 'New variant'}
            </Button>
          )}
          {!playground && !learn && !exam && (
            <Button disabled={!canSolution} onClick={doSolution}>
              Solution
            </Button>
          )}
          <Button variant="danger" disabled={end.isPending || submit.isPending} onClick={doEnd}>
            {end.isPending ? 'Ending…' : exam ? 'Abandon' : 'End'}
          </Button>
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => mutations.forEach((m) => m.reset())} />
      {exam && !focusActive && <ExamWarning session={session} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {live && session.connection && (
            <div
              ref={focusRef}
              className={focusActive ? 'fixed inset-x-0 top-0 z-40 grid h-dvh bg-zinc-950 p-3' : ''}
              style={
                focusActive
                  ? { gridTemplateColumns: playground ? 'minmax(0,1fr)' : `minmax(${SPLIT_MIN_PX}px,${split}%) 12px minmax(0,1fr)` }
                  : undefined
              }
            >
              {focusActive && learn && (
                <LessonPane
                  key="lesson"
                  session={session}
                  onSkip={() => skip.mutate()}
                  skipping={skip.isPending}
                  onReset={doReset}
                  onEnd={doEnd}
                  error={error}
                />
              )}
              {focusActive && !playground && !learn && (
                <TaskPane
                  key="task"
                  session={session}
                  active={activeTask}
                  onSelect={selectTask}
                  onOpen={openActive}
                  grading={state === 'grading' || grade.isPending || submit.isPending}
                  canGrade={canGrade}
                  canHint={canHint}
                  onGrade={() => grade.mutate()}
                  onHint={() => hint.mutate(task?.id)}
                  canSubmit={canSubmit}
                  onSubmit={doSubmit}
                  blind={blind}
                  error={error}
                />
              )}
              {focusActive && !playground && <SplitHandle key="split" container={focusRef} value={split} onChange={setSplit} />}
              <Suspense key="terminal" fallback={<div className="text-sm text-zinc-500">Loading terminal…</div>}>
                <TerminalPanel
                  key={`${session.id}-${session.readyAt}`}
                  session={session}
                  fullscreen={focusActive}
                  onToggleFullscreen={learn ? undefined : () => setFocus((f) => !f)}
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

          {(session.state === 'grading' || grade.isPending || submit.isPending) && (
            <div className="rounded-xl border border-sky-900 bg-sky-950/30 px-4 py-3 text-sm text-sky-200">
              {exam
                ? 'Submitting… your answers are being checked, then the lab VMs are stopped.'
                : 'Grading… checks that are not yet satisfied are retried for up to 30 seconds.'}
            </div>
          )}

          {lastGrade && !exam && (
            <Card title="Result">
              <GradeResultView result={lastGrade} blind={blind} />
            </Card>
          )}

          {!playground && !learn && (
            <Card title={session.tasks.length > 1 ? `Tasks (${session.tasks.length} questions)` : 'Task'}>
              <div className="space-y-4">
                <QuestionTabs session={session} active={activeTask} onSelect={selectTask} />
                <TaskBody session={session} active={activeTask} onOpen={openActive} />
              </div>
            </Card>
          )}

          {session.solution && !exam && (
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
          {!exam && <ReferencePanel />}
        </aside>
      </div>
    </div>
  );
}

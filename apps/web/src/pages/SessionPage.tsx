import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SessionView } from '@cka/schema';
import { api, studioApi } from '../api';
import { AttemptReviewView } from '../components/AttemptReviewView';
import { GradeResultView } from '../components/GradeResultView';
import { LessonPane } from '../components/LessonPane';
import { ReferencePanel } from '../components/ReferencePanel';
import { SPLIT_MIN_PX, SplitHandle, useSplit } from '../components/SplitHandle';
import { BarButton, Button, buttonClass, Card, ErrorBanner, Markdown, StateBadge } from '../components/ui';
import { formatDuration, sessionKey, useBlindGrading, useNow, useSession } from '../hooks';
import { SECTIONS, useSection } from '../section';

const TerminalPanel = lazy(() => import('../components/Terminal').then((m) => ({ default: m.TerminalPanel })));

const WARN_MS = 15 * 60_000;
const CRITICAL_MS = 5 * 60_000;

/** Exam mode: time left until the deadline, amber under 15 minutes and red under 5. Stands still while paused. */
function Countdown({ session }: { session: SessionView }) {
  useNow();
  // The time at render, not at the last tick: a resumed exam goes on from exactly what it showed while paused.
  const left = session.pausedAt ? session.timeLeftMs : session.deadlineAt ? Date.parse(session.deadlineAt) - Date.now() : undefined;
  if (left === undefined) return <span className="font-mono text-2xl text-zinc-600">--:--</span>;
  const color = session.pausedAt ? 'text-zinc-500' : left <= CRITICAL_MS ? 'text-red-400' : left <= WARN_MS ? 'text-amber-300' : 'text-zinc-100';
  return (
    <span
      className={`font-mono text-2xl tabular-nums ${color}`}
      title={session.pausedAt ? 'Time left; the clock is stopped while the exam is paused' : 'Time left; the exam is submitted automatically at 0:00'}
    >
      {formatDuration(left / 1000)}
    </span>
  );
}

const PauseIcon = () => (
  <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
    <rect x="2" y="1.5" width="3" height="9" rx="0.75" fill="currentColor" />
    <rect x="7" y="1.5" width="3" height="9" rx="0.75" fill="currentColor" />
  </svg>
);

const ResumeIcon = () => (
  <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
    <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
  </svg>
);

/** Exam mode, while paused: the time left and the way back, in place of the question. */
function PausedExam({ session, resuming, onResume }: { session: SessionView; resuming: boolean; onResume: () => void }) {
  const now = useNow();
  const since = new Date(session.pausedAt!);
  const at = since.toDateString() === new Date(now).toDateString() ? since.toLocaleTimeString() : since.toLocaleString();
  return (
    <div className="flex flex-col items-center gap-5 py-10 text-center">
      <div>
        <div className="font-mono text-5xl text-zinc-100 tabular-nums">{formatDuration((session.timeLeftMs ?? 0) / 1000)}</div>
        <div className="mt-1 text-sm text-zinc-400">left on the clock</div>
      </div>
      <Button variant="primary" className="px-5 py-2 text-base" disabled={resuming || session.state !== 'running'} onClick={onResume}>
        <ResumeIcon />
        {resuming ? 'Checking the lab…' : 'Resume exam'}
      </Button>
      <div className="space-y-1 text-xs text-zinc-500">
        <p>
          Paused at {at}, {formatDuration((now - since.getTime()) / 1000)} ago
          {session.pausedS ? ` · ${formatDuration(session.pausedS)} in earlier pauses` : ''}
        </p>
        <p className="max-w-md">
          The questions and the terminal are hidden until you resume.{' '}
          {session.base === 'floci'
            ? "The lab's AWS resources stay as they are."
            : 'The lab VMs keep running; on resume they are checked and their clocks synced before the timer restarts.'}
        </p>
      </div>
    </div>
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
    <ol ref={ref} className={`space-y-1 overflow-y-auto font-mono text-xs ${compact ? 'max-h-40' : 'h-full'}`}>
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

/** Left side of a session: the task, its controls, and the docs. A playground has no task, only the controls and docs. */
function TaskPane(props: {
  session: SessionView;
  subtitle: ReactNode;
  active: number;
  onSelect: (i: number) => void;
  onOpen: () => void;
  grading: boolean;
  canGrade: boolean;
  onGrade: () => void;
  canSubmit: boolean;
  onSubmit: () => void;
  canPause: boolean;
  pausing: boolean;
  onPause: () => void;
  resuming: boolean;
  onResume: () => void;
  error: unknown;
  onDismissError: () => void;
  blind: boolean;
  aws: boolean;
  footer?: ReactNode;
}) {
  const { session } = props;
  const exam = session.mode === 'mock';
  const playground = session.mode === 'playground';
  // A paused exam hides its questions until it resumes.
  const paused = exam && !!session.pausedAt && session.state === 'running';
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
      <header className="space-y-2 border-b border-zinc-800 px-4 py-2.5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="min-w-0 truncate font-semibold text-zinc-100" title={session.scenarioTitle}>
              {session.scenarioTitle}
            </h1>
            <StateBadge state={session.state} />
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-zinc-500">{props.subtitle}</div>
        </div>
        {!playground && (
          <div className="flex flex-wrap items-center gap-2">
            {exam && <Countdown session={session} />}
            <div className="ml-auto flex gap-2">
              {paused ? (
                <Button variant="primary" disabled={props.resuming} onClick={props.onResume}>
                  <ResumeIcon />
                  {props.resuming ? 'Checking the lab…' : 'Resume'}
                </Button>
              ) : exam ? (
                <>
                  <Button disabled={!props.canPause} onClick={props.onPause} title="Stop the clock and hide the questions until you resume">
                    <PauseIcon />
                    {props.pausing ? 'Pausing…' : 'Pause'}
                  </Button>
                  <Button variant="primary" disabled={!props.canSubmit} onClick={props.onSubmit}>
                    {props.grading ? 'Submitting…' : 'Submit exam'}
                  </Button>
                </>
              ) : (
                <Button variant="primary" shortcut="g" disabled={!props.canGrade} onClick={props.onGrade}>
                  {props.grading ? 'Grading…' : 'Grade'}
                </Button>
              )}
            </div>
          </div>
        )}
        {!paused && <QuestionTabs session={session} active={props.active} onSelect={props.onSelect} />}
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <ErrorBanner error={props.error} onDismiss={props.onDismissError} />
        {exam && <ExamWarning session={session} />}
        {props.grading && (
          <div className="text-sm text-sky-300">
            {exam ? 'Submitting… your answers are being checked.' : 'Grading… unmet checks are retried for up to 30 seconds.'}
          </div>
        )}
        {paused ? (
          <PausedExam session={session} resuming={props.resuming} onResume={props.onResume} />
        ) : (
          !playground && <TaskBody session={session} active={props.active} onOpen={props.onOpen} />
        )}
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
        {!exam && <ReferencePanel aws={props.aws} />}
      </div>
      {props.footer && <footer className="flex flex-wrap gap-2 border-t border-zinc-800 px-4 py-2.5">{props.footer}</footer>}
    </section>
  );
}

/** Right side until the terminal is up: the lab's setup progress, or why it failed. */
function LabStatus({
  session,
  actions,
  onRetry,
  retrying,
}: {
  session: SessionView;
  actions: ReactNode;
  onRetry: () => void;
  retrying: boolean;
}) {
  const failed = session.state === 'failed';
  const paused = !!session.pausedAt && session.state === 'running';
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
      <header className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800 px-2 py-1.5">
        <h2 className="mr-2 shrink-0 px-2 text-sm font-semibold tracking-wide text-zinc-300 uppercase">
          {failed ? 'Session failed' : paused ? 'Exam paused' : session.state === 'provisioning' ? 'Preparing the lab' : 'Terminal'}
        </h2>
        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">{actions}</div>
      </header>
      {failed ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm whitespace-pre-wrap text-red-300">{session.error}</p>
          <Button variant="primary" onClick={onRetry} disabled={retrying}>
            {retrying ? 'Resetting…' : 'Reset and retry'}
          </Button>
        </div>
      ) : paused ? (
        <div className="min-h-0 flex-1 p-4 text-sm text-zinc-500">The terminal is hidden until you resume the exam.</div>
      ) : (
        <div className="min-h-0 flex-1 p-4">
          <ProgressLog session={session} />
        </div>
      )}
    </section>
  );
}

/** Shown after End: final score and a way to retry. */
function EndedSummary({ ended, onDismiss }: { ended: SessionView; onDismiss: () => void }) {
  const qc = useQueryClient();
  const aws = useSection() === 'aws';
  const playground = ended.mode === 'playground';
  const exam = ended.mode === 'mock';
  const lesson = ended.mode === 'learn' ? ended.lesson : undefined;
  // After an exam, the report: each question that lost points or time, with what it took to get it right.
  const report = useQuery({ queryKey: ['review', ended.attemptId], queryFn: () => api.review(ended.attemptId), enabled: exam && Boolean(ended.lastGrade) });
  const catalog = useQuery({ queryKey: ['recipes'], queryFn: () => studioApi.recipes(), staleTime: Infinity, enabled: exam });
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
            {exam && report.data?.review?.attemptId === ended.attemptId ? (
              <>
                <AttemptReviewView review={report.data.review} topics={catalog.data?.topics ?? []} />
                {ended.lastGrade && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-medium text-zinc-400 hover:text-zinc-200">Every check</summary>
                    <div className="mt-3">
                      <GradeResultView result={ended.lastGrade} />
                    </div>
                  </details>
                )}
              </>
            ) : ended.lastGrade ? (
              <GradeResultView result={ended.lastGrade} />
            ) : (
              <p className="text-sm text-zinc-400">{exam ? 'The exam ended without being submitted.' : 'The session ended without being graded.'}</p>
            )}
            <div className="mt-3 text-xs text-zinc-500">
              {exam && ended.readyAt && ended.endedAt ? (
                `exam mode · finished in ${formatDuration((Date.parse(ended.endedAt) - Date.parse(ended.readyAt)) / 1000 - (ended.pausedS ?? 0))}` +
                (ended.pausedS ? ` · paused for ${formatDuration(ended.pausedS)}, not counted` : '')
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
          <Link to={lesson ? `${SECTIONS[lesson.track].base}/learn` : aws ? '/aws/scenarios' : '/'} className={buttonClass()}>
            {lesson ? 'Back to lessons' : 'Back to scenarios'}
          </Link>
          {lesson?.track !== 'linux' && (
            <Link to={aws ? '/aws/history' : '/history'} className={buttonClass('ghost')}>
              History
            </Link>
          )}
          {exam && !aws && (
            <Link to="/focus" className={buttonClass('ghost')}>
              Focus
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
  const pause = useMutation({ mutationFn: api.pause, onSuccess: setSession });
  const resume = useMutation({ mutationFn: api.resume, onSuccess: setSession });
  const openTask = useMutation({ mutationFn: api.openTask, onSuccess: setSession });
  const skip = useMutation({ mutationFn: api.skipStep, onSuccess: setSession });
  const answer = useMutation({ mutationFn: api.answerStep, onSuccess: setSession });
  const mutations = [grade, hint, solution, reset, reroll, end, submit, pause, resume, openTask, skip, answer];
  const error = mutations.find((m) => m.error)?.error;

  const [activeTask, setActiveTask] = useState(0);
  const tasksKey = session ? `${session.id}:${session.tasks.length}` : '';
  useEffect(() => setActiveTask(0), [tasksKey]);
  const task = session?.tasks[activeTask] ?? session?.tasks[0];

  const state = session?.state;
  // A paused exam hides its questions and terminal until it resumes.
  const paused = !!session?.pausedAt;

  // Minutes per question: tell the server which question is on screen while the lab runs, and
  // that none is when the page is hidden or left.
  const focusId = session && state === 'running' && !playground && !learn && !paused ? task?.id : undefined;
  useEffect(() => {
    if (!focusId) return;
    const report = () => api.focus(document.visibilityState === 'visible' ? focusId : null).catch(() => {});
    report();
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, [focusId]);
  const hasFocus = !!focusId;
  useEffect(() => {
    if (!hasFocus) return;
    return () => {
      api.focus(null).catch(() => {});
    };
  }, [hasFocus]);

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
  const canSubmit = exam && state === 'running' && !submit.isPending && !paused;
  const canPause = exam && state === 'running' && !paused && !pause.isPending && !submit.isPending;

  // aws labs have no VMs or snapshots: a reset is a fresh account, ending removes the session's resources.
  const aws = session?.base === 'floci';
  const fresh = aws ? 'A fresh AWS account is set up' : 'The snapshot is restored';
  const teardown = aws ? "remove the lab's AWS resources" : 'stop the lab VMs';
  const doReset = () => {
    if (canReset && confirm(`Reset the lab? ${fresh} and your changes are lost.`)) reset.mutate();
  };
  const canReroll = !!session?.rerollable && (state === 'running' || state === 'failed') && !reroll.isPending && !reset.isPending;
  const doReroll = () => {
    if (canReroll && confirm(`Roll a new variant? ${fresh} and a different version of the question is set up.`)) reroll.mutate();
  };
  const doSolution = () => {
    if (canSolution && confirm('Reveal the solution? This attempt will be marked as assisted.')) solution.mutate();
  };
  const doEnd = () => {
    const msg = exam ? `Abandon the exam without a score and ${teardown}?` : `End the session and ${teardown}?`;
    if (confirm(msg)) end.mutate();
  };
  const doSubmit = () => {
    if (canSubmit && confirm(`Submit the exam? Your answers are checked once and ${aws ? "the lab's AWS resources are removed" : 'the lab VMs are stopped'}.`)) submit.mutate();
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

  const live = state === 'running' || state === 'grading';
  const [split, setSplit] = useSplit();
  const splitRef = useRef<HTMLDivElement>(null);
  // A session fills the window, so the page underneath must not scroll.
  const hasSession = !!session;
  useEffect(() => {
    if (!hasSession) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = prev;
    };
  }, [hasSession]);

  if (ended && !session) return <EndedSummary ended={ended} onDismiss={() => setEnded(null)} />;
  if (isLoading) return <div className="text-zinc-500">Loading…</div>;
  if (!session) {
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <p className="mb-4 text-zinc-400">No active session.</p>
        <Link to={section === 'linux' ? '/linux/learn' : section === 'aws' ? '/aws/scenarios' : '/'} className={buttonClass('primary')}>
          {section === 'linux' ? 'Choose a lesson' : 'Choose a scenario'}
        </Link>
      </div>
    );
  }

  // Blind practice grading: check names stay hidden until the solution is shown.
  const blind = blindSetting && session.mode === 'practice' && !session.solutionViewed;

  // The session controls sit in the top bar on the right: the terminal's tab bar, or the status panel until the
  // terminal is up. Lessons have their own reset in the lesson pane.
  const scenarioMode = !playground && !learn && !exam;
  const barActions = (
    <>
      {scenarioMode && (
        <>
          <BarButton shortcut="h" disabled={!canHint || hint.isPending} onClick={() => hint.mutate(task?.id)}>
            Hint {task?.hintsRevealed.length ?? 0}/{task?.hintsTotal ?? 0}
          </BarButton>
          <BarButton disabled={!canSolution} onClick={doSolution} title="Reveal the solution; the attempt is marked as assisted">
            Solution
          </BarButton>
        </>
      )}
      {!exam && !learn && (
        <BarButton shortcut="r" disabled={!canReset || reset.isPending} onClick={doReset}>
          Reset
        </BarButton>
      )}
      <BarButton danger className="ml-1" disabled={end.isPending || submit.isPending} onClick={doEnd}>
        {end.isPending ? 'Ending…' : exam ? 'Abandon' : 'End'}
      </BarButton>
    </>
  );

  const subtitle = playground ? (
    'free practice · nothing is graded'
  ) : (
    <>
      {session.scenarioId} · {exam ? 'exam' : session.mode}
      {scenario.data && ` · ${scenario.data.points} pts · ~${scenario.data.estimatedMinutes} min`}
    </>
  );

  // The task (or lesson) on the left and the terminal on the right, filling the window.
  return (
    <div
      ref={splitRef}
      className="fixed inset-x-0 top-0 z-40 grid h-dvh bg-zinc-950 p-3"
      style={{ gridTemplateColumns: `minmax(${SPLIT_MIN_PX}px,${split}%) 12px minmax(0,1fr)` }}
    >
      {learn ? (
        <LessonPane
          session={session}
          onSkip={() => skip.mutate()}
          skipping={skip.isPending}
          onAnswer={(choice) => answer.mutate(choice)}
          answering={answer.isPending}
          onReset={doReset}
          onEnd={doEnd}
          error={error}
        />
      ) : (
        <TaskPane
          session={session}
          subtitle={subtitle}
          active={activeTask}
          onSelect={selectTask}
          onOpen={openActive}
          grading={state === 'grading' || grade.isPending || submit.isPending}
          canGrade={canGrade}
          onGrade={() => grade.mutate()}
          canSubmit={canSubmit}
          onSubmit={doSubmit}
          canPause={canPause}
          pausing={pause.isPending}
          onPause={() => pause.mutate()}
          resuming={resume.isPending}
          onResume={() => resume.mutate()}
          blind={blind}
          aws={Boolean(session.connection?.aws) || section === 'aws'}
          error={error}
          onDismissError={() => mutations.forEach((m) => m.reset())}
          footer={
            session.rerollable && (
              <Button
                disabled={!canReroll}
                onClick={doReroll}
                title={aws ? 'Start a fresh AWS account with a different variant of this question' : 'Restore the snapshot and set up a different variant of this question'}
              >
                {reroll.isPending ? 'Rolling…' : 'New variant'}
              </Button>
            )
          }
        />
      )}
      <SplitHandle container={splitRef} value={split} onChange={setSplit} />
      {live && session.connection && !paused ? (
        <Suspense fallback={<div className="text-sm text-zinc-500">Loading terminal…</div>}>
          <TerminalPanel key={`${session.id}-${session.readyAt}`} session={session} actions={barActions} />
        </Suspense>
      ) : (
        <LabStatus session={session} actions={barActions} onRetry={() => reset.mutate()} retrying={reset.isPending} />
      )}
    </div>
  );
}

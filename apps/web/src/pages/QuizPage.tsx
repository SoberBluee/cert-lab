import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { QuizGradeItem, QuizGradeResult, QuizQuestionView } from '@cka/schema';
import { api } from '../api';
import { Button, ErrorBanner, InlineMarkdown, Markdown, percentClass, Toggle } from '../components/ui';
import { SECTIONS } from '../section';

type Progress = {
  index: number;
  /** Selected choice per question id (before or after grading that question). */
  answers: Record<string, number>;
  /** Graded results keyed by question id. */
  graded: Record<string, QuizGradeItem>;
  /** Indexes into the quiz file, in the order this attempt asks them. */
  questionOrder: number[];
  finished?: boolean;
};

const storageKey = (id: string) => `cka.quiz.v2.${id}`;

const emptyProgress = (): Progress => ({ index: 0, answers: {}, graded: {}, questionOrder: [] });

function shuffleOrder(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

function loadProgress(id: string): Progress {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return emptyProgress();
    const p = JSON.parse(raw) as Progress;
    if (!Array.isArray(p.questionOrder)) return emptyProgress();
    return {
      index: typeof p.index === 'number' ? p.index : 0,
      answers: p.answers ?? {},
      graded: p.graded ?? {},
      questionOrder: p.questionOrder,
      finished: !!p.finished,
    };
  } catch {
    return emptyProgress();
  }
}

function ensureQuestionOrder(p: Progress, count: number): Progress {
  if (p.questionOrder.length === count) return p;
  return { ...p, questionOrder: shuffleOrder(count) };
}

function saveProgress(id: string, p: Progress) {
  localStorage.setItem(storageKey(id), JSON.stringify(p));
}

const backClass = 'text-sm text-zinc-400 hover:text-zinc-100';

/** A question on the results page: right or wrong, its first line, and why on a click. */
function ResultItem({ q, n, g }: { q: QuizQuestionView; n: number; g?: QuizGradeItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg px-3 py-2.5">
      <div className="flex items-baseline gap-3">
        <span className={`w-4 shrink-0 ${g?.correct ? 'text-emerald-400' : 'text-rose-400'}`}>{g?.correct ? '✓' : '✗'}</span>
        <span className="w-6 shrink-0 text-sm text-zinc-500 tabular-nums">{n}</span>
        <span className="min-w-0 flex-1 text-[15px] text-zinc-200">
          <InlineMarkdown>{q.prompt.split('\n')[0]!}</InlineMarkdown>
        </span>
        {g && (
          <span className="shrink-0 text-sm">
            <Toggle open={open} onClick={() => setOpen(!open)}>
              Why
            </Toggle>
          </span>
        )}
      </div>
      {open && g && (
        <div className="mt-2 ml-16">
          <Markdown>{g.explain}</Markdown>
        </div>
      )}
    </li>
  );
}

export function QuizPage() {
  const { id = '' } = useParams<{ id: string }>();
  const quiz = useQuery({ queryKey: ['quiz', id], queryFn: () => api.quiz(id), enabled: !!id });
  const [progress, setProgress] = useState<Progress>(() => loadProgress(id));
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    setProgress(loadProgress(id));
    setPicked(null);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    saveProgress(id, progress);
  }, [id, progress]);

  const fileQuestions = quiz.data?.questions ?? [];
  const questions =
    progress.questionOrder.length === fileQuestions.length
      ? progress.questionOrder.map((i) => fileQuestions[i]!)
      : fileQuestions;
  const current = questions[progress.index];
  const currentGraded = current ? progress.graded[current.id] : undefined;

  useEffect(() => {
    if (!quiz.data) return;
    setProgress((p) => ensureQuestionOrder(p, quiz.data.questions.length));
  }, [quiz.data]);

  useEffect(() => {
    if (!current) {
      setPicked(null);
      return;
    }
    setPicked(progress.answers[current.id] ?? null);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const gradeOne = useMutation({
    mutationFn: (choice: number) => {
      if (!current) throw new Error('no question');
      return api.gradeQuiz(id, { [current.id]: choice });
    },
    onSuccess: (result: QuizGradeResult, choice: number) => {
      if (!current) return;
      const item = result.results.find((r) => r.id === current.id);
      if (!item) return;
      setProgress((p) => ({
        ...p,
        answers: { ...p.answers, [current.id]: choice },
        graded: { ...p.graded, [current.id]: item },
      }));
    },
  });

  const score = useMemo(() => {
    const items = Object.values(progress.graded);
    return { correct: items.filter((i) => i.correct).length, total: questions.length };
  }, [progress.graded, questions.length]);

  const learnPath = `${SECTIONS[quiz.data?.track ?? 'cka'].base}/learn` || '/learn';

  const retry = () => {
    setProgress({
      index: 0,
      answers: {},
      graded: {},
      questionOrder: shuffleOrder(fileQuestions.length),
    });
    setPicked(null);
  };

  if (quiz.isLoading) return <div className="p-6 text-sm text-zinc-500">Loading quiz…</div>;
  if (quiz.error || !quiz.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <ErrorBanner error={quiz.error ?? new Error('Quiz not found')} />
        <Link to={learnPath} className={backClass}>
          ← Learn
        </Link>
      </div>
    );
  }

  if (progress.finished || (questions.length > 0 && Object.keys(progress.graded).length >= questions.length && progress.index >= questions.length)) {
    const percent = score.total ? Math.round((score.correct / score.total) * 100) : 0;
    return (
      <div className="mx-auto max-w-3xl space-y-10 pb-10">
        <Link to={learnPath} className={backClass}>
          ← Learn
        </Link>
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100">{quiz.data.title}</h1>
            <div className="mt-3 flex items-baseline gap-3">
              <span className={`text-5xl font-semibold tabular-nums ${percentClass(percent)}`}>
                {score.correct}/{score.total}
              </span>
              <span className="text-sm text-zinc-500">correct</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to={learnPath}>
              <Button variant="ghost">Back to Learn</Button>
            </Link>
            <Button variant="primary" onClick={retry}>
              Retry
            </Button>
          </div>
        </header>
        <ol className="-mx-3 space-y-1">
          {questions.map((q, i) => (
            <ResultItem key={q.id} q={q} n={i + 1} g={progress.graded[q.id]} />
          ))}
        </ol>
      </div>
    );
  }

  if (!current || progress.questionOrder.length !== fileQuestions.length) {
    return <div className="p-6 text-sm text-zinc-500">Loading quiz…</div>;
  }

  const answered = Object.keys(progress.graded).length;
  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-10">
      <Link to={learnPath} className={backClass}>
        ← Learn
      </Link>

      <header>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold text-zinc-100">{quiz.data.title}</h1>
          <span className="text-sm text-zinc-500 tabular-nums">
            Question {progress.index + 1} of {questions.length}
          </span>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-sky-500 transition-all" style={{ width: `${(answered / Math.max(questions.length, 1)) * 100}%` }} />
        </div>
      </header>

      <ErrorBanner error={gradeOne.error} />

      <div>
        <Markdown>{current.prompt}</Markdown>

        <fieldset className="mt-6 space-y-2" disabled={!!currentGraded || gradeOne.isPending}>
          <legend className="sr-only">Choose one</legend>
          {current.choices.map((choice, i) => {
            const selected = picked === i;
            const show = !!currentGraded;
            const isCorrect = show && currentGraded.answer === i;
            const isWrongPick = show && selected && !currentGraded.correct;
            return (
              <label
                key={i}
                className={`flex items-start gap-3 rounded-lg px-4 py-3 text-[15px] transition ${
                  isCorrect
                    ? 'bg-emerald-950/60 text-emerald-100'
                    : isWrongPick
                      ? 'bg-rose-950/50 text-rose-100'
                      : selected
                        ? 'bg-sky-950/60 text-zinc-100'
                        : show
                          ? 'bg-zinc-900/40 text-zinc-500'
                          : 'bg-zinc-900/70 text-zinc-300 hover:bg-zinc-800/80'
                } ${currentGraded ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <input
                  type="radio"
                  name={`q-${current.id}`}
                  className="mt-1 accent-sky-500"
                  checked={selected}
                  onChange={() => setPicked(i)}
                  disabled={!!currentGraded}
                />
                <InlineMarkdown>{choice}</InlineMarkdown>
              </label>
            );
          })}
        </fieldset>

        {currentGraded && (
          <div className="mt-6">
            <div className={`mb-2 text-base font-semibold ${currentGraded.correct ? 'text-emerald-400' : 'text-rose-400'}`}>
              {currentGraded.correct ? 'Correct' : 'Not quite'}
            </div>
            <Markdown>{currentGraded.explain}</Markdown>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          {!currentGraded ? (
            <Button variant="primary" disabled={picked === null || gradeOne.isPending} onClick={() => picked !== null && gradeOne.mutate(picked)}>
              {gradeOne.isPending ? 'Checking…' : 'Submit'}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                const next = progress.index + 1;
                if (next >= questions.length) {
                  setProgress((p) => ({ ...p, index: next, finished: true }));
                } else {
                  setProgress((p) => ({ ...p, index: next }));
                }
              }}
            >
              {progress.index + 1 >= questions.length ? 'See results' : 'Next'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

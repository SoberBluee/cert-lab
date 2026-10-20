import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { QuizGradeItem, QuizGradeResult } from '@cka/schema';
import { api } from '../api';
import { Button, ErrorBanner, Markdown } from '../components/ui';
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
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <ErrorBanner error={quiz.error ?? new Error('Quiz not found')} />
        <Link to={learnPath} className="text-sm text-sky-400 hover:text-sky-300">
          ← Back to Learn
        </Link>
      </div>
    );
  }

  if (progress.finished || (questions.length > 0 && Object.keys(progress.graded).length >= questions.length && progress.index >= questions.length)) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <Link to={learnPath} className="text-sm text-sky-400 hover:text-sky-300">
          ← Back to Learn
        </Link>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
          <h1 className="text-xl font-semibold text-zinc-100">{quiz.data.title}</h1>
          <p className="mt-2 text-sm text-zinc-400">{quiz.data.summary}</p>
          <p className="mt-6 text-3xl font-semibold text-emerald-300">
            {score.correct}/{score.total}
          </p>
          <p className="mt-1 text-sm text-zinc-500">correct</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="primary" onClick={retry}>
              Retry
            </Button>
            <Link to={learnPath}>
              <Button>Back to Learn</Button>
            </Link>
          </div>
        </div>
        <ol className="space-y-3">
          {questions.map((q, i) => {
            const g = progress.graded[q.id];
            return (
              <li key={q.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm">
                <div className="flex items-start gap-2">
                  <span className={g?.correct ? 'text-emerald-400' : 'text-rose-400'}>{g?.correct ? '✓' : '✗'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-zinc-200">
                      {i + 1}. <span className="font-normal text-zinc-400">{q.prompt.split('\n')[0]}</span>
                    </div>
                    {g && (
                      <div className="mt-2 text-zinc-400">
                        <Markdown>{g.explain}</Markdown>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  if (!current || progress.questionOrder.length !== fileQuestions.length) {
    return <div className="p-6 text-sm text-zinc-500">Loading quiz…</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={learnPath} className="text-sm text-sky-400 hover:text-sky-300">
          ← Back to Learn
        </Link>
        <span className="text-xs text-zinc-500">
          Question {progress.index + 1} / {questions.length}
        </span>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-zinc-100">{quiz.data.title}</h1>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full bg-sky-500 transition-all"
            style={{ width: `${(Object.keys(progress.graded).length / Math.max(questions.length, 1)) * 100}%` }}
          />
        </div>
      </div>

      <ErrorBanner error={gradeOne.error} />

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="text-sm leading-relaxed text-zinc-200">
          <Markdown>{current.prompt}</Markdown>
        </div>

        <fieldset className="mt-5 space-y-2" disabled={!!currentGraded || gradeOne.isPending}>
          <legend className="sr-only">Choose one</legend>
          {current.choices.map((choice, i) => {
            const selected = picked === i;
            const show = !!currentGraded;
            const isCorrect = show && currentGraded.answer === i;
            const isWrongPick = show && selected && !currentGraded.correct;
            return (
              <label
                key={i}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                  isCorrect
                    ? 'border-emerald-700 bg-emerald-950/40 text-emerald-100'
                    : isWrongPick
                      ? 'border-rose-800 bg-rose-950/30 text-rose-100'
                      : selected
                        ? 'border-sky-700 bg-sky-950/30 text-zinc-100'
                        : 'border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-zinc-700'
                } ${currentGraded ? 'cursor-default' : ''}`}
              >
                <input
                  type="radio"
                  name={`q-${current.id}`}
                  className="mt-1"
                  checked={selected}
                  onChange={() => setPicked(i)}
                  disabled={!!currentGraded}
                />
                <span>{choice}</span>
              </label>
            );
          })}
        </fieldset>

        {currentGraded && (
          <div
            className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
              currentGraded.correct ? 'border-emerald-800 bg-emerald-950/30 text-emerald-100' : 'border-rose-900 bg-rose-950/30 text-rose-100'
            }`}
          >
            <div className="mb-1 font-medium">{currentGraded.correct ? 'Correct' : 'Not quite'}</div>
            <div className="text-zinc-300">
              <Markdown>{currentGraded.explain}</Markdown>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          {!currentGraded ? (
            <Button
              variant="primary"
              disabled={picked === null || gradeOne.isPending}
              onClick={() => picked !== null && gradeOne.mutate(picked)}
            >
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

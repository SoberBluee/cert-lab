import { Link } from 'react-router-dom';
import type { AttemptReview, LabTopic, ReviewQuestion } from '@cka/schema';
import { Markdown } from './ui';

/** The CKA pass mark, in percent. */
const PASS_PERCENT = 66;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const percentClass = (pct: number) => (pct >= 100 ? 'text-emerald-400' : pct >= PASS_PERCENT ? 'text-amber-300' : 'text-red-400');

const minutesClass = (minutes: number | undefined, pace: number) =>
  minutes === undefined ? 'text-zinc-500' : minutes > 2 * pace ? 'text-red-400' : minutes > pace ? 'text-amber-300' : 'text-zinc-400';

/** Why a reviewed question needs another look, or undefined when it scored full marks within pace. */
function reviewNote(q: ReviewQuestion, pace: number): string | undefined {
  if (!q.attempted) return 'never opened';
  const notes = [];
  if (q.score < q.maxScore) notes.push(q.score === 0 && q.minutes !== undefined && q.minutes < 2 ? 'no points in under 2 minutes: skipped or left early' : `lost ${q.maxScore - q.score} pt`);
  if (q.minutes !== undefined && q.minutes > pace) notes.push(`${Math.round((q.minutes - pace) * 10) / 10} min over pace`);
  return notes.length ? notes.join(' · ') : undefined;
}

/**
 * A graded attempt question by question: the score against the pass mark, then every question that lost points
 * or ran over exam pace, costliest first, with the checks it failed, the task as it was set, its solution and
 * links to practise its topics.
 */
export function AttemptReviewView({ review: r, topics }: { review: AttemptReview; topics: LabTopic[] }) {
  const pace = r.paceMinutes;
  const percent = r.maxScore ? Math.round((r.score / r.maxScore) * 100) : 0;
  const lost = (q: ReviewQuestion) => q.maxScore - q.score;
  const over = (q: ReviewQuestion) => Math.max(0, (q.minutes ?? 0) - pace);
  const flagged = r.questions
    .map((q, i) => ({ q, i, note: reviewNote(q, pace) }))
    .filter((x) => x.note)
    // The costliest first: the most points lost, then the most minutes over pace.
    .sort((a, b) => lost(b.q) - lost(a.q) || over(b.q) - over(a.q));
  const slow = r.questions.filter((q) => over(q) > 0);
  const label = (id: string) => topics.find((t) => t.id === id)?.label ?? id;
  return (
    <div>
      <p className="text-sm text-zinc-300">
        {r.scenarioTitle}, {new Date(r.startedAt).toLocaleString()}:{' '}
        <span className={percentClass(percent)}>
          {r.score}/{r.maxScore} ({percent}%)
        </span>
        {r.mode === 'mock' && (
          <>
            {' '}
            · pass mark {PASS_PERCENT}%, {percent >= PASS_PERCENT ? 'passed' : 'not passed'}
          </>
        )}
        {' · '}
        {plural(r.questions.filter((q) => lost(q) > 0).length, 'question')} lost {r.maxScore - r.score} pt
        {slow.length > 0 && (
          <>
            {' · '}
            {plural(slow.length, 'question')} over the {pace}-minute pace took {Math.round(slow.reduce((n, q) => n + (q.minutes ?? 0), 0))} min
          </>
        )}
      </p>
      {flagged.length === 0 ? (
        <p className="mt-3 text-sm text-emerald-400">Full marks on every question, each within {pace} minutes.</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800">
          {flagged.map(({ q, i, note }) => (
            <li key={q.taskId} className="px-4 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium text-zinc-100">
                  Q{i + 1}. {q.title}
                </span>
                <span className={`text-sm ${q.score === q.maxScore ? 'text-emerald-400' : q.score === 0 ? 'text-red-400' : 'text-amber-300'}`}>
                  {q.score}/{q.maxScore} pt
                </span>
                <span className={`font-mono text-sm ${minutesClass(q.minutes, pace)}`}>{q.minutes === undefined ? 'no time' : `${q.minutes} min`}</span>
                <span className="text-xs text-zinc-500">{note}</span>
              </div>
              {q.missed.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-zinc-400">
                  {q.missed.map((c) => (
                    <li key={c.id}>
                      <span className="font-mono text-red-400/80">−{c.weight}</span> {c.description}
                    </li>
                  ))}
                </ul>
              )}
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-zinc-400 hover:text-zinc-200">The task</summary>
                <div className="mt-1 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <Markdown>{q.text}</Markdown>
                </div>
              </details>
              {q.solution ? (
                <details className="mt-1 text-sm" open={lost(q) > 0}>
                  <summary className="cursor-pointer text-xs font-medium text-amber-400 hover:text-amber-300">
                    {lost(q) > 0 ? 'What it took to get it right' : 'The reference solution'}
                  </summary>
                  <div className="mt-1 rounded-md border border-amber-900/50 bg-zinc-950/60 px-3 py-2">
                    <Markdown>{q.solution}</Markdown>
                  </div>
                </details>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">This lab's solution.md has no part for this question.</p>
              )}
              {q.topics.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-3 text-xs">
                  {q.topics.map((id) => (
                    <Link key={id} to={`/?topic=${id}`} className="text-sky-400 hover:text-sky-300">
                      Practice {label(id)} →
                    </Link>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {flagged.length < r.questions.length && (
        <p className="mt-2 text-xs text-zinc-500">
          {plural(r.questions.length - flagged.length, 'other question')} scored full marks within {pace} minutes.
        </p>
      )}
    </div>
  );
}

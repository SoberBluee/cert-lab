import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AttemptReview, LabTopic, ReviewQuestion } from '@cka/schema';
import { Markdown, percentClass, plural, Stat, Toggle } from './ui';

/** The CKA pass mark, in percent. */
const PASS_PERCENT = 66;

const scoreClass = (q: ReviewQuestion) => (q.score === q.maxScore ? 'text-emerald-400' : q.score === 0 ? 'text-red-400' : 'text-amber-300');

const minutesClass = (minutes: number | undefined, pace: number) =>
  minutes === undefined ? 'text-zinc-600' : minutes > 2 * pace ? 'text-red-400' : minutes > pace ? 'text-amber-300' : 'text-zinc-400';

const overPace = (q: ReviewQuestion, pace: number) => Math.max(0, Math.round(((q.minutes ?? 0) - pace) * 10) / 10);

/** Why a reviewed question needs another look, or undefined when it scored full marks within pace. */
function needsReview(q: ReviewQuestion, pace: number): boolean {
  return !q.attempted || q.score < q.maxScore || overPace(q, pace) > 0;
}

/** A note for a question that got nowhere, when its score and time do not say it already. */
function skippedNote(q: ReviewQuestion): string | undefined {
  if (!q.attempted) return 'Never opened';
  if (q.score === 0 && q.minutes !== undefined && q.minutes < 2) return 'No points in under 2 minutes: skipped or left early';
}

function ReviewItem({ q, n, pace, label }: { q: ReviewQuestion; n: number; pace: number; label: (id: string) => string }) {
  const [open, setOpen] = useState<'task' | 'solution' | null>(null);
  const toggle = (what: 'task' | 'solution') => setOpen(open === what ? null : what);
  const over = overPace(q, pace);
  const note = skippedNote(q);
  return (
    <li className="rounded-xl bg-zinc-900/70 px-5 py-4">
      <div className="flex items-baseline gap-3">
        <span className="w-8 shrink-0 text-sm text-zinc-500 tabular-nums">Q{n}</span>
        <h3 className="min-w-0 flex-1 text-base font-medium text-zinc-100">{q.title}</h3>
        <span className={`shrink-0 text-base font-semibold tabular-nums ${scoreClass(q)}`}>
          {q.score}/{q.maxScore}
        </span>
        <span
          className={`w-16 shrink-0 text-right text-sm tabular-nums ${minutesClass(q.minutes, pace)}`}
          title={over > 0 ? `${over} min over the ${pace}-minute pace` : `Within the ${pace}-minute pace`}
        >
          {q.minutes === undefined ? '–' : `${q.minutes} min`}
        </span>
      </div>
      <div className="ml-11">
        {note && <p className="mt-1 text-sm text-zinc-500">{note}</p>}
        {q.missed.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-zinc-300">
            {q.missed.map((c) => (
              <li key={c.id} className="flex gap-3">
                <span className="w-6 shrink-0 text-right font-medium text-red-400 tabular-nums">−{c.weight}</span>
                <span>{c.description}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Toggle open={open === 'task'} onClick={() => toggle('task')}>
            Task
          </Toggle>
          {q.solution && (
            <Toggle open={open === 'solution'} onClick={() => toggle('solution')}>
              {q.score < q.maxScore ? 'What it took' : 'Solution'}
            </Toggle>
          )}
          {q.topics.map((id) => (
            <Link key={id} to={`/?topic=${id}`} className="text-sky-400 hover:text-sky-300">
              Practice {label(id)} →
            </Link>
          ))}
        </div>
        {open === 'task' && (
          <div className="mt-3">
            <Markdown>{q.text}</Markdown>
          </div>
        )}
        {open === 'solution' && q.solution && (
          <div className="mt-3">
            <Markdown>{q.solution}</Markdown>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * A graded attempt question by question: the score against the pass mark, then every question that lost points
 * or ran over exam pace, costliest first, with the checks it failed. Its task, its solution and links to practise
 * its topics are a click away.
 */
export function AttemptReviewView({ review: r, topics }: { review: AttemptReview; topics: LabTopic[] }) {
  const pace = r.paceMinutes;
  const percent = r.maxScore ? Math.round((r.score / r.maxScore) * 100) : 0;
  const lost = (q: ReviewQuestion) => q.maxScore - q.score;
  const flagged = r.questions
    .map((q, i) => ({ q, n: i + 1 }))
    .filter(({ q }) => needsReview(q, pace))
    // The costliest first: the most points lost, then the most minutes over pace.
    .sort((a, b) => lost(b.q) - lost(a.q) || overPace(b.q, pace) - overPace(a.q, pace));
  const lostQuestions = r.questions.filter((q) => lost(q) > 0).length;
  const slow = r.questions.filter((q) => overPace(q, pace) > 0);
  const label = (id: string) => topics.find((t) => t.id === id)?.label ?? id;
  const passed = percent >= PASS_PERCENT;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-12 gap-y-5">
        <div>
          <div className="flex items-center gap-3">
            <span className={`text-5xl font-semibold tabular-nums ${percentClass(percent)}`}>{percent}%</span>
            {r.mode === 'mock' && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${passed ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'}`}
                title={`The pass mark is ${PASS_PERCENT}%`}
              >
                {passed ? 'Passed' : 'Not passed'}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-zinc-500">
            {r.score} of {r.maxScore} points · {r.scenarioTitle}, {new Date(r.startedAt).toLocaleDateString()}
          </div>
        </div>
        <Stat value={lostQuestions} label={`${lostQuestions === 1 ? 'question' : 'questions'} lost ${r.maxScore - r.score} pt`} />
        <Stat value={slow.length} label={`over the ${pace}-min pace`} className={slow.length ? 'text-amber-300' : 'text-zinc-100'} />
      </div>
      {flagged.length === 0 ? (
        <p className="mt-6 text-base text-emerald-400">Full marks on every question, each within {pace} minutes.</p>
      ) : (
        <ol className="mt-6 space-y-3">
          {flagged.map(({ q, n }) => (
            <ReviewItem key={q.taskId} q={q} n={n} pace={pace} label={label} />
          ))}
        </ol>
      )}
      {flagged.length > 0 && flagged.length < r.questions.length && (
        <p className="mt-4 text-sm text-zinc-500">
          {plural(r.questions.length - flagged.length, 'other question')} scored full marks within {pace} minutes.
        </p>
      )}
    </div>
  );
}

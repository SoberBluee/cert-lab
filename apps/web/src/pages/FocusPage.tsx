import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FocusMode, LabTopic } from '@cka/schema';
import { api, studioApi } from '../api';
import { AttemptReviewView } from '../components/AttemptReviewView';
import { Button, Card, ErrorBanner } from '../components/ui';
import { DOMAINS, domainSections, minutesOver, recommendations, SLOW_POINTS, topicRows, type TopicRow } from '../focusTopics';
import { useHiddenTopics } from '../hooks';
import { WEAK_SPOTS } from '../quickRandom';

const percentClass = (pct?: number) =>
  pct === undefined ? 'text-zinc-500' : pct >= 100 ? 'text-emerald-400' : pct >= 66 ? 'text-amber-300' : 'text-red-400';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const scenariosNote = (row: TopicRow) => (row.scenarioCount ? plural(row.scenarioCount, 'scenario') : 'Quick lab only');

/** Blind spots are sorted by domain weight; the rest are in the domain sections. */
const BLIND_SPOTS_SHOWN = 8;

const MODES: { id: FocusMode; label: string; title: string }[] = [
  { id: 'all', label: 'All attempts', title: 'Practice and exam mode' },
  { id: 'exam', label: 'Exam mode only', title: 'Only attempts in exam mode: no hints, no solution, one submit' },
];

/** Minutes per question, amber when slower than exam pace. */
function Pace({ minutes, pace }: { minutes?: number; pace: number }) {
  if (minutes === undefined) return null;
  return (
    <>
      {' · '}
      <span className={minutes > pace ? 'text-amber-300' : 'text-zinc-400'} title={`Exam pace is about ${pace} minutes per question`}>
        {minutes} min each
      </span>
    </>
  );
}

function StatBadge({ row, mode, pace }: { row: TopicRow; mode: FocusMode; pace: number }) {
  const { stat } = row;
  if (!stat.questions) return <span className="text-zinc-500">{mode === 'exam' ? 'not in exam mode yet' : 'never attempted'} · {scenariosNote(row)}</span>;
  return (
    <span className="text-zinc-400">
      recent <span className={percentClass(stat.recentPercent)}>{stat.recentPercent}%</span>
      {mode === 'all' &&
        (stat.cleanPercent === undefined ? (
          <> · <span className="text-zinc-500">no clean result</span></>
        ) : (
          <> · clean <span className={percentClass(stat.cleanPercent)}>{stat.cleanPercent}%</span></>
        ))}
      {' · '}
      {plural(stat.questions, 'question')}
      <Pace minutes={stat.recentMinutes} pace={pace} /> · {scenariosNote(row)}
    </span>
  );
}

/** The latest mock, or another attempt picked from the menu, question by question. */
function ExamReview({ topics }: { topics: LabTopic[] }) {
  const [attemptId, setAttemptId] = useState<number>();
  const review = useQuery({ queryKey: ['review', attemptId], queryFn: () => api.review(attemptId) });
  const r = review.data?.review;
  if (review.error) return <ErrorBanner error={review.error} />;
  if (!r) return null;
  const attempts = review.data?.attempts ?? [];
  return (
    <Card
      title={r.mode === 'mock' ? 'Exam review' : 'Lab review'}
      actions={
        attempts.length > 1 && (
          <select
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
            value={r.attemptId}
            onChange={(e) => setAttemptId(Number(e.target.value))}
            aria-label="Attempt to review"
          >
            {attempts.map((a) => (
              <option key={a.attemptId} value={a.attemptId}>
                {a.scenarioTitle} · {new Date(a.startedAt).toLocaleDateString()} · {a.score}/{a.maxScore}
                {a.mode === 'mock' ? ' · exam' : ''}
              </option>
            ))}
          </select>
        )
      }
    >
      <AttemptReviewView review={r} topics={topics} />
      <p className="mt-2 text-xs text-zinc-500">
        These questions count toward their topics below: misses lower a topic's score, and time over pace raises its place in Work on next.
      </p>
    </Card>
  );
}

const domainShort = (topic: LabTopic) => DOMAINS.find((d) => d.id === topic.domain)?.short ?? topic.domain;
const groupName = (topic: LabTopic) => (topic.group === 'create' ? 'create' : 'troubleshoot');

/** Create and troubleshoot topics can share a label, so lists that mix them name the group and domain. */
function TopicName({ topic }: { topic: LabTopic }) {
  return (
    <div className="truncate font-medium text-zinc-100">
      {topic.label}{' '}
      <span className="text-xs font-normal text-zinc-500">
        {groupName(topic)} · {domainShort(topic)}
      </span>
    </div>
  );
}

function TopicLine({ row, hidden, onToggle, mode, pace }: { row: TopicRow; hidden: boolean; onToggle: (id: string, hide: boolean) => void; mode: FocusMode; pace: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <input
        type="checkbox"
        checked={hidden}
        onChange={(e) => onToggle(row.topic.id, e.target.checked)}
        title={hidden ? 'Hidden from Scenarios' : 'Hide from Scenarios'}
        className="h-4 w-4 shrink-0 accent-sky-600"
      />
      <span className="min-w-0 flex-1 truncate">
        <span className={`font-medium ${hidden ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-100'}`}>{row.topic.label}</span>{' '}
        <span className="text-xs text-zinc-500">{groupName(row.topic)}</span>
      </span>
      <span className="hidden text-xs sm:block">
        <StatBadge row={row} mode={mode} pace={pace} />
      </span>
      <Link to={`/?topic=${row.topic.id}`} className="shrink-0 text-sm font-medium text-sky-400 hover:text-sky-300">
        Practice →
      </Link>
    </div>
  );
}

export function FocusPage() {
  const [mode, setMode] = useState<FocusMode>('all');
  const catalog = useQuery({ queryKey: ['recipes'], queryFn: () => studioApi.recipes(), staleTime: Infinity });
  const all = useQuery({ queryKey: ['scenarios', { track: 'cka' }], queryFn: () => api.scenarios({ track: 'cka' }) });
  const scores = useQuery({ queryKey: ['focus', mode], queryFn: () => api.topicScores(mode) });
  const [hidden, setHidden] = useHiddenTopics();
  const [search, setSearch] = useState('');

  const rows = useMemo(
    () => topicRows(catalog.data?.topics ?? [], scores.data, all.data?.scenarios ?? []),
    [catalog.data, scores.data, all.data],
  );
  const recent = scores.data?.recent ?? 5;
  const pace = scores.data?.paceMinutes ?? 7;
  const recs = useMemo(() => recommendations(rows, recent, pace), [rows, recent, pace]);

  const toggle = (id: string, hide: boolean) => setHidden(hide ? [...hidden, id] : hidden.filter((x) => x !== id));
  const shown = rows.filter((r) => r.topic.label.toLowerCase().includes(search.trim().toLowerCase()));

  const reason = ({ stat }: TopicRow) => {
    const w = stat.weakest;
    if (!w) return '';
    // A single-question lab's question carries the lab's title.
    const where = w.title === w.scenarioTitle ? w.title : `${w.title} (${w.scenarioTitle})`;
    const parts = [
      mode === 'exam' || stat.cleanQuestions === stat.questions
        ? `${stat.recentPercent}% on the last ${plural(Math.min(stat.questions, recent), 'question')}`
        : stat.cleanPercent === undefined
          ? `no clean result yet · ${stat.recentPercent}% with help`
          : `clean ${stat.cleanPercent}% on the last ${plural(Math.min(stat.cleanQuestions, recent), 'question')} · ${stat.recentPercent}% with help`,
    ];
    const over = minutesOver(stat, pace);
    if (over > 0) parts.push(`${stat.cleanMinutes} min each, ${over} over pace`);
    // A perfect score on too few questions is not done yet: say how many more confirm it.
    if (stat.cleanPercent === 100 && stat.cleanQuestions < recent) parts.push(`${recent - stat.cleanQuestions} more clean to confirm`);
    else if (w.percent < 100) parts.push(`weakest: ${where} ${w.percent}%`);
    return parts.join(' · ');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-lg font-semibold text-zinc-100">Focus</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Tick a topic to hide its scenarios from the Scenarios tab, so what is left is what you still need to practise. Each graded question counts toward its own
            topics with its own score, and a topic is scored on its {recent} most recent questions. A clean result is one without hints or the solution: that is
            the score the recommendations go by, and a topic is only done at a clean 100% on {recent} questions within exam pace, about {pace} minutes per question.
            Work on next ranks topics by the points they miss plus {SLOW_POINTS} for each minute over pace.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-md border border-zinc-700" role="radiogroup" aria-label="Attempts to score">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              title={m.title}
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 text-sm transition ${mode === m.id ? 'bg-sky-600 text-white' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <ErrorBanner error={catalog.error} />
      <ErrorBanner error={all.error} />
      <ErrorBanner error={scores.error} />

      <ExamReview topics={catalog.data?.topics ?? []} />

      {(recs.workOn.length > 0 || recs.blindSpots.length > 0) && (
        <Card title={mode === 'exam' ? 'Recommended focus, from exam mode' : 'Recommended focus'}>
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium text-zinc-200">Work on next</h3>
                {mode === 'all' && recs.workOn.length > 0 && (
                  <Link
                    to={`/?topic=${WEAK_SPOTS}`}
                    className="text-sm font-medium text-sky-400 hover:text-sky-300"
                    title="A Quick lab with one question on each of these topics"
                  >
                    Practise these →
                  </Link>
                )}
              </div>
              {recs.workOn.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">
                  {!rows.some((r) => r.stat.questions > 0)
                    ? mode === 'exam'
                      ? 'No graded question in exam mode yet. Sit a Full mock, or tick Exam mode before you start a lab.'
                      : 'No graded question yet.'
                    : `Every practised topic has a clean 100% on ${recent} recent questions.`}
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {recs.workOn.map((r) => (
                    <li key={r.topic.id} className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <TopicName topic={r.topic} />
                        <div className="text-xs text-zinc-500">{reason(r)}</div>
                      </div>
                      <Link to={`/?topic=${r.topic.id}`} className="shrink-0 text-sm font-medium text-sky-400 hover:text-sky-300">
                        Practice →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-zinc-200">Blind spots</h3>
              {recs.blindSpots.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">{mode === 'exam' ? 'Every topic has been attempted in exam mode.' : 'Every topic has been attempted.'}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {recs.blindSpots.slice(0, BLIND_SPOTS_SHOWN).map((r) => (
                    <li key={r.topic.id} className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <TopicName topic={r.topic} />
                        <div className="text-xs text-zinc-500">
                          {mode === 'exam' ? 'not in exam mode yet' : 'never attempted'} · {scenariosNote(r)}
                        </div>
                      </div>
                      <Link to={`/?topic=${r.topic.id}`} className="shrink-0 text-sm font-medium text-sky-400 hover:text-sky-300">
                        Practice →
                      </Link>
                    </li>
                  ))}
                  {recs.blindSpots.length > BLIND_SPOTS_SHOWN && (
                    <li className="text-xs text-zinc-500">and {plural(recs.blindSpots.length - BLIND_SPOTS_SHOWN, 'more topic')}, listed by domain below</li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card
        title="Topics by exam domain"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setHidden([])}>
              Show all
            </Button>
            <Button variant="ghost" onClick={() => setHidden([...hidden, ...shown.map((r) => r.topic.id)])}>
              Hide shown
            </Button>
          </div>
        }
      >
        <input
          placeholder="Search topics"
          className="mb-3 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {catalog.isLoading || all.isLoading || scores.isLoading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="text-sm text-zinc-500">No topics match.</div>
        ) : (
          domainSections(shown).map(({ domain, rows: domainRows }) => {
            const proven = domainRows.filter((r) => (mode === 'exam' ? r.stat.questions > 0 : r.stat.cleanQuestions > 0)).length;
            return (
              <div key={domain.id} className="mb-4 last:mb-0">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    {domain.name} · {domain.weight}% of the exam
                  </h3>
                  <span className="text-xs text-zinc-500">
                    {proven} of {plural(domainRows.length, 'topic')} {mode === 'exam' ? 'attempted in exam mode' : 'with a clean result'}
                  </span>
                </div>
                <div className="divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800">
                  {domainRows.map((r) => (
                    <TopicLine key={r.topic.id} row={r} hidden={hidden.includes(r.topic.id)} onToggle={toggle} mode={mode} pace={pace} />
                  ))}
                </div>
              </div>
            );
          })
        )}
        <p className="mt-3 text-xs text-zinc-600">
          {hidden.length} topic{hidden.length === 1 ? '' : 's'} hidden from Scenarios. Untick to bring them back.
        </p>
      </Card>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { FocusMode, LabTopic } from '@cka/schema';
import { api, studioApi } from '../api';
import { AttemptReviewView } from '../components/AttemptReviewView';
import { Button, ErrorBanner } from '../components/ui';
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

const linkClass = 'shrink-0 text-sm font-medium text-sky-400 hover:text-sky-300';

/** A part of the page: a heading, optional controls, and its content, with no box around it. */
function Section({ title, note, actions, children }: { title: string; note?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-100">
          {title}
          {note && <span className="ml-2 text-sm font-normal text-zinc-500">{note}</span>}
        </h2>
        {actions}
      </div>
      {children}
    </section>
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
    <Section
      title={r.mode === 'mock' ? 'Exam review' : 'Lab review'}
      actions={
        attempts.length > 1 && (
          <select
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300"
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
    </Section>
  );
}

const domainShort = (topic: LabTopic) => DOMAINS.find((d) => d.id === topic.domain)?.short ?? topic.domain;
const groupName = (topic: LabTopic) => (topic.group === 'create' ? 'create' : 'troubleshoot');

/** One recommended topic: its name, one short line on why, and the way to practise it. */
function RecommendedTopic({ row, why, whyTitle }: { row: TopicRow; why: string; whyTitle?: string }) {
  return (
    <li className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[15px] font-medium text-zinc-100">
          {row.topic.label}{' '}
          <span className="text-sm font-normal text-zinc-500">
            {groupName(row.topic)} · {domainShort(row.topic)}
          </span>
        </div>
        <div className="mt-0.5 text-sm text-zinc-400" title={whyTitle}>
          {why}
        </div>
      </div>
      <Link to={`/?topic=${row.topic.id}`} className={linkClass}>
        Practice →
      </Link>
    </li>
  );
}

/** Columns of the topic tables; every domain's table uses the same, so they line up under one header. */
function TopicColumns({ mode }: { mode: FocusMode }) {
  return (
    <colgroup>
      <col className="w-10" />
      <col />
      <col className="w-24" />
      {mode === 'all' && <col className="hidden w-24 sm:table-column" />}
      <col className="hidden w-28 sm:table-column" />
      <col className="hidden w-28 sm:table-column" />
      <col className="w-28" />
    </colgroup>
  );
}

/** Rows light up as a whole on hover: the cells carry the background, since a row cannot round its corners. */
const hoverCell = 'transition group-hover:bg-zinc-900/70';
const numberCell = `${hoverCell} px-2 py-2.5 text-right tabular-nums`;

function TopicLine({ row, hidden, onToggle, mode, pace }: { row: TopicRow; hidden: boolean; onToggle: (id: string, hide: boolean) => void; mode: FocusMode; pace: number }) {
  const { stat } = row;
  const tried = stat.questions > 0;
  return (
    <tr className="group">
      <td className={`${hoverCell} rounded-l-lg py-2.5 pl-3`}>
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => onToggle(row.topic.id, e.target.checked)}
          title={hidden ? 'Hidden from Scenarios' : 'Hide from Scenarios'}
          aria-label={`Hide ${row.topic.label} from Scenarios`}
          className="h-4 w-4 accent-sky-600"
        />
      </td>
      <td className={`${hoverCell} truncate py-2.5 pr-3 text-[15px]`} title={scenariosNote(row)}>
        <span className={hidden ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-100'}>{row.topic.label}</span>{' '}
        <span className="text-sm text-zinc-500">{groupName(row.topic)}</span>
      </td>
      <td className={`${numberCell} text-[15px] font-medium ${tried ? percentClass(stat.recentPercent) : 'text-zinc-600'}`}>
        {tried ? `${stat.recentPercent}%` : '–'}
      </td>
      {mode === 'all' && (
        <td className={`${numberCell} hidden text-[15px] sm:table-cell ${percentClass(stat.cleanPercent)}`}>
          {stat.cleanPercent === undefined ? <span className="text-zinc-600">–</span> : `${stat.cleanPercent}%`}
        </td>
      )}
      <td className={`${numberCell} hidden text-sm text-zinc-400 sm:table-cell`}>{tried ? stat.questions : <span className="text-zinc-600">–</span>}</td>
      <td
        className={`${numberCell} hidden text-sm sm:table-cell ${stat.recentMinutes !== undefined && stat.recentMinutes > pace ? 'text-amber-300' : 'text-zinc-400'}`}
        title={`Exam pace is about ${pace} minutes per question`}
      >
        {stat.recentMinutes === undefined ? <span className="text-zinc-600">–</span> : `${stat.recentMinutes} min`}
      </td>
      <td className={`${hoverCell} rounded-r-lg py-2.5 pr-3 text-right`}>
        {/* Quiet until its row is hovered or focused: forty bright links would outshout the scores. */}
        <Link to={`/?topic=${row.topic.id}`} className="text-sm font-medium text-zinc-500 group-hover:text-sky-400 hover:text-sky-300 focus:text-sky-400">
          Practice →
        </Link>
      </td>
    </tr>
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

  /** Why a topic is worth working on, in a few words: its score, its pace, or how far it is from done. */
  const why = ({ stat }: TopicRow) => {
    const parts = [
      mode === 'exam' || stat.cleanQuestions === stat.questions
        ? `${stat.recentPercent}% recent`
        : stat.cleanPercent === undefined
          ? `no clean result · ${stat.recentPercent}% with help`
          : `${stat.cleanPercent}% clean · ${stat.recentPercent}% with help`,
    ];
    const over = minutesOver(stat, pace);
    if (over > 0) parts.push(`${over} min over pace`);
    // A perfect score on too few questions is not done yet: say how many more confirm it.
    if (stat.cleanPercent === 100 && stat.cleanQuestions < recent) parts.push(`${recent - stat.cleanQuestions} more clean to confirm`);
    return parts.join(' · ');
  };
  /** The weakest recent question, for a tooltip. */
  const weakest = ({ stat }: TopicRow) => {
    const w = stat.weakest;
    if (!w || w.percent >= 100) return undefined;
    // A single-question lab's question carries the lab's title.
    return `Weakest: ${w.title === w.scenarioTitle ? w.title : `${w.title} (${w.scenarioTitle})`}, ${w.percent}%`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-14 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Focus</h1>
          <p className="mt-1 text-[15px] text-zinc-400">What to practise next, from how your recent questions went.</p>
        </div>
        <div className="flex rounded-lg bg-zinc-900 p-1" role="radiogroup" aria-label="Attempts to score">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              title={m.title}
              onClick={() => setMode(m.id)}
              className={`rounded-md px-3 py-1.5 text-sm transition ${mode === m.id ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      <ErrorBanner error={catalog.error} />
      <ErrorBanner error={all.error} />
      <ErrorBanner error={scores.error} />

      <ExamReview topics={catalog.data?.topics ?? []} />

      {(recs.workOn.length > 0 || recs.blindSpots.length > 0) && (
        <Section title="Recommended focus" note={mode === 'exam' ? 'from exam mode' : undefined}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-zinc-900/70 p-5">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <h3 className="text-base font-semibold text-zinc-200">Work on next</h3>
                {mode === 'all' && recs.workOn.length > 0 && (
                  <Link to={`/?topic=${WEAK_SPOTS}`} className={linkClass} title="A Quick lab with one question on each of these topics">
                    Practise these →
                  </Link>
                )}
              </div>
              {recs.workOn.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  {!rows.some((r) => r.stat.questions > 0)
                    ? mode === 'exam'
                      ? 'No graded question in exam mode yet. Sit a Full mock, or tick Exam mode before you start a lab.'
                      : 'No graded question yet.'
                    : `Every practised topic has a clean 100% on ${recent} recent questions.`}
                </p>
              ) : (
                <ul className="space-y-4">
                  {recs.workOn.map((r) => (
                    <RecommendedTopic key={r.topic.id} row={r} why={why(r)} whyTitle={weakest(r)} />
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl bg-zinc-900/70 p-5">
              <h3 className="mb-4 text-base font-semibold text-zinc-200">Blind spots</h3>
              {recs.blindSpots.length === 0 ? (
                <p className="text-sm text-zinc-500">{mode === 'exam' ? 'Every topic has been attempted in exam mode.' : 'Every topic has been attempted.'}</p>
              ) : (
                <ul className="space-y-4">
                  {recs.blindSpots.slice(0, BLIND_SPOTS_SHOWN).map((r) => (
                    <RecommendedTopic key={r.topic.id} row={r} why={`${mode === 'exam' ? 'Not in exam mode yet' : 'Never attempted'} · ${scenariosNote(r)}`} />
                  ))}
                  {recs.blindSpots.length > BLIND_SPOTS_SHOWN && (
                    <li className="text-sm text-zinc-500">and {plural(recs.blindSpots.length - BLIND_SPOTS_SHOWN, 'more topic')}, in All topics below</li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </Section>
      )}

      <Section
        title="All topics"
        note="by exam domain"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="Search topics"
              aria-label="Search topics"
              className="w-48 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button variant="ghost" onClick={() => setHidden([])}>
              Show all
            </Button>
            <Button variant="ghost" onClick={() => setHidden([...hidden, ...shown.map((r) => r.topic.id)])}>
              Hide shown
            </Button>
          </div>
        }
      >
        {catalog.isLoading || all.isLoading || scores.isLoading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="text-sm text-zinc-500">No topics match.</div>
        ) : (
          <div className="space-y-8">
            <table className="w-full table-fixed text-sm text-zinc-500">
              <TopicColumns mode={mode} />
              <thead>
                <tr>
                  <th aria-label="Hidden from Scenarios" />
                  <th className="text-left font-normal">Topic</th>
                  <th className="px-2 text-right font-normal" title={`Score on the ${recent} most recent questions`}>
                    Recent
                  </th>
                  {mode === 'all' && (
                    <th className="hidden px-2 text-right font-normal sm:table-cell" title="Recent score without hints or the solution">
                      Clean
                    </th>
                  )}
                  <th className="hidden px-2 text-right font-normal sm:table-cell">Questions</th>
                  <th className="hidden px-2 text-right font-normal sm:table-cell">Per question</th>
                  <th />
                </tr>
              </thead>
            </table>
            {domainSections(shown).map(({ domain, rows: domainRows }) => {
              const proven = domainRows.filter((r) => (mode === 'exam' ? r.stat.questions > 0 : r.stat.cleanQuestions > 0)).length;
              return (
                <div key={domain.id}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 px-3">
                    <h3 className="text-base font-semibold text-zinc-200">
                      {domain.name} <span className="ml-1 text-sm font-normal text-zinc-500">{domain.weight}% of the exam</span>
                    </h3>
                    <span className="text-sm text-zinc-500">
                      {proven} of {domainRows.length} {mode === 'exam' ? 'tried in exam mode' : 'with a clean result'}
                    </span>
                  </div>
                  <table className="w-full table-fixed">
                    <TopicColumns mode={mode} />
                    <tbody>
                      {domainRows.map((r) => (
                        <TopicLine key={r.topic.id} row={r} hidden={hidden.includes(r.topic.id)} onToggle={toggle} mode={mode} pace={pace} />
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-6 px-3 text-sm text-zinc-500">
          {plural(hidden.length, 'topic')} hidden from Scenarios. Untick to bring them back.
        </p>
      </Section>

      <details className="text-sm text-zinc-400">
        <summary className="cursor-pointer font-medium text-zinc-300 hover:text-zinc-100">How scoring works</summary>
        <div className="mt-3 max-w-3xl space-y-2 leading-relaxed">
          <p>
            Each graded question counts toward its own topics with its own score, and a topic is scored on its {recent} most recent questions. Questions from
            the exam review count too: misses lower a topic's score.
          </p>
          <p>
            A clean result is one without hints or the solution. That is the score the recommendations go by, and a topic is only done at a clean 100% on{' '}
            {recent} questions within exam pace, about {pace} minutes per question.
          </p>
          <p>
            Work on next ranks topics by the points they miss plus {SLOW_POINTS} for each minute over pace. Tick a topic in All topics to hide its scenarios from
            the Scenarios tab, so what is left is what you still need to practise.
          </p>
        </div>
      </details>
    </div>
  );
}

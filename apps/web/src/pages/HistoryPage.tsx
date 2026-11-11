import { useQuery } from '@tanstack/react-query';
import type { AttemptRecord } from '@cka/schema';
import { api } from '../api';
import { ErrorBanner, PageHeader, percentClass, plural, Section, Stat } from '../components/ui';
import { DOMAINS } from '../focusTopics';
import { formatDuration } from '../hooks';

/** Slowest questions shown at the top; the rest are in each attempt. */
const SLOWEST_SHOWN = 8;

const domainName = (a: AttemptRecord) => (a.domain ? (DOMAINS.find((d) => d.id === a.domain)?.short ?? a.domain.replace(/-/g, ' ')) : undefined);

const secondsClass = (s: number) => (s > 600 ? 'text-red-400' : s > 420 ? 'text-amber-300' : 'text-zinc-400');

/** Rows light up as a whole on hover: the cells carry the background, since a row cannot round its corners. */
const hoverCell = 'transition group-hover:bg-zinc-900/70';
const cell = `${hoverCell} px-2 py-2.5 align-top`;

/** Hints and the solution, in a couple of words. */
function helpNote(a: AttemptRecord) {
  const parts = [a.hintsUsed > 0 && plural(a.hintsUsed, 'hint'), a.solutionViewed && 'solution'].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function AttemptLine({ a }: { a: AttemptRecord }) {
  const pct = a.score !== undefined && a.maxScore ? Math.round((a.score / a.maxScore) * 100) : undefined;
  const timed = a.tasks?.filter((t) => t.seconds > 0) ?? [];
  const help = helpNote(a);
  const when = new Date(a.startedAt);
  return (
    <tr className="group">
      <td className={`${cell} rounded-l-lg pl-3 whitespace-nowrap text-zinc-500`} title={when.toLocaleString()}>
        {when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
      </td>
      <td className={`${cell} min-w-0`}>
        <div className="truncate text-[15px] text-zinc-100" title={a.scenarioTitle}>
          {a.scenarioTitle}
          <span className="ml-2 text-sm text-zinc-500">{[a.mode === 'mock' ? 'exam' : a.mode, domainName(a)].filter(Boolean).join(' · ')}</span>
        </div>
        {timed.length > 1 && (
          <details className="mt-1 text-sm">
            <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">Minutes per question</summary>
            <ul className="mt-2 mb-1 space-y-1">
              {a.tasks!.map((t, i) => (
                <li key={t.id} className="flex gap-3 text-zinc-400">
                  <span className={`w-14 shrink-0 text-right tabular-nums ${secondsClass(t.seconds)}`}>{formatDuration(t.seconds)}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-300">
                    Q{i + 1}. {t.title}
                  </span>
                  {t.maxScore ? (
                    <span className={`tabular-nums ${t.score === t.maxScore ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      {t.score}/{t.maxScore}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
      <td className={`${cell} text-right text-[15px] font-medium whitespace-nowrap tabular-nums ${percentClass(pct)}`} title={pct === undefined ? 'Not graded' : `${a.score}/${a.maxScore} points`}>
        {pct === undefined ? <span className="text-zinc-600">–</span> : `${pct}%`}
      </td>
      <td
        className={`${cell} hidden text-right text-sm whitespace-nowrap text-zinc-400 tabular-nums sm:table-cell`}
        title={a.pausedS ? `Paused for ${formatDuration(a.pausedS)}, not counted` : undefined}
      >
        {a.durationS !== undefined ? formatDuration(a.durationS) : <span className="text-zinc-600">–</span>}
      </td>
      <td className={`${cell} hidden rounded-r-lg pr-3 text-right text-sm whitespace-nowrap sm:table-cell ${a.solutionViewed ? 'text-amber-300' : 'text-zinc-500'}`}>
        {help ?? <span className="text-zinc-600">–</span>}
      </td>
    </tr>
  );
}

export function HistoryPage() {
  const { data, error, isLoading } = useQuery({ queryKey: ['history'], queryFn: api.history });
  const attempts = data?.attempts ?? [];
  const graded = attempts.filter((a) => a.score !== undefined && a.maxScore);
  const avg = graded.length ? Math.round(graded.reduce((s, a) => s + (a.score! / a.maxScore!) * 100, 0) / graded.length) : undefined;
  const passed = graded.filter((a) => a.score === a.maxScore).length;
  // Questions you spent the most time on, across recent attempts: where the clock goes.
  const slowest = attempts
    .flatMap((a) => (a.tasks ?? []).filter((t) => t.seconds >= 30).map((t) => ({ ...t, attempt: a })))
    .sort((x, y) => y.seconds - x.seconds)
    .slice(0, SLOWEST_SHOWN);

  return (
    <div className="mx-auto max-w-5xl space-y-14 pb-10">
      <PageHeader title="History" intro="Every attempt, newest first, and where the time went." />

      <div className="flex flex-wrap gap-x-14 gap-y-5">
        <Stat value={attempts.length} label="attempts" />
        <Stat value={avg === undefined ? '–' : `${avg}%`} label="average score" className={percentClass(avg)} />
        <Stat value={`${passed}/${graded.length}`} label="full marks" />
      </div>

      <ErrorBanner error={error} />

      {slowest.length > 0 && (
        <Section title="Slowest questions" note="the exam allows about 7 minutes each">
          <ul className="space-y-1">
            {slowest.map((t) => (
              <li key={`${t.attempt.id}-${t.id}`} className="flex items-baseline gap-4 rounded-lg px-3 py-2 transition hover:bg-zinc-900/70">
                <span className={`w-14 shrink-0 text-right text-[15px] font-medium tabular-nums ${secondsClass(t.seconds)}`}>{formatDuration(t.seconds)}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] text-zinc-100" title={t.attempt.scenarioTitle}>
                  {t.title}
                  {t.attempt.scenarioTitle !== t.title && <span className="ml-2 text-sm text-zinc-500">{t.attempt.scenarioTitle}</span>}
                </span>
                <span className={`shrink-0 text-sm tabular-nums ${t.maxScore && t.score === t.maxScore ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  {t.maxScore ? `${t.score}/${t.maxScore} pt` : 'not graded'}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Attempts" note={attempts.length > 0 ? plural(attempts.length, 'attempt') : undefined}>
        {isLoading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : attempts.length === 0 ? (
          <div className="text-sm text-zinc-500">No attempts yet.</div>
        ) : (
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-24" />
              <col />
              <col className="w-20" />
              <col className="hidden w-24 sm:table-column" />
              <col className="hidden w-36 sm:table-column" />
            </colgroup>
            <thead className="text-sm text-zinc-500">
              <tr>
                <th className="pb-2 pl-3 text-left font-normal">When</th>
                <th className="px-2 pb-2 text-left font-normal">Scenario</th>
                <th className="px-2 pb-2 text-right font-normal">Score</th>
                <th className="hidden px-2 pb-2 text-right font-normal sm:table-cell">Time</th>
                <th className="hidden pr-3 pb-2 text-right font-normal sm:table-cell">Help</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <AttemptLine key={a.id} a={a} />
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

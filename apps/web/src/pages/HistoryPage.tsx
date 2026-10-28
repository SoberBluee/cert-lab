import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card, DomainBadge, ErrorBanner } from '../components/ui';
import { formatDuration } from '../hooks';

export function HistoryPage() {
  const { data, error, isLoading } = useQuery({ queryKey: ['history'], queryFn: api.history });
  const attempts = data?.attempts ?? [];
  const graded = attempts.filter((a) => a.score !== undefined && a.maxScore);
  const avg = graded.length
    ? Math.round(graded.reduce((s, a) => s + (a.score! / a.maxScore!) * 100, 0) / graded.length)
    : undefined;
  const passed = graded.filter((a) => a.score === a.maxScore).length;
  // Questions you spent the most time on, across recent attempts: where the clock goes.
  const slowest = attempts
    .flatMap((a) => (a.tasks ?? []).filter((t) => t.seconds >= 30).map((t) => ({ ...t, attempt: a })))
    .sort((x, y) => y.seconds - x.seconds)
    .slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['Attempts', String(attempts.length)],
          ['Average score', avg === undefined ? '-' : `${avg}%`],
          ['Full marks', `${passed}/${graded.length}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
            <div className="text-xs text-zinc-500 uppercase">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
          </div>
        ))}
      </div>
      <ErrorBanner error={error} />
      {slowest.length > 0 && (
        <Card title="Slowest questions">
          <p className="mb-3 text-xs text-zinc-500">
            Time each question was open on screen. The exam allows about 7 minutes per question; anything well above that is a topic to drill.
          </p>
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-zinc-800">
              {slowest.map((t) => (
                <tr key={`${t.attempt.id}-${t.id}`}>
                  <td className={`py-1.5 pr-4 font-mono whitespace-nowrap ${t.seconds > 600 ? 'text-red-400' : t.seconds > 420 ? 'text-amber-300' : 'text-zinc-300'}`}>
                    {formatDuration(t.seconds)}
                  </td>
                  <td className="py-1.5 pr-4 text-zinc-200">{t.title}</td>
                  <td className="py-1.5 pr-4 text-xs text-zinc-500">{t.attempt.scenarioTitle}</td>
                  <td className="py-1.5 text-xs whitespace-nowrap text-zinc-400">{t.maxScore ? `${t.score}/${t.maxScore} pt` : 'not graded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Card title="Attempts">
        {isLoading ? (
          <div className="text-zinc-500">Loading…</div>
        ) : attempts.length === 0 ? (
          <div className="text-sm text-zinc-500">No attempts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500 uppercase">
                <tr>
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Scenario</th>
                  <th className="py-2 pr-4 font-medium">Score</th>
                  <th className="py-2 pr-4 font-medium">Time</th>
                  <th className="py-2 pr-4 font-medium">Help</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {attempts.map((a) => {
                  const pct = a.score !== undefined && a.maxScore ? Math.round((a.score / a.maxScore) * 100) : undefined;
                  return (
                    <tr key={a.id}>
                      <td className="py-2 pr-4 whitespace-nowrap text-zinc-400">{new Date(a.startedAt).toLocaleString()}</td>
                      <td className="py-2 pr-4">
                        <div className="text-zinc-200">{a.scenarioTitle}</div>
                        <div className="mt-0.5 flex items-center gap-2">
                          {a.domain && <DomainBadge domain={a.domain} />}
                          <span className="font-mono text-xs text-zinc-500">{a.mode}</span>
                        </div>
                        {a.tasks && a.tasks.some((t) => t.seconds > 0) && (
                          <details className="mt-1 text-xs">
                            <summary className="cursor-pointer text-zinc-500">Minutes per question</summary>
                            <ul className="mt-1 space-y-0.5">
                              {a.tasks.map((t, i) => (
                                <li key={t.id} className="flex gap-3 text-zinc-400">
                                  <span className="w-14 shrink-0 font-mono">{formatDuration(t.seconds)}</span>
                                  <span className="text-zinc-300">
                                    Q{i + 1}. {t.title}
                                  </span>
                                  {t.maxScore ? (
                                    <span className={t.score === t.maxScore ? 'text-emerald-400' : 'text-zinc-500'}>
                                      {t.score}/{t.maxScore} pt
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {pct === undefined ? (
                          <span className="text-zinc-600">not graded</span>
                        ) : (
                          <span className={pct === 100 ? 'text-emerald-400' : pct >= 66 ? 'text-amber-300' : 'text-red-400'}>
                            {a.score}/{a.maxScore} ({pct}%)
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 font-mono text-zinc-400">
                        {a.durationS !== undefined ? formatDuration(a.durationS) : '-'}
                        {a.pausedS ? (
                          <div className="font-sans text-xs text-zinc-500" title="The exam was paused; the time above leaves the pauses out">
                            paused {formatDuration(a.pausedS)}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 text-xs text-zinc-400">
                        {a.hintsUsed > 0 && <span className="mr-2">{a.hintsUsed} hint{a.hintsUsed === 1 ? '' : 's'}</span>}
                        {a.solutionViewed && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">assisted</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

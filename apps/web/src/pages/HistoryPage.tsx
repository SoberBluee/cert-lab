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
                      <td className="py-2 pr-4 font-mono text-zinc-400">{a.durationS !== undefined ? formatDuration(a.durationS) : '-'}</td>
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

import type { CheckResult, GradeResult } from '@cka/schema';
import { formatDuration } from '../hooks';

function CheckRow({ c }: { c: CheckResult }) {
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-950/60">
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              c.passed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
            }`}
          >
            {c.passed ? '✓' : '✗'}
          </span>
          <span className="flex-1 text-sm text-zinc-200">{c.description}</span>
          <span className="text-xs text-zinc-500">
            {c.passed ? c.weight : 0}/{c.weight} pt
          </span>
        </summary>
        <div className="border-t border-zinc-800 px-3 py-2">
          {!c.passed && <div className="mb-2 text-xs text-red-300">{c.detail}</div>}
          <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap text-zinc-400">{c.output}</pre>
        </div>
      </details>
    </li>
  );
}

export function GradeResultView({ result }: { result: GradeResult }) {
  const color = result.allPassed ? 'text-emerald-400' : result.percent >= 66 ? 'text-amber-300' : 'text-red-400';
  const byId = new Map(result.checks.map((c) => [c.id, c]));
  const groups = result.tasks && result.tasks.length > 1 ? result.tasks : undefined;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div className={`text-3xl font-bold ${color}`}>
          {result.score}/{result.maxScore}
          <span className="ml-2 text-lg font-medium">({result.percent}%)</span>
        </div>
        <div className="text-sm text-zinc-400">time {formatDuration(result.elapsedS)}</div>
        <div className="text-xs text-zinc-500">graded {new Date(result.gradedAt).toLocaleTimeString()}</div>
      </div>
      {groups ? (
        <div className="space-y-4">
          {groups.map((t, i) => (
            <div key={t.id}>
              <div className="mb-1.5 flex items-baseline gap-2 text-sm">
                <span className="font-semibold text-zinc-200">
                  Q{i + 1}. {t.title}
                </span>
                <span className={`ml-auto text-xs ${t.score === t.maxScore ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {t.score}/{t.maxScore} pt
                </span>
              </div>
              <ul className="space-y-1.5">
                {t.checkIds.map((id) => {
                  const c = byId.get(id);
                  return c && <CheckRow key={id} c={c} />;
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {result.checks.map((c) => (
            <CheckRow key={c.id} c={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

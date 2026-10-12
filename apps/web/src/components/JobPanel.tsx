import type { StudioJob } from '../api';
import { GradeResultView } from './GradeResultView';
import { Button } from './ui';

export function JobPanel({ job, progress, onDismiss }: { job: StudioJob; progress: { at: string; message: string }[]; onDismiss: () => void }) {
  const tone =
    job.state === 'running'
      ? 'border-sky-800 bg-sky-950/30'
      : job.state === 'passed'
        ? 'border-emerald-800 bg-emerald-950/30'
        : 'border-red-800 bg-red-950/30';
  const expectation =
    job.kind === 'dry-run' ? 'setup breaks the cluster, so the grade is below the maximum' : 'the solution makes every check pass';
  return (
    <div className={`space-y-3 rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium text-zinc-100">
          {job.kind === 'dry-run' ? 'Dry-run' : 'Verify'}: {job.state === 'running' ? 'running…' : job.state}
        </span>
        <span className="text-xs text-zinc-400">passes when {expectation}</span>
        {job.vars && (
          <span className="ml-auto font-mono text-xs text-zinc-500">
            {Object.entries(job.vars)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ')}
          </span>
        )}
        {job.state !== 'running' && (
          <Button variant="ghost" className={job.vars ? '' : 'ml-auto'} onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
      {job.state === 'running' && progress.length > 0 && (
        <pre className="max-h-32 overflow-auto rounded bg-zinc-950/70 p-2 font-mono text-[11px] text-zinc-400">
          {progress
            .slice(-8)
            .map((p) => p.message)
            .join('\n')}
        </pre>
      )}
      {job.error && <div className="text-sm text-red-300">{job.error}</div>}
      {job.result && <GradeResultView result={job.result} />}
    </div>
  );
}

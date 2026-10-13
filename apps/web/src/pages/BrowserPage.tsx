import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ScenarioSummary } from '@cka/schema';
import { DOMAINS } from '@cka/schema/constants';
import { api, type ScenarioFilters } from '../api';
import { Button, Difficulty, DomainBadge, ErrorBanner, StateBadge } from '../components/ui';
import { isActive, sessionKey, useExamMode, useSession } from '../hooks';

const select = 'rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-200';

function StatsLine({ s }: { s: ScenarioSummary }) {
  const { stats } = s;
  if (!stats.attempts) return <span className="text-zinc-500">never attempted</span>;
  const passed = stats.lastScore === stats.lastMaxScore;
  return (
    <span className="text-zinc-400">
      best <span className="text-zinc-200">{stats.bestPercent}%</span> · last{' '}
      <span className={passed ? 'text-emerald-400' : 'text-red-400'}>
        {stats.lastScore}/{stats.lastMaxScore}
      </span>{' '}
      · {stats.attempts} attempt{stats.attempts === 1 ? '' : 's'}
    </span>
  );
}

export function BrowserPage() {
  const [filters, setFilters] = useState<ScenarioFilters>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSession().data;
  const active = isActive(session);

  const all = useQuery({ queryKey: ['scenarios', {}], queryFn: () => api.scenarios() });
  const filtered = useQuery({ queryKey: ['scenarios', filters], queryFn: () => api.scenarios(filters) });
  const images = useQuery({ queryKey: ['images'], queryFn: api.images, retry: false });

  const tags = useMemo(
    () => [...new Set(all.data?.scenarios.flatMap((s) => s.tags) ?? [])].sort(),
    [all.data],
  );
  const missingImages = images.data?.filter((i) => !i.available).map((i) => i.name) ?? [];

  const [exam] = useExamMode();
  const start = useMutation({
    mutationFn: (id: string) => api.start(id, exam ? 'mock' : 'practice'),
    onSuccess: (view) => {
      qc.setQueryData(sessionKey, view);
      navigate('/session');
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const set = (k: keyof ScenarioFilters) => (e: { target: { value: string } }) =>
    setFilters((f) => ({ ...f, [k]: e.target.value || undefined }));

  return (
    <div className="space-y-5">
      {session && (
        <div className="flex items-center justify-between rounded-xl border border-sky-800/60 bg-sky-950/30 px-4 py-3">
          <div className="flex items-center gap-3 text-sm">
            <StateBadge state={session.state} />
            <span>
              Session in progress: <span className="font-medium text-zinc-100">{session.scenarioTitle}</span>
            </span>
          </div>
          <Link to="/session" className="text-sm font-medium text-sky-400 hover:text-sky-300">
            Open session →
          </Link>
        </div>
      )}

      {missingImages.length > 0 && (
        <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Base image{missingImages.length > 1 ? 's' : ''} <b>{missingImages.join(', ')}</b> not built yet. Run{' '}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-amber-100">./cka images build</code> once (15-25 minutes).
        </div>
      )}
      {images.error && (
        <ErrorBanner error={new Error(`Could not query the lab backend: ${(images.error as Error).message}`)} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={searchRef}
          placeholder="Search  ( / )"
          className={`${select} w-56 placeholder:text-zinc-600`}
          value={filters.search ?? ''}
          onChange={set('search')}
        />
        <select className={select} value={filters.domain ?? ''} onChange={set('domain')}>
          <option value="">All domains</option>
          {DOMAINS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select className={select} value={filters.difficulty ?? ''} onChange={set('difficulty')}>
          <option value="">Any difficulty</option>
          <option value="1">Easy</option>
          <option value="2">Medium</option>
          <option value="3">Hard</option>
        </select>
        <select className={select} value={filters.tag ?? ''} onChange={set('tag')}>
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select className={select} value={filters.status ?? ''} onChange={set('status')}>
          <option value="">Any status</option>
          <option value="never">Never attempted</option>
          <option value="failed">Failed last time</option>
          <option value="passed">Passed last time</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={filters.drafts === '1'}
            onChange={(e) => setFilters((f) => ({ ...f, drafts: e.target.checked ? '1' : undefined }))}
          />
          Show drafts
        </label>
        {Object.values(filters).some(Boolean) && (
          <Button variant="ghost" onClick={() => setFilters({})}>
            Clear
          </Button>
        )}
        <span className="ml-auto text-sm text-zinc-500">{filtered.data?.scenarios.length ?? 0} scenarios</span>
      </div>

      <ErrorBanner error={start.error} onDismiss={() => start.reset()} />
      <ErrorBanner error={filtered.error} />
      {all.data?.errors.map((e) => (
        <ErrorBanner key={e.file} error={new Error(`Invalid scenario ${e.file}:\n${e.messages.join('\n')}`)} />
      ))}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.data?.scenarios.map((s) => (
          <article key={s.id} className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-zinc-700">
            <div className="mb-2 flex items-center justify-between gap-2">
              <DomainBadge domain={s.domain} />
              <Difficulty level={s.difficulty} />
            </div>
            <h3 className="font-semibold text-zinc-100">{s.title}</h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-xs text-zinc-500">
              {s.id}
              {s.taskCount > 1 && <span className="rounded bg-sky-500/10 px-1.5 py-0.5 font-sans text-[11px] text-sky-300">{s.taskCount} questions</span>}
              {s.variableNames.length > 0 && (
                <span
                  className="rounded bg-violet-500/10 px-1.5 py-0.5 font-sans text-[11px] text-violet-300"
                  title={`Names and values change on every start: ${s.variableNames.join(', ')}`}
                >
                  randomized
                </span>
              )}
              {s.draft && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-sans text-[11px] text-amber-300">draft</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {s.tags.map((t) => (
                <button
                  key={t}
                  onClick={() => setFilters((f) => ({ ...f, tag: t }))}
                  className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200"
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="mt-3 text-xs">
              <StatsLine s={s} />
            </div>
            <div className="mt-auto flex items-center justify-between pt-4">
              <span className="text-xs text-zinc-500">
                ~{s.estimatedMinutes} min · {s.points} pts · {s.base}
              </span>
              <Button
                variant="primary"
                disabled={active || start.isPending}
                title={active ? 'End the current session first' : undefined}
                onClick={() => start.mutate(s.id)}
              >
                {start.isPending && start.variables === s.id ? 'Starting…' : exam ? 'Start exam' : 'Start'}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { LabTopic, LessonTrack, ScenarioSummary } from '@cka/schema';
import { DOMAINS } from '@cka/schema/constants';
import { api, studioApi, type ScenarioFilters } from '../api';
import { Button, Difficulty, DomainBadge, ErrorBanner, StateBadge } from '../components/ui';
import { scenarioTopics } from '../focusTopics';
import { isActive, sessionKey, useExamMode, useHiddenTopics, useSession } from '../hooks';
import { RANDOM_MAX, randomLab, toRequest, type LabKind } from '../quickRandom';
import { SECTIONS } from '../section';

const KIND_LABELS: Record<LabKind, string> = { create: 'Create', troubleshoot: 'Troubleshoot', random: 'Random' };

const topicOptions = (topics: LabTopic[]) =>
  topics.map((t) => (
    <option key={t.id} value={t.id}>
      {t.label}
    </option>
  ));

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

export function BrowserPage({ track = 'cka' }: { track?: LessonTrack }) {
  const base = SECTIONS[track].base;
  const sessionPath = `${base}/session` || '/session';
  const [filters, setFilters] = useState<ScenarioFilters>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSession().data;
  const active = isActive(session);
  const recipesReady = track === 'cka';

  const baseFilter: ScenarioFilters = { track };
  const queryFilters = { ...filters, ...baseFilter };
  const all = useQuery({ queryKey: ['scenarios', baseFilter], queryFn: () => api.scenarios(baseFilter) });
  const filtered = useQuery({ queryKey: ['scenarios', queryFilters], queryFn: () => api.scenarios(queryFilters) });
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
      navigate(sessionPath);
    },
  });

  const catalog = useQuery({
    queryKey: ['recipes'],
    queryFn: () => studioApi.recipes(),
    staleTime: Infinity,
    enabled: recipesReady,
  });
  const [hiddenTopics] = useHiddenTopics();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusTopic = searchParams.get('topic');
  const focusLabel = focusTopic ? catalog.data?.topics.find((t) => t.id === focusTopic)?.label : undefined;

  // Focus page preferences: a practised topic shows only its scenarios; otherwise hidden topics are dropped.
  const visibleScenarios = useMemo(() => {
    const list = filtered.data?.scenarios ?? [];
    if (!catalog.data) return list;
    if (focusTopic) return list.filter((s) => scenarioTopics(s, catalog.data).includes(focusTopic));
    if (!hiddenTopics.length) return list;
    const hidden = new Set(hiddenTopics);
    return list.filter((s) => !scenarioTopics(s, catalog.data).some((id) => hidden.has(id)));
  }, [filtered.data, catalog.data, focusTopic, hiddenTopics]);
  const [labKind, setLabKind] = useState<LabKind>('random');
  const [labTopic, setLabTopic] = useState('any');
  const [labCount, setLabCount] = useState('1');
  const [labPhase, setLabPhase] = useState<'generating' | 'starting'>('generating');
  const topics = catalog.data?.topics ?? [];
  const topicChoices = topics.filter((t) => labKind === 'random' || t.group === labKind);
  const chosenTopic = topicChoices.find((t) => t.id === labTopic);
  const topicIds = topicChoices.map((t) => t.id).join('\n');
  const quickStart = useMutation({
    mutationFn: async ({ kind, n, topic }: { kind: LabKind; n: number; topic?: LabTopic }) => {
      setLabPhase('generating');
      const questions = await randomLab(catalog.data!, n, kind, topic);
      const id = `quick-lab-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
      await studioApi.quickCreate({ ...toRequest(questions, id, `Quick lab: ${topic?.label ?? KIND_LABELS[kind]}`), dryRun: false });
      setLabPhase('starting');
      qc.invalidateQueries({ queryKey: ['scenarios'] });
      try {
        return await api.start(id, exam ? 'mock' : 'practice');
      } catch (e) {
        throw new Error(`Created draft ${id} but could not start it: ${(e as Error).message}`);
      }
    },
    onSuccess: (view) => {
      qc.setQueryData(sessionKey, view);
      navigate(sessionPath);
    },
  });
  const labN = Math.min(RANDOM_MAX, Math.max(1, Math.floor(Number(labCount)) || 1));

  useEffect(() => {
    if (labTopic !== 'any' && !topicIds.split('\n').includes(labTopic)) setLabTopic('any');
  }, [labTopic, topicIds]);

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
          <Link to={sessionPath} className="text-sm font-medium text-sky-400 hover:text-sky-300">
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
        <span className="ml-auto text-sm text-zinc-500">{visibleScenarios.length} scenarios</span>
      </div>

      {recipesReady && focusTopic ? (
        <div className="flex items-center justify-between rounded-xl border border-sky-800/60 bg-sky-950/30 px-4 py-2.5 text-sm text-sky-200">
          <span>
            Practising: <span className="font-medium text-zinc-100">{focusLabel ?? focusTopic}</span>
          </span>
          <button
            className="font-medium text-sky-400 hover:text-sky-300"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('topic');
              setSearchParams(next);
            }}
          >
            Show all scenarios
          </button>
        </div>
      ) : (
        recipesReady &&
        hiddenTopics.length > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-400">
            <span>
              {hiddenTopics.length} topic{hiddenTopics.length === 1 ? '' : 's'} hidden in Focus
            </span>
            <Link to="/focus" className="font-medium text-sky-400 hover:text-sky-300">
              Manage →
            </Link>
          </div>
        )
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-300">Quick lab</span>
        <select
          className={select}
          value={labKind}
          onChange={(e) => setLabKind(e.target.value as LabKind)}
          disabled={quickStart.isPending || !recipesReady}
        >
          {(Object.keys(KIND_LABELS) as LabKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select
          className={select}
          value={chosenTopic?.id ?? 'any'}
          onChange={(e) => setLabTopic(e.target.value)}
          disabled={quickStart.isPending || !catalog.data || !recipesReady}
        >
          <option value="any">Any</option>
          {labKind === 'random' ? (
            <>
              <optgroup label="Create">{topicOptions(topicChoices.filter((t) => t.group === 'create'))}</optgroup>
              <optgroup label="Troubleshoot">{topicOptions(topicChoices.filter((t) => t.group === 'troubleshoot'))}</optgroup>
            </>
          ) : (
            topicOptions(topicChoices)
          )}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-zinc-400">
          <input
            type="number"
            min={1}
            max={RANDOM_MAX}
            className={`${select} w-16`}
            value={labCount}
            onChange={(e) => setLabCount(e.target.value)}
            disabled={quickStart.isPending || !recipesReady}
          />
          question{labN === 1 ? '' : 's'}
        </label>
        <Button
          variant="primary"
          disabled={active || !recipesReady || !catalog.data || quickStart.isPending || start.isPending}
          title={
            !recipesReady
              ? 'Linux Quick lab recipes are not available yet'
              : active
                ? 'End the current session first'
                : catalog.error
                  ? 'Could not load the recipe catalog'
                  : undefined
          }
          onClick={() => quickStart.mutate({ kind: labKind, n: labN, topic: chosenTopic })}
        >
          {quickStart.isPending ? (labPhase === 'generating' ? 'Generating…' : 'Starting…') : exam ? 'Start exam' : 'Start'}
        </Button>
        <span className="text-xs text-zinc-500">
          {!recipesReady
            ? 'Linux Quick lab recipes are not available yet.'
            : chosenTopic
              ? `Questions from ${chosenTopic.label}, saved as a hidden draft.`
              : 'A random lab from the recipe catalog, saved as a hidden draft.'}
        </span>
      </div>

      <ErrorBanner error={quickStart.error} onDismiss={() => quickStart.reset()} />
      <ErrorBanner error={catalog.error} />
      <ErrorBanner error={start.error} onDismiss={() => start.reset()} />
      <ErrorBanner error={filtered.error} />
      {all.data?.errors.map((e) => (
        <ErrorBanner key={e.file} error={new Error(`Invalid scenario ${e.file}:\n${e.messages.join('\n')}`)} />
      ))}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleScenarios.map((s) => (
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
                disabled={active || start.isPending || quickStart.isPending}
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

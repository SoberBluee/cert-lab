import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Domain, LabTopic, LessonTrack, ScenarioSummary } from '@cka/schema';
import { AWS_DOMAINS, DOMAINS } from '@cka/schema/constants';
import { api, studioApi, type ScenarioFilters } from '../api';
import { Button, ErrorBanner, fieldClass, linkClass, Notice, PageHeader, percentClass, plural, Section } from '../components/ui';
import { DOMAINS as CKA_DOMAINS, recommendations, topicRows } from '../focusTopics';
import { formatDuration, isActive, sessionKey, useExamMode, useHiddenTopics, useSession } from '../hooks';
import { fullMock, MOCK_MINUTES, MOCK_QUESTIONS, RANDOM_MAX, randomLab, toRequest, WEAK_SPOTS, weakSpotsLab, type Depth, type LabKind } from '../quickRandom';
import { SECTIONS } from '../section';

const KIND_LABELS: Record<LabKind, string> = { create: 'Create', troubleshoot: 'Troubleshoot', random: 'Random' };

const topicOptions = (topics: LabTopic[]) =>
  topics.map((t) => (
    <option key={t.id} value={t.id}>
      {t.label}
    </option>
  ));

const select = fieldClass;

const DIFFICULTY = ['', 'Easy', 'Medium', 'Hard'];

/** The domains in the order the page lists them: the CKA's heaviest first, the AWS exam's in its own order. */
function domainGroups(domains: readonly Domain[]): { id: Domain; name: string; short: string; note?: string }[] {
  return domains
    .map((id) => {
      const cka = CKA_DOMAINS.find((d) => d.id === id);
      const name = cka?.name ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
      return { id, name, short: cka?.short ?? name, note: cka && `${cka.weight}% of the exam`, weight: cka?.weight ?? 0 };
    })
    .sort((a, b) => b.weight - a.weight);
}

/** What a scenario has besides its title, in a few words. */
const scenarioNote = (s: ScenarioSummary) => (s.taskCount > 1 ? `${s.taskCount} questions` : '');

const lastPercent = ({ stats }: ScenarioSummary) =>
  stats.attempts && stats.lastMaxScore ? Math.round(((stats.lastScore ?? 0) / stats.lastMaxScore) * 100) : undefined;

/** Tags shown on a card; the rest are counted. */
const TAGS_SHOWN = 3;

/** The card's score line: the last score, the best when it differs, and how many attempts. */
function ScoreLine({ s }: { s: ScenarioSummary }) {
  const { stats } = s;
  const last = lastPercent(s);
  if (last === undefined) return <span className="text-zinc-600">Not tried yet</span>;
  return (
    <span className="text-zinc-500 tabular-nums">
      <span className={`font-medium ${percentClass(last)}`}>{last}%</span> last
      {stats.bestPercent !== undefined && stats.bestPercent !== last && <> · best {stats.bestPercent}%</>}
      {' · '}
      {plural(stats.attempts, 'attempt')}
    </span>
  );
}

/**
 * One scenario, the whole card a button that starts it. On hover it lifts a little, takes a sky outline and glow,
 * and its Start slides in; with reduced motion it only lights up.
 */
function ScenarioTile({
  s,
  label,
  starting,
  disabled,
  title,
  onStart,
}: {
  s: ScenarioSummary;
  label: string;
  starting: boolean;
  disabled: boolean;
  title?: string;
  onStart: () => void;
}) {
  const details = [DIFFICULTY[s.difficulty], `~${s.estimatedMinutes} min`, `${s.points} pts`, scenarioNote(s)].filter(Boolean).join(' · ');
  const extraTags = s.tags.length - TAGS_SHOWN;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onStart}
      title={title ?? [s.id, s.variableNames.length ? 'New names and values on every start' : ''].filter(Boolean).join('\n')}
      className={`group relative flex flex-col overflow-hidden rounded-xl bg-zinc-900/70 p-4 text-left ring-1 ring-transparent transition duration-200 ease-out
        enabled:cursor-pointer enabled:hover:bg-zinc-800/70 enabled:hover:shadow-lg enabled:hover:shadow-sky-500/10 enabled:hover:ring-sky-500/50
        motion-safe:enabled:hover:-translate-y-0.5 motion-safe:enabled:active:translate-y-0 enabled:active:bg-zinc-800
        focus-visible:outline-none focus-visible:ring-sky-500/70 disabled:cursor-not-allowed ${starting ? 'ring-sky-500/70' : ''}`}
    >
      {/* A soft sky light from the top left corner, faded in on hover. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-linear-to-br from-sky-500/15 via-sky-500/0 to-transparent transition-opacity duration-300 ${
          starting ? 'opacity-100' : 'opacity-0 group-enabled:group-hover:opacity-100 group-focus-visible:opacity-100'
        }`}
      />
      <span className="relative line-clamp-2 text-[15px] font-medium text-zinc-100">{s.title}</span>
      <span className="relative mt-1 text-sm text-zinc-500">
        {details}
        {s.draft && <span className="ml-2 text-amber-300/80">draft</span>}
      </span>
      {s.tags.length > 0 && (
        <span className="relative mt-3 flex flex-wrap items-center gap-1.5">
          {s.tags.slice(0, TAGS_SHOWN).map((t) => (
            <span key={t} className="rounded-md bg-zinc-800/80 px-1.5 py-0.5 text-xs text-zinc-400">
              {t}
            </span>
          ))}
          {extraTags > 0 && (
            <span className="text-xs text-zinc-600" title={s.tags.slice(TAGS_SHOWN).join(', ')}>
              +{extraTags}
            </span>
          )}
        </span>
      )}
      <span className="relative mt-auto flex items-baseline justify-between gap-3 pt-4 text-sm">
        <ScoreLine s={s} />
        <span
          className={`shrink-0 font-medium transition duration-200 ${
            starting
              ? 'animate-pulse text-sky-300'
              : 'text-zinc-600 group-enabled:group-hover:text-sky-400 group-focus-visible:text-sky-400 motion-safe:group-enabled:group-hover:translate-x-0.5'
          }`}
        >
          {label}
        </span>
      </span>
    </button>
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
  // aws scenarios run on Floci, not the lab VMs: no base images, no Quick lab recipes.
  const aws = track === 'aws';
  const domains = aws ? AWS_DOMAINS : DOMAINS;

  const baseFilter: ScenarioFilters = { track };
  const queryFilters = { ...filters, ...baseFilter };
  const all = useQuery({ queryKey: ['scenarios', baseFilter], queryFn: () => api.scenarios(baseFilter) });
  const filtered = useQuery({ queryKey: ['scenarios', queryFilters], queryFn: () => api.scenarios(queryFilters) });
  const images = useQuery({ queryKey: ['images'], queryFn: api.images, retry: false, enabled: !aws });

  const tags = useMemo(
    () => [...new Set(all.data?.scenarios.flatMap((s) => s.tags) ?? [])].sort(),
    [all.data],
  );
  const missingImages = images.data?.filter((i) => !i.available && i.name !== 'floci').map((i) => i.name) ?? [];

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
  // The Focus "Work on next" topics, most needed first: what a Weak spots lab practises.
  const focus = useQuery({ queryKey: ['focus', 'all'], queryFn: () => api.topicScores('all'), enabled: recipesReady });
  const weakTopics = useMemo(
    () =>
      catalog.data && focus.data
        ? recommendations(topicRows(catalog.data.topics, focus.data, []), focus.data.recent, focus.data.paceMinutes).workOn.map((r) => r.topic)
        : [],
    [catalog.data, focus.data],
  );
  const weakFocus = focusTopic === WEAK_SPOTS;
  const focusLabel = weakFocus
    ? `Weak spots (${weakTopics.map((t) => t.label).join(', ') || 'none yet'})`
    : focusTopic
      ? catalog.data?.topics.find((t) => t.id === focusTopic)?.label
      : undefined;

  // Focus page preferences: a practised topic shows only its scenarios; otherwise hidden topics are dropped.
  const visibleScenarios = useMemo(() => {
    const list = filtered.data?.scenarios ?? [];
    if (focusTopic) {
      const ids = new Set(weakFocus ? weakTopics.map((t) => t.id) : [focusTopic]);
      return list.filter((s) => s.topics.some((id) => ids.has(id)));
    }
    if (!hiddenTopics.length) return list;
    const hidden = new Set(hiddenTopics);
    return list.filter((s) => !s.topics.some((id) => hidden.has(id)));
  }, [filtered.data, focusTopic, weakFocus, weakTopics, hiddenTopics]);
  const [labKind, setLabKind] = useState<LabKind>('random');
  const [labTopic, setLabTopic] = useState('any');
  const [labCount, setLabCount] = useState('1');
  const [labLayers, setLabLayers] = useState('1');
  const [labContexts, setLabContexts] = useState(false);
  const [labPhase, setLabPhase] = useState<'generating' | 'starting'>('generating');
  const topics = catalog.data?.topics ?? [];
  const topicChoices = topics.filter((t) => labKind === 'random' || t.group === labKind);
  const chosenTopic = topicChoices.find((t) => t.id === labTopic);
  const topicIds = topicChoices.map((t) => t.id).join('\n');
  const weakChoices = weakTopics.filter((t) => labKind === 'random' || t.group === labKind);
  const weakChosen = labTopic === WEAK_SPOTS && weakChoices.length > 0;
  const quickStart = useMutation({
    mutationFn: async ({
      kind,
      n,
      topic,
      weak,
      layers,
      contexts,
    }: {
      kind: LabKind;
      n: number;
      topic?: LabTopic;
      /** The Focus topics to practise, most needed first, instead of one topic. */
      weak?: LabTopic[];
      layers: Depth;
      contexts: boolean;
    }) => {
      setLabPhase('generating');
      const questions = weak ? await weakSpotsLab(catalog.data!, weak, n, kind, layers) : await randomLab(catalog.data!, n, kind, topic, layers);
      const id = `quick-lab-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
      const title = `Quick lab: ${weak ? 'Weak spots' : (topic?.label ?? KIND_LABELS[kind])}`;
      await studioApi.quickCreate({ ...toRequest(questions, id, title, { contexts }), dryRun: false });
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

  // A full mock exam: curriculum-weighted questions, the exam's time limit, a context per question,
  // and always exam mode (no hints, one submit).
  const mockStart = useMutation({
    mutationFn: async () => {
      setLabPhase('generating');
      const questions = await fullMock(catalog.data!);
      const id = `quick-lab-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
      await studioApi.quickCreate({ ...toRequest(questions, id, 'Full mock exam', { contexts: true }), minutes: MOCK_MINUTES, dryRun: false });
      setLabPhase('starting');
      qc.invalidateQueries({ queryKey: ['scenarios'] });
      try {
        return await api.start(id, 'mock');
      } catch (e) {
        throw new Error(`Created draft ${id} but could not start it: ${(e as Error).message}`);
      }
    },
    onSuccess: (view) => {
      qc.setQueryData(sessionKey, view);
      navigate(sessionPath);
    },
  });

  useEffect(() => {
    if (labTopic === WEAK_SPOTS) {
      // Only once Focus has answered: until then there is no list to judge.
      if (focus.data && !weakChoices.length) setLabTopic('any');
    } else if (labTopic !== 'any' && !topicIds.split('\n').includes(labTopic)) setLabTopic('any');
  }, [labTopic, topicIds, focus.data, weakChoices.length]);

  // Practising a topic from Focus also points the Quick lab at it, for topics with few or no scenarios. The weak
  // spots link asks for one question per topic that needs work.
  useEffect(() => {
    if (focusTopic === WEAK_SPOTS) {
      if (!weakTopics.length) return;
      setLabKind('random');
      setLabTopic(WEAK_SPOTS);
      setLabCount(String(weakTopics.length));
      return;
    }
    const topic = focusTopic ? catalog.data?.topics.find((t) => t.id === focusTopic) : undefined;
    if (!topic) return;
    setLabKind(topic.group);
    setLabTopic(topic.id);
  }, [focusTopic, catalog.data, weakTopics.length]);

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

  const sessionLabel = !session
    ? ''
    : session.pausedAt
      ? `${session.mode === 'mock' ? 'Exam' : 'Lab'} paused`
      : session.state === 'failed'
        ? 'Lab failed'
        : session.state === 'provisioning'
          ? 'Preparing'
          : `${session.mode === 'mock' ? 'Exam' : 'Lab'} in progress`;
  const groups = domainGroups(domains)
    .map((d) => ({ ...d, scenarios: visibleScenarios.filter((s) => s.domain === d.id) }))
    .filter((d) => d.scenarios.length > 0);
  const startLabel = exam ? 'Start exam →' : 'Start →';
  const busy = quickStart.isPending || mockStart.isPending || start.isPending;
  const quickHelp = !recipesReady
    ? 'Linux Quick lab recipes are not available yet.'
    : weakChosen
      ? 'One question on each topic Focus says needs work, most needed first.'
      : chosenTopic
        ? `Questions on ${chosenTopic.label}, saved as a hidden draft.`
        : 'A random lab from the recipe catalog, saved as a hidden draft.';

  return (
    <div className="mx-auto max-w-6xl space-y-12 pb-10">
      <PageHeader title="Scenarios" intro={aws ? 'AWS scenarios, solved with the AWS CLI.' : 'Pick a scenario, or let Quick lab build one.'} />

      {(session || missingImages.length > 0 || images.error) && (
        <div className="-mt-6 space-y-3">
          {session && (
            <Notice
              tone="info"
              action={
                <Link to={sessionPath} className={linkClass}>
                  {session.pausedAt ? `Resume ${session.mode === 'mock' ? 'exam' : 'lab'} →` : 'Open session →'}
                </Link>
              }
            >
              {sessionLabel}: <span className="font-medium text-zinc-100">{session.scenarioTitle}</span>
              {session.timeLeftMs !== undefined && <span className="text-sky-200/70"> · {formatDuration(session.timeLeftMs / 1000)} left</span>}
            </Notice>
          )}
          {missingImages.length > 0 && (
            <Notice tone="warn">
              Base image{missingImages.length > 1 ? 's' : ''} <b>{missingImages.join(', ')}</b> not built yet. Run{' '}
              <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-amber-100">./cka images build</code> once (15-25 minutes).
            </Notice>
          )}
          {images.error && <ErrorBanner error={new Error(`Could not query the lab backend: ${(images.error as Error).message}`)} />}
        </div>
      )}

      {!aws && (
        <Section title="Quick lab" note="built from the recipe catalog">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={select}
              value={labKind}
              onChange={(e) => setLabKind(e.target.value as LabKind)}
              disabled={quickStart.isPending || !recipesReady}
              aria-label="Kind of questions"
            >
              {(Object.keys(KIND_LABELS) as LabKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <select
              className={`${select} max-w-64`}
              value={weakChosen ? WEAK_SPOTS : (chosenTopic?.id ?? 'any')}
              onChange={(e) => setLabTopic(e.target.value)}
              disabled={quickStart.isPending || !catalog.data || !recipesReady}
              aria-label="Topic"
            >
              <option value="any">Any topic</option>
              {weakChoices.length > 0 && <option value={WEAK_SPOTS}>Weak spots from Focus ({weakChoices.length})</option>}
              {labKind === 'random' ? (
                <>
                  <optgroup label="Create">{topicOptions(topicChoices.filter((t) => t.group === 'create'))}</optgroup>
                  <optgroup label="Troubleshoot">{topicOptions(topicChoices.filter((t) => t.group === 'troubleshoot'))}</optgroup>
                </>
              ) : (
                topicOptions(topicChoices)
              )}
            </select>
            <label className="flex items-center gap-2 text-sm text-zinc-400">
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
            {labKind !== 'create' && (
              <select
                className={select}
                value={labLayers}
                onChange={(e) => setLabLayers(e.target.value)}
                disabled={quickStart.isPending || !recipesReady}
                aria-label="Faults per question"
                title="Troubleshooting questions can stack several separate faults, one per layer (for example the Service, the Pods and a NetworkPolicy). Categories without layers stay single."
              >
                <option value="1">1 fault each</option>
                <option value="mix">Exam mix (1 or 2)</option>
                <option value="2">2 faults stacked</option>
                <option value="3">3 faults stacked</option>
              </select>
            )}
            <label
              className="flex items-center gap-2 px-1 text-sm text-zinc-400"
              title="Each question names its own kubeconfig context to switch to, as the exam names a host per task."
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-sky-600"
                checked={labContexts}
                onChange={(e) => setLabContexts(e.target.checked)}
                disabled={quickStart.isPending || !recipesReady}
              />
              Per-question contexts
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500" title={weakChosen ? weakChoices.map((t) => t.label).join(', ') : undefined}>
              {quickHelp} Full mock: {MOCK_QUESTIONS} questions in {MOCK_MINUTES} minutes, in exam mode.
            </p>
            <div className="flex gap-2">
              <Button
                disabled={active || !recipesReady || !catalog.data || busy}
                title={`${MOCK_QUESTIONS} questions weighted like the CKA curriculum, ${MOCK_MINUTES} minutes, exam mode, a kubeconfig context per question`}
                onClick={() => mockStart.mutate()}
              >
                {mockStart.isPending ? (labPhase === 'generating' ? 'Generating…' : 'Starting…') : 'Full mock'}
              </Button>
              <Button
                variant="primary"
                disabled={active || !recipesReady || !catalog.data || busy}
                title={
                  !recipesReady
                    ? 'Linux Quick lab recipes are not available yet'
                    : active
                      ? 'End the current session first'
                      : catalog.error
                        ? 'Could not load the recipe catalog'
                        : undefined
                }
                onClick={() =>
                  quickStart.mutate({
                    kind: labKind,
                    n: labN,
                    topic: weakChosen ? undefined : chosenTopic,
                    weak: weakChosen ? weakChoices : undefined,
                    layers: labKind === 'create' ? 1 : labLayers === 'mix' ? 'mix' : Number(labLayers),
                    contexts: labContexts,
                  })
                }
              >
                {quickStart.isPending ? (labPhase === 'generating' ? 'Generating…' : 'Starting…') : exam ? 'Start exam' : 'Start'}
              </Button>
            </div>
          </div>
        </Section>
      )}

      {(quickStart.error || mockStart.error || catalog.error || start.error || filtered.error || (all.data?.errors.length ?? 0) > 0) && (
        <div className="space-y-3">
          <ErrorBanner error={quickStart.error} onDismiss={() => quickStart.reset()} />
          <ErrorBanner error={mockStart.error} onDismiss={() => mockStart.reset()} />
          <ErrorBanner error={catalog.error} />
          <ErrorBanner error={start.error} onDismiss={() => start.reset()} />
          <ErrorBanner error={filtered.error} />
          {all.data?.errors.map((e) => (
            <ErrorBanner key={e.file} error={new Error(`Invalid scenario ${e.file}:\n${e.messages.join('\n')}`)} />
          ))}
        </div>
      )}

      <Section
        title={recipesReady && focusTopic ? `Practising ${focusLabel ?? focusTopic}` : 'All scenarios'}
        note={plural(visibleScenarios.length, 'scenario')}
        actions={
          recipesReady &&
          focusTopic && (
            <button
              className={linkClass}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete('topic');
                setSearchParams(next);
              }}
            >
              Show all scenarios
            </button>
          )
        }
      >
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <input
            ref={searchRef}
            placeholder="Search  ( / )"
            aria-label="Search scenarios"
            className={`${select} w-52`}
            value={filters.search ?? ''}
            onChange={set('search')}
          />
          <select className={select} value={filters.domain ?? ''} onChange={set('domain')} aria-label="Domain">
            <option value="">All domains</option>
            {domainGroups(domains).map((d) => (
              <option key={d.id} value={d.id}>
                {d.short}
              </option>
            ))}
          </select>
          <select className={select} value={filters.difficulty ?? ''} onChange={set('difficulty')} aria-label="Difficulty">
            <option value="">Any difficulty</option>
            <option value="1">Easy</option>
            <option value="2">Medium</option>
            <option value="3">Hard</option>
          </select>
          <select className={select} value={filters.status ?? ''} onChange={set('status')} aria-label="Status">
            <option value="">Any status</option>
            <option value="never">Never attempted</option>
            <option value="failed">Failed last time</option>
            <option value="passed">Passed last time</option>
          </select>
          <select className={`${select} max-w-40`} value={filters.tag ?? ''} onChange={set('tag')} aria-label="Tag">
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 px-1 text-sm text-zinc-400">
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-600"
              checked={filters.drafts === '1'}
              onChange={(e) => setFilters((f) => ({ ...f, drafts: e.target.checked ? '1' : undefined }))}
            />
            Drafts
          </label>
          {Object.values(filters).some(Boolean) && (
            <Button variant="ghost" onClick={() => setFilters({})}>
              Clear
            </Button>
          )}
        </div>

        {filtered.isLoading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-zinc-500">No scenarios match.</div>
        ) : (
          <div className="space-y-10">
            {groups.map((g) => (
              <div key={g.id}>
                <h3 className="mb-3 text-base font-semibold text-zinc-200">
                  {g.name}
                  <span className="ml-2 text-sm font-normal text-zinc-500">{[g.note, plural(g.scenarios.length, 'scenario')].filter(Boolean).join(' · ')}</span>
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.scenarios.map((s) => (
                    <ScenarioTile
                      key={s.id}
                      s={s}
                      label={start.isPending && start.variables === s.id ? 'Starting…' : startLabel}
                      starting={start.isPending && start.variables === s.id}
                      disabled={active || busy}
                      title={active ? 'End the current session first' : undefined}
                      onStart={() => start.mutate(s.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {recipesReady && !focusTopic && hiddenTopics.length > 0 && (
          <p className="mt-8 text-sm text-zinc-500">
            {plural(hiddenTopics.length, 'topic')} hidden in Focus.{' '}
            <Link to="/focus" className="text-sky-400 hover:text-sky-300">
              Manage →
            </Link>
          </p>
        )}
      </Section>
    </div>
  );
}

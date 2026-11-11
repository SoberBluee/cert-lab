import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { BlueprintSummary, CkaDomain, CreateScenarioRequest, Domain } from '@cka/schema';
import { DOMAINS } from '@cka/schema/constants';
import { api, studioApi } from '../api';
import { Button, Card, ErrorBanner, fieldClass, PageHeader, plural, Section, tileAction, tileClass } from '../components/ui';
import { DOMAINS as CKA_DOMAINS } from '../focusTopics';
import { QuickCreateTracks } from '../studio/QuickCreateTracks';

const input = 'w-full rounded-lg bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600';

const DIFFICULTY = ['', 'Easy', 'Medium', 'Hard'];

const domainShort = (d: Domain) => CKA_DOMAINS.find((x) => x.id === d)?.short ?? d;

type Source = { kind: 'blank' } | { kind: 'blueprint'; bp: BlueprintSummary } | { kind: 'scenario' };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

function CreatePanel({ source, topic, onCancel }: { source: Source; topic: Domain | null; onCancel: () => void }) {
  const navigate = useNavigate();
  const scenarios = useQuery({ queryKey: ['scenarios', { drafts: '1' }], queryFn: () => api.scenarios({ drafts: '1' }) });
  const bp = source.kind === 'blueprint' ? source.bp : null;
  const [title, setTitle] = useState(bp ? bp.name : '');
  const [id, setId] = useState('');
  const [domain, setDomain] = useState<Domain>(bp?.domain ?? topic ?? 'workloads');
  const [copyFrom, setCopyFrom] = useState('');
  const [knobs, setKnobs] = useState<Record<string, string>>(() =>
    Object.fromEntries((bp?.knobs ?? []).map((k) => [k.variable, k.values.join(', ')])),
  );
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const effectiveId = id || slugify(title);
  const taken = scenarios.data?.scenarios.some((s) => s.id === effectiveId);

  const create = useMutation({
    mutationFn: (req: CreateScenarioRequest) => studioApi.create(req),
    onSuccess: (bundle) => navigate(`/studio/${bundle.id}`),
  });

  const submit = () => {
    const req: CreateScenarioRequest = { id: effectiveId, title: title.trim(), domain };
    if (bp) {
      req.from = { kind: 'blueprint', id: bp.id };
      req.knobs = Object.fromEntries(
        Object.entries(knobs).map(([k, v]) => [
          k,
          v
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        ]),
      );
    } else if (source.kind === 'scenario') {
      req.from = { kind: 'scenario', id: copyFrom };
    }
    create.mutate(req);
  };

  const ready = title.trim() && /^[a-z0-9][a-z0-9-]*$/.test(effectiveId) && !taken && (source.kind !== 'scenario' || copyFrom);

  return (
    <div ref={panel} className="scroll-mt-20">
      <Card
        className="mb-8"
        title={bp ? `New from blueprint: ${bp.name}` : source.kind === 'scenario' ? 'Duplicate a scenario' : 'Blank scenario'}
        actions={
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            {source.kind === 'scenario' && (
              <label className="block text-sm">
                <span className="mb-1 block text-sm text-zinc-500">Copy from</span>
                <select
                  className={input}
                  value={copyFrom}
                  onChange={(e) => {
                    setCopyFrom(e.target.value);
                    const s = scenarios.data?.scenarios.find((x) => x.id === e.target.value);
                    if (s) {
                      setDomain(s.domain);
                      if (!title) setTitle(`${s.title} (copy)`);
                    }
                  }}
                >
                  <option value="">Choose a scenario…</option>
                  {scenarios.data?.scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} ({s.id})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-sm">
              <span className="mb-1 block text-sm text-zinc-500">Title</span>
              <input
                className={input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Fix the broken Service"
                autoFocus
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-sm text-zinc-500">
                Id (folder name){taken && <span className="ml-2 text-red-400">already exists</span>}
              </span>
              <input
                className={`${input} font-mono`}
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder={slugify(title) || 'my-scenario'}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-sm text-zinc-500">Topic</span>
              <select className={input} value={domain} onChange={(e) => setDomain(e.target.value as Domain)}>
                {DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {domainShort(d)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="space-y-3">
            {bp ? (
              <>
                <p className="text-sm text-zinc-400">{bp.description}</p>
                {bp.knobs.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-zinc-300">Knobs</div>
                    {bp.knobs.map((k) => (
                      <label key={k.variable} className="block text-sm">
                        <span className="mb-1 flex items-center gap-2 text-xs text-zinc-400">
                          {k.label}
                          <code className="font-mono text-[11px] text-violet-300">{`\${${k.variable}}`}</code>
                        </span>
                        <input
                          className={`${input} font-mono`}
                          value={knobs[k.variable] ?? ''}
                          onChange={(e) => setKnobs((s) => ({ ...s, [k.variable]: e.target.value }))}
                        />
                        {k.help && <span className="mt-1 block text-xs text-zinc-500">{k.help}</span>}
                      </label>
                    ))}
                    <p className="text-xs text-zinc-500">Comma-separated. One value is picked at random each time the scenario starts.</p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-zinc-400">
                {source.kind === 'blank'
                  ? 'Starts from the scaffold template: one question, an example variable, a setup script and a check. Everything is editable in the next step.'
                  : 'Copies every file of the scenario under a new id, as a draft.'}
              </p>
            )}
            <p className="text-sm text-zinc-500">Saved as a draft: hidden from Scenarios until you publish it.</p>
          </div>
        </div>
        <ErrorBanner error={create.error} onDismiss={() => create.reset()} />
        <div className="mt-4 flex justify-end">
          <Button variant="primary" disabled={!ready || create.isPending} onClick={submit}>
            {create.isPending ? 'Creating…' : 'Create and edit'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** One line of a list: a name, a quiet note, details on the right and an action that lights up on hover. */
const rowClass = 'group flex w-full items-baseline gap-4 rounded-lg px-3 py-2.5 text-left transition hover:bg-zinc-900/70';
const rowAction = 'w-16 shrink-0 text-right text-sm font-medium text-zinc-500 group-hover:text-sky-400';

/** Scenarios listed under Edit a scenario until the list is opened in full or searched. */
const EDIT_SHOWN = 12;

export function StudioPage() {
  const [topic, setTopic] = useState<Domain | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [search, setSearch] = useState('');
  const [allShown, setAllShown] = useState(false);
  const blueprints = useQuery({ queryKey: ['blueprints'], queryFn: studioApi.blueprints });
  const scenarios = useQuery({ queryKey: ['scenarios', { drafts: '1' }], queryFn: () => api.scenarios({ drafts: '1' }) });

  const shown = useMemo(() => (blueprints.data ?? []).filter((b) => !topic || b.domain === topic), [blueprints.data, topic]);
  const q = search.trim().toLowerCase();
  const mine = useMemo(
    () => (scenarios.data?.scenarios ?? []).filter((s) => (!topic || s.domain === topic) && (!q || `${s.title} ${s.id}`.toLowerCase().includes(q))),
    [scenarios.data, topic, q],
  );
  const topics: { id: Domain | null; label: string }[] = [{ id: null, label: 'All topics' }, ...DOMAINS.map((d) => ({ id: d, label: domainShort(d) }))];

  return (
    <div className="mx-auto max-w-6xl space-y-14 pb-10">
      <PageHeader title="Studio" intro="Build practice labs. Quick Create is the fastest way; Advanced gives you full control." />

      <Section title="Quick Create" note="question by question, no YAML or scripts">
        <QuickCreateTracks base="" />
      </Section>

      <Section
        title="Advanced"
        note="start from a blueprint, then edit everything"
        actions={
          <div className="flex flex-wrap rounded-lg bg-zinc-900 p-1" role="radiogroup" aria-label="Topic">
            {topics.map((t) => (
              <button
                key={t.id ?? 'all'}
                type="button"
                role="radio"
                aria-checked={topic === t.id}
                onClick={() => setTopic(t.id)}
                className={`rounded-md px-3 py-1.5 text-sm transition ${topic === t.id ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        {source && (
          <CreatePanel
            key={source.kind === 'blueprint' ? source.bp.id : source.kind}
            source={source}
            topic={topic}
            onCancel={() => setSource(null)}
          />
        )}
        <ErrorBanner error={blueprints.error} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button className={tileClass} onClick={() => setSource({ kind: 'blank' })}>
            <span className="text-[15px] font-medium text-zinc-100">Blank scenario</span>
            <span className="mt-1 text-sm text-zinc-500">One question and one check</span>
            <span className={`${tileAction} mt-auto self-end pt-4`}>New →</span>
          </button>
          <button className={tileClass} onClick={() => setSource({ kind: 'scenario' })}>
            <span className="text-[15px] font-medium text-zinc-100">Duplicate a scenario</span>
            <span className="mt-1 text-sm text-zinc-500">Copy one and change it</span>
            <span className={`${tileAction} mt-auto self-end pt-4`}>New →</span>
          </button>
          {shown.map((b) => (
            <button key={b.id} className={tileClass} onClick={() => setSource({ kind: 'blueprint', bp: b })} title={b.description}>
              <span className="line-clamp-2 text-[15px] font-medium text-zinc-100">{b.name}</span>
              <span className="mt-1 text-sm text-zinc-500">
                {[!topic && domainShort(b.domain), DIFFICULTY[b.difficulty], b.taskCount > 1 && `${b.taskCount} questions`].filter(Boolean).join(' · ')}
              </span>
              <span className={`${tileAction} mt-auto self-end pt-4`}>Use →</span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Edit a scenario"
        note={plural(mine.length, 'scenario')}
        actions={
          <input
            placeholder="Search scenarios"
            aria-label="Search scenarios"
            className={`${fieldClass} w-52`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      >
        <ul>
          {(allShown || q ? mine : mine.slice(0, EDIT_SHOWN)).map((s) => (
            <li key={s.id}>
              <Link to={`/studio/${s.id}`} className={rowClass} title={s.id}>
                <span className="min-w-0 flex-1 truncate text-[15px] text-zinc-100">
                  {s.title}
                  {!topic && <span className="ml-2 text-sm text-zinc-500">{domainShort(s.domain)}</span>}
                  {s.draft && <span className="ml-2 text-sm text-amber-300/80">draft</span>}
                </span>
                <span className="hidden shrink-0 text-sm text-zinc-500 tabular-nums sm:inline">{plural(s.taskCount, 'question')}</span>
                <span className={rowAction}>Edit →</span>
              </Link>
            </li>
          ))}
          {!mine.length && <li className="px-3 py-2.5 text-sm text-zinc-500">{q ? 'No scenarios match.' : 'No scenarios for this topic yet.'}</li>}
        </ul>
        {!q && mine.length > EDIT_SHOWN && (
          <button className="mt-3 px-3 text-sm font-medium text-zinc-400 hover:text-zinc-100" onClick={() => setAllShown(!allShown)}>
            {allShown ? 'Show fewer' : `Show all ${mine.length}`}
          </button>
        )}
      </Section>
    </div>
  );
}

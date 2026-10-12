import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { BlueprintSummary, CreateScenarioRequest, Domain } from '@cka/schema';
import { DOMAINS } from '@cka/schema/constants';
import { api, studioApi } from '../api';
import { Button, buttonClass, Card, Difficulty, DomainBadge, ErrorBanner } from '../components/ui';
import { TRACKS } from '../studio/tracks';

const input = 'w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600';

const TOPIC_BLURBS: Record<Domain, string> = {
  'cluster-architecture': 'RBAC, kubeadm, etcd, upgrades',
  workloads: 'Deployments, scheduling, config',
  'services-networking': 'Services, Ingress, NetworkPolicy, DNS',
  storage: 'PV, PVC, StorageClass, volumes',
  troubleshooting: 'Broken nodes, pods, control plane',
};

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
                <span className="mb-1 block text-xs text-zinc-500">Copy from</span>
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
              <span className="mb-1 block text-xs text-zinc-500">Title</span>
              <input
                className={input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Fix the broken Service"
                autoFocus
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-zinc-500">
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
              <span className="mb-1 block text-xs text-zinc-500">Topic</span>
              <select className={input} value={domain} onChange={(e) => setDomain(e.target.value as Domain)}>
                {DOMAINS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="space-y-3">
            {bp ? (
              <>
                <p className="text-sm text-zinc-400">{bp.description}</p>
                {bp.knobs.length > 0 && (
                  <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                    <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Knobs</div>
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
            <p className="text-xs text-zinc-500">
              New scenarios are saved as drafts: hidden from the Scenarios page until you publish them.
            </p>
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

export function StudioPage() {
  const [topic, setTopic] = useState<Domain | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const blueprints = useQuery({ queryKey: ['blueprints'], queryFn: studioApi.blueprints });
  const scenarios = useQuery({ queryKey: ['scenarios', { drafts: '1' }], queryFn: () => api.scenarios({ drafts: '1' }) });

  const shown = useMemo(() => (blueprints.data ?? []).filter((b) => !topic || b.domain === topic), [blueprints.data, topic]);
  const mine = useMemo(() => (scenarios.data?.scenarios ?? []).filter((s) => !topic || s.domain === topic), [scenarios.data, topic]);
  const count = (d: Domain) => blueprints.data?.filter((b) => b.domain === d).length ?? 0;

  const card = 'flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-left transition hover:border-sky-700';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Scenario Studio</h1>
        <p className="mt-1 text-sm text-zinc-400">Build practice labs. Quick Create is the fastest way; the advanced options give you full control.</p>
      </div>

      <div>
        <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">Quick Create</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Build a lab question by question and get setup, checks, hints and solution generated. No YAML or scripts. One lab can mix tracks, like a
          real exam.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {TRACKS.map((t) =>
          t.soon ? (
            <div key={t.id} className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 opacity-60">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-zinc-300">{t.name}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">phase 2</span>
              </div>
              <p className="mt-1 flex-1 text-sm text-zinc-400">{t.blurb}</p>
            </div>
          ) : (
            <Link
              key={t.id}
              to={`/studio/new?track=${t.id}`}
              className="flex flex-col rounded-xl border border-sky-800 bg-sky-950/30 p-5 transition hover:border-sky-600"
            >
              <span className="text-lg font-semibold text-zinc-100">{t.name}</span>
              <p className="mt-1 flex-1 text-sm text-zinc-300">{t.blurb}</p>
              <span className={`${buttonClass('primary')} mt-4 self-start`}>Start →</span>
            </Link>
          ),
        )}
      </div>

      <h2 className="pt-2 text-sm font-semibold tracking-wide text-zinc-400 uppercase">Advanced</h2>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <button
          onClick={() => setTopic(null)}
          className={`rounded-xl border p-3 text-left ${topic === null ? 'border-sky-600 bg-sky-950/30' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'}`}
        >
          <div className="text-sm font-medium text-zinc-100">All topics</div>
          <div className="mt-1 text-xs text-zinc-500">{blueprints.data?.length ?? 0} blueprints</div>
        </button>
        {DOMAINS.map((d) => (
          <button
            key={d}
            onClick={() => setTopic(d)}
            className={`rounded-xl border p-3 text-left ${topic === d ? 'border-sky-600 bg-sky-950/30' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'}`}
          >
            <DomainBadge domain={d} />
            <div className="mt-1.5 text-xs text-zinc-500">{TOPIC_BLURBS[d]}</div>
            <div className="mt-1 text-xs text-zinc-600">
              {count(d)} blueprint{count(d) === 1 ? '' : 's'}
            </div>
          </button>
        ))}
      </div>

      {source && (
        <CreatePanel
          key={source.kind === 'blueprint' ? source.bp.id : source.kind}
          source={source}
          topic={topic}
          onCancel={() => setSource(null)}
        />
      )}

      <ErrorBanner error={blueprints.error} />
      <section>
        <h3 className="mb-2 text-sm font-medium text-zinc-300">Start from a blueprint or template, then edit everything</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <button className={`${card} border-dashed`} onClick={() => setSource({ kind: 'blank' })}>
            <span className="font-semibold text-zinc-100">Blank scenario</span>
            <span className="mt-1 text-sm text-zinc-400">The scaffold template with one question and one check.</span>
          </button>
          <button className={`${card} border-dashed`} onClick={() => setSource({ kind: 'scenario' })}>
            <span className="font-semibold text-zinc-100">Duplicate a scenario</span>
            <span className="mt-1 text-sm text-zinc-400">Copy an existing scenario and change it.</span>
          </button>
          {shown.map((b) => (
            <button key={b.id} className={card} onClick={() => setSource({ kind: 'blueprint', bp: b })}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <DomainBadge domain={b.domain} />
                <Difficulty level={b.difficulty} />
              </div>
              <span className="font-semibold text-zinc-100">{b.name}</span>
              <span className="mt-1 text-sm text-zinc-400">{b.description}</span>
              <span className="mt-3 flex flex-wrap gap-1">
                {b.knobs.map((k) => (
                  <span key={k.variable} className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] text-violet-300">
                    {k.label}
                  </span>
                ))}
                {b.taskCount > 1 && (
                  <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-300">{b.taskCount} questions</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-zinc-400 uppercase">Edit a scenario</h2>
        <div className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
          {mine.map((s) => (
            <Link key={s.id} to={`/studio/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-zinc-800/50">
              <DomainBadge domain={s.domain} />
              <span className="text-zinc-100">{s.title}</span>
              <span className="font-mono text-xs text-zinc-500">{s.id}</span>
              {s.draft && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300">draft</span>}
              <span className="ml-auto text-xs text-zinc-500">
                {s.taskCount} question{s.taskCount === 1 ? '' : 's'} · {s.variableNames.length} variables
              </span>
            </Link>
          ))}
          {!mine.length && <div className="px-4 py-3 text-sm text-zinc-500">No scenarios for this topic yet.</div>}
        </div>
      </section>
    </div>
  );
}

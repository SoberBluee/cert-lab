import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { parseDocument } from 'yaml';
import type { BuilderSummary, CategorySummary, PartSummary, QuickCreateRequest, QuickQuestion, RecipeField } from '@cka/schema';
import { api, studioApi, type StudioJob } from '../api';
import { JobPanel } from '../components/JobPanel';
import { Button, Card, Difficulty, DomainBadge, ErrorBanner, Markdown } from '../components/ui';
import { useSession } from '../hooks';
import { getFile, SCENARIO_FILE, setFile, stringify } from '../studio/model';
import { TRACKS, type TrackId } from '../studio/tracks';

const input = 'w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600';

interface Fields {
  values: Record<string, string>;
  /** Present for randomized fields: the values one is picked from at every start. */
  pools: Record<string, string[]>;
}

interface Part extends Fields {
  key: number;
  part: PartSummary;
}

type Question =
  | { key: number; type: 'create'; builder: BuilderSummary; fields: Fields; addons: Part[]; followUps: Part[] }
  | {
      key: number;
      type: 'troubleshoot';
      category: CategorySummary;
      fields: Fields;
      /** Fault ids to roll from; every fault when undefined. */
      faults?: string[];
    };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

let nextKey = 1;
const initialFields = (fields: RecipeField[]): Fields => ({
  values: Object.fromEntries(fields.map((f) => [f.key, f.default])),
  pools: Object.fromEntries(fields.filter((f) => f.pool && f.randomizeByDefault).map((f) => [f.key, [...f.pool!]])),
});
const newPart = (part: PartSummary): Part => ({ key: nextKey++, part, ...initialFields(part.fields) });

const questionMeta = (q: Question) =>
  q.type === 'create'
    ? {
        name: q.builder.name,
        domain: q.builder.domain,
        points: q.builder.points + [...q.addons, ...q.followUps].reduce((s, p) => s + p.part.points, 0),
        minutes: q.builder.minutes + (q.addons.length + q.followUps.length) * 2,
      }
    : { name: q.category.name, domain: q.category.domain, points: q.category.points, minutes: q.category.minutes };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function TrackBadge({ type }: { type: Question['type'] }) {
  return type === 'troubleshoot' ? (
    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[11px] font-medium text-rose-300">Troubleshoot</span>
  ) : (
    <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-medium text-sky-300">Create</span>
  );
}

function PoolEditor({ field, pool, onChange }: { field: RecipeField; pool: string[]; onChange: (pool: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const chip = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs';
  if (field.options) {
    return (
      <div className="flex flex-wrap gap-1">
        {field.options.map((o) => {
          const on = pool.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onChange(on ? pool.filter((p) => p !== o) : [...pool, o])}
              className={`${chip} border ${on ? 'border-violet-600 bg-violet-500/15 text-violet-200' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}
            >
              {o}
            </button>
          );
        })}
      </div>
    );
  }
  const add = () => {
    const values = draft
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v && !pool.includes(v));
    if (values.length) onChange([...pool, ...values]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-1">
      {pool.map((p) => (
        <span key={p} className={`${chip} bg-violet-500/15 text-violet-200`}>
          {p}
          <button
            type="button"
            className="text-violet-400 hover:text-violet-100"
            onClick={() => onChange(pool.filter((x) => x !== p))}
            aria-label={`remove ${p}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent px-1 py-0.5 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
        value={draft}
        placeholder="add value…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && pool.length) {
            onChange(pool.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function FieldInput({ field, state, onChange }: { field: RecipeField; state: Fields; onChange: (s: Fields) => void }) {
  const pool = state.pools[field.key];
  const randomized = pool !== undefined;
  const setValue = (v: string) => onChange({ ...state, values: { ...state.values, [field.key]: v } });
  const setPool = (p: string[] | undefined) => {
    const pools = { ...state.pools };
    if (p === undefined) delete pools[field.key];
    else pools[field.key] = p;
    onChange({ ...state, pools });
  };
  return (
    <div className="text-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs text-zinc-400">{field.label}</span>
        {field.pool && (
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-500 select-none">
            <input
              type="checkbox"
              className="accent-violet-500"
              checked={randomized}
              onChange={(e) => setPool(e.target.checked ? [...(field.pool ?? [])] : undefined)}
            />
            Randomize
          </label>
        )}
      </div>
      {randomized ? (
        <PoolEditor field={field} pool={pool} onChange={setPool} />
      ) : field.options ? (
        <select className={input} value={state.values[field.key]} onChange={(e) => setValue(e.target.value)}>
          {field.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          className={`${input} font-mono`}
          type={field.type === 'number' ? 'number' : 'text'}
          min={field.min}
          max={field.max}
          value={state.values[field.key]}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      <span className="mt-1 block text-[11px] text-zinc-500">{randomized ? 'One value is picked at random every time the lab starts.' : field.help}</span>
    </div>
  );
}

function FieldGrid({ fields, state, onChange }: { fields: RecipeField[]; state: Fields; onChange: (s: Fields) => void }) {
  if (!fields.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => (
        <FieldInput key={f.key} field={f} state={state} onChange={onChange} />
      ))}
    </div>
  );
}

/** Why a part cannot be added right now, or undefined. */
function blocked(part: PartSummary, chosen: Part[], all: PartSummary[]): string | undefined {
  const ids = chosen.map((p) => p.part.id);
  const name = (id: string) => all.find((p) => p.id === id)?.name ?? id;
  if (ids.includes(part.id)) return 'already added';
  const conflict = part.conflicts?.find((c) => ids.includes(c));
  if (conflict) return `conflicts with ${name(conflict)}`;
  const missing = part.requires?.find((r) => !ids.includes(r));
  if (missing) return `needs ${name(missing)} first`;
}

function PartPicker({
  label,
  parts,
  chosen,
  all,
  onAdd,
}: {
  label: string;
  parts: PartSummary[];
  chosen: Part[];
  all: PartSummary[];
  onAdd: (p: PartSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!parts.length) return null;
  return (
    <div>
      <Button variant="ghost" onClick={() => setOpen(!open)}>
        {open ? '−' : '+'} {label}
      </Button>
      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {parts.map((p) => {
            const why = blocked(p, chosen, all);
            return (
              <button
                key={p.id}
                type="button"
                disabled={!!why}
                title={why}
                onClick={() => {
                  onAdd(p);
                  setOpen(false);
                }}
                className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 text-left transition enabled:hover:border-sky-700 disabled:opacity-40"
              >
                <span className="text-sm text-zinc-100">
                  {p.name} <span className="text-xs text-zinc-500">+{p.points} pt</span>
                </span>
                <span className="mt-0.5 text-xs text-zinc-400">{why ? `Unavailable: ${why}.` : p.description}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PartCard({ p, prefix, onChange, onRemove }: { p: Part; prefix: string; onChange: (p: Part) => void; onRemove: () => void }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-center gap-2 border-b border-zinc-800/70 px-3 py-1.5">
        <span className="text-xs text-zinc-500">{prefix}</span>
        <span className="text-sm text-zinc-100">{p.part.name}</span>
        <span className="text-xs text-zinc-500">+{p.part.points} pt</span>
        <Button variant="ghost" className="ml-auto" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {p.part.fields.length > 0 && (
        <div className="p-3">
          <FieldGrid fields={p.part.fields} state={p} onChange={(s) => onChange({ ...p, ...s })} />
        </div>
      )}
    </div>
  );
}

function CreateBody({ q, onChange }: { q: Extract<Question, { type: 'create' }>; onChange: (q: Question) => void }) {
  const all = [...q.builder.addons, ...q.builder.followUps];
  const chosen = [...q.addons, ...q.followUps];
  const replace = (list: 'addons' | 'followUps', key: number, next?: Part) =>
    onChange({ ...q, [list]: next ? q[list].map((x) => (x.key === key ? next : x)) : q[list].filter((x) => x.key !== key) });
  // Removing a part also removes the parts that need it.
  const remove = (list: 'addons' | 'followUps', p: Part) => {
    const gone = new Set([p.part.id]);
    const keep = (xs: Part[]) => xs.filter((x) => x.key !== p.key && !x.part.requires?.some((r) => gone.has(r)));
    onChange({ ...q, addons: list === 'addons' ? keep(q.addons) : q.addons, followUps: keep(q.followUps) });
  };
  return (
    <div className="space-y-4 p-4">
      <FieldGrid fields={q.builder.fields} state={q.fields} onChange={(fields) => onChange({ ...q, fields })} />
      {q.addons.map((p) => (
        <PartCard key={p.key} p={p} prefix="With" onChange={(n) => replace('addons', p.key, n)} onRemove={() => remove('addons', p)} />
      ))}
      {q.followUps.map((p, i) => (
        <PartCard key={p.key} p={p} prefix={`Step ${i + 2}: then`} onChange={(n) => replace('followUps', p.key, n)} onRemove={() => remove('followUps', p)} />
      ))}
      <div className="flex flex-col gap-2">
        <PartPicker label="Add-on" parts={q.builder.addons} chosen={chosen} all={all} onAdd={(p) => onChange({ ...q, addons: [...q.addons, newPart(p)] })} />
        <PartPicker
          label="Then…"
          parts={q.builder.followUps}
          chosen={chosen}
          all={all}
          onAdd={(p) => onChange({ ...q, followUps: [...q.followUps, newPart(p)] })}
        />
      </div>
    </div>
  );
}

function TroubleBody({ q, onChange }: { q: Extract<Question, { type: 'troubleshoot' }>; onChange: (q: Question) => void }) {
  const [reveal, setReveal] = useState(false);
  const spoilers = useQuery({ queryKey: ['recipes', 'spoilers'], queryFn: () => studioApi.recipes(true), enabled: reveal, staleTime: Infinity });
  const faults = spoilers.data?.categories.find((c) => c.id === q.category.id)?.faults ?? [];
  const count = q.faults?.length ?? q.category.faultCount;
  const toggle = (id: string) => {
    const current = q.faults ?? faults.map((f) => f.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    onChange({ ...q, faults: next.length === faults.length ? undefined : next });
  };
  return (
    <div className="space-y-4 p-4">
      <FieldGrid fields={q.category.fields} state={q.fields} onChange={(fields) => onChange({ ...q, fields })} />
      <p className="text-sm text-zinc-300">
        {count} possible fault{count === 1 ? '' : 's'}. One is picked at random every time the lab starts, and stays hidden until you reveal the solution.
        {q.category.disruptive && ' This category breaks a worker, so it is set up after and fixed before every other question.'}
      </p>
      <details className="rounded-lg border border-zinc-800 bg-zinc-950/40 text-sm" onToggle={(e) => setReveal(e.currentTarget.open)}>
        <summary className="cursor-pointer px-3 py-2 text-xs text-zinc-400 select-none">Reveal fault pool (spoiler)</summary>
        <div className="space-y-1.5 px-3 pb-3">
          {spoilers.isLoading && <div className="text-xs text-zinc-500">Loading…</div>}
          <ErrorBanner error={spoilers.error} />
          {faults.map((f) => (
            <label key={f.id} className="flex cursor-pointer items-center gap-2 text-zinc-300">
              <input type="checkbox" className="accent-rose-500" checked={q.faults?.includes(f.id) ?? true} onChange={() => toggle(f.id)} />
              {f.label} <span className="font-mono text-[11px] text-zinc-500">{f.id}</span>
            </label>
          ))}
          {faults.length > 0 && <p className="pt-1 text-[11px] text-zinc-500">Untick a fault to leave it out of this lab.</p>}
        </div>
      </details>
    </div>
  );
}

function QuestionForm({
  q,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  q: Question;
  index: number;
  count: number;
  onChange: (q: Question) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const meta = questionMeta(q);
  return (
    <div id={`question-${q.key}`} className="scroll-mt-20 rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <span className="text-sm font-semibold text-zinc-300">Question {index + 1}</span>
        <TrackBadge type={q.type} />
        <span className="text-sm text-zinc-100">{meta.name}</span>
        <span className="text-xs text-zinc-500">
          {meta.points} pt · ~{meta.minutes} min
        </span>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} title="Move up">
            ↑
          </Button>
          <Button variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)} title="Move down">
            ↓
          </Button>
          <Button variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
      {q.type === 'create' ? <CreateBody q={q} onChange={onChange} /> : <TroubleBody q={q} onChange={onChange} />}
    </div>
  );
}

interface Pickable {
  id: string;
  name: string;
  description: string;
  difficulty: number;
  points: number;
  minutes: number;
  domain: BuilderSummary['domain'];
}

function PickGrid({
  items,
  onPick,
  compact,
  disabled = {},
}: {
  items: Pickable[];
  onPick: (id: string) => void;
  compact: boolean;
  /** Reason, by item id, why it cannot be added. */
  disabled?: Record<string, string>;
}) {
  return (
    <div className={`grid gap-2 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
      {items.map((r) => (
        <button
          key={r.id}
          onClick={() => onPick(r.id)}
          disabled={!!disabled[r.id]}
          title={disabled[r.id]}
          className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-left transition enabled:hover:border-sky-700 disabled:opacity-40"
        >
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-100">{r.name}</span>
            <DomainBadge domain={r.domain} />
          </span>
          {!compact && <span className="mt-1 text-xs text-zinc-400">{r.description}</span>}
          <span className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
            <Difficulty level={r.difficulty} />
            from {r.points} pt · ~{r.minutes} min
          </span>
        </button>
      ))}
    </div>
  );
}

function AddQuestion({
  track,
  onTrack,
  builders,
  categories,
  onPick,
  compact,
  chosen,
}: {
  track: TrackId;
  onTrack: (t: TrackId) => void;
  builders: BuilderSummary[];
  categories: CategorySummary[];
  onPick: (track: TrackId, id: string) => void;
  compact: boolean;
  /** Ids of the categories already in the lab. */
  chosen: string[];
}) {
  const breaksApi = categories.filter((c) => c.breaksApi && chosen.includes(c.id));
  const disabled = Object.fromEntries(
    breaksApi.length ? categories.filter((c) => c.breaksApi).map((c) => [c.id, 'A lab can hold only one control plane question.']) : [],
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {TRACKS.map((t) => (
          <button
            key={t.id}
            disabled={t.soon}
            onClick={() => onTrack(t.id)}
            title={t.soon ? 'Coming later' : t.blurb}
            className={`rounded-md px-3 py-1.5 text-sm ${track === t.id ? 'bg-sky-600/20 text-sky-200' : 'text-zinc-400 enabled:hover:text-zinc-100'} disabled:opacity-40`}
          >
            {t.name}
            {t.soon && <span className="ml-1.5 text-[10px] text-zinc-500">soon</span>}
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-500">{TRACKS.find((t) => t.id === track)?.blurb}</p>
      {track === 'create' ? (
        <PickGrid items={builders} onPick={(id) => onPick('create', id)} compact={compact} />
      ) : (
        <PickGrid items={categories.filter((c) => c.track === track)} onPick={(id) => onPick('troubleshoot', id)} compact={compact} disabled={disabled} />
      )}
    </div>
  );
}

function toQuestion(q: Question): QuickQuestion {
  const part = (p: Part) => ({ id: p.part.id, values: p.values, randomize: p.pools });
  return q.type === 'create'
    ? {
        type: 'create',
        builder: q.builder.id,
        values: q.fields.values,
        randomize: q.fields.pools,
        addons: q.addons.map(part),
        followUps: q.followUps.map(part),
      }
    : { type: 'troubleshoot', category: q.category.id, values: q.fields.values, randomize: q.fields.pools, ...(q.faults ? { faults: q.faults } : {}) };
}

const toRequest = (questions: Question[], id: string, title: string): QuickCreateRequest => ({ id, title, questions: questions.map(toQuestion) });

function Created({ id, jobError, onAnother }: { id: string; jobError: string | null; onAnother: () => void }) {
  const qc = useQueryClient();
  const session = useSession().data;
  const job = useQuery({
    queryKey: ['studio-job'],
    queryFn: studioApi.job,
    refetchInterval: (q) => (q.state.data?.state === 'running' ? 1500 : false),
    refetchIntervalInBackground: true,
  });
  const myJob = job.data?.scenarioId === id ? job.data : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const running = job.data?.state === 'running';
  const run = useMutation({
    mutationFn: (kind: StudioJob['kind']) => studioApi.run(id, kind),
    onSuccess: (r) => qc.setQueryData(['studio-job'], r.job),
  });
  const publish = useMutation({
    mutationFn: async () => {
      const bundle = await studioApi.read(id);
      const doc = parseDocument(getFile(bundle, SCENARIO_FILE) ?? '');
      doc.delete('draft');
      return studioApi.save(setFile(bundle, SCENARIO_FILE, stringify(doc)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenarios'] }),
  });

  return (
    <Card title="Lab created">
      <div className="space-y-4">
        <p className="text-sm text-zinc-300">
          Saved as draft <span className="font-mono text-zinc-100">{id}</span>.{' '}
          {myJob ? 'A dry-run checks that setup works and that the questions start out unsolved.' : 'Run a dry-run or verify to test it on the lab VMs.'}
        </p>
        {jobError && !myJob && <div className="text-sm text-amber-300">The dry-run did not start: {jobError}</div>}
        {myJob && myJob.startedAt !== dismissed && (
          <JobPanel job={myJob} progress={session?.scenarioId === id ? session.progress : []} onDismiss={() => setDismissed(myJob.startedAt)} />
        )}
        <ErrorBanner error={run.error} onDismiss={() => run.reset()} />
        <ErrorBanner error={publish.error} onDismiss={() => publish.reset()} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={running || run.isPending} onClick={() => run.mutate('dry-run')} title="Start, run setup and grade: every question should fail">
            Dry-run
          </Button>
          <Button disabled={running || run.isPending} onClick={() => run.mutate('verify')} title="Start, apply the solution and grade: every check should pass">
            Verify
          </Button>
          <Button variant="primary" disabled={publish.isPending || publish.isSuccess} onClick={() => publish.mutate()}>
            {publish.isSuccess ? 'Published' : publish.isPending ? 'Publishing…' : 'Publish'}
          </Button>
          <Link to={`/studio/${id}`} className="ml-auto self-center text-sm text-sky-400 hover:text-sky-300">
            Open in Advanced editor →
          </Link>
          <Button variant="ghost" onClick={onAnother}>
            Create another
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function QuickCreatePage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const track: TrackId = TRACKS.find((t) => t.id === params.get('track') && !t.soon)?.id ?? 'create';
  const setTrack = (t: TrackId) => setParams({ track: t }, { replace: true });
  const catalog = useQuery({ queryKey: ['recipes'], queryFn: () => studioApi.recipes(), staleTime: Infinity });
  const scenarios = useQuery({ queryKey: ['scenarios', { drafts: '1' }], queryFn: () => api.scenarios({ drafts: '1' }) });
  const [questions, setQuestions] = useState<Question[]>([]);
  const [title, setTitle] = useState('');
  const [id, setId] = useState('');
  const [created, setCreated] = useState<{ id: string; jobError: string | null } | null>(null);
  const [scrollTo, setScrollTo] = useState<number | null>(null);

  useEffect(() => {
    if (scrollTo === null) return;
    document.getElementById(`question-${scrollTo}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setScrollTo(null);
  }, [scrollTo]);

  const effectiveId = id || slugify(title);
  const taken = scenarios.data?.scenarios.some((s) => s.id === effectiveId) ?? false;
  const req = useMemo(() => toRequest(questions, effectiveId, title), [questions, effectiveId, title]);
  const debounced = useDebounced(req, 400);
  const preview = useQuery({
    queryKey: ['quick-preview', JSON.stringify(debounced.questions)],
    queryFn: () => studioApi.quickPreview(debounced),
    enabled: debounced.questions.length > 0,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const p = questions.length ? preview.data : undefined;
  const errors = p?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = p?.issues.filter((i) => i.level === 'warning') ?? [];
  const settled = JSON.stringify(debounced.questions) === JSON.stringify(req.questions) && !preview.isFetching;

  const create = useMutation({
    mutationFn: () => studioApi.quickCreate(req),
    onSuccess: (r) => {
      if (r.job) qc.setQueryData(['studio-job'], r.job);
      qc.invalidateQueries({ queryKey: ['scenarios'] });
      setCreated({ id: r.id, jobError: r.jobError });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  const add = (t: TrackId, pickId: string) => {
    const key = nextKey++;
    let q: Question | undefined;
    if (t === 'create') {
      const builder = catalog.data?.builders.find((b) => b.id === pickId);
      if (builder) q = { key, type: 'create', builder, fields: initialFields(builder.fields), addons: [], followUps: [] };
    } else {
      const category = catalog.data?.categories.find((c) => c.id === pickId);
      if (category) q = { key, type: 'troubleshoot', category, fields: initialFields(category.fields) };
    }
    if (!q) return;
    setQuestions((qs) => [...qs, q]);
    setScrollTo(key);
  };
  const update = (key: number, q: Question) => setQuestions((qs) => qs.map((x) => (x.key === key ? q : x)));
  const move = (index: number, delta: number) =>
    setQuestions((qs) => {
      const next = [...qs];
      const [q] = next.splice(index, 1);
      next.splice(index + delta, 0, q);
      return next;
    });

  const ready = questions.length > 0 && title.trim() && /^[a-z0-9][a-z0-9-]*$/.test(effectiveId) && !taken && settled && errors.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/studio" className="text-sm text-zinc-400 hover:text-zinc-100">
          ← Studio
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-zinc-100">Quick Create</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Build a lab question by question. Create questions combine a resource with add-ons and follow-up steps; troubleshooting questions inject a hidden
          random fault. Setup, checks, hints and solution are generated for you.
        </p>
      </div>

      {created ? (
        <Created
          id={created.id}
          jobError={created.jobError}
          onAnother={() => {
            setCreated(null);
            setQuestions([]);
            setTitle('');
            setId('');
            create.reset();
          }}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="space-y-4">
            <ErrorBanner error={catalog.error} />
            {questions.map((q, i) => (
              <QuestionForm
                key={q.key}
                q={q}
                index={i}
                count={questions.length}
                onChange={(next) => update(q.key, next)}
                onMove={(d) => move(i, d)}
                onRemove={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}
              />
            ))}

            <Card title={questions.length ? 'Add another question' : '1. Pick a question'}>
              {catalog.data ? (
                <AddQuestion
                  track={track}
                  onTrack={setTrack}
                  builders={catalog.data.builders}
                  categories={catalog.data.categories}
                  onPick={add}
                  compact={questions.length > 0}
                  chosen={questions.flatMap((q) => (q.type === 'troubleshoot' ? [q.category.id] : []))}
                />
              ) : (
                <div className="text-sm text-zinc-500">Loading…</div>
              )}
            </Card>

            {questions.length > 0 && (
              <Card title="Create and test">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs text-zinc-500">Title</span>
                    <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Workloads warm-up" />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs text-zinc-500">
                      Id (folder name){taken && <span className="ml-2 text-red-400">already exists</span>}
                    </span>
                    <input className={`${input} font-mono`} value={id} onChange={(e) => setId(e.target.value)} placeholder={slugify(title) || 'my-lab'} />
                  </label>
                </div>
                <p className="mt-3 text-xs text-zinc-500">
                  Saved as a draft under the topic of question 1 ({questionMeta(questions[0]).domain}), then a dry-run starts on the lab VMs. Publish when you
                  are happy with it.
                </p>
                <ErrorBanner error={create.error} onDismiss={() => create.reset()} />
                <div className="mt-3 flex justify-end">
                  <Button variant="primary" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
                    {create.isPending ? 'Creating…' : 'Create and test'}
                  </Button>
                </div>
              </Card>
            )}
          </div>

          <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-auto">
            <Card
              title="What the student sees"
              actions={
                p && (
                  <Button variant="ghost" onClick={() => preview.refetch()} title="Pick new random values">
                    Re-roll
                  </Button>
                )
              }
            >
              {!questions.length ? (
                <p className="text-sm text-zinc-500">Add a question to see the lab as the student will read it.</p>
              ) : !p ? (
                <p className="text-sm text-zinc-500">Generating…</p>
              ) : (
                <div className={`space-y-4 transition-opacity ${settled ? '' : 'opacity-60'}`}>
                  <div className="flex gap-3 text-xs text-zinc-400">
                    <span>
                      {p.questions.length} question{p.questions.length === 1 ? '' : 's'}
                    </span>
                    <span>{p.points} points</span>
                    <span>~{p.minutes} min</span>
                  </div>
                  {errors.length > 0 && (
                    <ul className="space-y-1 rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-200">
                      {errors.map((e, i) => (
                        <li key={i}>{e.message}</li>
                      ))}
                    </ul>
                  )}
                  {warnings.length > 0 && (
                    <ul className="space-y-1 text-xs text-amber-300">
                      {warnings.map((w, i) => (
                        <li key={i}>! {w.message}</li>
                      ))}
                    </ul>
                  )}
                  {p.questions.map((q, i) => (
                    <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                      <div className="mb-2 text-sm font-semibold text-zinc-100">
                        Question {i + 1}: {q.title} <span className="font-normal text-zinc-500">({q.points} pt)</span>
                      </div>
                      <div className="text-sm">
                        <Markdown>{q.markdown}</Markdown>
                      </div>
                    </div>
                  ))}
                  {Object.keys(p.vars).length > 0 && (
                    <div className="font-mono text-[11px] break-all text-zinc-500">
                      sample roll:{' '}
                      {Object.entries(p.vars)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(' ')}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

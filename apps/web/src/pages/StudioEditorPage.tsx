import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Document } from 'yaml';
import type { ScenarioBundle, StudioIssue } from '@cka/schema';
import { BASES, DOMAINS } from '@cka/schema/constants';
import { render, rollVariable, rollVars, visibleVars } from '@cka/schema/vars';
import { studioApi, type StudioJob } from '../api';
import { JobPanel } from '../components/JobPanel';
import { Button, buttonClass, Card, DomainBadge, ErrorBanner, Markdown } from '../components/ui';
import { useSession } from '../hooks';
import {
  CheckEditor,
  Code,
  CommitInput,
  field,
  HintsEditor,
  Label,
  mono,
  StepsEditor,
  VariablesEditor,
  type Edit,
  type TryState,
} from '../studio/editors';
import {
  convertToTasks,
  getFile,
  isScriptFilePath,
  nextId,
  parseScenario,
  removeFile,
  renameFile,
  SCENARIO_FILE,
  setFile,
  setPath,
  stringify,
  taskFile,
  taskRefs,
  variablesOk,
  workersOf,
  type CheckDraft,
  type ParsedScenario,
  type TaskRef,
} from '../studio/model';

type Tab = 'overview' | 'variables' | 'questions' | 'scripts' | 'yaml';
const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['variables', 'Variables'],
  ['questions', 'Questions'],
  ['scripts', 'Setup & solution'],
  ['yaml', 'YAML'],
];

const SHELL_TEMPLATE = '#!/usr/bin/env bash\nset -euo pipefail\n\n';

function withYaml(b: ScenarioBundle, text: string): ScenarioBundle {
  const next = setFile(b, SCENARIO_FILE, text);
  const domain = /^domain:\s*["']?([a-z-]+)/m.exec(text)?.[1];
  return domain && (DOMAINS as readonly string[]).includes(domain) ? { ...next, domain: domain as ScenarioBundle['domain'] } : next;
}

function transform(b: ScenarioBundle, fn: (doc: Document, b: ScenarioBundle) => ScenarioBundle | void): ScenarioBundle {
  const { doc, errors } = parseScenario(getFile(b, SCENARIO_FILE) ?? '');
  if (errors.length) return b;
  const out = fn(doc, b) ?? b;
  return withYaml(out, stringify(doc));
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">{title}</h3>
        {aside && <span className="text-xs text-zinc-500">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function StudioEditorPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const session = useSession().data;
  const loaded = useQuery({ queryKey: ['studio-bundle', id], queryFn: () => studioApi.read(id), staleTime: Infinity, gcTime: 0 });
  const [bundle, setBundle] = useState<ScenarioBundle | null>(null);
  const [saved, setSaved] = useState('');
  const [tab, setTab] = useState<Tab>('questions');
  const [issues, setIssues] = useState<StudioIssue[] | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [tries, setTries] = useState<Record<string, TryState>>({});

  useEffect(() => {
    if (loaded.data) {
      setBundle(loaded.data);
      setSaved(JSON.stringify(loaded.data));
    }
  }, [loaded.data]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.scrollPaddingBottom = '5rem';
    return () => void (root.style.scrollPaddingBottom = '');
  }, []);

  const dirty = bundle !== null && JSON.stringify(bundle) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  const yamlText = bundle ? (getFile(bundle, SCENARIO_FILE) ?? '') : '';
  const parsed: ParsedScenario = useMemo(() => parseScenario(yamlText), [yamlText]);
  const d = parsed.draft;
  const workers = workersOf(d);
  const variables = variablesOk(d.variables) ? d.variables : {};

  // When the lab runs this scenario, previews start from its real values.
  const liveVars = session?.state === 'running' && session.scenarioId === id ? session.vars : null;
  const liveKey = JSON.stringify(liveVars);
  const prevDefs = useRef<Record<string, string>>({});
  const varsKey = JSON.stringify(variables);
  useEffect(() => {
    const defs = Object.fromEntries(Object.entries(variables).map(([n, v]) => [n, JSON.stringify(v)]));
    const before = prevDefs.current;
    prevDefs.current = defs;
    setPreview((p) =>
      Object.fromEntries(
        Object.entries(variables).map(([n, def]) => {
          if (n in p && before[n] === defs[n]) return [n, p[n]];
          if (!(n in before) && liveVars?.[n] !== undefined) return [n, liveVars[n]];
          return [n, rollVariable(def, workers)];
        }),
      ),
    );
    // varsKey stands in for `variables`, which is a new object on every render.
  }, [varsKey, workers]);
  useEffect(() => {
    if (liveVars) setPreview((p) => ({ ...p, ...Object.fromEntries(Object.entries(liveVars).filter(([n]) => n in p)) }));
  }, [liveKey]);

  const [validateRetry, setValidateRetry] = useState(0);
  useEffect(() => {
    if (!bundle) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      studioApi
        .validate(bundle)
        .then((r) => setIssues(r.issues))
        .catch((e: Error) => {
          // fetch throws TypeError when the API is unreachable (e.g. restarting); HTTP errors are plain Errors.
          if (e instanceof TypeError) retry = setTimeout(() => setValidateRetry((n) => n + 1), 3000);
          setIssues([{ level: 'error', message: e instanceof TypeError ? `Could not reach the API to validate: ${e.message}` : e.message }]);
        });
    }, 500);
    return () => {
      clearTimeout(t);
      clearTimeout(retry);
    };
  }, [bundle, validateRetry]);

  const apply = useCallback(
    (fn: (doc: Document, b: ScenarioBundle) => ScenarioBundle | void) => setBundle((b) => b && transform(b, fn)),
    [],
  );
  const edit: Edit = useCallback((fn) => apply((doc) => void fn(doc)), [apply]);
  const putFile = useCallback((path: string, content: string) => setBundle((b) => b && setFile(b, path, content)), []);

  const save = useMutation({
    mutationFn: (b: ScenarioBundle) => studioApi.save(b),
    onSuccess: (r, b) => {
      setSaved(JSON.stringify(b));
      setIssues(r.issues);
      qc.invalidateQueries({ queryKey: ['scenarios'] });
    },
  });

  const job = useQuery({
    queryKey: ['studio-job'],
    queryFn: studioApi.job,
    refetchInterval: (q) => (q.state.data?.state === 'running' ? 1500 : false),
    refetchIntervalInBackground: true,
  });
  const run = useMutation({
    mutationFn: async (kind: StudioJob['kind']) => {
      if (dirty && bundle) await save.mutateAsync(bundle);
      return studioApi.run(id, kind);
    },
    onSuccess: (r) => qc.setQueryData(['studio-job'], r.job),
  });
  const myJob = job.data?.scenarioId === id ? job.data : null;
  const [dismissedJob, setDismissedJob] = useState<string | null>(null);
  const running = job.data?.state === 'running';

  const sessionHere = session?.state === 'running' && session.scenarioId === id;
  const labRunning = session?.state === 'running';

  const tryCheck = async (key: string, check: CheckDraft) => {
    setTries((t) => ({ ...t, [key]: { pending: true } }));
    try {
      if (check.type === 'script' && dirty && bundle) await save.mutateAsync(bundle);
      const result = await studioApi.tryCheck(check, id, sessionHere ? undefined : preview);
      setTries((t) => ({ ...t, [key]: { result } }));
    } catch (e) {
      setTries((t) => ({ ...t, [key]: { error: (e as Error).message } }));
    }
  };

  if (loaded.error) return <ErrorBanner error={loaded.error} />;
  if (!bundle) return <div className="text-sm text-zinc-500">Loading…</div>;

  const files = bundle.files.map((f) => f.path);
  const setupScripts = files.filter((p) => p.startsWith('setup/'));
  const checkScripts = files.filter((p) => p.startsWith('checks/'));
  const nodeVars = Object.entries(variables)
    .filter(([, v]) => 'node' in v)
    .map(([n]) => `\${${n}}`);
  const nodes = ['controlplane', ...Array.from({ length: workers }, (_, i) => `worker-${i + 1}`), ...nodeVars];
  const allText = bundle.files.map((f) => f.content).join('\n');
  const usage = (name: string) => (allText.match(new RegExp(`\\$\\{?${name}\\b`, 'g')) ?? []).length;
  const errors = issues?.filter((i) => i.level === 'error') ?? [];
  const warnings = issues?.filter((i) => i.level === 'warning') ?? [];
  const isDraft = d.draft === true;
  const yamlBroken = parsed.errors.length > 0;

  const publish = () => {
    const next = transform(bundle, (doc) => void doc.delete('draft'));
    setBundle(next);
    save.mutate(next);
  };

  return (
    <div className="space-y-4 pb-16">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/studio" className="text-sm text-zinc-400 hover:text-zinc-100">
          ← Studio
        </Link>
        <DomainBadge domain={bundle.domain} />
        <h1 className="text-lg font-semibold text-zinc-100">{d.title || id}</h1>
        <span className="font-mono text-xs text-zinc-500">{id}</span>
        {isDraft && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300">draft</span>}
        {dirty && <span className="text-xs text-amber-400">unsaved changes</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Link to="/studio/new" className={buttonClass()} title="Build a lab with the guided form">
            Quick Create
          </Link>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(bundle)}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            disabled={running || run.isPending}
            onClick={() => run.mutate('dry-run')}
            title="Start, run setup and grade: every task should fail"
          >
            Dry-run
          </Button>
          <Button
            disabled={running || run.isPending}
            onClick={() => run.mutate('verify')}
            title="Start, apply the solution and grade: every check should pass"
          >
            Verify
          </Button>
          {isDraft && (
            <Button
              variant="primary"
              disabled={save.isPending || errors.length > 0}
              onClick={publish}
              title={errors.length ? 'Fix the errors first' : 'Show on the Scenarios page'}
            >
              Publish
            </Button>
          )}
        </div>
      </div>

      <ErrorBanner error={save.error} onDismiss={() => save.reset()} />
      <ErrorBanner error={run.error} onDismiss={() => run.reset()} />

      {myJob && myJob.startedAt !== dismissedJob && (
        <JobPanel
          job={myJob}
          progress={session?.scenarioId === id ? session.progress : []}
          onDismiss={() => setDismissedJob(myJob.startedAt)}
        />
      )}

      <div className="flex gap-1 border-b border-zinc-800">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? 'border-sky-500 text-zinc-100' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {yamlBroken && tab !== 'yaml' ? (
        <ErrorBanner error={new Error(`scenario.yaml has syntax errors; fix them in the YAML tab:\n${parsed.errors.join('\n')}`)} />
      ) : (
        <>
          {tab === 'overview' && <OverviewTab d={d} edit={edit} />}
          {tab === 'variables' && (
            <Card title="Variables">
              <VariablesEditor
                variables={variables}
                edit={edit}
                preview={preview}
                usage={usage}
                onRoll={() => setPreview(rollVars(variables, workers))}
              />
            </Card>
          )}
          {tab === 'questions' && (
            <QuestionsTab
              bundle={bundle}
              parsed={parsed}
              apply={apply}
              edit={edit}
              putFile={putFile}
              preview={preview}
              nodes={nodes}
              setupScripts={setupScripts}
              checkScripts={checkScripts}
              tries={tries}
              onTry={tryCheck}
              lab={labRunning ? (sessionHere ? 'this' : session!.scenarioTitle) : null}
            />
          )}
          {tab === 'scripts' && (
            <ScriptsTab
              bundle={bundle}
              d={d}
              edit={edit}
              setBundle={setBundle}
              putFile={putFile}
              nodes={nodes}
              setupScripts={setupScripts}
            />
          )}
          {tab === 'yaml' && (
            <Card title="scenario.yaml">
              <Code language="yaml" value={yamlText} onChange={(text) => setBundle((b) => b && withYaml(b, text))} minHeight="28rem" />
            </Card>
          )}
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
        {showIssues && issues && issues.length > 0 && (
          <ul className="mx-auto max-h-56 max-w-7xl space-y-1 overflow-auto px-4 pt-3 text-xs">
            {[...errors, ...warnings].map((i, n) => (
              <li key={n} className={i.level === 'error' ? 'text-red-300' : 'text-amber-300'}>
                {i.level === 'error' ? '✕' : '!'} {i.message}
              </li>
            ))}
          </ul>
        )}
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 text-sm">
          {issues === null ? (
            <span className="text-zinc-500">Validating…</span>
          ) : issues.length === 0 ? (
            <span className="text-emerald-400">✓ Valid: schema, files and lint all pass</span>
          ) : (
            <button className="flex items-center gap-3" onClick={() => setShowIssues((s) => !s)}>
              {errors.length > 0 && (
                <span className="text-red-400">
                  {errors.length} error{errors.length === 1 ? '' : 's'}
                </span>
              )}
              {warnings.length > 0 && (
                <span className="text-amber-400">
                  {warnings.length} warning{warnings.length === 1 ? '' : 's'}
                </span>
              )}
              <span className="text-xs text-zinc-500">{showIssues ? 'hide' : 'show'}</span>
            </button>
          )}
          <span className="ml-auto text-xs text-zinc-500">
            {Object.keys(visibleVars(preview, variables)).length > 0 && (
              <span className="font-mono">
                preview:{' '}
                {Object.entries(visibleVars(preview, variables))
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' ')}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ d, edit }: { d: ParsedScenario['draft']; edit: Edit }) {
  const num = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
  const taskPoints = Array.isArray(d.tasks) ? d.tasks.reduce((s, t) => s + (Number(t?.points) || 0), 0) : undefined;
  return (
    <Card title="Overview">
      <div className="grid gap-4 md:grid-cols-3">
        <Label text="Title" className="md:col-span-2">
          <input className={field} value={d.title ?? ''} onChange={(e) => edit((doc) => setPath(doc, ['title'], e.target.value))} />
        </Label>
        <Label text="Topic">
          <select className={field} value={d.domain ?? ''} onChange={(e) => edit((doc) => setPath(doc, ['domain'], e.target.value))}>
            {DOMAINS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Label>
        <Label text="Difficulty">
          <select
            className={field}
            value={String(d.difficulty ?? 1)}
            onChange={(e) => edit((doc) => setPath(doc, ['difficulty'], Number(e.target.value)))}
          >
            <option value="1">1 · easy</option>
            <option value="2">2 · medium</option>
            <option value="3">3 · hard</option>
          </select>
        </Label>
        <Label text="Estimated minutes">
          <CommitInput
            className={field}
            value={String(d.estimatedMinutes ?? '')}
            onCommit={(v) => edit((doc) => setPath(doc, ['estimatedMinutes'], num(v)))}
          />
        </Label>
        <Label text={taskPoints !== undefined ? `Points (questions add up to ${taskPoints})` : 'Points'}>
          <CommitInput className={field} value={String(d.points ?? '')} onCommit={(v) => edit((doc) => setPath(doc, ['points'], num(v)))} />
        </Label>
        <Label text="Tags (comma-separated)" className="md:col-span-2">
          <CommitInput
            className={field}
            value={(d.tags ?? []).join(', ')}
            onCommit={(v) =>
              edit((doc) =>
                setPath(
                  doc,
                  ['tags'],
                  v
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                  true,
                ),
              )
            }
          />
        </Label>
        <Label text="Base image">
          <select className={field} value={d.base ?? 'cluster'} onChange={(e) => edit((doc) => setPath(doc, ['base'], e.target.value))}>
            {BASES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </Label>
        <Label text="Workers">
          <select
            className={field}
            value={String(d.nodes?.workers ?? 2)}
            onChange={(e) => edit((doc) => setPath(doc, ['nodes'], { controlPlane: 1, workers: Number(e.target.value) }, true))}
          >
            {[0, 1, 2].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Label>
        <Label text="kubectl context shown to the candidate">
          <input
            className={mono}
            value={d.context ?? ''}
            placeholder="kubernetes-admin@kubernetes"
            onChange={(e) => edit((doc) => setPath(doc, ['context'], e.target.value))}
          />
        </Label>
        <Label text="Settle seconds after setup">
          <CommitInput
            className={field}
            value={String(d.settleSeconds ?? '')}
            placeholder="30"
            onCommit={(v) => edit((doc) => setPath(doc, ['settleSeconds'], num(v)))}
          />
        </Label>
      </div>
    </Card>
  );
}

function QuestionsTab({
  bundle,
  parsed,
  apply,
  edit,
  putFile,
  preview,
  nodes,
  setupScripts,
  checkScripts,
  tries,
  onTry,
  lab,
}: {
  bundle: ScenarioBundle;
  parsed: ParsedScenario;
  apply: (fn: (doc: Document, b: ScenarioBundle) => ScenarioBundle | void) => void;
  edit: Edit;
  putFile: (path: string, content: string) => void;
  preview: Record<string, string>;
  nodes: string[];
  setupScripts: string[];
  checkScripts: string[];
  tries: Record<string, TryState>;
  onTry: (key: string, check: CheckDraft) => void;
  lab: string | null;
}) {
  const d = parsed.draft;
  const refs = taskRefs(d);
  const [active, setActive] = useState(0);
  const current: TaskRef | undefined = refs[Math.min(active, refs.length - 1)];
  const allCheckIds = refs.flatMap((r) => (r.task.checks ?? []).map((c) => c?.id));

  const addQuestion = () => {
    const ids = refs[0]?.legacy ? ['q1'] : refs.map((r) => r.task.id);
    const qid = nextId('q', ids);
    apply((doc, b) => {
      const next = refs[0]?.legacy ? convertToTasks(b, doc, d) : b;
      doc.addIn(
        ['tasks'],
        doc.createNode({
          id: qid,
          title: 'New question',
          points: 1,
          checks: [
            {
              id: `${qid}-check-1`,
              description: 'Describe what is checked',
              type: 'kubectl',
              run: 'kubectl get nodes',
              expect: { exitCode: 0 },
            },
          ],
        }),
      );
      setPath(doc, ['tasks', ids.length, 'checks', 0, 'expect'], { exitCode: 0 }, true);
      return setFile(next, taskFile(qid), `Describe what the candidate must do.\n`);
    });
    setActive(ids.length);
  };

  if (!current) return null;
  const t = current.task;
  const md = getFile(bundle, current.markdownPath) ?? '';
  const checksPath = [...current.base, 'checks'];
  const hintsPath = [...current.base, 'hints'];
  const checkPrefix = current.legacy ? 'check-' : `${t.id}-check-`;

  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
      <aside className="space-y-2">
        {refs.map((r, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${
              current.index === i
                ? 'border-sky-600 bg-sky-950/30 text-zinc-100'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Q{i + 1}</span>
              <span className="text-xs text-zinc-500">{r.task.points ?? '?'} pt</span>
            </div>
            <div className="truncate text-xs text-zinc-400">{r.legacy ? 'Single question' : r.task.title}</div>
          </button>
        ))}
        <Button variant="ghost" onClick={addQuestion} className="w-full justify-center">
          + Add question
        </Button>
        <p className="px-1 text-xs text-zinc-500">
          {lab === null ? (
            <>Start any scenario on the Scenarios page to try checks against a live lab.</>
          ) : lab === 'this' ? (
            <>Lab is running this scenario: checks are tried with its real values.</>
          ) : (
            <>Lab is running “{lab}”: checks are tried there with the preview values.</>
          )}
        </p>
      </aside>

      <div className="space-y-5">
        {current.legacy ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
            Single-question scenario: title and points come from Overview. Adding a question moves this one into <code>tasks:</code> as Q1.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-[8rem_1fr_6rem_auto]">
            <Label text="Id">
              <CommitInput
                className={mono}
                value={t.id ?? ''}
                onCommit={(v) =>
                  apply((doc, b) => {
                    doc.setIn([...current.base, 'id'], v);
                    return renameFile(b, current.markdownPath, taskFile(v));
                  })
                }
              />
            </Label>
            <Label text="Title">
              <input
                className={field}
                value={t.title ?? ''}
                onChange={(e) => edit((doc) => setPath(doc, [...current.base, 'title'], e.target.value))}
              />
            </Label>
            <Label text="Points">
              <CommitInput
                className={field}
                value={String(t.points ?? '')}
                onCommit={(v) => edit((doc) => setPath(doc, [...current.base, 'points'], Number(v) || undefined))}
              />
            </Label>
            <div className="flex items-end">
              <Button
                variant="danger"
                disabled={refs.length < 2}
                title={refs.length < 2 ? 'A scenario needs at least one question' : 'Remove this question'}
                onClick={() => {
                  if (!confirm(`Remove Q${current.index + 1} "${t.title}" and its markdown?`)) return;
                  apply((doc, b) => {
                    doc.deleteIn(['tasks', current.index]);
                    return removeFile(b, current.markdownPath);
                  });
                  setActive(Math.max(0, current.index - 1));
                }}
              >
                Remove
              </Button>
            </div>
            <Label text="kubectl context for this question (optional)" className="md:col-span-4">
              <input
                className={mono}
                value={t.context ?? ''}
                onChange={(e) => edit((doc) => setPath(doc, [...current.base, 'context'], e.target.value))}
              />
            </Label>
          </div>
        )}

        <Section title="Question text" aside={current.markdownPath}>
          <div className="grid gap-3 xl:grid-cols-2">
            <Code
              key={current.markdownPath}
              language="markdown"
              value={md}
              onChange={(v) => putFile(current.markdownPath, v)}
              minHeight="14rem"
            />
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="mb-2 text-[11px] tracking-wide text-zinc-500 uppercase">Preview with rolled values</div>
              <Markdown>{render(md, preview) || '_Empty_'}</Markdown>
            </div>
          </div>
        </Section>

        {!current.legacy && (
          <Section title="Setup for this question" aside="runs after the scenario setup">
            <StepsEditor
              steps={t.setup ?? []}
              path={[...current.base, 'setup']}
              edit={edit}
              nodes={nodes}
              scripts={setupScripts}
              dropWhenEmpty
            />
          </Section>
        )}

        <Section title="Checks" aside={`${(t.checks ?? []).length} checks · weights are scaled to the question's points`}>
          <div className="space-y-2">
            {(t.checks ?? []).map((c, ci) => {
              const key = `${current.markdownPath}#${ci}`;
              return (
                <CheckEditor
                  key={key}
                  check={c ?? {}}
                  path={[...checksPath, ci]}
                  edit={edit}
                  nodes={nodes}
                  checkScripts={checkScripts}
                  tryState={tries[key]}
                  onTry={() => onTry(key, c)}
                  onRemove={(t.checks ?? []).length > 1 ? () => edit((doc) => doc.deleteIn([...checksPath, ci])) : undefined}
                />
              );
            })}
            <Button
              variant="ghost"
              onClick={() =>
                edit((doc) => {
                  const n = (t.checks ?? []).length;
                  doc.addIn(
                    checksPath,
                    doc.createNode({
                      id: nextId(checkPrefix, allCheckIds),
                      description: 'Describe what is checked',
                      type: 'kubectl',
                      run: 'kubectl get nodes',
                    }),
                  );
                  setPath(doc, [...checksPath, n, 'expect'], { exitCode: 0 }, true);
                })
              }
            >
              + Add check
            </Button>
          </div>
        </Section>

        <Section title="Hints">
          <HintsEditor hints={t.hints ?? []} path={hintsPath} edit={edit} />
        </Section>
      </div>
    </div>
  );
}

function ScriptsTab({
  bundle,
  d,
  edit,
  setBundle,
  putFile,
  nodes,
  setupScripts,
}: {
  bundle: ScenarioBundle;
  d: ParsedScenario['draft'];
  edit: Edit;
  setBundle: Dispatch<SetStateAction<ScenarioBundle | null>>;
  putFile: (path: string, content: string) => void;
  nodes: string[];
  setupScripts: string[];
}) {
  const scriptFiles = bundle.files
    .map((f) => f.path)
    .filter(isScriptFilePath)
    .sort();
  const [selected, setSelected] = useState<string | null>(scriptFiles[0] ?? null);
  const [folder, setFolder] = useState<'setup' | 'checks'>('setup');
  const [name, setName] = useState('');
  const newPath = `${folder}/${name.endsWith('.sh') ? name : `${name}.sh`}`;
  const canAdd = name.trim() !== '' && isScriptFilePath(newPath) && !scriptFiles.includes(newPath);
  const current = selected && scriptFiles.includes(selected) ? selected : (scriptFiles[0] ?? null);

  const addFile = (path: string, content: string) => {
    putFile(path, content);
    setSelected(path);
  };

  return (
    <div className="space-y-4">
      <Card title="Setup steps">
        <p className="mb-3 text-xs text-zinc-400">
          Run in order when the scenario starts, as root on the chosen node. Scripts get the variables as environment variables and the
          admin kubeconfig.
        </p>
        <StepsEditor steps={d.setup ?? []} path={['setup']} edit={edit} nodes={nodes} scripts={setupScripts} />
      </Card>

      <Card title="Solution">
        <p className="mb-3 text-xs text-zinc-400">
          Verify runs these steps if set; otherwise it runs <code>solution.sh</code> on the controlplane. <code>solution.md</code> is what
          the candidate sees when they reveal the solution.
        </p>
        <StepsEditor
          steps={d.solution ?? []}
          path={['solution']}
          edit={edit}
          nodes={nodes}
          scripts={[...setupScripts, 'solution.sh']}
          dropWhenEmpty
          addLabel="Add solution step"
        />
      </Card>

      <Card title="Files">
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <aside className="space-y-2">
            {scriptFiles.map((p) => (
              <button
                key={p}
                onClick={() => setSelected(p)}
                className={`block w-full truncate rounded-md px-2.5 py-1.5 text-left font-mono text-xs ${
                  current === p ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                }`}
              >
                {p}
              </button>
            ))}
            <div className="space-y-2 border-t border-zinc-800 pt-3">
              <div className="flex gap-1">
                <select className={`${field} w-24`} value={folder} onChange={(e) => setFolder(e.target.value as 'setup' | 'checks')}>
                  <option value="setup">setup/</option>
                  <option value="checks">checks/</option>
                </select>
                <input className={mono} placeholder="break.sh" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Button
                className="w-full justify-center"
                disabled={!canAdd}
                onClick={() => {
                  addFile(newPath, SHELL_TEMPLATE);
                  setName('');
                }}
              >
                New script
              </Button>
              {!scriptFiles.includes('solution.sh') && (
                <Button variant="ghost" className="w-full justify-center" onClick={() => addFile('solution.sh', SHELL_TEMPLATE)}>
                  + solution.sh
                </Button>
              )}
              {!scriptFiles.includes('solution.md') && (
                <Button variant="ghost" className="w-full justify-center" onClick={() => addFile('solution.md', '# Solution\n\n')}>
                  + solution.md
                </Button>
              )}
            </div>
          </aside>
          <div className="space-y-2">
            {current ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-zinc-400">{current}</span>
                  <Button
                    variant="danger"
                    className="!px-2 !py-1 text-xs"
                    onClick={() => {
                      if (confirm(`Delete ${current}?`)) setBundle((b) => b && removeFile(b, current));
                    }}
                  >
                    Delete file
                  </Button>
                </div>
                <Code
                  key={current}
                  language={current.endsWith('.md') ? 'markdown' : 'shell'}
                  value={getFile(bundle, current) ?? ''}
                  onChange={(v) => putFile(current, v)}
                  minHeight="22rem"
                />
              </>
            ) : (
              <p className="text-sm text-zinc-500">No scripts yet.</p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

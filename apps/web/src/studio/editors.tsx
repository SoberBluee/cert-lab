import { lazy, Suspense, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import type { Document } from 'yaml';
import type { TryCheckResult } from '@cka/schema';
import { VAR_NAME, type VariableDef } from '@cka/schema/vars';
import type { CodeEditorProps } from '../components/CodeEditor';
import { Button } from '../components/ui';
import { DEFAULT_VARIABLE, setPath, variableKind, type CheckDraft, type StepDraft, type YamlPath } from './model';

const LazyCodeEditor = lazy(() => import('../components/CodeEditor'));

export function Code(props: CodeEditorProps) {
  return (
    <Suspense fallback={<div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">Loading editor…</div>}>
      <LazyCodeEditor {...props} />
    </Suspense>
  );
}

export type Edit = (fn: (doc: Document) => void) => void;

export const field = 'w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600';
export const mono = `${field} font-mono text-[12.5px]`;

export function Label({ text, children, className = '' }: { text: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs text-zinc-500">{text}</span>
      {children}
    </label>
  );
}

/**
 * Keeps its own text while focused and commits on blur or Enter, so values that only parse once
 * complete (lists, numbers) can be typed character by character.
 */
export function CommitInput({
  value,
  onCommit,
  ...props
}: { value: string; onCommit: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <input
      {...props}
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      onChange={(e) => setText(e.target.value)}
    />
  );
}

const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? undefined : Number(s));

function appendTo(doc: Document, path: YamlPath, item: unknown) {
  if (doc.hasIn(path)) doc.addIn(path, doc.createNode(item));
  else doc.setIn(path, doc.createNode([item]));
}

function removeAt(doc: Document, path: YamlPath, index: number, dropWhenEmpty: boolean) {
  doc.deleteIn([...path, index]);
  const left = doc.getIn(path) as { items?: unknown[] } | undefined;
  if (dropWhenEmpty && (!left?.items || left.items.length === 0)) doc.deleteIn(path);
}

export function NodeInput({ value, onChange, nodes }: { value: string; onChange: (v: string) => void; nodes: string[] }) {
  const id = useRef(`nodes-${Math.random().toString(36).slice(2)}`).current;
  return (
    <>
      <input className={mono} list={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="controlplane" />
      <datalist id={id}>
        {nodes.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}

export function StepsEditor({
  steps,
  path,
  edit,
  nodes,
  scripts,
  dropWhenEmpty = false,
  addLabel = 'Add step',
}: {
  steps: StepDraft[];
  path: YamlPath;
  edit: Edit;
  nodes: string[];
  scripts: string[];
  dropWhenEmpty?: boolean;
  addLabel?: string;
}) {
  const scriptList = useRef(`scripts-${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="space-y-2">
      <datalist id={scriptList}>
        {scripts.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {steps.map((st, i) => {
        const kind = st.run !== undefined ? 'run' : 'script';
        return (
          <div key={i} className="grid grid-cols-[9rem_6rem_1fr_6rem_auto] items-center gap-2">
            <NodeInput nodes={nodes} value={st.node ?? ''} onChange={(v) => edit((d) => setPath(d, [...path, i, 'node'], v))} />
            <select
              className={field}
              value={kind}
              onChange={(e) =>
                edit((d) => {
                  const current = kind === 'run' ? st.run : st.script;
                  d.deleteIn([...path, i, kind]);
                  d.setIn(
                    [...path, i, e.target.value],
                    current || (e.target.value === 'script' ? (scripts[0] ?? 'setup/break.sh') : 'true'),
                  );
                })
              }
            >
              <option value="script">script</option>
              <option value="run">run</option>
            </select>
            <input
              className={mono}
              list={kind === 'script' ? scriptList : undefined}
              value={(kind === 'run' ? st.run : st.script) ?? ''}
              placeholder={kind === 'run' ? 'shell command' : 'setup/break.sh'}
              onChange={(e) => edit((d) => d.setIn([...path, i, kind], e.target.value))}
            />
            <CommitInput
              className={field}
              title="timeout in seconds"
              placeholder="300 s"
              value={st.timeoutSeconds === undefined ? '' : String(st.timeoutSeconds)}
              onCommit={(v) => edit((d) => setPath(d, [...path, i, 'timeoutSeconds'], num(v)))}
            />
            <Button variant="ghost" onClick={() => edit((d) => removeAt(d, path, i, dropWhenEmpty))} title="Remove step">
              ✕
            </Button>
          </div>
        );
      })}
      <Button
        variant="ghost"
        onClick={() =>
          edit((d) => appendTo(d, path, { node: 'controlplane', script: scripts[0] ?? 'setup/break.sh', timeoutSeconds: 300 }))
        }
      >
        + {addLabel}
      </Button>
    </div>
  );
}

const EXPECT_OPS = ['equals', 'contains', 'notContains', 'matches', 'exitCode', 'notEmpty', 'gte', 'lte'] as const;
type ExpectOp = (typeof EXPECT_OPS)[number];
const NUMERIC_OPS: ExpectOp[] = ['exitCode', 'gte', 'lte'];

function ExpectEditor({
  expect,
  onChange,
}: {
  expect: Record<string, unknown>;
  onChange: (e: Record<string, unknown> | undefined) => void;
}) {
  const entries = Object.entries(expect) as [ExpectOp, unknown][];
  const put = (next: [string, unknown][]) => onChange(next.length ? Object.fromEntries(next) : undefined);
  const free = EXPECT_OPS.filter((o) => !(o in expect));
  return (
    <div className="space-y-1.5">
      {entries.map(([op, v], i) => (
        <div key={op} className="grid grid-cols-[9rem_1fr_auto] items-center gap-2">
          <select
            className={field}
            value={op}
            onChange={(e) => {
              const nextOp = e.target.value as ExpectOp;
              const nextVal = nextOp === 'notEmpty' ? true : NUMERIC_OPS.includes(nextOp) ? (num(String(v)) ?? 0) : String(v ?? '');
              put(entries.map(([o, x], j): [string, unknown] => (j === i ? [nextOp, nextVal] : [o, x])));
            }}
          >
            {[op, ...free].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          {op === 'notEmpty' ? (
            <span className="text-xs text-zinc-500">output is not empty</span>
          ) : NUMERIC_OPS.includes(op) ? (
            <CommitInput
              className={mono}
              value={String(v ?? '')}
              onCommit={(s) => put(entries.map(([o, x], j): [string, unknown] => (j === i ? [o, num(s) ?? 0] : [o, x])))}
            />
          ) : (
            <input
              className={mono}
              value={String(v ?? '')}
              onChange={(e) => put(entries.map(([o, x], j): [string, unknown] => (j === i ? [o, e.target.value] : [o, x])))}
            />
          )}
          <Button variant="ghost" onClick={() => put(entries.filter((_, j) => j !== i))} title="Remove operator">
            ✕
          </Button>
        </div>
      ))}
      {free.length > 0 && (
        <Button
          variant="ghost"
          onClick={() => put([...entries, [free[0], free[0] === 'exitCode' ? 0 : free[0] === 'notEmpty' ? true : '']])}
        >
          + operator
        </Button>
      )}
    </div>
  );
}

const CHECK_TEMPLATES: Record<NonNullable<CheckDraft['type']>, (scripts: string[]) => Partial<CheckDraft>> = {
  kubectl: () => ({ run: 'kubectl get nodes', expect: { exitCode: 0 } }),
  ssh: () => ({ node: 'controlplane', run: 'systemctl is-active kubelet', expect: { equals: 'active' } }),
  script: (scripts) => ({ node: 'controlplane', script: scripts[0] ?? 'checks/check.sh' }),
  file: () => ({ node: 'controlplane', path: '/etc/kubernetes/manifests/example.yaml', exists: true }),
};

export interface TryState {
  pending?: boolean;
  result?: TryCheckResult;
  error?: string;
}

export function CheckEditor({
  check,
  path,
  edit,
  nodes,
  checkScripts,
  tryState,
  onTry,
  onRemove,
}: {
  check: CheckDraft;
  path: YamlPath;
  edit: Edit;
  nodes: string[];
  checkScripts: string[];
  tryState?: TryState;
  onTry: () => void;
  onRemove?: () => void;
}) {
  const type = check.type ?? 'kubectl';
  const set = (key: keyof CheckDraft, value: unknown, flow = false) => edit((d) => setPath(d, [...path, key], value, flow));
  const [open, setOpen] = useState(false);

  const changeType = (next: NonNullable<CheckDraft['type']>) =>
    edit((d) => {
      const { id, description, weight, retrySeconds } = check;
      const { expect, ...rest } = CHECK_TEMPLATES[next](checkScripts);
      d.setIn(
        path,
        d.createNode({
          id,
          description,
          type: next,
          ...rest,
          ...(weight !== undefined && { weight }),
          ...(retrySeconds !== undefined && { retrySeconds }),
        }),
      );
      if (expect) setPath(d, [...path, 'expect'], expect, true);
    });

  const result = tryState?.result?.check;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          className="text-xs text-zinc-500 hover:text-zinc-200"
          onClick={() => setOpen((o) => !o)}
          title={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">{type}</span>
        <button className="min-w-0 flex-1 truncate text-left text-sm text-zinc-200" onClick={() => setOpen((o) => !o)}>
          {check.description || <span className="text-zinc-500">(no description)</span>}
        </button>
        {result && (
          <span className={`text-xs font-medium ${result.passed ? 'text-emerald-400' : 'text-red-400'}`}>
            {result.passed ? 'passed' : 'failed'}
          </span>
        )}
        <span className="text-xs text-zinc-500">×{check.weight ?? 1}</span>
        <Button
          variant="secondary"
          className="!px-2 !py-1 text-xs"
          disabled={tryState?.pending}
          onClick={onTry}
          title="Run this check against the running lab"
        >
          {tryState?.pending ? 'Trying…' : 'Try on cluster'}
        </Button>
        {onRemove && (
          <Button variant="ghost" className="!px-2 !py-1" onClick={onRemove} title="Remove check">
            ✕
          </Button>
        )}
      </div>
      {(tryState?.error || result) && (
        <div className="border-t border-zinc-800 px-3 py-2 text-xs">
          {tryState?.error ? (
            <span className="text-red-300">{tryState.error}</span>
          ) : (
            result && (
              <div className="space-y-1">
                <div className={result.passed ? 'text-emerald-300' : 'text-red-300'}>{result.detail}</div>
                {result.output && (
                  <pre className="max-h-40 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-400">
                    {result.output}
                  </pre>
                )}
                {tryState?.result && Object.keys(tryState.result.vars).length > 0 && (
                  <div className="font-mono text-[11px] text-zinc-500">
                    with{' '}
                    {Object.entries(tryState.result.vars)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(' ')}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}
      {open && (
        <div className="grid gap-3 border-t border-zinc-800 p-3 md:grid-cols-2">
          <Label text="Id">
            <input className={mono} value={check.id ?? ''} onChange={(e) => set('id', e.target.value)} />
          </Label>
          <div className="grid grid-cols-3 gap-2">
            <Label text="Type">
              <select className={field} value={type} onChange={(e) => changeType(e.target.value as NonNullable<CheckDraft['type']>)}>
                {Object.keys(CHECK_TEMPLATES).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Label>
            <Label text="Weight">
              <CommitInput className={field} value={String(check.weight ?? '')} placeholder="1" onCommit={(v) => set('weight', num(v))} />
            </Label>
            <Label text="Retry (s)">
              <CommitInput
                className={field}
                value={String(check.retrySeconds ?? '')}
                placeholder="default"
                onCommit={(v) => set('retrySeconds', num(v))}
              />
            </Label>
          </div>
          <Label text="Description (shown in results)" className="md:col-span-2">
            <input className={field} value={check.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </Label>
          {type !== 'kubectl' && (
            <Label text="Node">
              <NodeInput nodes={nodes} value={check.node ?? ''} onChange={(v) => set('node', v)} />
            </Label>
          )}
          {(type === 'kubectl' || type === 'ssh') && (
            <Label
              text={type === 'kubectl' ? 'Command (runs with the admin kubeconfig)' : 'Command (runs on the node as root)'}
              className="md:col-span-2"
            >
              <input className={mono} value={check.run ?? ''} onChange={(e) => set('run', e.target.value)} />
            </Label>
          )}
          {type === 'script' && (
            <>
              <Label text="Script">
                <select className={mono} value={check.script ?? ''} onChange={(e) => set('script', e.target.value)}>
                  {[...new Set([check.script ?? '', ...checkScripts])].map((s) => (
                    <option key={s} value={s}>
                      {s || '(choose)'}
                    </option>
                  ))}
                </select>
              </Label>
              <Label text="Arguments (space-separated)">
                <CommitInput
                  className={mono}
                  value={(check.args ?? []).join(' ')}
                  onCommit={(v) => set('args', v.trim() ? v.trim().split(/\s+/) : undefined, true)}
                />
              </Label>
            </>
          )}
          {type === 'file' && (
            <>
              <Label text="Absolute path">
                <input className={mono} value={check.path ?? ''} onChange={(e) => set('path', e.target.value)} />
              </Label>
              <Label text="Must exist">
                <select className={field} value={String(check.exists ?? true)} onChange={(e) => set('exists', e.target.value === 'true')}>
                  <option value="true">yes</option>
                  <option value="false">no (must be absent)</option>
                </select>
              </Label>
              <Label text="Contains">
                <input className={mono} value={check.contains ?? ''} onChange={(e) => set('contains', e.target.value)} />
              </Label>
              <Label text="Matches (regex)">
                <input className={mono} value={check.matches ?? ''} onChange={(e) => set('matches', e.target.value)} />
              </Label>
            </>
          )}
          {type !== 'file' && (
            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-zinc-500">Expect {type === 'script' && '(optional: without it, exit code 0 passes)'}</div>
              <ExpectEditor expect={check.expect ?? {}} onChange={(e) => set('expect', e, true)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function HintsEditor({ hints, path, edit }: { hints: string[]; path: YamlPath; edit: Edit }) {
  return (
    <div className="space-y-2">
      {hints.map((h, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-6 text-right text-xs text-zinc-500">{i + 1}.</span>
          <input className={field} value={h} onChange={(e) => edit((d) => d.setIn([...path, i], e.target.value))} />
          <Button variant="ghost" onClick={() => edit((d) => removeAt(d, path, i, true))} title="Remove hint">
            ✕
          </Button>
        </div>
      ))}
      <Button variant="ghost" onClick={() => edit((d) => appendTo(d, path, 'A nudge in the right direction.'))}>
        + Add hint
      </Button>
      <p className="text-xs text-zinc-500">Order from gentle to explicit. Each revealed hint is recorded with the attempt.</p>
    </div>
  );
}

export function VariablesEditor({
  variables,
  edit,
  preview,
  onRoll,
  usage,
}: {
  variables: Record<string, VariableDef>;
  edit: Edit;
  preview: Record<string, string>;
  onRoll: () => void;
  usage: (name: string) => number;
}) {
  const [name, setName] = useState('');
  const names = Object.keys(variables);
  const nameOk = VAR_NAME.test(name) && !names.includes(name);
  const put = (n: string, def: VariableDef) => edit((d) => setPath(d, ['variables', n], def, true));

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Generator</th>
              <th className="px-3 py-2 font-medium">Values</th>
              <th className="px-3 py-2 font-medium">Preview</th>
              <th className="px-3 py-2 font-medium">Used</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {names.map((n) => {
              const def = variables[n];
              const kind = variableKind(def);
              return (
                <tr key={n}>
                  <td className="px-3 py-2 font-mono text-violet-300">{n}</td>
                  <td className="px-3 py-2">
                    <select className={field} value={kind} onChange={(e) => put(n, DEFAULT_VARIABLE[e.target.value as typeof kind])}>
                      <option value="oneOf">one of</option>
                      <option value="range">number range</option>
                      <option value="node">node</option>
                      <option value="random">random name</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {'oneOf' in def && (
                      <CommitInput
                        className={mono}
                        value={def.oneOf.join(', ')}
                        title="Comma-separated"
                        onCommit={(v) => {
                          const values = v
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean);
                          if (values.length) put(n, { ...def, oneOf: values });
                        }}
                      />
                    )}
                    {'range' in def && (
                      <div className="flex items-center gap-2">
                        <CommitInput
                          className={field}
                          value={String(def.range[0])}
                          onCommit={(v) => put(n, { range: [num(v) ?? 0, def.range[1]] })}
                        />
                        <span className="text-zinc-500">to</span>
                        <CommitInput
                          className={field}
                          value={String(def.range[1])}
                          onCommit={(v) => put(n, { range: [def.range[0], num(v) ?? 0] })}
                        />
                      </div>
                    )}
                    {'node' in def && (
                      <select className={field} value={def.node} onChange={(e) => put(n, { node: e.target.value as 'workers' | 'any' })}>
                        <option value="workers">a worker</option>
                        <option value="any">any node (incl. controlplane)</option>
                      </select>
                    )}
                    {'random' in def && (
                      <div className="flex items-center gap-2">
                        <CommitInput
                          className={`${field} w-20`}
                          value={String(def.random)}
                          onCommit={(v) => put(n, { random: Math.min(16, Math.max(1, num(v) ?? 5)) })}
                        />
                        <span className="text-xs text-zinc-500">lowercase characters</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-300">
                    {'oneOf' in def && def.hidden ? <span className="text-zinc-500 italic">hidden</span> : (preview[n] ?? '–')}
                  </td>
                  <td className={`px-3 py-2 text-xs ${usage(n) ? 'text-zinc-400' : 'text-amber-400'}`}>{usage(n) || 'unused'}</td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" onClick={() => edit((d) => d.deleteIn(['variables', n]))} title={`Remove ${n}`}>
                      ✕
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!names.length && (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-sm text-zinc-500">
                  No variables yet. Add one to randomize names and values on every start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <input
          className={`${mono} w-48`}
          placeholder="NEW_VARIABLE"
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && nameOk) {
              put(name, DEFAULT_VARIABLE.oneOf);
              setName('');
            }
          }}
        />
        <Button
          disabled={!nameOk}
          onClick={() => {
            put(name, DEFAULT_VARIABLE.oneOf);
            setName('');
          }}
        >
          Add variable
        </Button>
        <Button variant="primary" className="ml-auto" onClick={onRoll} disabled={!names.length}>
          Roll
        </Button>
      </div>
      <p className="text-xs text-zinc-500">
        Write <code className="text-violet-300">{'${NAME}'}</code> in scenario.yaml and question text; scripts read them as environment
        variables (<code className="text-violet-300">$NAME</code>). Values are picked once per start and kept on Reset. Roll re-picks the
        preview values used on this page.
      </p>
    </div>
  );
}

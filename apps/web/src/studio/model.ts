import { isMap, parseDocument, YAMLMap, YAMLSeq, type Document } from 'yaml';
import type { BundleFile, ScenarioBundle } from '@cka/schema';
import type { VariableDef } from '@cka/schema/vars';

export type YamlPath = (string | number)[];

/** Loose view of scenario.yaml: the Studio edits drafts that do not validate yet. */
export interface StepDraft {
  node?: string;
  script?: string;
  run?: string;
  timeoutSeconds?: number;
  lane?: string;
}

export interface CheckDraft {
  id?: string;
  description?: string;
  type?: 'kubectl' | 'ssh' | 'script' | 'file';
  weight?: number;
  retrySeconds?: number;
  node?: string;
  run?: string;
  script?: string;
  args?: string[];
  path?: string;
  exists?: boolean;
  contains?: string;
  matches?: string;
  sha256?: string;
  expect?: Record<string, string | number | boolean>;
}

export interface TaskDraft {
  id?: string;
  title?: string;
  points?: number;
  context?: string;
  setup?: StepDraft[];
  checks?: CheckDraft[];
  hints?: string[];
}

export interface ScenarioDraft {
  id?: string;
  title?: string;
  domain?: string;
  difficulty?: number;
  estimatedMinutes?: number;
  points?: number;
  tags?: string[];
  base?: string;
  nodes?: { controlPlane?: number; workers?: number };
  context?: string;
  settleSeconds?: number;
  draft?: boolean;
  variables?: Record<string, VariableDef>;
  setup?: StepDraft[];
  solution?: StepDraft[];
  checks?: CheckDraft[];
  hints?: string[];
  tasks?: TaskDraft[];
}

export const SCENARIO_FILE = 'scenario.yaml';
export const LEGACY_TASK_FILE = 'task.md';
export const taskFile = (id: string) => `tasks/${id}.md`;

export const FILE_PATTERNS = [/^setup\/[A-Za-z0-9][A-Za-z0-9._-]*\.sh$/, /^checks\/[A-Za-z0-9][A-Za-z0-9._-]*\.sh$/, /^solution\.(md|sh)$/];
export const isScriptFilePath = (p: string) => FILE_PATTERNS.some((re) => re.test(p));

export function getFile(bundle: ScenarioBundle, path: string): string | undefined {
  return bundle.files.find((f) => f.path === path)?.content;
}

export function setFile(bundle: ScenarioBundle, path: string, content: string): ScenarioBundle {
  const files: BundleFile[] = bundle.files.some((f) => f.path === path)
    ? bundle.files.map((f) => (f.path === path ? { path, content } : f))
    : [...bundle.files, { path, content }];
  return { ...bundle, files };
}

export function removeFile(bundle: ScenarioBundle, path: string): ScenarioBundle {
  return { ...bundle, files: bundle.files.filter((f) => f.path !== path) };
}

export function renameFile(bundle: ScenarioBundle, from: string, to: string): ScenarioBundle {
  if (from === to) return bundle;
  return {
    ...bundle,
    files: bundle.files.filter((f) => f.path !== to).map((f) => (f.path === from ? { path: to, content: f.content } : f)),
  };
}

export interface ParsedScenario {
  doc: Document;
  draft: ScenarioDraft;
  errors: string[];
}

export function parseScenario(text: string): ParsedScenario {
  const doc = parseDocument(text);
  const errors = doc.errors.map((e) => e.message);
  let draft: ScenarioDraft = {};
  if (!errors.length) {
    const js = doc.toJS();
    if (js && typeof js === 'object' && !Array.isArray(js)) draft = js as ScenarioDraft;
    else errors.push('scenario.yaml must be a mapping');
  }
  return { doc, draft, errors };
}

/** Values that are empty are removed so optional keys do not linger as `key: ""`. */
export function setPath(doc: Document, path: YamlPath, value: unknown, flow = false): void {
  if (value === undefined || value === '') {
    if (doc.hasIn(path)) doc.deleteIn(path);
    return;
  }
  if (typeof value === 'object' && value !== null) doc.setIn(path, doc.createNode(value, { flow }));
  else doc.setIn(path, value);
}

/** Puts a key right after another one in a mapping, for readable diffs of new keys. */
export function moveKeyAfter(doc: Document, key: string, after: string): void {
  const root = doc.contents;
  if (!isMap(root)) return;
  const items = root.items;
  const from = items.findIndex((p) => (p.key as { value?: unknown })?.value === key);
  const anchor = items.findIndex((p) => (p.key as { value?: unknown })?.value === after);
  if (from < 0 || anchor < 0) return;
  const [pair] = items.splice(from, 1);
  items.splice(anchor + (from > anchor ? 1 : 0), 0, pair);
}

/** A question of the scenario: either an entry of tasks:, or the single legacy task (top-level checks). */
export interface TaskRef {
  index: number;
  legacy: boolean;
  task: TaskDraft;
  /** YAML path of the task mapping; [] for the legacy task (fields live at the root). */
  base: YamlPath;
  markdownPath: string;
}

export function taskRefs(d: ScenarioDraft): TaskRef[] {
  if (Array.isArray(d.tasks)) {
    return d.tasks.map((t, i) => ({
      index: i,
      legacy: false,
      task: t ?? {},
      base: ['tasks', i],
      markdownPath: taskFile(t?.id ?? `q${i + 1}`),
    }));
  }
  return [
    {
      index: 0,
      legacy: true,
      task: { id: 'main', title: d.title, points: d.points, context: d.context, checks: d.checks ?? [], hints: d.hints ?? [] },
      base: [],
      markdownPath: LEGACY_TASK_FILE,
    },
  ];
}

/** Long commands and hints stay on one line, as in the hand-written files. */
export const stringify = (doc: Document) => doc.toString({ lineWidth: 0 });

/** Moves top-level checks/hints and task.md into tasks[0] so more questions can be added. */
export function convertToTasks(bundle: ScenarioBundle, doc: Document, d: ScenarioDraft): ScenarioBundle {
  // The existing YAML nodes are moved rather than re-created, so their styles and comments survive.
  const task = doc.createNode({ id: 'q1', title: d.title ?? 'Question 1', points: d.points ?? 1 }) as YAMLMap;
  task.set('checks', doc.get('checks', true));
  if (d.hints?.length) task.set('hints', doc.get('hints', true));
  doc.delete('checks');
  doc.delete('hints');
  doc.set('tasks', new YAMLSeq());
  doc.addIn(['tasks'], task);
  let next = setFile(bundle, SCENARIO_FILE, stringify(doc));
  next = renameFile(next, LEGACY_TASK_FILE, taskFile('q1'));
  if (getFile(next, taskFile('q1')) === undefined) next = setFile(next, taskFile('q1'), '');
  return next;
}

export function nextId(prefix: string, taken: (string | undefined)[]): string {
  for (let i = 1; ; i++) if (!taken.includes(`${prefix}${i}`)) return `${prefix}${i}`;
}

export const workersOf = (d: ScenarioDraft) => (typeof d.nodes?.workers === 'number' ? d.nodes.workers : 2);

export function variableKind(v: VariableDef | undefined): 'oneOf' | 'range' | 'node' | 'random' {
  if (v && 'range' in v) return 'range';
  if (v && 'node' in v) return 'node';
  if (v && 'random' in v) return 'random';
  return 'oneOf';
}

export const DEFAULT_VARIABLE: Record<ReturnType<typeof variableKind>, VariableDef> = {
  oneOf: { oneOf: ['alpha', 'beta'] },
  range: { range: [1, 5] },
  node: { node: 'workers' },
  random: { random: 5 },
};

export function variablesOk(vars: unknown): vars is Record<string, VariableDef> {
  if (!vars || typeof vars !== 'object') return false;
  return Object.values(vars).every((v) => {
    if (!v || typeof v !== 'object') return false;
    if ('oneOf' in v) return Array.isArray(v.oneOf) && v.oneOf.length > 0;
    if ('range' in v) return Array.isArray(v.range) && v.range.length === 2 && v.range.every((n: unknown) => typeof n === 'number');
    if ('node' in v) return v.node === 'workers' || v.node === 'any';
    if ('random' in v) return typeof v.random === 'number' && v.random > 0;
    return false;
  });
}

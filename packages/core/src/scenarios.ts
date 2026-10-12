import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  formatZodError,
  ScenarioSchema,
  scenarioTasks,
  type Scenario,
  type ScenarioStats,
  type ScenarioSummary,
  type Task,
} from '@cka/schema';
import { scenariosDir } from './paths';

export interface LoadedTask extends Task {
  markdown: string;
}

export interface LoadedScenario {
  def: Scenario;
  dir: string;
  /** Path relative to the scenarios folder, e.g. troubleshooting/ts-kubelet-stopped */
  relDir: string;
  /** Whole task text: task.md, or every task's markdown under a heading. */
  task: string;
  tasks: LoadedTask[];
  solutionMd?: string;
  solutionScript?: string;
}

export const taskFile = (taskId: string) => `tasks/${taskId}.md`;

/** Builds a LoadedScenario from a validated definition and a file reader (disk or in-memory bundle). */
export function assembleScenario(
  def: Scenario,
  dir: string,
  relDir: string,
  read: (name: string) => string | undefined,
  hasSolutionScript: boolean,
): LoadedScenario {
  const tasks = scenarioTasks(def).map((t) => ({
    ...t,
    markdown: (def.tasks ? read(taskFile(t.id)) : read('task.md')) ?? '',
  }));
  const task = def.tasks
    ? tasks.map((t, i) => `### Question ${i + 1}: ${t.title} (${t.points} pt)\n\n${t.markdown.trim()}`).join('\n\n')
    : tasks[0].markdown;
  return {
    def,
    dir,
    relDir,
    task,
    tasks,
    solutionMd: read('solution.md'),
    solutionScript: hasSolutionScript ? join(dir, 'solution.sh') : undefined,
  };
}

export interface LoadError {
  file: string;
  messages: string[];
}

export function findScenarioFiles(root = scenariosDir): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry === 'scenario.yaml') found.push(p);
    }
  };
  walk(root);
  return found.sort();
}

export function loadScenarioFile(file: string, root = scenariosDir): LoadedScenario | LoadError {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, 'utf8'));
  } catch (e) {
    return { file, messages: [`YAML parse error: ${(e as Error).message}`] };
  }
  const parsed = ScenarioSchema.safeParse(raw);
  if (!parsed.success) return { file, messages: formatZodError(parsed.error) };
  const dir = dirname(file);
  const read = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : undefined);
  return assembleScenario(parsed.data, dir, relative(root, dir), read, existsSync(join(dir, 'solution.sh')));
}

export const isLoadError = (x: LoadedScenario | LoadError): x is LoadError => 'messages' in x;

/** Filesystem-backed scenario index. The filesystem is the source of truth; call reload() to rescan. */
export class ScenarioLibrary {
  private byId = new Map<string, LoadedScenario>();
  errors: LoadError[] = [];

  constructor(readonly root = scenariosDir) {
    this.reload();
  }

  reload(): this {
    this.byId.clear();
    this.errors = [];
    for (const file of findScenarioFiles(this.root)) {
      const res = loadScenarioFile(file, this.root);
      if (isLoadError(res)) {
        this.errors.push(res);
      } else if (this.byId.has(res.def.id)) {
        this.errors.push({ file, messages: [`duplicate scenario id "${res.def.id}" (also in ${this.byId.get(res.def.id)!.relDir})`] });
      } else {
        this.byId.set(res.def.id, res);
      }
    }
    return this;
  }

  list(): LoadedScenario[] {
    return [...this.byId.values()].sort(
      (a, b) => a.def.domain.localeCompare(b.def.domain) || a.def.difficulty - b.def.difficulty || a.def.id.localeCompare(b.def.id),
    );
  }

  get(id: string): LoadedScenario | undefined {
    return this.byId.get(id);
  }
}

export function toSummary(s: LoadedScenario, stats?: ScenarioStats): ScenarioSummary {
  const d = s.def;
  return {
    id: d.id,
    title: d.title,
    domain: d.domain,
    difficulty: d.difficulty,
    estimatedMinutes: d.estimatedMinutes,
    points: d.points,
    tags: d.tags,
    base: d.base,
    hintCount: s.tasks.reduce((n, t) => n + t.hints.length, 0),
    hasSolution: Boolean(s.solutionMd),
    taskCount: s.tasks.length,
    variableNames: Object.keys(d.variables),
    draft: d.draft,
    stats: stats ?? { attempts: 0 },
  };
}

export const scenarioDirName = (s: LoadedScenario) => basename(s.dir);

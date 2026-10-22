import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { formatZodError, LESSON_TOPICS, LessonSchema, type LearnProgress, type Lesson, type LessonSummary, type LessonView } from '@cka/schema';
import { hookSteps } from './learn';
import { lessonsDir } from './paths';
import type { LoadedScenario, LoadError } from './scenarios';

export interface LoadedLesson {
  def: Lesson;
  dir: string;
}

export function loadLessonFile(file: string): LoadedLesson | LoadError {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, 'utf8'));
  } catch (e) {
    return { file, messages: [`YAML parse error: ${(e as Error).message}`] };
  }
  const parsed = LessonSchema.safeParse(raw);
  if (!parsed.success) return { file, messages: formatZodError(parsed.error) };
  return { def: parsed.data, dir: join(file, '..') };
}

/** Filesystem-backed lesson index: lessons/<id>/lesson.yaml. Call reload() to rescan. */
export class LessonLibrary {
  private byId = new Map<string, LoadedLesson>();
  errors: LoadError[] = [];

  constructor(readonly root = lessonsDir) {
    this.reload();
  }

  reload(): this {
    this.byId.clear();
    this.errors = [];
    if (!existsSync(this.root)) return this;
    for (const entry of readdirSync(this.root).sort()) {
      const file = join(this.root, entry, 'lesson.yaml');
      if (entry.startsWith('.') || !statSync(join(this.root, entry)).isDirectory() || !existsSync(file)) continue;
      const res = loadLessonFile(file);
      if ('messages' in res) this.errors.push(res);
      else if (res.def.id !== entry) this.errors.push({ file, messages: [`directory name "${entry}" must equal id "${res.def.id}"`] });
      else this.byId.set(res.def.id, res);
    }
    return this;
  }

  list(): LoadedLesson[] {
    const topic = (l: LoadedLesson) => LESSON_TOPICS.indexOf(l.def.topic);
    return [...this.byId.values()].sort((a, b) => topic(a) - topic(b) || a.def.estimatedMinutes - b.def.estimatedMinutes || a.def.id.localeCompare(b.def.id));
  }

  get(id: string): LoadedLesson | undefined {
    return this.byId.get(id);
  }
}

/** Session scenario ids of lessons carry this prefix, so a lesson and a scenario may share an id. */
export const LEARN_PREFIX = 'learn:';
const LESSON_NODES = ['controlplane', 'worker-1', 'worker-2'];

/** A lesson as a task-free scenario on the cluster image: the command-log hook, then the lesson's setup. */
export function lessonScenario(l: LoadedLesson): LoadedScenario {
  return {
    def: {
      id: LEARN_PREFIX + l.def.id,
      title: l.def.title,
      domain: 'cluster-architecture',
      track: l.def.track,
      difficulty: 1,
      estimatedMinutes: l.def.estimatedMinutes,
      points: 1,
      tags: [],
      base: 'cluster',
      nodes: { controlPlane: 1, workers: 2 },
      context: 'kubernetes-admin@kubernetes',
      settleSeconds: 0,
      draft: false,
      variables: {},
      setup: [...hookSteps(LESSON_NODES), ...l.def.setup],
      hints: [],
    },
    dir: l.dir,
    relDir: LEARN_PREFIX + l.def.id,
    task: '',
    tasks: [],
  };
}

export const toLessonSummary = ({ def }: LoadedLesson): LessonSummary => ({
  id: def.id,
  title: def.title,
  summary: def.summary,
  track: def.track,
  topic: def.topic,
  estimatedMinutes: def.estimatedMinutes,
  stepCount: def.steps.length,
});

/** A question's answer and why are only sent once its step is done, so the pane cannot give them away. */
export const toLessonView = ({ def }: LoadedLesson, progress?: LearnProgress): LessonView => ({
  id: def.id,
  title: def.title,
  summary: def.summary,
  track: def.track,
  topic: def.topic,
  steps: def.steps.map((s, i) => {
    const q = s.question;
    const done = !!progress?.steps[i]?.done;
    return {
      id: s.id,
      title: s.title,
      explain: s.explain,
      ...(s.command !== undefined ? { command: s.command.trimEnd() } : {}),
      node: s.node,
      ...(s.hint ? { hint: s.hint } : {}),
      ...(q ? { question: { prompt: q.prompt, choices: q.choices, ...(done ? { answer: q.answer, why: q.why } : {}) } } : {}),
    };
  }),
});

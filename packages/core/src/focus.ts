import { render, resolveTask, type FocusQuestion, type FocusReport, type LabTopic, type Scenario, type Task, type Vars } from '@cka/schema';
import { NOT_ATTEMPTED } from './grader';
import { labTopics } from './recipes/topics';
import type { LoadedScenario, ScenarioLibrary } from './scenarios';
import type { Store } from './store';

/** How many of a topic's most recent questions its score averages. */
export const FOCUS_RECENT = 5;

let cachedTopics: LabTopic[] | undefined;
const allTopics = () => (cachedTopics ??= labTopics());

/**
 * The faults a troubleshooting question of task q<n> rolls: Q<n>_FAULT, Q<n>_FAULT_2 and Q<n>_FAULT_3.
 * `rolled` when an attempt's variables say which were picked; otherwise every fault the question could roll.
 */
function questionFaults(def: Scenario, task: Task, vars?: Vars): { faults: string[]; rolled: boolean } {
  const n = /^q(\d+)$/.exec(task.id)?.[1];
  const names = n ? Object.keys(def.variables).filter((k) => new RegExp(`^Q${n}_FAULT(_\\d+)?$`).test(k)) : [];
  if (names.length && vars && names.every((k) => Object.hasOwn(vars, k))) return { faults: names.map((k) => vars[k]), rolled: true };
  const pool = (k: string) => {
    const v = def.variables[k];
    return 'oneOf' in v ? v.oneOf.map(String) : [];
  };
  return { faults: names.flatMap(pool), rolled: false };
}

/**
 * Ids of the topics a question belongs to. A generated question names its recipe: the topics of its builder
 * whose add-ons it has, or of its category whose faults it rolled. A handwritten question shares a tag with
 * the topic (its own tags, else the scenario's), in the same group: troubleshooting or not.
 */
export function questionTopics(def: Scenario, task: Task, vars?: Vars, topics = allTopics()): string[] {
  const recipe = task.recipe;
  if (recipe && 'builder' in recipe) {
    return topics
      .filter((t) => t.group === 'create' && t.builderId === recipe.builder && (t.addons ?? []).every((a) => recipe.parts.includes(a)))
      .map((t) => t.id);
  }
  if (recipe) {
    const { faults, rolled } = questionFaults(def, task, vars);
    const covers = (subset: string[]) => (rolled ? faults.some((f) => subset.includes(f)) : faults.length > 0 && faults.every((f) => subset.includes(f)));
    return topics.filter((t) => t.categories?.some((c) => c.id === recipe.category && (!c.faults || covers(c.faults)))).map((t) => t.id);
  }
  const tags = task.tags ?? def.tags;
  const group = def.domain === 'troubleshooting' || tags.includes('troubleshooting') ? 'troubleshoot' : 'create';
  return topics.filter((t) => t.group === group && t.tags.some((x) => tags.includes(x))).map((t) => t.id);
}

/** Every topic any question of the scenario belongs to. */
export function scenarioTopicIds(s: LoadedScenario, topics = allTopics()): string[] {
  const ids = new Set(s.tasks.flatMap((t) => questionTopics(s.def, t, undefined, topics)));
  return topics.filter((t) => ids.has(t.id)).map((t) => t.id);
}

/**
 * Scores every topic from the graded questions of past attempts. Each question counts toward its own topics
 * only, with its own score; a question that was never opened does not count.
 */
export function focusReport(store: Store, library: ScenarioLibrary, topics = allTopics()): FocusReport {
  const byTopic = new Map<string, FocusQuestion[]>();
  for (const a of store.gradedAttempts()) {
    const s = library.get(a.scenarioId);
    if (!s) continue;
    const results = new Map(a.checks.map((c) => [c.id, c]));
    for (const raw of s.tasks) {
      const task = resolveTask(raw, a.vars);
      const checks = task.checks.flatMap((c) => results.get(c.id) ?? []);
      if (!checks.length || checks.some((c) => c.output.startsWith(NOT_ATTEMPTED))) continue;
      const max = checks.reduce((n, c) => n + c.weight, 0);
      if (max <= 0) continue;
      const question: FocusQuestion = {
        attemptId: a.id,
        scenarioId: s.def.id,
        scenarioTitle: s.def.title,
        // Variables the attempt did not record show as "…".
        title: render(task.title, a.vars).replace(/\$\{\w+\}/g, '…'),
        percent: Math.round((checks.reduce((n, c) => n + (c.passed ? c.weight : 0), 0) / max) * 100),
        at: a.startedAt,
      };
      for (const id of questionTopics(s.def, task, a.vars, topics)) byTopic.set(id, [...(byTopic.get(id) ?? []), question]);
    }
  }
  return {
    recent: FOCUS_RECENT,
    topics: topics.map((t) => {
      const questions = (byTopic.get(t.id) ?? []).sort((a, b) => b.at.localeCompare(a.at) || b.attemptId - a.attemptId);
      const recent = questions.slice(0, FOCUS_RECENT);
      return {
        topicId: t.id,
        questions: questions.length,
        ...(recent.length > 0 && {
          recentPercent: Math.round(recent.reduce((n, q) => n + q.percent, 0) / recent.length),
          weakest: recent.reduce((w, q) => (q.percent < w.percent ? q : w)),
          lastAt: questions[0].at,
        }),
      };
    }),
  };
}

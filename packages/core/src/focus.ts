import {
  render,
  resolveTask,
  type AttemptReview,
  type FocusMode,
  type FocusQuestion,
  type FocusReport,
  type LabTopic,
  type ReviewQuestion,
  type ReviewResponse,
  type Scenario,
  type Task,
  type Vars,
} from '@cka/schema';
import { NOT_ATTEMPTED } from './grader';
import { labTopics } from './recipes/topics';
import type { LoadedScenario, ScenarioLibrary } from './scenarios';
import type { Store } from './store';
import { renderScenario } from './vars';

/** How many of a topic's most recent questions its score averages. */
export const FOCUS_RECENT = 5;

/** Exam pace: 120 minutes for about 17 tasks. */
export const FOCUS_PACE_MINUTES = 7;

/** A question left open longer than this counts as this long in a topic's speed: past it, the tab was likely idle. */
export const FOCUS_MAX_MINUTES = 30;

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
 * whose add-ons it has (or that list one of its parts in `anyParts`), or of its category whose faults it
 * rolled. A handwritten question shares a tag with the topic (its own tags, else the scenario's), in the same
 * group: troubleshooting or not. When no topic of its group shares a tag, the other group's topics may.
 */
export function questionTopics(def: Scenario, task: Task, vars?: Vars, topics = allTopics()): string[] {
  const recipe = task.recipe;
  if (recipe && 'builder' in recipe) {
    const own = (t: LabTopic) => t.builderId === recipe.builder && (t.addons ?? []).every((a) => recipe.parts.includes(a));
    return topics.filter((t) => t.group === 'create' && (own(t) || t.anyParts?.some((p) => recipe.parts.includes(p)))).map((t) => t.id);
  }
  if (recipe) {
    const { faults, rolled } = questionFaults(def, task, vars);
    const touches = (subset: string[]) => faults.some((f) => subset.includes(f));
    const within = (subset: string[]) => faults.length > 0 && faults.every((f) => subset.includes(f));
    const sources = (t: LabTopic) => t.categories?.filter((c) => c.id === recipe.category) ?? [];
    const matching = (covers: (subset: string[]) => boolean) =>
      topics.filter((t) => sources(t).some((c) => !c.faults || covers(c.faults))).map((t) => t.id);
    const found = matching(rolled ? touches : within);
    // A pool that spans several fault subsets, in a category without a topic of its own (Ingress and
    // HTTPRoute), counts toward every subset it can roll until an attempt says which it did.
    return found.length || rolled ? found : topics.filter((t) => sources(t).some((c) => c.faults && touches(c.faults))).map((t) => t.id);
  }
  const tags = task.tags ?? def.tags;
  const group = def.domain === 'troubleshooting' || tags.includes('troubleshooting') ? 'troubleshoot' : 'create';
  const tagged = (g: LabTopic['group']) => topics.filter((t) => t.group === g && t.tags.some((x) => tags.includes(x))).map((t) => t.id);
  const own = tagged(group);
  return own.length ? own : tagged(group === 'create' ? 'troubleshoot' : 'create');
}

/** Every topic any question of the scenario belongs to. */
export function scenarioTopicIds(s: LoadedScenario, topics = allTopics()): string[] {
  const ids = new Set(s.tasks.flatMap((t) => questionTopics(s.def, t, undefined, topics)));
  return topics.filter((t) => ids.has(t.id)).map((t) => t.id);
}

const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;

/**
 * Scores every topic from the graded questions of past attempts. Each question counts toward its own topics
 * only, with its own score; a question that was never opened does not count. `exam` scores exam-mode
 * attempts only. A question is clean when its attempt revealed no hint and showed no solution.
 */
export function focusReport(store: Store, library: ScenarioLibrary, topics = allTopics(), mode: FocusMode = 'all'): FocusReport {
  const byTopic = new Map<string, FocusQuestion[]>();
  for (const a of store.gradedAttempts()) {
    if (mode === 'exam' && a.mode !== 'mock') continue;
    const s = library.get(a.scenarioId);
    if (!s) continue;
    const results = new Map(a.checks.map((c) => [c.id, c]));
    const clean = a.hintsUsed === 0 && !a.solutionViewed;
    for (const raw of s.tasks) {
      const task = resolveTask(raw, a.vars);
      const checks = task.checks.flatMap((c) => results.get(c.id) ?? []);
      if (!checks.length || checks.some((c) => c.output.startsWith(NOT_ATTEMPTED))) continue;
      const max = checks.reduce((n, c) => n + c.weight, 0);
      if (max <= 0) continue;
      const seconds = a.taskSeconds[task.id];
      const question: FocusQuestion = {
        attemptId: a.id,
        scenarioId: s.def.id,
        scenarioTitle: s.def.title,
        // Variables the attempt did not record show as "…".
        title: render(task.title, a.vars).replace(/\$\{\w+\}/g, '…'),
        percent: Math.round((checks.reduce((n, c) => n + (c.passed ? c.weight : 0), 0) / max) * 100),
        at: a.startedAt,
        clean,
        ...(seconds ? { minutes: Math.round((seconds / 60) * 10) / 10 } : {}),
      };
      for (const id of questionTopics(s.def, task, a.vars, topics)) byTopic.set(id, [...(byTopic.get(id) ?? []), question]);
    }
  }
  return {
    recent: FOCUS_RECENT,
    mode,
    paceMinutes: FOCUS_PACE_MINUTES,
    topics: topics.map((t) => {
      const questions = (byTopic.get(t.id) ?? []).sort((a, b) => b.at.localeCompare(a.at) || b.attemptId - a.attemptId);
      const recent = questions.slice(0, FOCUS_RECENT);
      const clean = questions.filter((q) => q.clean);
      const timed = recent.flatMap((q) => (q.minutes === undefined ? [] : [q.minutes]));
      const cleanTimed = clean.slice(0, FOCUS_RECENT).flatMap((q) => (q.minutes === undefined ? [] : [Math.min(q.minutes, FOCUS_MAX_MINUTES)]));
      return {
        topicId: t.id,
        questions: questions.length,
        cleanQuestions: clean.length,
        ...(recent.length > 0 && {
          recentPercent: Math.round(mean(recent.map((q) => q.percent))),
          weakest: recent.reduce((w, q) => (q.percent < w.percent ? q : w)),
          lastAt: questions[0].at,
        }),
        ...(clean.length > 0 && { cleanPercent: Math.round(mean(clean.slice(0, FOCUS_RECENT).map((q) => q.percent))) }),
        ...(timed.length > 0 && { recentMinutes: Math.round(mean(timed) * 10) / 10 }),
        ...(cleanTimed.length > 0 && { cleanMinutes: Math.round(mean(cleanTimed) * 10) / 10 }),
      };
    }),
  };
}

const REVIEW_LIST = 10;

/** A heading that opens one question's part of solution.md: "### Question 2: ..." or "## q2 — ...". */
const QUESTION_HEADING = /^#{2,3} +(?:Question +(\d+)\b|q(\d+)\b)/i;

/**
 * solution.md split into each question's part, by task id: question N is task qN, else the Nth task. A
 * scenario of one question gets the whole file; questions without a heading of their own get nothing.
 */
export function questionSolutions(md: string, taskIds: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string | undefined;
  let lines: string[] = [];
  let fenced = false;
  const flush = () => {
    if (current && lines.join('').trim()) out[current] = lines.join('\n').trim();
  };
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const m = fenced ? null : QUESTION_HEADING.exec(line);
    if (m) {
      flush();
      const n = Number(m[1] ?? m[2]);
      current = taskIds.includes(`q${n}`) ? `q${n}` : taskIds[n - 1];
      lines = [];
    } else if (current) lines.push(line);
  }
  flush();
  if (!Object.keys(out).length && taskIds.length === 1 && md.trim()) out[taskIds[0]] = md.replace(/^## Solution\s*\n/, '').trim();
  return out;
}

/**
 * A graded attempt that has ended, question by question: its score, the minutes it was open, the checks it
 * missed and its solution, with the Focus topics it counts toward. Without `attemptId`, the latest exam-mode
 * attempt of several questions, else the latest of several questions in any mode. `attempts` lists recent
 * attempts of several questions to pick from. An attempt still running is never reviewed: the review shows
 * its solutions.
 */
export function attemptReview(store: Store, library: ScenarioLibrary, attemptId?: number, topics = allTopics()): ReviewResponse {
  const all = store.gradedAttempts().filter((a) => a.endedAt);
  const graded = all.filter((a) => (library.get(a.scenarioId)?.tasks.length ?? 0) > 1).reverse();
  const pick = attemptId === undefined ? (graded.find((a) => a.mode === 'mock') ?? graded[0]) : all.find((a) => a.id === attemptId);
  const reviews = new Map<number, AttemptReview>();
  const review = (a: (typeof graded)[number]): AttemptReview | undefined => {
    const s = library.get(a.scenarioId);
    if (!s) return undefined;
    if (reviews.has(a.id)) return reviews.get(a.id);
    const results = new Map(a.checks.map((c) => [c.id, c]));
    const rendered = renderScenario(s, a.vars);
    const solutions = questionSolutions(rendered.solutionMd ?? '', rendered.tasks.map((t) => t.id));
    const questions = rendered.tasks.map((task): ReviewQuestion => {
      const checks = task.checks.flatMap((c) => {
        const r = results.get(c.id);
        return r ? [{ ...r, description: c.description }] : [];
      });
      const seconds = a.taskSeconds[task.id];
      return {
        taskId: task.id,
        title: task.title.replace(/\$\{\w+\}/g, '…'),
        score: checks.reduce((n, c) => n + (c.passed ? c.weight : 0), 0),
        maxScore: checks.reduce((n, c) => n + c.weight, 0),
        ...(seconds ? { minutes: Math.round((seconds / 60) * 10) / 10 } : {}),
        attempted: !checks.some((c) => c.output.startsWith(NOT_ATTEMPTED)),
        text: task.markdown,
        ...(solutions[task.id] ? { solution: solutions[task.id] } : {}),
        missed: checks
          .filter((c) => !c.passed)
          .sort((x, y) => y.weight - x.weight)
          .map((c) => ({ id: c.id, description: c.description, weight: c.weight })),
        topics: questionTopics(s.def, task, a.vars, topics),
      };
    });
    const out: AttemptReview = {
      attemptId: a.id,
      scenarioId: s.def.id,
      scenarioTitle: s.def.title,
      mode: a.mode,
      startedAt: a.startedAt,
      score: questions.reduce((n, q) => n + q.score, 0),
      maxScore: questions.reduce((n, q) => n + q.maxScore, 0),
      paceMinutes: FOCUS_PACE_MINUTES,
      questions,
    };
    reviews.set(a.id, out);
    return out;
  };
  const chosen = pick && review(pick);
  return {
    ...(chosen ? { review: chosen } : {}),
    attempts: graded.slice(0, REVIEW_LIST).flatMap((a) => {
      const r = review(a);
      return r
        ? [{ attemptId: r.attemptId, scenarioTitle: r.scenarioTitle, mode: r.mode, startedAt: r.startedAt, score: r.score, maxScore: r.maxScore, questions: r.questions.length }]
        : [];
    }),
  };
}

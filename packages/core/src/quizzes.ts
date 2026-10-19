import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  formatZodError,
  QUIZ_TOPICS,
  QuizSchema,
  type Quiz,
  type QuizGradeResult,
  type QuizQuestion,
  type QuizSummary,
  type QuizView,
} from '@cka/schema';
import { quizzesDir } from './paths';
import type { LoadError } from './scenarios';

export interface LoadedQuiz {
  def: Quiz;
  dir: string;
}

export function loadQuizFile(file: string): LoadedQuiz | LoadError {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, 'utf8'));
  } catch (e) {
    return { file, messages: [`YAML parse error: ${(e as Error).message}`] };
  }
  const parsed = QuizSchema.safeParse(raw);
  if (!parsed.success) return { file, messages: formatZodError(parsed.error) };
  return { def: parsed.data, dir: join(file, '..') };
}

/** Filesystem-backed quiz index: quizzes/<id>/quiz.yaml. Call reload() to rescan. */
export class QuizLibrary {
  private byId = new Map<string, LoadedQuiz>();
  errors: LoadError[] = [];

  constructor(readonly root = quizzesDir) {
    this.reload();
  }

  reload(): this {
    this.byId.clear();
    this.errors = [];
    if (!existsSync(this.root)) return this;
    for (const entry of readdirSync(this.root).sort()) {
      const file = join(this.root, entry, 'quiz.yaml');
      if (entry.startsWith('.') || !statSync(join(this.root, entry)).isDirectory() || !existsSync(file)) continue;
      const res = loadQuizFile(file);
      if ('messages' in res) this.errors.push(res);
      else if (res.def.id !== entry) this.errors.push({ file, messages: [`directory name "${entry}" must equal id "${res.def.id}"`] });
      else this.byId.set(res.def.id, res);
    }
    return this;
  }

  list(): LoadedQuiz[] {
    const topic = (q: LoadedQuiz) => QUIZ_TOPICS.indexOf(q.def.topic);
    return [...this.byId.values()].sort(
      (a, b) => topic(a) - topic(b) || a.def.estimatedMinutes - b.def.estimatedMinutes || a.def.id.localeCompare(b.def.id),
    );
  }

  get(id: string): LoadedQuiz | undefined {
    return this.byId.get(id);
  }

  /** Re-reads one quiz from disk so an edit applies without restarting the API. */
  fresh(id: string): LoadedQuiz | undefined {
    const file = join(this.root, id, 'quiz.yaml');
    if (!existsSync(file)) return this.byId.get(id);
    const res = loadQuizFile(file);
    if ('messages' in res || res.def.id !== id) return this.byId.get(id);
    this.byId.set(id, res);
    return res;
  }
}

/** Same order for the quiz view and for grading. The correct choice is never first. */
export function presentQuestion(q: QuizQuestion): { choices: string[]; answer: number } {
  const order = q.choices.map((_, i) => i);
  let seed = 2166136261;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) seed = Math.imul(seed ^ s.charCodeAt(i), 16777619);
  };
  mix(q.id);
  for (const choice of q.choices) mix(choice);
  const rnd = () => {
    seed = Math.imul(seed ^ (seed >>> 16), 2246822507);
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
    return ((seed ^= seed >>> 16) >>> 0) / 4294967296;
  };
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  if (order[0] === q.answer) {
    const j = 1 + Math.floor(rnd() * (order.length - 1));
    [order[0], order[j]] = [order[j]!, order[0]!];
  }
  return { choices: order.map((i) => q.choices[i]!), answer: order.indexOf(q.answer) };
}

export const toQuizSummary = ({ def }: LoadedQuiz): QuizSummary => ({
  id: def.id,
  title: def.title,
  summary: def.summary,
  track: def.track,
  topic: def.topic,
  estimatedMinutes: def.estimatedMinutes,
  questionCount: def.questions.length,
});

/** Learner-facing quiz: prompts and choices only. */
export const toQuizView = ({ def }: LoadedQuiz): QuizView => ({
  id: def.id,
  title: def.title,
  summary: def.summary,
  track: def.track,
  topic: def.topic,
  estimatedMinutes: def.estimatedMinutes,
  questions: def.questions.map((q) => {
    const presented = presentQuestion(q);
    return { id: q.id, prompt: q.prompt, choices: presented.choices };
  }),
});

/** Grade selected answers (question id → choice index). Missing answers count as wrong. */
export function gradeQuiz(quiz: LoadedQuiz, answers: Record<string, number>): QuizGradeResult {
  const results = quiz.def.questions.map((q) => {
    const selected = answers[q.id];
    const has = typeof selected === 'number' && Number.isInteger(selected);
    const presented = presentQuestion(q);
    const correct = has && selected === presented.answer;
    return {
      id: q.id,
      correct,
      ...(has ? { selected } : {}),
      answer: presented.answer,
      explain: q.explain,
    };
  });
  return {
    score: results.filter((r) => r.correct).length,
    maxScore: results.length,
    results,
  };
}

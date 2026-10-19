import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  formatZodError,
  QUIZ_TOPICS,
  QuizSchema,
  type Quiz,
  type QuizGradeResult,
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
  questions: def.questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    choices: q.choices,
  })),
});

/** Grade selected answers (question id → choice index). Missing answers count as wrong. */
export function gradeQuiz(quiz: LoadedQuiz, answers: Record<string, number>): QuizGradeResult {
  const results = quiz.def.questions.map((q) => {
    const selected = answers[q.id];
    const has = typeof selected === 'number' && Number.isInteger(selected);
    const correct = has && selected === q.answer;
    return {
      id: q.id,
      correct,
      ...(has ? { selected } : {}),
      answer: q.answer,
      explain: q.explain,
    };
  });
  return {
    score: results.filter((r) => r.correct).length,
    maxScore: results.length,
    results,
  };
}

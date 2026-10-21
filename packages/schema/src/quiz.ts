import { z } from 'zod';
import { LessonTrackSchema } from './lesson';

export const QUIZ_TOPICS = ['quiz-errors', 'quiz-paths', 'quiz-workloads', 'quiz-networking', 'quiz-storage-rbac', 'quiz-cluster', 'quiz-linux-openssl'] as const;
export const QuizTopicSchema = z.enum(QUIZ_TOPICS);
export type QuizTopic = z.infer<typeof QuizTopicSchema>;

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, { message: 'use lowercase letters, digits and dashes' });

export const QuizQuestionSchema = z
  .strictObject({
    id: SlugSchema,
    /** Markdown: symptom + error snippet or path clue. */
    prompt: z.string().min(1),
    /** Exactly five choices; one correct. */
    choices: z.array(z.string().min(1)).length(5),
    /** 0-based index of the correct choice. */
    answer: z.number().int().min(0).max(4),
    /** Markdown shown after the learner answers. */
    explain: z.string().min(1),
  })
  .superRefine((q, ctx) => {
    if (q.answer >= q.choices.length) {
      ctx.addIssue({ code: 'custom', message: `answer ${q.answer} is out of range for ${q.choices.length} choices`, path: ['answer'] });
    }
  });
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const QuizSchema = z
  .strictObject({
    id: SlugSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    track: LessonTrackSchema.default('cka'),
    topic: QuizTopicSchema,
    estimatedMinutes: z.number().positive(),
    questions: z.array(QuizQuestionSchema).min(1),
  })
  .superRefine((quiz, ctx) => {
    const seen = new Set<string>();
    quiz.questions.forEach((q, i) => {
      if (seen.has(q.id)) ctx.addIssue({ code: 'custom', message: `duplicate question id "${q.id}"`, path: ['questions', i, 'id'] });
      seen.add(q.id);
    });
  });
export type Quiz = z.infer<typeof QuizSchema>;

/** Quiz card on the Learn page. */
export interface QuizSummary {
  id: string;
  title: string;
  summary: string;
  track: z.infer<typeof LessonTrackSchema>;
  topic: QuizTopic;
  estimatedMinutes: number;
  questionCount: number;
}

/** Question as sent to the UI before grading (no spoilers). */
export interface QuizQuestionView {
  id: string;
  prompt: string;
  choices: string[];
}

/** Quiz body for the learner UI. */
export interface QuizView {
  id: string;
  title: string;
  summary: string;
  track: z.infer<typeof LessonTrackSchema>;
  topic: QuizTopic;
  estimatedMinutes: number;
  questions: QuizQuestionView[];
}

export interface QuizGradeItem {
  id: string;
  correct: boolean;
  /** The learner's choice index, when provided. */
  selected?: number;
  answer: number;
  explain: string;
}

export interface QuizGradeResult {
  score: number;
  maxScore: number;
  results: QuizGradeItem[];
}

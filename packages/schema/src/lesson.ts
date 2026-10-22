import { z } from 'zod';
import { LESSON_TRACKS } from './constants';
import { CheckSchema, NodeNameSchema, StepSchema } from './scenario';

export const LESSON_TOPICS = ['certificates', 'etcd', 'cluster', 'jobs', 'admission', 'troubleshooting', 'openssl', 'firewall', 'systemd', 'networking', 'files'] as const;
export const LessonTopicSchema = z.enum(LESSON_TOPICS);
export type LessonTopic = z.infer<typeof LessonTopicSchema>;

/** Which section of the app lists the lesson: CKA Labs or Linux Labs. */
export { LESSON_TRACKS };
export const LessonTrackSchema = z.enum(LESSON_TRACKS);
export type LessonTrack = z.infer<typeof LessonTrackSchema>;

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, { message: 'use lowercase letters, digits and dashes' });

const RegexSchema = z.string().refine(
  (r) => {
    try {
      new RegExp(r);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'not a valid regular expression' },
);

/** A multiple-choice question between command steps, answered in the lesson pane rather than the terminal. */
export const LessonQuestionSchema = z.strictObject({
  /** Markdown. */
  prompt: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2).max(6),
  /** Index of the right choice. */
  answer: z.number().int().min(0),
  /** Markdown: why that answer is right, shown once the question is answered or skipped. */
  why: z.string().min(1),
});
export type LessonQuestion = z.infer<typeof LessonQuestionSchema>;

export const LessonStepSchema = z
  .strictObject({
    id: SlugSchema,
    title: z.string().min(1),
    /** Markdown: why the step matters and what to look for in the output. */
    explain: z.string().default(''),
    /** The reference command. Shown in the guide (hidden in drill mode) and run by "cka learn verify". */
    command: z.string().min(1).optional(),
    /** Makes the step a question instead of a command: it has no command, match or check. */
    question: LessonQuestionSchema.optional(),
    node: NodeNameSchema.default('controlplane'),
    /** Matched against each command the learner runs on the node (exit code 0, leading sudo and env assignments stripped). */
    match: RegexSchema.optional(),
    /** The matched command may exit non-zero, e.g. a request that should be Forbidden. */
    allowFailure: z.boolean().default(false),
    /** Confirms the result once the command matched, or on its own after every command when there is no match. */
    check: CheckSchema.optional(),
    hint: z.string().optional(),
  })
  .superRefine((s, ctx) => {
    if (s.question) {
      if (s.command !== undefined || s.match !== undefined || s.check !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'a question step has no command, match or check' });
      }
      if (s.question.answer >= s.question.choices.length) {
        ctx.addIssue({ code: 'custom', message: `answer ${s.question.answer} is not one of the ${s.question.choices.length} choices`, path: ['question', 'answer'] });
      }
      return;
    }
    if (s.command === undefined) ctx.addIssue({ code: 'custom', message: 'a step needs a "command", or a "question"' });
    if (s.match === undefined && s.check === undefined) ctx.addIssue({ code: 'custom', message: 'a step needs "match", "check" or both' });
  });
export type LessonStep = z.infer<typeof LessonStepSchema>;

export const LessonSchema = z
  .strictObject({
    id: SlugSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    track: LessonTrackSchema.default('cka'),
    topic: LessonTopicSchema,
    estimatedMinutes: z.number().positive(),
    setup: z.array(StepSchema).default([]),
    steps: z.array(LessonStepSchema).min(1),
  })
  .superRefine((l, ctx) => {
    const seen = new Set<string>();
    l.steps.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: 'custom', message: `duplicate step id "${s.id}"`, path: ['steps', i, 'id'] });
      seen.add(s.id);
    });
    const nodes = [...l.setup.map((s) => s.node), ...l.steps.map((s) => s.node)];
    nodes.forEach((n) => {
      if (n.startsWith('$')) ctx.addIssue({ code: 'custom', message: `lessons have no variables; use a node name instead of ${n}`, path: ['steps'] });
    });
  });
export type Lesson = z.infer<typeof LessonSchema>;

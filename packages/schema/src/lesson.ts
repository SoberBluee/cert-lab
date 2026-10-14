import { z } from 'zod';
import { CheckSchema, NodeNameSchema, StepSchema } from './scenario';

export const LESSON_TOPICS = ['certificates', 'etcd', 'cluster', 'troubleshooting', 'openssl', 'firewall', 'systemd', 'networking', 'files'] as const;
export const LessonTopicSchema = z.enum(LESSON_TOPICS);
export type LessonTopic = z.infer<typeof LessonTopicSchema>;

/** Which section of the app lists the lesson: CKA Labs or Linux Labs. */
export const LESSON_TRACKS = ['cka', 'linux'] as const;
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

export const LessonStepSchema = z
  .strictObject({
    id: SlugSchema,
    title: z.string().min(1),
    /** Markdown: why the step matters and what to look for in the output. */
    explain: z.string().default(''),
    /** The reference command. Shown in the guide (hidden in drill mode) and run by "cka learn verify". */
    command: z.string().min(1),
    node: NodeNameSchema.default('controlplane'),
    /** Matched against each command the learner runs on the node (exit code 0, leading sudo and env assignments stripped). */
    match: RegexSchema.optional(),
    /** The matched command may exit non-zero, e.g. a request that should be Forbidden. */
    allowFailure: z.boolean().default(false),
    /** Confirms the result once the command matched, or on its own after every command when there is no match. */
    check: CheckSchema.optional(),
    hint: z.string().optional(),
  })
  .refine((s) => s.match !== undefined || s.check !== undefined, { message: 'a step needs "match", "check" or both' });
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

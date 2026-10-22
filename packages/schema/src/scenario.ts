import { z } from 'zod';
import { AWS_DOMAINS, BASES, DOMAINS, LESSON_TRACKS } from './constants';
import { VAR_NAME } from './vars';

export { AWS_DOMAINS, BASES, DOMAINS };

export const DomainSchema = z.enum([...DOMAINS, ...AWS_DOMAINS]);
export type Domain = z.infer<typeof DomainSchema>;
export type CkaDomain = (typeof DOMAINS)[number];
export type AwsDomain = (typeof AWS_DOMAINS)[number];

export const BaseSchema = z.enum(BASES);
export type Base = z.infer<typeof BaseSchema>;

export const NodeNameSchema = z.string().regex(/^(controlplane|worker-[1-9]\d*|\$\{[A-Z][A-Z0-9_]*\})$/, {
  message: 'node must be "controlplane", "worker-N" or a node variable like ${NODE}',
});

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, { message: 'use lowercase letters, digits and dashes' });

// YAML turns `equals: 3` or `equals: true` into non-strings; command output is always text.
const Scalar = z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v));

export const ExpectSchema = z
  .strictObject({
    equals: Scalar.optional(),
    contains: Scalar.optional(),
    notContains: Scalar.optional(),
    matches: z.string().optional(),
    exitCode: z.number().int().optional(),
    notEmpty: z.boolean().optional(),
    gte: z.number().optional(),
    lte: z.number().optional(),
  })
  .refine((e) => Object.values(e).some((v) => v !== undefined), {
    message: 'expect needs at least one operator',
  })
  .refine(
    (e) => {
      if (e.matches === undefined) return true;
      try {
        new RegExp(e.matches);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'expect.matches is not a valid regular expression' },
  );
export type Expect = z.infer<typeof ExpectSchema>;

const checkBase = {
  id: SlugSchema,
  description: z.string().min(1),
  weight: z.number().positive().default(1),
  retrySeconds: z.number().min(0).max(600).optional(),
};

export const KubectlCheckSchema = z.strictObject({
  ...checkBase,
  type: z.literal('kubectl'),
  run: z.string().min(1),
  expect: ExpectSchema,
});

export const SshCheckSchema = z.strictObject({
  ...checkBase,
  type: z.literal('ssh'),
  node: NodeNameSchema,
  run: z.string().min(1),
  expect: ExpectSchema,
});

export const ScriptCheckSchema = z.strictObject({
  ...checkBase,
  type: z.literal('script'),
  node: NodeNameSchema.default('controlplane'),
  script: z.string().min(1),
  args: z.array(z.string()).default([]),
  expect: ExpectSchema.optional(),
});

/** An AWS CLI command (or any shell) run on the host against the session's Floci account. */
export const AwsCheckSchema = z.strictObject({
  ...checkBase,
  type: z.literal('aws'),
  run: z.string().min(1),
  expect: ExpectSchema,
});

export const FileCheckSchema = z.strictObject({
  ...checkBase,
  type: z.literal('file'),
  node: NodeNameSchema.default('controlplane'),
  path: z.string().startsWith('/', { message: 'path must be absolute' }),
  exists: z.boolean().default(true),
  contains: Scalar.optional(),
  matches: z.string().optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/, { message: 'sha256 must be 64 lowercase hex characters' })
    .optional(),
});

export const CheckSchema = z.discriminatedUnion('type', [KubectlCheckSchema, SshCheckSchema, ScriptCheckSchema, FileCheckSchema, AwsCheckSchema]);
export type Check = z.infer<typeof CheckSchema>;
export type CheckType = Check['type'];

export const StepSchema = z
  .strictObject({
    /** aws scenarios have no nodes; their steps run on the host whatever this says. */
    node: NodeNameSchema.default('controlplane'),
    script: z.string().min(1).optional(),
    run: z.string().min(1).optional(),
    timeoutSeconds: z.number().positive().max(1800).default(300),
    /** Consecutive steps with a lane run in parallel with other lanes, and in order within their own; see docs/authoring.md. */
    lane: z
      .string()
      .regex(/^[\w-]+$/)
      .optional(),
  })
  .refine((s) => (s.script === undefined) !== (s.run === undefined), {
    message: 'a step needs exactly one of "script" or "run"',
  });
export type Step = z.infer<typeof StepSchema>;

export const VariableSchema = z.union([
  z.strictObject({
    oneOf: z.array(z.union([z.string().min(1), z.number()])).min(1, { message: 'oneOf needs at least one value' }),
    /** The rolled value is kept from the learner (and the Studio) until the solution is revealed. */
    hidden: z.boolean().optional(),
  }),
  z
    .strictObject({ range: z.tuple([z.number().int(), z.number().int()]) })
    .refine((v) => v.range[0] <= v.range[1], { message: 'range must be [low, high] with low <= high' }),
  z.strictObject({ node: z.enum(['workers', 'any']) }),
  z.strictObject({ random: z.number().int().min(1).max(16) }),
]);

const VariableNameSchema = z.string().regex(VAR_NAME, { message: 'variable names are UPPER_SNAKE_CASE' });

/** One of several sibling questions a task slot can roll. Fields left out fall back to the task's. */
export const TaskVariantSchema = z.strictObject({
  title: z.string().min(1).optional(),
  context: z.string().optional(),
  /** Runs after the task's own setup steps. */
  setup: z.array(StepSchema).default([]),
  setupStage: z.number().int().min(0).max(9).optional(),
  /** Added to the task's own checks. */
  checks: z.array(CheckSchema).min(1),
  /** Replace the task's hints when not empty. */
  hints: z.array(z.string()).default([]),
});
export type TaskVariant = z.infer<typeof TaskVariantSchema>;

/**
 * A create builder with the add-ons and follow-ups it got, or a troubleshooting category. The faults of
 * a category question are the hidden variables Q<n>_FAULT, Q<n>_FAULT_2 and Q<n>_FAULT_3 of task q<n>.
 */
export const RecipeRefSchema = z.union([
  z.strictObject({ builder: z.string().min(1), parts: z.array(z.string()).default([]) }),
  z.strictObject({ category: z.string().min(1) }),
]);
export type RecipeRef = z.infer<typeof RecipeRefSchema>;

export const TaskSchema = z
  .strictObject({
    id: SlugSchema,
    title: z.string().min(1),
    points: z.number().positive(),
    context: z.string().optional(),
    setup: z.array(StepSchema).default([]),
    /** 0: set up at session start. 1 or more: set up when the learner first opens the task, after any unopened task with a lower stage. */
    setupStage: z.number().int().min(0).max(9).default(0),
    checks: z.array(CheckSchema).default([]),
    hints: z.array(z.string()).default([]),
    /** Tags of this question alone, for Focus; the scenario's tags cover every question. */
    tags: z.array(z.string()).optional(),
    /** The Quick Create recipe that generated the question, so Focus counts it toward exactly its topics. */
    recipe: RecipeRefSchema.optional(),
    /** A oneOf variable whose rolled value picks the entry of `variants`; its markdown is tasks/<id>.<value>.md. */
    variant: z.string().regex(VAR_NAME, { message: 'variant names an UPPER_SNAKE_CASE variable' }).optional(),
    variants: z.record(z.string().regex(/^[\w.-]+$/), TaskVariantSchema).optional(),
  })
  .superRefine((t, ctx) => {
    if ((t.variant === undefined) !== (t.variants === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'a task needs both "variant" and "variants", or neither', path: ['variants'] });
    }
    if (!t.variants && !t.checks.length) ctx.addIssue({ code: 'custom', message: 'a task needs at least one check', path: ['checks'] });
  });
export type Task = z.infer<typeof TaskSchema>;

export const TopologySchema = z.strictObject({
  controlPlane: z.literal(1).default(1),
  workers: z.number().int().min(0).max(2).default(2),
});
export type Topology = z.infer<typeof TopologySchema>;

export const ScenarioSchema = z
  .strictObject({
    id: SlugSchema,
    title: z.string().min(1),
    domain: DomainSchema,
    /** Product section this lab belongs to; defaults to CKA so existing YAML needs no change. */
    track: z.enum(LESSON_TRACKS).default('cka'),
    difficulty: z.number().int().min(1).max(3),
    estimatedMinutes: z.number().positive(),
    points: z.number().positive(),
    tags: z.array(z.string()).default([]),
    base: BaseSchema,
    k8sVersion: z.string().optional(),
    nodes: TopologySchema.default({ controlPlane: 1, workers: 2 }),
    context: z.string().optional(),
    settleSeconds: z.number().min(0).max(600).default(30),
    draft: z.boolean().default(false),
    variables: z.record(VariableNameSchema, VariableSchema).default({}),
    setup: z.array(StepSchema).default([]),
    solution: z.array(StepSchema).optional(),
    checks: z.array(CheckSchema).min(1).optional(),
    hints: z.array(z.string()).default([]),
    tasks: z.array(TaskSchema).min(1).optional(),
  })
  .superRefine((s, ctx) => {
    if ((s.checks === undefined) === (s.tasks === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'a scenario needs exactly one of "checks" (single task) or "tasks"', path: [] });
      return;
    }
    if (s.tasks && s.hints.length) {
      ctx.addIssue({ code: 'custom', message: 'with "tasks", put hints inside each task', path: ['hints'] });
    }
    const seen = new Set<string>();
    const taskIds = new Set<string>();
    s.tasks?.forEach((t, ti) => {
      if (taskIds.has(t.id)) ctx.addIssue({ code: 'custom', message: `duplicate task id "${t.id}"`, path: ['tasks', ti, 'id'] });
      taskIds.add(t.id);
    });
    const allChecks: [Check, (string | number)[]][] = s.checks
      ? s.checks.map((c, i) => [c, ['checks', i]])
      : s.tasks!.flatMap((t, ti) => [
          ...t.checks.map((c, i): [Check, (string | number)[]] => [c, ['tasks', ti, 'checks', i]]),
          ...Object.entries(t.variants ?? {}).flatMap(([k, v]) =>
            v.checks.map((c, i): [Check, (string | number)[]] => [c, ['tasks', ti, 'variants', k, 'checks', i]]),
          ),
        ]);
    for (const [c, path] of allChecks) {
      if (seen.has(c.id)) ctx.addIssue({ code: 'custom', message: `duplicate check id "${c.id}"`, path: [...path, 'id'] });
      seen.add(c.id);
    }
    const aws = s.track === 'aws';
    if (aws !== (s.base === 'floci')) {
      ctx.addIssue({ code: 'custom', message: aws ? 'aws scenarios use base "floci"' : 'base "floci" is only for the aws track', path: ['base'] });
    }
    if (aws !== (AWS_DOMAINS as readonly string[]).includes(s.domain)) {
      ctx.addIssue({
        code: 'custom',
        message: aws ? `aws scenarios use one of the domains ${AWS_DOMAINS.join(', ')}` : `domain "${s.domain}" is only for the aws track`,
        path: ['domain'],
      });
    }
    for (const [c, path] of allChecks) {
      if (aws ? c.type === 'kubectl' || c.type === 'ssh' : c.type === 'aws') {
        ctx.addIssue({ code: 'custom', message: aws ? `aws scenarios have no cluster; use an "aws" or "script" check` : '"aws" checks are only for the aws track', path: [...path, 'type'] });
      }
    }
    s.tasks?.forEach((t, ti) => {
      if (!t.variant || !t.variants) return;
      const v = s.variables[t.variant];
      if (!v || !('oneOf' in v) || v.hidden) {
        ctx.addIssue({ code: 'custom', message: `variant ${t.variant} must be a declared oneOf variable that is not hidden`, path: ['tasks', ti, 'variant'] });
        return;
      }
      const values = v.oneOf.map(String);
      const keys = Object.keys(t.variants);
      for (const x of values) {
        if (!keys.includes(x)) ctx.addIssue({ code: 'custom', message: `variants has no entry for ${t.variant}=${x}`, path: ['tasks', ti, 'variants'] });
      }
      for (const k of keys) {
        if (!values.includes(k)) ctx.addIssue({ code: 'custom', message: `variants.${k} is not a value of ${t.variant}`, path: ['tasks', ti, 'variants', k] });
      }
    });
    for (const [name, v] of Object.entries(s.variables)) {
      if ('node' in v && v.node === 'workers' && s.nodes.workers < 1) {
        ctx.addIssue({ code: 'custom', message: `variable ${name} picks a worker but the topology has none`, path: ['variables', name] });
      }
    }

    const nodeAllowed = (node: string) => {
      if (node === 'controlplane') return true;
      const n = Number(node.slice('worker-'.length));
      return n >= 1 && n <= s.nodes.workers;
    };
    const visit = (node: string | undefined, path: (string | number)[]) => {
      const ref = node && /^\$\{(\w+)\}$/.exec(node)?.[1];
      if (ref) {
        const v = s.variables[ref];
        const ok = v && ('node' in v || ('oneOf' in v && v.oneOf.every((x) => nodeAllowed(String(x)))));
        if (!ok) ctx.addIssue({ code: 'custom', message: `${node} must be a variable with "node:" or a oneOf of node names`, path });
        return;
      }
      if (node !== undefined && !nodeAllowed(node)) {
        ctx.addIssue({
          code: 'custom',
          message: `node "${node}" is outside the topology (${s.nodes.workers} workers)`,
          path,
        });
      }
    };
    s.setup.forEach((st, i) => visit(st.node, ['setup', i, 'node']));
    s.solution?.forEach((st, i) => visit(st.node, ['solution', i, 'node']));
    for (const [c, path] of allChecks) visit('node' in c ? c.node : undefined, [...path, 'node']);
    s.tasks?.forEach((t, ti) => {
      t.setup.forEach((st, i) => visit(st.node, ['tasks', ti, 'setup', i, 'node']));
      for (const [k, v] of Object.entries(t.variants ?? {})) {
        v.setup.forEach((st, i) => visit(st.node, ['tasks', ti, 'variants', k, 'setup', i, 'node']));
      }
    });
  });
export type Scenario = z.infer<typeof ScenarioSchema>;

export const LEGACY_TASK_ID = 'main';

/** Every scenario as a task list. A single-task scenario (top-level checks) becomes one task "main". */
export function scenarioTasks(s: Scenario): Task[] {
  if (s.tasks) return s.tasks;
  return [{ id: LEGACY_TASK_ID, title: s.title, points: s.points, context: s.context, setup: [], setupStage: 0, checks: s.checks ?? [], hints: s.hints }];
}

/** The rolled variant of a task, or undefined when the task has none or its variable was not rolled. */
export function taskVariant(t: Task, vars: Record<string, string>): string | undefined {
  if (!t.variant || !t.variants || !Object.hasOwn(vars, t.variant)) return undefined;
  const key = vars[t.variant];
  return Object.hasOwn(t.variants, key) ? key : undefined;
}

/** Merges the rolled variant into the task. Tasks without variants come back unchanged. */
export function resolveTask(t: Task, vars: Record<string, string>): Task {
  const key = taskVariant(t, vars);
  if (key === undefined) return t;
  const v = t.variants![key];
  const { variant: _variant, variants: _variants, ...rest } = t;
  return {
    ...rest,
    title: v.title ?? t.title,
    context: v.context ?? t.context,
    setup: [...t.setup, ...v.setup],
    setupStage: v.setupStage ?? t.setupStage,
    checks: [...t.checks, ...v.checks],
    hints: v.hints.length ? v.hints : t.hints,
  };
}

export function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)';
    // Record keys fail as a generic "Invalid key in record"; the useful message is nested.
    if (issue.code === 'invalid_key') return `${path}: ${issue.issues.map((i) => i.message).join('; ')}`;
    return `${path}: ${issue.message}`;
  });
}

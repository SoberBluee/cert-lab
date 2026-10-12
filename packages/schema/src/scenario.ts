import { z } from 'zod';
import { BASES, DOMAINS } from './constants';
import { VAR_NAME } from './vars';

export { BASES, DOMAINS };

export const DomainSchema = z.enum(DOMAINS);
export type Domain = z.infer<typeof DomainSchema>;

export const BaseSchema = z.enum(BASES);
export type Base = z.infer<typeof BaseSchema>;

export const NodeNameSchema = z.string().regex(/^(controlplane|worker-[1-9]\d*|\$\{[A-Z][A-Z0-9_]*\})$/, {
  message: 'node must be "controlplane", "worker-N" or a node variable like ${NODE}',
});

const SlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, { message: 'use lowercase letters, digits and dashes' });

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

export const CheckSchema = z.discriminatedUnion('type', [
  KubectlCheckSchema,
  SshCheckSchema,
  ScriptCheckSchema,
  FileCheckSchema,
]);
export type Check = z.infer<typeof CheckSchema>;
export type CheckType = Check['type'];

export const StepSchema = z
  .strictObject({
    node: NodeNameSchema,
    script: z.string().min(1).optional(),
    run: z.string().min(1).optional(),
    timeoutSeconds: z.number().positive().max(1800).default(300),
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

export const TaskSchema = z.strictObject({
  id: SlugSchema,
  title: z.string().min(1),
  points: z.number().positive(),
  context: z.string().optional(),
  setup: z.array(StepSchema).default([]),
  checks: z.array(CheckSchema).min(1),
  hints: z.array(z.string()).default([]),
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
      : s.tasks!.flatMap((t, ti) => t.checks.map((c, i): [Check, (string | number)[]] => [c, ['tasks', ti, 'checks', i]]));
    for (const [c, path] of allChecks) {
      if (seen.has(c.id)) ctx.addIssue({ code: 'custom', message: `duplicate check id "${c.id}"`, path: [...path, 'id'] });
      seen.add(c.id);
    }
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
    s.tasks?.forEach((t, ti) => t.setup.forEach((st, i) => visit(st.node, ['tasks', ti, 'setup', i, 'node'])));
  });
export type Scenario = z.infer<typeof ScenarioSchema>;

export const LEGACY_TASK_ID = 'main';

/** Every scenario as a task list. A single-task scenario (top-level checks) becomes one task "main". */
export function scenarioTasks(s: Scenario): Task[] {
  if (s.tasks) return s.tasks;
  return [
    { id: LEGACY_TASK_ID, title: s.title, points: s.points, context: s.context, setup: [], checks: s.checks ?? [], hints: s.hints },
  ];
}

export function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)';
    // Record keys fail as a generic "Invalid key in record"; the useful message is nested.
    if (issue.code === 'invalid_key') return `${path}: ${issue.issues.map((i) => i.message).join('; ')}`;
    return `${path}: ${issue.message}`;
  });
}

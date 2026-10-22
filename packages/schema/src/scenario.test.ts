import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatZodError, LEGACY_TASK_ID, resolveTask, ScenarioSchema, scenarioTasks } from './scenario';

const base = {
  id: 'demo',
  title: 'Demo',
  domain: 'workloads',
  difficulty: 1,
  estimatedMinutes: 5,
  points: 4,
  base: 'cluster',
};
const check = (id: string, extra: object = {}) => ({ id, description: id, type: 'kubectl', run: 'true', expect: { exitCode: 0 }, ...extra });

function errors(input: object): string[] {
  const r = ScenarioSchema.safeParse(input);
  return r.success ? [] : formatZodError(r.error);
}

describe('ScenarioSchema tasks', () => {
  it('turns top-level checks into a single legacy task', () => {
    const s = ScenarioSchema.parse({ ...base, checks: [check('a')], hints: ['h'] });
    const [task] = scenarioTasks(s);
    assert.equal(task.id, LEGACY_TASK_ID);
    assert.equal(task.points, 4);
    assert.deepEqual(task.hints, ['h']);
  });

  it('needs exactly one of checks and tasks', () => {
    assert.match(errors(base).join(), /exactly one of "checks"/);
    const both = { ...base, checks: [check('a')], tasks: [{ id: 'q1', title: 'Q', points: 4, checks: [check('b')] }] };
    assert.match(errors(both).join(), /exactly one of "checks"/);
  });

  it('rejects duplicate task ids and check ids across tasks', () => {
    const dup = {
      ...base,
      tasks: [
        { id: 'q1', title: 'A', points: 2, checks: [check('same')] },
        { id: 'q1', title: 'B', points: 2, checks: [check('same')] },
      ],
    };
    const msgs = errors(dup).join('\n');
    assert.match(msgs, /duplicate task id "q1"/);
    assert.match(msgs, /duplicate check id "same"/);
  });

  it('puts hints inside tasks, not at the top level', () => {
    const s = { ...base, hints: ['x'], tasks: [{ id: 'q1', title: 'A', points: 4, checks: [check('a')] }] };
    assert.match(errors(s).join(), /put hints inside each task/);
  });
});

describe('ScenarioSchema task variants', () => {
  const withVariants = (variables: object, variants: object) => ({
    ...base,
    variables,
    tasks: [{ id: 'q1', title: 'Slot', points: 4, checks: [check('shared')], variant: 'KIND', variants }],
  });

  it('accepts one variant per oneOf value and resolves the rolled one', () => {
    const s = ScenarioSchema.parse(
      withVariants({ KIND: { oneOf: ['a', 'b'] } }, {
        a: { title: 'A', checks: [check('a1')], hints: ['ha'], setup: [{ node: 'controlplane', run: 'echo a' }] },
        b: { checks: [check('b1')] },
      }),
    );
    const [t] = s.tasks!;
    const a = resolveTask(t, { KIND: 'a' });
    assert.equal(a.title, 'A');
    assert.deepEqual(a.checks.map((c) => c.id), ['shared', 'a1']);
    assert.deepEqual(a.hints, ['ha']);
    assert.equal(a.variants, undefined);
    assert.equal(resolveTask(t, { KIND: 'b' }).title, 'Slot');
    assert.equal(resolveTask(t, {}), t);
  });

  it('needs variants to match the oneOf values of a visible variable', () => {
    assert.match(errors(withVariants({ KIND: { oneOf: ['a', 'b'] } }, { a: { checks: [check('a1')] } })).join(), /no entry for KIND=b/);
    assert.match(
      errors(withVariants({ KIND: { oneOf: ['a'] } }, { a: { checks: [check('a1')] }, z: { checks: [check('z1')] } })).join(),
      /variants.z is not a value of KIND/,
    );
    assert.match(errors(withVariants({ KIND: { oneOf: ['a'], hidden: true } }, { a: { checks: [check('a1')] } })).join(), /not hidden/);
    assert.match(errors(withVariants({}, { a: { checks: [check('a1')] } })).join(), /declared oneOf/);
  });

  it('rejects duplicate check ids across variants and tasks without checks', () => {
    assert.match(
      errors(withVariants({ KIND: { oneOf: ['a', 'b'] } }, { a: { checks: [check('x')] }, b: { checks: [check('x')] } })).join(),
      /duplicate check id "x"/,
    );
    assert.match(errors({ ...base, tasks: [{ id: 'q1', title: 'A', points: 4 }] }).join(), /at least one check/);
  });
});

describe('ScenarioSchema variables', () => {
  it('accepts node variables in checks and steps', () => {
    const s = {
      ...base,
      variables: { NODE: { node: 'workers' } },
      setup: [{ node: '${NODE}', run: 'true' }],
      checks: [check('a', { type: 'ssh', node: '${NODE}' })],
    };
    assert.deepEqual(errors(s), []);
  });

  it('accepts a oneOf of node names as a node variable', () => {
    const s = { ...base, variables: { N: { oneOf: ['worker-1', 'controlplane'] } }, checks: [check('a', { type: 'ssh', node: '${N}' })] };
    assert.deepEqual(errors(s), []);
  });

  it('rejects node references to non-node variables', () => {
    const s = { ...base, variables: { NS: { oneOf: ['shop'] } }, checks: [check('a', { type: 'ssh', node: '${NS}' })] };
    assert.match(errors(s).join(), /must be a variable with "node:"/);
  });

  it('rejects a worker variable without workers', () => {
    const s = { ...base, nodes: { workers: 0 }, variables: { NODE: { node: 'workers' } }, checks: [check('a')] };
    assert.match(errors(s).join(), /picks a worker but the topology has none/);
  });

  it('validates generator shapes and names', () => {
    assert.match(errors({ ...base, variables: { lower: { oneOf: ['a'] } }, checks: [check('a')] }).join(), /UPPER_SNAKE_CASE/);
    assert.notDeepEqual(errors({ ...base, variables: { R: { range: [5, 1] } }, checks: [check('a')] }), []);
    assert.notDeepEqual(errors({ ...base, variables: { E: { oneOf: [] } }, checks: [check('a')] }), []);
  });
});

describe('ScenarioSchema aws track', () => {
  const aws = { ...base, track: 'aws', domain: 'secure-architectures', base: 'floci' };
  const awsCheck = (id: string) => ({ id, description: id, type: 'aws', run: 'aws sts get-caller-identity', expect: { exitCode: 0 } });

  it('accepts aws checks and steps without a node', () => {
    const s = ScenarioSchema.parse({ ...aws, setup: [{ run: 'aws s3 mb s3://x' }], checks: [awsCheck('a')] });
    assert.equal(s.setup[0].node, 'controlplane');
    assert.equal(scenarioTasks(s)[0].checks[0].type, 'aws');
  });

  it('keeps the aws track, the floci base and the SAA domains together', () => {
    assert.match(errors({ ...aws, base: 'cluster', checks: [awsCheck('a')] }).join(), /aws scenarios use base "floci"/);
    assert.match(errors({ ...aws, domain: 'workloads', checks: [awsCheck('a')] }).join(), /aws scenarios use one of the domains/);
    assert.match(errors({ ...base, base: 'floci', checks: [check('a')] }).join(), /only for the aws track/);
    assert.match(errors({ ...base, domain: 'secure-architectures', checks: [check('a')] }).join(), /only for the aws track/);
  });

  it('allows no cluster checks in aws scenarios and no aws checks elsewhere', () => {
    assert.match(errors({ ...aws, checks: [check('k')] }).join(), /aws scenarios have no cluster/);
    assert.match(errors({ ...base, checks: [awsCheck('a')] }).join(), /"aws" checks are only for the aws track/);
  });
});

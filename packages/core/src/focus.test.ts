import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { stringify } from 'yaml';
import { ScenarioSchema, type Mode } from '@cka/schema';
import { focusReport, questionTopics, scenarioTopicIds } from './focus';
import { NOT_ATTEMPTED } from './grader';
import { CATEGORIES, faultList } from './recipes';
import { ScenarioLibrary } from './scenarios';
import { Store } from './store';

const root = mkdtempSync(join(tmpdir(), 'cka-focus-'));
after(() => rmSync(root, { recursive: true, force: true }));

const controlplane = faultList(CATEGORIES.find((c) => c.id === 'controlplane')!).map((f) => f.id);
const etcdFaults = controlplane.filter((f) => f.startsWith('etcd-'));
const apiserverFault = controlplane.find((f) => f.startsWith('apiserver-'))!;

const check = (id: string, weight = 1) => ({ id, description: id, type: 'kubectl', run: 'true', expect: { exitCode: 0 }, weight });
const task = (id: string, extra: Record<string, unknown>, checkIds = [`${id}-a`, `${id}-b`]) => ({
  id,
  title: `Question ${id}`,
  points: checkIds.length,
  checks: checkIds.map((c) => check(c)),
  hints: ['look'],
  ...extra,
});
const scenario = (def: Record<string, unknown>) =>
  ScenarioSchema.parse({ title: 'Lab', difficulty: 2, estimatedMinutes: 10, base: 'cluster', points: 4, tags: [], ...def });

/** Writes the scenario to the temp library: scenario.yaml and one markdown file per question. */
function save(def: ReturnType<typeof scenario>) {
  const dir = join(root, def.domain, def.id);
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'scenario.yaml'), stringify(def));
  for (const t of def.tasks ?? []) writeFileSync(join(dir, 'tasks', `${t.id}.md`), 'Do it.\n');
}

describe('questionTopics', () => {
  it('puts a generated create question in the topics of its builder whose add-ons it has', () => {
    const def = scenario({ id: 'c', domain: 'workloads', tasks: [task('q1', { recipe: { builder: 'deployment', parts: ['expose', 'ingress'] } })] });
    assert.deepEqual(questionTopics(def, def.tasks![0]), ['create-deployment', 'create-service', 'create-ingress']);
  });

  it('puts a troubleshooting question in the fault subsets its pool covers, or that it rolled', () => {
    const def = scenario({
      id: 't',
      domain: 'troubleshooting',
      variables: { Q1_FAULT: { oneOf: etcdFaults, hidden: true }, Q2_FAULT: { oneOf: controlplane, hidden: true } },
      tasks: [task('q1', { recipe: { category: 'controlplane' } }), task('q2', { recipe: { category: 'controlplane' } })],
    });
    const [q1, q2] = def.tasks!;
    assert.deepEqual(questionTopics(def, q1), ['trouble-etcd', 'trouble-controlplane']);
    // The whole category: only its broad topic, until an attempt says which fault was rolled.
    assert.deepEqual(questionTopics(def, q2), ['trouble-controlplane']);
    assert.deepEqual(questionTopics(def, q2, { Q2_FAULT: apiserverFault }), ['trouble-apiserver', 'trouble-controlplane']);
  });

  it('matches a handwritten question on its own tags, within its group', () => {
    const helm = scenario({ id: 'h', domain: 'cluster-architecture', tags: ['helm', 'daemonset'], tasks: [task('q1', {})] });
    assert.deepEqual(questionTopics(helm, helm.tasks![0]), ['create-helm', 'create-workload-controllers']);
    // A troubleshooting lab about a Service counts toward troubleshooting topics only.
    const svc = scenario({ id: 's', domain: 'troubleshooting', tags: ['troubleshooting', 'service', 'logs'], tasks: [task('q1', {})] });
    assert.deepEqual(questionTopics(svc, svc.tasks![0]), ['trouble-services']);
    // Question tags win over the scenario's, which cover every question.
    const mixed = scenario({
      id: 'm',
      domain: 'workloads',
      tags: ['hpa', 'sidecar'],
      tasks: [task('q1', { tags: ['hpa'] }), task('q2', { tags: ['sidecar'] })],
    });
    assert.deepEqual(questionTopics(mixed, mixed.tasks![0]), ['create-hpa']);
    assert.deepEqual(scenarioTopicIds({ def: mixed, tasks: mixed.tasks } as never), ['create-pod', 'create-hpa']);
  });
});

describe('focusReport', () => {
  const store = new Store(join(root, 'state.db'));
  save(
    scenario({
      id: 'mixed-lab',
      title: 'Mixed lab',
      domain: 'troubleshooting',
      variables: { Q1_FAULT: { oneOf: controlplane, hidden: true }, Q2_APP: { oneOf: ['web', 'api'] } },
      tasks: [
        task('q1', { recipe: { category: 'controlplane' } }),
        task('q2', { title: 'Deployment ${Q2_APP}', recipe: { builder: 'helm', parts: [] } }, ['q2-a', 'q2-b', 'q2-c']),
        task('q3', { recipe: { builder: 'crds', parts: [] } }),
      ],
    }),
  );
  const library = new ScenarioLibrary(root);

  /** A graded attempt: each check passes when its id is in `passed`; q3 was never opened. */
  function attempt(mode: Mode, vars: Record<string, string>, passed: string[]) {
    const id = store.createAttempt({ scenarioId: 'mixed-lab', sessionId: `s${Math.random()}`, mode });
    store.createSession({ id: `s-${id}`, scenarioId: 'mixed-lab', mode, base: 'cluster', attemptId: id, vars });
    store.updateAttempt(id, { score: passed.length, maxScore: 7 });
    store.replaceCheckResults(id, [
      ...['q1-a', 'q1-b', 'q2-a', 'q2-b', 'q2-c'].map((c) => ({ checkId: c, passed: passed.includes(c), weight: 1, output: 'exit=0' })),
      ...['q3-a', 'q3-b'].map((c) => ({ checkId: c, passed: false, weight: 1, output: NOT_ATTEMPTED })),
    ]);
  }

  it('scores each question toward its own topics, and skips questions that were never opened', () => {
    attempt('practice', { Q1_FAULT: apiserverFault, Q2_APP: 'web' }, ['q1-a', 'q2-a', 'q2-b']);
    attempt('dry-run', { Q1_FAULT: apiserverFault, Q2_APP: 'api' }, []);
    const stat = (id: string) => focusReport(store, library).topics.find((t) => t.topicId === id)!;

    assert.equal(stat('trouble-apiserver').recentPercent, 50);
    assert.equal(stat('trouble-etcd').questions, 0);
    assert.equal(stat('create-helm').recentPercent, 67);
    assert.equal(stat('create-helm').weakest?.title, 'Deployment web');
    // Never opened, and a dry-run is not practice.
    assert.equal(stat('create-crds').questions, 0);
    assert.equal(stat('trouble-controlplane').questions, 1);
  });

  it('averages the most recent questions only', () => {
    for (let i = 0; i < 6; i++) attempt('practice', { Q1_FAULT: apiserverFault, Q2_APP: 'api' }, ['q2-a', 'q2-b', 'q2-c']);
    const helm = focusReport(store, library).topics.find((t) => t.topicId === 'create-helm')!;
    assert.equal(helm.questions, 7);
    assert.equal(helm.recentPercent, 100);
    assert.equal(helm.weakest?.title, 'Deployment api');
  });
});

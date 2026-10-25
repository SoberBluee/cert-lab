import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { stringify } from 'yaml';
import { ScenarioSchema, type Mode } from '@cka/schema';
import { attemptReview, focusReport, questionSolutions, questionTopics, scenarioTopicIds } from './focus';
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

  it('counts a create question toward topics that list one of its parts, whatever the builder', () => {
    const pod = scenario({ id: 'p', domain: 'workloads', tasks: [task('q1', { recipe: { builder: 'pod', parts: ['config-volume'] } })] });
    assert.deepEqual(questionTopics(pod, pod.tasks![0]), ['create-pod', 'create-config']);
    const tolerating = scenario({ id: 'd', domain: 'workloads', tasks: [task('q1', { recipe: { builder: 'deployment', parts: ['toleration'] } })] });
    assert.deepEqual(questionTopics(tolerating, tolerating.tasks![0]), ['create-deployment', 'create-placement']);
  });

  it('counts a pool that spans several fault subsets toward each of them, until an attempt rolls one', () => {
    const def = scenario({
      id: 'i',
      domain: 'services-networking',
      variables: { Q1_FAULT: { oneOf: ['ingress-class', 'route-parent'], hidden: true } },
      tasks: [task('q1', { recipe: { category: 'ingress' } })],
    });
    assert.deepEqual(questionTopics(def, def.tasks![0]), ['trouble-ingress', 'trouble-httproute']);
    assert.deepEqual(questionTopics(def, def.tasks![0], { Q1_FAULT: 'route-parent' }), ['trouble-httproute']);
  });

  it('matches a handwritten question on its own tags, within its group first', () => {
    const helm = scenario({ id: 'h', domain: 'cluster-architecture', tags: ['helm', 'daemonset'], tasks: [task('q1', {})] });
    assert.deepEqual(questionTopics(helm, helm.tasks![0]), ['create-helm', 'create-workload-controllers']);
    // A troubleshooting lab about a Service counts toward troubleshooting topics only.
    const svc = scenario({ id: 's', domain: 'troubleshooting', tags: ['troubleshooting', 'service', 'logs'], tasks: [task('q1', {})] });
    assert.deepEqual(questionTopics(svc, svc.tasks![0]), ['trouble-services']);
    // A lab that configures CoreDNS counts toward the create topic, not DNS troubleshooting.
    const dns = scenario({ id: 'k', domain: 'cluster-architecture', tags: ['coredns', 'dns'], tasks: [task('q1', {})] });
    assert.deepEqual(questionTopics(dns, dns.tasks![0]), ['create-coredns']);
    // No create topic is about endpoints, so a lab tagged only with them counts toward Services troubleshooting.
    const ep = scenario({ id: 'e', domain: 'services-networking', tags: ['endpoints'], tasks: [task('q1', {})] });
    assert.deepEqual(questionTopics(ep, ep.tasks![0]), ['trouble-services']);
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

describe('focusReport with help, exam mode and time', () => {
  const store = new Store(join(root, 'help.db'));

  /** An attempt of mixed-lab that graded only q2 (the Helm question), open for `seconds`. */
  function attempt(mode: Mode, passed: string[], help: { hintsUsed?: number; solutionViewed?: boolean } = {}, seconds = 0) {
    const id = store.createAttempt({ scenarioId: 'mixed-lab', sessionId: `s${Math.random()}`, mode, ...help });
    store.createSession({ id: `s-${id}`, scenarioId: 'mixed-lab', mode, base: 'cluster', attemptId: id, vars: { Q1_FAULT: apiserverFault, Q2_APP: 'web' } });
    store.updateAttempt(id, { score: passed.length, maxScore: 3, tasks: [{ id: 'q2', title: 'Deployment web', seconds }] });
    store.replaceCheckResults(id, [
      ...['q2-a', 'q2-b', 'q2-c'].map((c) => ({ checkId: c, passed: passed.includes(c), weight: 1, output: 'exit=0' })),
      ...['q1-a', 'q1-b', 'q3-a', 'q3-b'].map((c) => ({ checkId: c, passed: false, weight: 1, output: NOT_ATTEMPTED })),
    ]);
  }

  it('scores clean questions apart, filters exam mode, and averages the minutes per question', () => {
    attempt('practice', ['q2-a', 'q2-b', 'q2-c'], { hintsUsed: 2 }, 600);
    attempt('practice', ['q2-a'], {}, 240);
    attempt('mock', ['q2-a', 'q2-b']);
    const library = new ScenarioLibrary(root);
    const helm = (mode?: 'exam') => focusReport(store, library, undefined, mode).topics.find((t) => t.topicId === 'create-helm')!;

    const all = helm();
    assert.deepEqual([all.questions, all.recentPercent, all.cleanQuestions, all.cleanPercent, all.recentMinutes], [3, 67, 2, 50, 7]);
    // Exam mode has no hints, so every question counts as clean; this one recorded no time.
    const exam = helm('exam');
    assert.deepEqual([exam.questions, exam.recentPercent, exam.cleanQuestions, exam.cleanPercent, exam.recentMinutes], [1, 67, 1, 67, undefined]);
    assert.equal(focusReport(store, library, undefined, 'exam').mode, 'exam');
  });
});

describe('speed and the attempt review', () => {
  const store = new Store(join(root, 'review.db'));

  /** An attempt of mixed-lab: q1 and q2 graded with the given results, q3 never opened. Ended unless `running`. */
  function attempt(mode: Mode, results: [string, boolean, number][], seconds: Record<string, number>, help: { hintsUsed?: number } = {}, running = false) {
    const id = store.createAttempt({ scenarioId: 'mixed-lab', sessionId: `s${Math.random()}`, mode, ...help });
    store.createSession({ id: `s-${id}`, scenarioId: 'mixed-lab', mode, base: 'cluster', attemptId: id, vars: { Q1_FAULT: apiserverFault, Q2_APP: 'web' } });
    const passed = results.filter(([, ok]) => ok).reduce((n, [, , w]) => n + w, 0);
    store.updateAttempt(id, {
      score: passed,
      maxScore: 9,
      tasks: Object.entries(seconds).map(([task, s]) => ({ id: task, title: task, seconds: s })),
      ...(running ? {} : { endedAt: new Date().toISOString() }),
    });
    store.replaceCheckResults(id, [
      ...results.map(([c, ok, weight]) => ({ checkId: c, passed: ok, weight, output: 'exit=0' })),
      ...['q3-a', 'q3-b'].map((c) => ({ checkId: c, passed: false, weight: 1, output: NOT_ATTEMPTED })),
    ]);
    return id;
  }

  const all: [string, boolean, number][] = [
    ['q1-a', true, 1],
    ['q1-b', true, 1],
    ['q2-a', true, 1],
    ['q2-b', true, 1],
    ['q2-c', true, 1],
  ];

  it('judges speed on clean questions, capping a question left open too long', () => {
    attempt('practice', all, { q1: 3600, q2: 600 });
    attempt('practice', all, { q1: 120, q2: 120 }, { hintsUsed: 1 });
    const library = new ScenarioLibrary(root);
    const stat = (id: string) => focusReport(store, library).topics.find((t) => t.topicId === id)!;
    // 60 minutes counts as 30; the attempt with a hint does not count toward speed.
    assert.equal(stat('trouble-apiserver').cleanMinutes, 30);
    assert.equal(stat('create-helm').cleanMinutes, 10);
    assert.equal(stat('create-helm').recentMinutes, 6);
  });

  it('reviews the latest exam-mode attempt question by question, heaviest misses first, with its solutions', () => {
    writeFileSync(
      join(root, 'troubleshooting', 'mixed-lab', 'solution.md'),
      [
        '## Solution',
        '',
        '### Question 1: Control plane',
        '',
        `<!-- fault Q1_FAULT=${apiserverFault} -->`,
        'Fix the API server flag.',
        '<!-- /fault -->',
        `<!-- fault Q1_FAULT=${etcdFaults[0]} -->`,
        'Fix etcd.',
        '<!-- /fault -->',
        '',
        '### Question 2: Deployment ${Q2_APP}',
        '',
        '```bash',
        '# Question 3 is not a heading inside a code block',
        'helm upgrade ${Q2_APP}',
        '```',
      ].join('\n'),
    );
    const mock = attempt(
      'mock',
      [
        ['q1-a', true, 1],
        ['q1-b', true, 1],
        ['q2-a', false, 1],
        ['q2-b', true, 1],
        ['q2-c', false, 3],
      ],
      { q1: 300, q2: 900 },
    );
    // A later practice attempt: the review still defaults to the exam. One still running is never reviewed.
    attempt('practice', all, { q1: 60 });
    const running = attempt('practice', all, { q1: 60 }, {}, true);
    const library = new ScenarioLibrary(root);
    const { review, attempts } = attemptReview(store, library);

    assert.equal(review?.attemptId, mock);
    assert.deepEqual([review?.score, review?.maxScore, review?.mode, review?.paceMinutes], [3, 9, 'mock', 7]);
    const [q1, q2, q3] = review!.questions;
    assert.deepEqual([q1.score, q1.maxScore, q1.minutes, q1.missed], [2, 2, 5, []]);
    assert.equal(q2.title, 'Deployment web');
    assert.deepEqual([q2.score, q2.maxScore, q2.minutes], [1, 5, 15]);
    assert.deepEqual(q2.missed.map((c) => [c.id, c.weight]), [['q2-c', 3], ['q2-a', 1]]);
    assert.deepEqual(q2.topics, ['create-helm']);
    assert.equal(q3.attempted, false);
    // Each question's part of solution.md, for the fault it rolled, variables filled in.
    assert.equal(q1.solution, 'Fix the API server flag.');
    assert.match(q2.solution!, /helm upgrade web/);
    assert.match(q2.solution!, /Question 3 is not a heading/);
    assert.equal(q3.solution, undefined);
    assert.equal(q2.text, 'Do it.\n');
    assert.ok(!attempts.some((a) => a.attemptId === running));
    assert.equal(attemptReview(store, library, running).review, undefined);
    assert.equal(attempts[0].mode, 'practice');
    assert.ok(attempts.some((a) => a.attemptId === mock));

    // Asked for by id, any graded attempt can be reviewed.
    assert.equal(attemptReview(store, library, attempts[0].attemptId).review?.mode, 'practice');
  });
});

describe('questionSolutions', () => {
  it('splits solution.md at each question heading, by task id', () => {
    const md = '## Solution\n\n### Question 1: A\n\none\n\n### Question 2: B\n\ntwo\n';
    assert.deepEqual(questionSolutions(md, ['q1', 'q2']), { q1: 'one', q2: 'two' });
    // Older handwritten mocks head each part "## qN".
    assert.deepEqual(questionSolutions('# Mock\n## q1 — Helm\nhelm\n## q2 — etcd\netcd', ['q1', 'q2']), { q1: 'helm', q2: 'etcd' });
    // One question gets the whole file; a question without a part gets nothing.
    assert.deepEqual(questionSolutions('## Solution\n\nkubectl apply\n', ['main']), { main: 'kubectl apply' });
    assert.deepEqual(questionSolutions('### Question 2: B\n\ntwo', ['q1', 'q2']), { q2: 'two' });
  });
});

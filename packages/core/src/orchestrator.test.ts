import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import pino from 'pino';
import { FakeDriver } from '@cka/driver-fake';
import type { ExecOptions, ExecResult, Mode } from '@cka/schema';
import { diskReader, lintScenario } from './lint';
import { selectDriverName } from './orchestrator';
import { ScenarioLibrary } from './scenarios';
import { SessionManager } from './session';
import { Store } from './store';

describe('selectDriverName', () => {
  it('uses CKA_DRIVER, then the driver the images were built with, then multipass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cka-sel-'));
    assert.equal(selectDriverName(undefined, dir), 'multipass');
    writeFileSync(join(dir, 'images.json'), JSON.stringify({ builtAt: 'x' }));
    assert.equal(selectDriverName(undefined, dir), 'multipass');
    writeFileSync(join(dir, 'images.json'), JSON.stringify({ builtAt: 'x', driver: 'tart' }));
    assert.equal(selectDriverName(undefined, dir), 'tart');
    assert.equal(selectDriverName('fake', dir), 'fake');
    assert.throws(() => selectDriverName('vbox', dir), /Unknown driver "vbox"/);
  });
});

/** Records which setup scripts were copied in, in order, and every command run. */
class RecordingDriver extends FakeDriver {
  scripts: string[] = [];
  commands: string[] = [];
  /** When set, no node answers, as after the Mac restarted. */
  down = false;
  constructor() {
    super(0);
  }
  override async copyIn(_s: string, _n: string, _local: string, remote: string): Promise<void> {
    this.scripts.push(basename(remote).replace(/^\d+-/, ''));
  }
  override async exec(sessionId: string, node: string, command: string, opts?: ExecOptions): Promise<ExecResult> {
    this.commands.push(command);
    if (this.down) throw new Error(`Cannot run commands on ${node}: Connection refused`);
    return super.exec(sessionId, node, command, opts);
  }
}

const task = (n: number, stage: number) => `  - id: q${n}
    title: Question ${n}
    points: 1
    setupStage: ${stage}
    setup: [{ node: controlplane, script: setup/q${n}.sh${stage ? '' : `, lane: q${n}`} }]
    checks: [{ id: q${n}-c, description: check ${n}, type: kubectl, run: echo check-q${n}, expect: { equals: '' } }]`;

/** A lab with one harmless question (stage 0), one node question (stage 1) and one control plane question (stage 2). */
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'cka-staged-'));
  const dir = join(root, 'troubleshooting', 'staged');
  mkdirSync(join(dir, 'setup'), { recursive: true });
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(
    join(dir, 'scenario.yaml'),
    `id: staged
title: Staged
domain: troubleshooting
difficulty: 1
estimatedMinutes: 5
points: 3
base: cluster
settleSeconds: 0
tasks:
${[task(1, 0), task(2, 1), task(3, 2)].join('\n')}
`,
  );
  for (const n of [1, 2, 3]) {
    writeFileSync(join(dir, 'setup', `q${n}.sh`), 'true\n');
    writeFileSync(join(dir, 'tasks', `q${n}.md`), `Question ${n}\n`);
  }
  const driver = new RecordingDriver();
  const library = new ScenarioLibrary(root);
  assert.deepEqual(library.errors, []);
  const store = new Store(join(root, 'state.db'));
  const sessions = new SessionManager(driver, store, library, pino({ enabled: false }));
  const start = async (mode: Mode = 'practice') => (await sessions.start('staged', mode)).ready;
  return { driver, sessions, start, store, library };
}

const readyIds = (v: { tasks: { id: string; ready: boolean }[] }) => v.tasks.filter((t) => t.ready).map((t) => t.id);

describe('deferred task setup', () => {
  it('sets up only stage-0 tasks at start', async () => {
    const { driver, start } = setup();
    const view = await start();
    assert.equal(view.state, 'running');
    assert.deepEqual(driver.scripts, ['q1.sh']);
    assert.deepEqual(readyIds(view), ['q1']);
  });

  it('opening a later stage first sets up the unopened earlier stage, and only once', async () => {
    const { driver, sessions, start } = setup();
    await start();
    const view = await sessions.openTask('q3').ready;
    assert.deepEqual(driver.scripts, ['q1.sh', 'q2.sh', 'q3.sh']);
    assert.deepEqual(readyIds(view), ['q1', 'q2', 'q3']);
    assert.equal(view.preparingTask, undefined);
    assert.ok(view.progress.some((p) => p.message === 'Preparing questions 2 and 3'));
    await sessions.openTask('q3').ready;
    await sessions.openTask('q2').ready;
    assert.deepEqual(driver.scripts, ['q1.sh', 'q2.sh', 'q3.sh']);
  });

  it('concurrent opens run the setup once', async () => {
    const { driver, sessions, start } = setup();
    await start();
    await Promise.all([sessions.openTask('q2').ready, sessions.openTask('q2').ready, sessions.openTask('q2').ready]);
    assert.deepEqual(driver.scripts, ['q1.sh', 'q2.sh']);
  });

  it('grades unopened tasks as not attempted without running their checks', async () => {
    const { driver, sessions, start } = setup();
    await start();
    const result = await sessions.grade({ retry: false });
    assert.equal(result.score, 1);
    assert.equal(result.maxScore, 3);
    assert.ok(driver.commands.some((c) => c.includes('check-q1')));
    assert.ok(!driver.commands.some((c) => c.includes('check-q2') || c.includes('check-q3')));
    assert.deepEqual(
      result.checks.filter((c) => !c.passed).map((c) => [c.id, c.detail]),
      [
        ['q2-c', 'not attempted'],
        ['q3-c', 'not attempted'],
      ],
    );
  });

  it('verify mode sets up every task at start, in stage order', async () => {
    const { driver, start } = setup();
    const view = await start('verify');
    assert.deepEqual(driver.scripts, ['q1.sh', 'q2.sh', 'q3.sh']);
    assert.deepEqual(readyIds(view), ['q1', 'q2', 'q3']);
  });

  it('a scenario cannot use the playground id', () => {
    const root = mkdtempSync(join(tmpdir(), 'cka-reserved-'));
    mkdirSync(join(root, 'x'));
    writeFileSync(
      join(root, 'x', 'scenario.yaml'),
      `id: playground\ntitle: P\ndomain: troubleshooting\ndifficulty: 1\nestimatedMinutes: 1\npoints: 1\nbase: cluster\nchecks: [{ id: c, description: c, type: kubectl, run: 'true', expect: { equals: '' } }]\n`,
    );
    writeFileSync(join(root, 'x', 'task.md'), 'x\n');
    const library = new ScenarioLibrary(root);
    assert.equal(library.get('playground'), undefined);
    assert.match(library.errors[0].messages.join(), /reserved for the playground/);
  });

  it('reset forgets opened tasks', async () => {
    const { driver, sessions, start } = setup();
    await start();
    await sessions.openTask('q2').ready;
    const view = await (await sessions.reset()).ready;
    assert.deepEqual(readyIds(view), ['q1']);
    assert.deepEqual(driver.scripts, ['q1.sh', 'q2.sh', 'q1.sh']);
  });
});

describe('exam mode', () => {
  it('has a deadline and refuses grade, hints, solution and reset', async () => {
    const { sessions, start } = setup();
    const view = await start('mock');
    assert.equal(view.mode, 'mock');
    assert.equal(Date.parse(view.deadlineAt!) - Date.parse(view.readyAt!), 5 * 60_000);
    await assert.rejects(sessions.grade(), /submit the exam/);
    assert.throws(() => sessions.hint(), /disabled in mock mode/);
    assert.throws(() => sessions.solution(), /disabled in mock mode/);
    await assert.rejects(sessions.reset(), /cannot be reset/);
  });

  it('submit grades once, ends the session and records the attempt', async () => {
    const { sessions, start } = setup();
    const store = (sessions as unknown as { store: Store }).store;
    await start('mock');
    const ended = await sessions.submit();
    assert.equal(ended.state, 'completed');
    assert.equal(ended.lastGrade?.score, 1);
    assert.equal(ended.lastGrade?.maxScore, 3);
    assert.equal(sessions.current(), null);
    const attempts = store.listAttempts();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].mode, 'mock');
    assert.equal(attempts[0].score, 1);
    assert.equal(attempts[0].pausedS, undefined);
    assert.equal(ended.pausedS, undefined);
  });

  it('only an exam is submitted, and practice sessions have no deadline', async () => {
    const { sessions, start } = setup();
    const view = await start();
    assert.equal(view.deadlineAt, undefined);
    await assert.rejects(sessions.submit(), /Only an exam is submitted/);
  });
});

describe('pausing an exam', () => {
  const T0 = Date.parse('2026-10-27T09:00:00.000Z');
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  /** The exam clock follows a mocked Date that only moves on tick(); the fake lab still runs on real timers. */
  const frozen = (t: TestContext) => t.mock.timers.enable({ apis: ['Date'], now: T0 });

  it('stops the clock, and resume continues with exactly the time that was left', async (t) => {
    frozen(t);
    const { driver, sessions, start, store } = setup();
    const view = await start('mock');
    assert.equal(view.readyAt, new Date(T0).toISOString());
    t.mock.timers.tick(MIN);
    const paused = sessions.pause();
    assert.equal(paused.state, 'running');
    assert.equal(paused.pausedAt, new Date(T0 + MIN).toISOString());
    assert.equal(paused.deadlineAt, undefined);
    assert.equal(paused.timeLeftMs, 4 * MIN);

    t.mock.timers.tick(3 * HOUR + 1234);
    assert.equal(sessions.current()?.timeLeftMs, 4 * MIN);
    const resumed = await sessions.resume();
    assert.equal(resumed.pausedAt, undefined);
    assert.equal(resumed.timeLeftMs, undefined);
    assert.equal(Date.parse(resumed.deadlineAt!), Date.now() + 4 * MIN);
    assert.equal(resumed.pausedS, 3 * 3600 + 1);
    assert.equal(driver.commands.filter((c) => c.includes('chronyc -a makestep')).length, 3);
    assert.deepEqual(
      resumed.progress.slice(-2).map((p) => p.message),
      ['Exam paused', 'Exam resumed after a 3 h 0 min pause'],
    );

    t.mock.timers.tick(30_000);
    const ended = await sessions.submit();
    assert.equal(ended.lastGrade?.elapsedS, 90);
    assert.equal(ended.pausedS, 3 * 3600 + 1);
    const [attempt] = store.listAttempts();
    assert.equal(attempt.durationS, 90);
    assert.equal(attempt.pausedS, 3 * 3600 + 1);
  });

  it('stays paused across an API restart', async (t) => {
    frozen(t);
    const { sessions, start, store, library } = setup();
    await start('mock');
    t.mock.timers.tick(2 * MIN);
    sessions.pause();
    t.mock.timers.tick(8 * HOUR);
    const restarted = new SessionManager(new RecordingDriver(), store, library, pino({ enabled: false }));
    await restarted.recoverOnStartup();
    const view = restarted.current()!;
    assert.equal(view.state, 'running');
    assert.equal(view.timeLeftMs, 3 * MIN);
    assert.equal(Date.parse((await restarted.resume()).deadlineAt!), Date.now() + 3 * MIN);
  });

  it('stops question time, and refuses to submit or open a question until resumed', async (t) => {
    frozen(t);
    const { sessions, start, store } = setup();
    await start('mock');
    sessions.focus('q1');
    t.mock.timers.tick(20_000);
    sessions.pause();
    // A page that still reports the question while paused adds no time to it.
    sessions.focus('q1');
    t.mock.timers.tick(HOUR);
    await assert.rejects(sessions.submit(), /paused\. Resume it before submitting/);
    assert.throws(() => sessions.openTask('q2'), /paused\. Resume it to open a question/);
    await sessions.resume();
    sessions.focus('q1');
    t.mock.timers.tick(10_000);
    await sessions.end();
    const [attempt] = store.listAttempts();
    assert.equal(attempt.tasks?.find((x) => x.id === 'q1')?.seconds, 30);
    assert.equal(attempt.durationS, 30);
    assert.equal(attempt.pausedS, 3600);
  });

  it('stays paused when the lab does not answer on resume', async (t) => {
    frozen(t);
    const { driver, sessions, start } = setup();
    await start('mock');
    t.mock.timers.tick(MIN);
    sessions.pause();
    t.mock.timers.tick(HOUR);
    driver.down = true;
    await assert.rejects(sessions.resume(), /did not answer, so the exam stays paused \(controlplane: Cannot run commands on controlplane: Connection refused, and 2 more\)/);
    assert.equal(sessions.current()?.timeLeftMs, 4 * MIN);
    driver.down = false;
    t.mock.timers.tick(MIN);
    const resumed = await sessions.resume();
    assert.equal(resumed.pausedAt, undefined);
    assert.equal(Date.parse(resumed.deadlineAt!), Date.now() + 4 * MIN);
  });

  it('an exam abandoned while paused records only the time before the pause', async (t) => {
    frozen(t);
    const { sessions, start, store } = setup();
    await start('mock');
    t.mock.timers.tick(MIN);
    sessions.pause();
    t.mock.timers.tick(2 * HOUR);
    const ended = await sessions.end();
    assert.equal(ended.state, 'completed');
    assert.equal(ended.pausedAt, undefined);
    assert.equal(ended.pausedS, 2 * 3600);
    const [attempt] = store.listAttempts();
    assert.equal(attempt.durationS, 60);
    assert.equal(attempt.pausedS, 2 * 3600);
  });

  it('pauses only an exam with time left, and pausing twice is harmless', async (t) => {
    frozen(t);
    const { sessions, start } = setup();
    await start();
    assert.throws(() => sessions.pause(), /Only an exam can be paused/);
    await assert.rejects(sessions.resume(), /Only an exam/);
    await sessions.end();
    await start('mock');
    const first = sessions.pause();
    t.mock.timers.tick(MIN);
    assert.equal(sessions.pause().pausedAt, first.pausedAt);
    await sessions.resume();
    assert.equal((await sessions.resume()).deadlineAt, new Date(T0 + 6 * MIN).toISOString());
    t.mock.timers.tick(5 * MIN);
    assert.throws(() => sessions.pause(), /Time is up/);
  });
});

/** A lab whose only question rolls between two sibling variants with their own setup and checks. */
function variantSetup() {
  const root = mkdtempSync(join(tmpdir(), 'cka-variants-'));
  const dir = join(root, 'workloads', 'varied');
  mkdirSync(join(dir, 'setup'), { recursive: true });
  mkdirSync(join(dir, 'tasks'));
  const variant = (k: string) => `      ${k}:
        title: Variant ${k}
        setup: [{ node: controlplane, script: setup/${k}.sh }]
        checks: [{ id: ${k}-c, description: check ${k}, type: kubectl, run: echo check-${k}, expect: { equals: '' } }]
        hints: [hint ${k}]`;
  writeFileSync(
    join(dir, 'scenario.yaml'),
    `id: varied
title: Varied
domain: workloads
difficulty: 1
estimatedMinutes: 5
points: 1
base: cluster
settleSeconds: 0
variables:
  KIND: { oneOf: [alpha, beta] }
  NS: { oneOf: [one, two, three] }
tasks:
  - id: q1
    title: Slot
    points: 1
    variant: KIND
    variants:
${variant('alpha')}
${variant('beta')}
`,
  );
  for (const k of ['alpha', 'beta']) {
    writeFileSync(join(dir, 'setup', `${k}.sh`), 'true\n');
    writeFileSync(join(dir, 'tasks', `q1.${k}.md`), `Question ${k} in \${NS}\n`);
  }
  writeFileSync(join(dir, 'solution.sh'), 'true\n');
  writeFileSync(join(dir, 'solution.md'), '<!-- fault KIND=alpha -->\nsolve alpha\n<!-- /fault -->\n<!-- fault KIND=beta -->\nsolve beta\n<!-- /fault -->\n');
  const driver = new RecordingDriver();
  const library = new ScenarioLibrary(root);
  assert.deepEqual(library.errors, []);
  const sessions = new SessionManager(driver, new Store(join(root, 'state.db')), library, pino({ enabled: false }));
  return { driver, sessions, library, dir };
}

describe('task variants', () => {
  it('sets up, shows and grades only the rolled variant', async () => {
    const { driver, sessions } = variantSetup();
    const view = await (await sessions.start('varied', 'practice', { vars: { KIND: 'beta', NS: 'two' } })).ready;
    assert.deepEqual(driver.scripts, ['beta.sh']);
    assert.equal(view.tasks[0].title, 'Variant beta');
    assert.equal(view.tasks[0].markdown, 'Question beta in two\n');
    assert.equal(view.tasks[0].hintsTotal, 1);
    const result = await sessions.grade({ retry: false });
    assert.deepEqual(result.checks.map((c) => c.id), ['beta-c']);
    assert.equal(sessions.solution().solution?.trim(), 'solve beta');
  });

  it('lints every variant', () => {
    const { library, dir } = variantSetup();
    const s = library.get('varied')!;
    assert.deepEqual(lintScenario(s, diskReader(dir), 'varied'), []);
    rmSync(join(dir, 'tasks', 'q1.beta.md'));
    const broken = new ScenarioLibrary(join(dir, '..', '..')).get('varied')!;
    assert.match(lintScenario(broken, diskReader(dir), 'varied').map((i) => i.message).join(), /tasks\/q1.beta.md is missing/);
  });

  it('re-roll rolls new variables, forgets hints and the solution, and sets up again', async () => {
    const { driver, sessions } = variantSetup();
    const store = (sessions as unknown as { store: Store }).store;
    const first = await (await sessions.start('varied', 'practice', { vars: { KIND: 'alpha', NS: 'one' } })).ready;
    assert.equal(first.rerollable, true);
    sessions.hint();
    sessions.solution();
    let view = first;
    for (let i = 0; i < 20 && view.vars.KIND === 'alpha' && view.vars.NS === 'one'; i++) view = await (await sessions.reset({ reroll: true })).ready;
    assert.notDeepEqual(view.vars, { KIND: 'alpha', NS: 'one' });
    assert.equal(view.state, 'running');
    assert.equal(view.solutionViewed, false);
    assert.deepEqual(view.hintsRevealed, []);
    assert.equal(view.tasks[0].title, `Variant ${view.vars.KIND}`);
    assert.equal(driver.scripts[0], 'alpha.sh');
    assert.equal(driver.scripts.at(-1), `${view.vars.KIND}.sh`);
    assert.equal(store.listAttempts().find((a) => a.id === view.attemptId)?.solutionViewed, false);
  });

  it('picks up variables added to scenario.yaml while the API is running', async () => {
    const { sessions, dir } = variantSetup();
    await (await sessions.start('varied', 'practice', { vars: { KIND: 'beta', NS: 'two' } })).ready;
    const file = join(dir, 'scenario.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('variables:\n', 'variables:\n  EXTRA: { oneOf: [x] }\n'));
    const reset = await (await sessions.reset()).ready;
    assert.deepEqual(reset.vars, { EXTRA: 'x', KIND: 'beta', NS: 'two' });
    await sessions.end();
    const started = await (await sessions.start('varied')).ready;
    assert.equal(started.vars.EXTRA, 'x');
  });

  it('only practice sessions can re-roll', async () => {
    const { sessions } = variantSetup();
    const view = await (await sessions.start('varied', 'verify')).ready;
    assert.equal(view.rerollable, false);
    await assert.rejects(sessions.reset({ reroll: true }), /Only a practice session/);
  });
});

describe('playground', () => {
  it('runs a task-free lab on the cluster image that cannot be graded and leaves no history', async () => {
    const { driver, sessions } = setup();
    const store = (sessions as unknown as { store: Store }).store;
    const view = await (await sessions.startPlayground()).ready;
    assert.equal(view.state, 'running');
    assert.equal(view.mode, 'playground');
    assert.equal(view.scenarioTitle, 'Playground');
    assert.equal(view.base, 'cluster');
    assert.deepEqual(view.tasks, []);
    assert.deepEqual(driver.scripts, []);
    assert.ok(view.connection);

    await assert.rejects(sessions.grade(), /no tasks/);
    assert.throws(() => sessions.hint(), /no tasks/);
    assert.throws(() => sessions.solution(), /no tasks/);
    assert.throws(() => sessions.openTask('q1'), /no tasks/);
    await assert.rejects(sessions.start('staged'), /already running/);

    assert.equal((await (await sessions.reset()).ready).state, 'running');
    await sessions.end();
    assert.equal(sessions.current(), null);
    assert.deepEqual(store.listAttempts(), []);
  });

  it('the playground id only starts in playground mode, and vice versa', async () => {
    const { sessions } = setup();
    await assert.rejects(sessions.start('playground', 'practice'), /only be started as a playground/);
    await assert.rejects(sessions.start('staged', 'playground'), /only be started as a playground/);
  });
});

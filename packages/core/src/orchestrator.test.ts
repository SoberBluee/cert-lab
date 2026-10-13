import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, it } from 'node:test';
import pino from 'pino';
import { FakeDriver } from '@cka/driver-fake';
import type { ExecOptions, ExecResult, Mode } from '@cka/schema';
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
  constructor() {
    super(0);
  }
  override async copyIn(_s: string, _n: string, _local: string, remote: string): Promise<void> {
    this.scripts.push(basename(remote).replace(/^\d+-/, ''));
  }
  override async exec(sessionId: string, node: string, command: string, opts?: ExecOptions): Promise<ExecResult> {
    this.commands.push(command);
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
  const sessions = new SessionManager(driver, new Store(join(root, 'state.db')), library, pino({ enabled: false }));
  const start = async (mode: Mode = 'practice') => (await sessions.start('staged', mode)).ready;
  return { driver, sessions, start };
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

  it('reset forgets opened tasks', async () => {
    const { driver, sessions, start } = setup();
    await start();
    await sessions.openTask('q2').ready;
    const view = await (await sessions.reset()).ready;
    assert.deepEqual(readyIds(view), ['q1']);
    assert.deepEqual(driver.scripts, ['q1.sh', 'q2.sh', 'q1.sh']);
  });
});

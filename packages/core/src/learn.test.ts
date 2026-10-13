import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import pino from 'pino';
import { FakeDriver } from '@cka/driver-fake';
import type { ExecOptions, ExecResult, LearnProgress } from '@cka/schema';
import { COMMAND_LOG, commandMatches, initialProgress, LearnWatcher, normalizeCommand, parseCommandLog, type LoggedCommand } from './learn';
import { LessonLibrary, type LoadedLesson } from './lessons';
import { lintLessons } from './lint';
import { ScenarioLibrary } from './scenarios';
import { SessionManager } from './session';
import { Store } from './store';

const quiet = pino({ enabled: false });

describe('command log', () => {
  it('parses complete lines only and keeps tabs out of the command', () => {
    const text = '3\t1700000000\t0\tkubectl get pods\n4\t1700000005\t1\tetcdctl snapshot save x\n5\t17000';
    const { commands, lines } = parseCommandLog('controlplane', text);
    assert.equal(lines, 2);
    assert.deepEqual(commands, [
      { node: 'controlplane', at: 1700000000000, exitCode: 0, command: 'kubectl get pods' },
      { node: 'controlplane', at: 1700000005000, exitCode: 1, command: 'etcdctl snapshot save x' },
    ]);
    assert.deepEqual(parseCommandLog('controlplane', ''), { commands: [], lines: 0 });
  });

  it('strips sudo, env assignments and time, and expands the k alias', () => {
    assert.equal(normalizeCommand('sudo ETCDCTL_API=3 etcdctl snapshot save /x'), 'etcdctl snapshot save /x');
    assert.equal(normalizeCommand('sudo -E env A="b c" time openssl x509 -text'), 'openssl x509 -text');
    assert.equal(normalizeCommand('sudo -u root kubeadm certs renew all'), 'kubeadm certs renew all');
    assert.equal(normalizeCommand('k get pods'), 'kubectl get pods');
    assert.equal(normalizeCommand('kubectl get pods'), 'kubectl get pods');
  });

  it('matches any part of a command chain', () => {
    const step = { match: '^grep\\b.*kube-apiserver\\.yaml' };
    assert.ok(commandMatches(step, 'clear; sudo grep tls /etc/kubernetes/manifests/kube-apiserver.yaml'));
    assert.ok(commandMatches(step, 'cd /etc && sudo grep tls kubernetes/manifests/kube-apiserver.yaml'));
    assert.ok(!commandMatches(step, 'echo grep kube-apiserver.yaml'));
  });
});

describe('shipped lessons', () => {
  const library = new LessonLibrary();

  it('load and lint without errors', () => {
    assert.deepEqual(library.errors, []);
    assert.ok(library.list().length >= 5);
    assert.deepEqual(
      lintLessons().issues.filter((i) => i.level === 'error'),
      [],
    );
  });

  it('match their own reference commands, as typed with sudo or the k alias', () => {
    for (const l of library.list()) {
      for (const s of l.def.steps) {
        if (!s.match) continue;
        const first = s.command.trim().split('\n')[0];
        assert.ok(commandMatches(s, first), `${l.def.id}/${s.id}: /${s.match}/ does not match "${first}"`);
        if (first.startsWith('kubectl ')) assert.ok(commandMatches(s, first.replace(/^kubectl/, 'k')), `${l.def.id}/${s.id}: k alias`);
      }
    }
  });
});

function lessonFixture(): LoadedLesson {
  const root = mkdtempSync(join(tmpdir(), 'cka-lessons-'));
  mkdirSync(join(root, 'demo'));
  writeFileSync(
    join(root, 'demo', 'lesson.yaml'),
    `id: demo
title: Demo
summary: Three steps
topic: etcd
estimatedMinutes: 2
steps:
  - id: a
    title: Run a
    command: echo a
    match: '^echo a$'
  - id: b
    title: Run b, which is checked
    command: echo b
    match: '^echo b$'
    check: { id: b-ok, description: b worked, type: ssh, node: controlplane, run: check-b, expect: { equals: ok } }
  - id: c
    title: Make c true any way you like
    command: echo c > /tmp/c
    check: { id: c-ok, description: c is true, type: ssh, node: controlplane, run: check-c, expect: { equals: ok } }
  - id: d
    title: Fail on purpose
    command: kubectl --context jane get pods
    match: 'get pods'
    allowFailure: true
`,
  );
  const lib = new LessonLibrary(root);
  assert.deepEqual(lib.errors, []);
  return lib.get('demo')!;
}

/** Answers check commands from a table; everything else succeeds with empty output. */
class CheckDriver extends FakeDriver {
  results = new Map<string, string>();
  runs: { node: string; script: string; env?: Record<string, string> }[] = [];
  constructor() {
    super(0);
  }
  override async exec(_s: string, node: string, command: string, opts?: ExecOptions): Promise<ExecResult> {
    this.runs.push({ node, script: command, env: opts?.env });
    return { exitCode: 0, stdout: this.results.get(command) ?? '', stderr: '' };
  }
}

function watcherFixture() {
  const lesson = lessonFixture();
  const driver = new CheckDriver();
  let progress: LearnProgress = initialProgress(lesson);
  let saves = 0;
  const watcher = new LearnWatcher(
    {
      driver,
      log: quiet,
      isRunning: () => true,
      getProgress: () => structuredClone(progress),
      saveProgress: (_id, p) => {
        progress = p;
        saves++;
      },
    },
    's1',
    lesson,
  );
  const cmd = (command: string, exitCode = 0): LoggedCommand => ({ node: 'controlplane', at: Date.now(), exitCode, command });
  return { driver, watcher, cmd, progress: () => progress, saves: () => saves };
}

describe('LearnWatcher', () => {
  it('completes steps in order; a later step does not count early', async () => {
    const f = watcherFixture();
    await f.watcher.consume([f.cmd('echo b'), f.cmd('echo a')]);
    assert.equal(f.progress().current, 1);
    assert.deepEqual(f.progress().steps[0], {
      id: 'a',
      done: true,
      doneAt: f.progress().steps[0].doneAt,
      failure: undefined,
      attempt: undefined,
      lastCommand: 'echo a',
    });
    assert.equal(f.progress().steps[1].done, false);
  });

  it("ignores failed commands and other nodes, and says why they didn't count", async () => {
    const f = watcherFixture();
    await f.watcher.consume([f.cmd('echo a', 1)]);
    assert.deepEqual(f.progress().steps[0].attempt, { command: 'echo a', reason: 'it failed with exit code 1' });
    await f.watcher.consume([{ ...f.cmd('echo a'), node: 'worker-1' }]);
    assert.deepEqual(f.progress().steps[0].attempt, { command: 'echo a', reason: 'it ran on worker-1; this step is on controlplane' });
    await f.watcher.consume([f.cmd('ls')]);
    assert.deepEqual(f.progress().steps[0].attempt, { command: 'ls', reason: "it isn't this step's command" });
    assert.equal(f.progress().current, 0);
  });

  it('reports a failing check, then re-checks after later commands', async () => {
    const f = watcherFixture();
    await f.watcher.consume([f.cmd('sudo echo a'), f.cmd('echo b')]);
    assert.equal(f.progress().current, 1);
    assert.equal(f.progress().steps[1].lastCommand, 'echo b');
    assert.match(f.progress().steps[1].failure ?? '', /^b worked: /);

    f.driver.results.set('check-b', 'ok');
    await f.watcher.consume([f.cmd('ls')]);
    assert.equal(f.progress().current, 2);
    assert.equal(f.progress().steps[1].failure, undefined);
  });

  it('checks a check-only step after any command, and accepts expected failures', async () => {
    const f = watcherFixture();
    f.driver.results.set('check-b', 'ok');
    await f.watcher.consume([f.cmd('echo a'), f.cmd('echo b'), f.cmd('vim /tmp/c')]);
    assert.equal(f.progress().current, 2);
    assert.match(f.progress().steps[2].failure ?? '', /c is true/);

    f.driver.results.set('check-c', 'ok');
    await f.watcher.consume([f.cmd('cat /tmp/c'), f.cmd('k --context jane get pods', 1)]);
    assert.equal(f.progress().current, 4);
    assert.ok(f.progress().completedAt);
  });

  it('skips the current step by running its command as the learner, without logging it', async () => {
    const f = watcherFixture();
    await f.watcher.skip();
    assert.equal(f.progress().current, 1);
    assert.equal(f.progress().steps[0].skipped, true);
    const run = f.driver.runs.find((r) => r.env?.CKA_LEARN_CMD);
    assert.equal(run?.env?.CKA_LEARN_CMD, 'echo a');
    assert.match(run!.script, /sudo -u ubuntu/);
    assert.doesNotMatch(run!.script, new RegExp(COMMAND_LOG));
  });

  it('reads the log incrementally from each node', async () => {
    const f = watcherFixture();
    f.driver.results.set(`tail -n +1 ${COMMAND_LOG} 2>/dev/null || true`, '1\t1700000000\t0\techo a\n');
    await f.watcher.tick();
    assert.equal(f.progress().current, 1);
    f.driver.results.set(`tail -n +2 ${COMMAND_LOG} 2>/dev/null || true`, '2\t1700000001\t0\techo b\n');
    f.driver.results.set('check-b', 'ok');
    await f.watcher.tick();
    assert.equal(f.progress().current, 2);
  });
});

describe('learn sessions', () => {
  function setup() {
    const lesson = lessonFixture();
    const root = mkdtempSync(join(tmpdir(), 'cka-learn-'));
    const driver = new CheckDriver();
    const commands: string[] = [];
    const exec = driver.exec.bind(driver);
    driver.exec = async (s, n, command, opts) => {
      commands.push(command);
      return exec(s, n, command, opts);
    };
    const sessions = new SessionManager(driver, new Store(join(root, 'state.db')), new ScenarioLibrary(root), quiet, new LessonLibrary(join(lesson.dir, '..')));
    return { sessions, commands };
  }

  it('installs the command hook on every node and shows the lesson', async () => {
    const { sessions, commands } = setup();
    const view = await (await sessions.startLesson('demo')).ready;
    assert.equal(view.state, 'running');
    assert.equal(view.mode, 'learn');
    assert.equal(view.scenarioId, 'learn:demo');
    assert.equal(view.lesson?.steps.length, 4);
    assert.deepEqual(view.learn, { current: 0, steps: ['a', 'b', 'c', 'd'].map((id) => ({ id, done: false })) });
    assert.equal(commands.filter((c) => c.includes('# >>> cka-lab command log >>>')).length, 3);
    await assert.rejects(sessions.grade(), /steps, not tasks/);
    await sessions.end();
  });

  it('skips steps and starts over on reset', async () => {
    const { sessions } = setup();
    await (
      await sessions.startLesson('demo')
    ).ready;
    const skipped = await sessions.skipLearnStep();
    assert.equal(skipped.learn?.current, 1);
    const view = await (await sessions.reset()).ready;
    assert.equal(view.learn?.current, 0);
    await sessions.end();
  });

  it('rejects unknown lessons and mixing lessons with other modes', async () => {
    const { sessions } = setup();
    assert.throws(() => sessions.startLesson('nope'), /Unknown lesson "nope"/);
    await assert.rejects(sessions.start('learn:demo', 'practice'), /learn mode/);
  });
});

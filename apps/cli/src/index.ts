import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  createOrchestrator,
  createScenario,
  dataDir,
  dryRun,
  lintLessons,
  lintQuizzes,
  lintScenarios,
  logFile,
  readImagesMeta,
  repoRoot,
  runAsLearner,
  selectDriverName,
  verify,
  type Orchestrator,
} from '@cka/core';
import { visibleVars, type ConnectionInfo, type GradeResult, type SessionView, type Vars } from '@cka/schema';

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

let orch: Orchestrator | undefined;
const o = () => (orch ??= createOrchestrator('cli'));

function fail(message: string, code = 1): never {
  console.error(c.red(`error: ${message}`));
  console.error(c.dim(`log: ${logFile}`));
  process.exit(code);
}

/** Wraps an action so errors print readably and the process always exits. */
const action =
  <A extends unknown[]>(fn: (...args: A) => Promise<number | void> | number | void) =>
  async (...args: A) => {
    try {
      const code = await fn(...args);
      process.exit(code ?? 0);
    } catch (e) {
      fail((e as Error).message);
    }
  };

/** Prints provisioning progress lines as they arrive. Returns an unsubscribe function. */
function followProgress(): () => void {
  let printed = 0;
  const onChange = (v: SessionView | null) => {
    if (!v) return;
    if (v.progress.length < printed) printed = 0;
    for (const line of v.progress.slice(printed)) {
      console.log(`${c.dim(new Date(line.at).toLocaleTimeString())} ${line.message}`);
    }
    printed = v.progress.length;
  };
  o().sessions.on('change', onChange);
  return () => o().sessions.off('change', onChange);
}

function printConnection(conn?: ConnectionInfo) {
  if (!conn) return;
  console.log(c.bold('\nConnect'));
  for (const n of conn.nodes) console.log(`  ${n.name.padEnd(13)} ${c.cyan(n.sshCommand)}`);
  if (conn.exportLine) console.log(`\n  ${c.cyan(conn.exportLine)}`);
}

/** `blind` prints scores only: check descriptions name what is still wrong. */
function printGrade(r: GradeResult, blind = false) {
  console.log(c.bold('\nResults'));
  const byId = new Map(r.checks.map((ch) => [ch.id, ch]));
  const groups = r.tasks && r.tasks.length > 1 ? r.tasks : [{ title: '', checkIds: r.checks.map((ch) => ch.id), score: 0, maxScore: 0 }];
  for (const g of groups) {
    if (g.title) console.log(`  ${c.bold(g.title)} ${c.dim(`${g.score}/${g.maxScore}`)}`);
    if (blind) continue;
    for (const ch of g.checkIds.map((id) => byId.get(id)!)) {
      const mark = ch.passed ? c.green('PASS') : c.red('FAIL');
      console.log(`  ${mark} ${ch.description} ${c.dim(`(${ch.weight} pt)`)}`);
      if (!ch.passed) console.log(`       ${c.dim(ch.detail)}`);
    }
  }
  const total = `${r.score}/${r.maxScore} (${r.percent}%)`;
  console.log(`\n  Score ${r.allPassed ? c.green(total) : c.yellow(total)}  ${c.dim(`time ${formatDuration(r.elapsedS)}`)}`);
  if (blind) console.log(c.dim('  Blind grading: run "cka grade" without --blind, or view the solution, to see the checks.'));
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
}

async function awaitReady(ready: Promise<SessionView>): Promise<SessionView> {
  const stop = followProgress();
  const view = await ready;
  stop();
  if (view.state === 'failed') fail(`provisioning failed: ${view.error}`);
  return view;
}

function printTask(view: SessionView, only?: number) {
  console.log(c.bold(`\n${view.scenarioTitle}`) + c.dim(`  [${view.scenarioId}]`));
  const multi = view.tasks.length > 1;
  view.tasks.forEach((t, i) => {
    if (only !== undefined && i !== only) return;
    if (multi) console.log(c.bold(`\nQuestion ${i + 1}: ${t.title}`) + c.dim(` (${t.points} pt)`));
    if (!t.ready) console.log(c.yellow(`\nNot set up yet. Run ./cka task ${i + 1} when you start this question.`));
    console.log('\n' + t.markdown.trim());
  });
  printConnection(view.connection);
  console.log(c.dim('\nWhen done: ./cka grade   (hints: ./cka hint, retry: ./cka reset, finish: ./cka end)'));
}

const program = new Command().name('cka').description('CKA practice lab: start scenarios on real VMs, then grade the end state').showHelpAfterError();

program
  .command('list')
  .description('list scenarios')
  .action(
    action(() => {
      const stats = o().store.scenarioStats();
      for (const s of o().library.list()) {
        const best = stats.get(s.def.id)?.bestPercent;
        const bestStr = best === undefined ? c.dim('  -  ') : `${String(best).padStart(3)}%`;
        console.log(`${bestStr}  ${s.def.domain.padEnd(21)} ${'*'.repeat(s.def.difficulty).padEnd(3)} ${s.def.id.padEnd(28)} ${s.def.title}`);
      }
      for (const e of o().library.errors) console.log(c.red(`invalid: ${e.file} (run ./cka lint)`));
    }),
  );

program
  .command('start <id>')
  .description('restore the base snapshot, run setup and print the task')
  .option('--exam', 'exam mode: no hints or solution, a deadline, and one ./cka submit at the end')
  .action(
    action(async (id: string, opts: { exam?: boolean }) => {
      const { ready } = await o().sessions.start(id, opts.exam ? 'mock' : 'practice');
      const view = await awaitReady(ready);
      printTask(view);
      if (view.deadlineAt) console.log(c.yellow(`\nExam mode: submit with ./cka submit before ${new Date(view.deadlineAt).toLocaleTimeString()}`));
    }),
  );

program
  .command('playground')
  .description('start a 3-node cluster with no tasks, to practise freely')
  .option('--install', 'plain Ubuntu nodes with nothing of Kubernetes on them, to install a cluster yourself')
  .action(
    action(async (opts: { install?: boolean }) => {
      const { ready } = await o().sessions.startPlayground(opts.install ? 'install' : 'cluster');
      const view = await awaitReady(ready);
      if (opts.install) {
        console.log(c.bold('\nInstall playground ready') + c.dim('  Ubuntu nodes with no container runtime, kubeadm, kubelet or kubectl'));
      } else {
        console.log(c.bold('\nPlayground ready') + c.dim('  Calico, Traefik (Ingress and Gateway API on :30080), Helm, crictl, etcdctl'));
      }
      printConnection(view.connection);
      console.log(c.dim(`\nReset to ${opts.install ? 'clean nodes' : 'a clean cluster'}: ./cka reset   finish: ./cka end`));
    }),
  );

program
  .command('status')
  .description('show the current session')
  .action(
    action(() => {
      const v = o().sessions.current();
      if (!v) return console.log('No active session.');
      console.log(`${c.bold(v.scenarioTitle)} ${c.dim(v.scenarioId)}  state=${v.state}  mode=${v.mode}`);
      if (v.error) console.log(c.red(v.error));
      if (v.pausedAt) console.log(c.yellow(`exam paused, ${formatDuration(Math.round((v.timeLeftMs ?? 0) / 1000))} left (./cka resume)`));
      else if (v.readyAt) console.log(`elapsed ${formatDuration(Math.round((Date.now() - Date.parse(v.readyAt)) / 1000) - (v.pausedS ?? 0))}`);
      const waiting = v.tasks.flatMap((t, i) => (t.ready ? [] : [i + 1]));
      if (v.preparingTask) console.log(c.yellow(`setting up ${v.preparingTask}`));
      if (waiting.length) console.log(c.dim(`not set up yet: question ${waiting.join(', ')} (./cka task <n> sets one up)`));
      printConnection(v.connection);
      if (v.lastGrade) printGrade(v.lastGrade);
    }),
  );

program
  .command('task [n]')
  .description('print the task of the current session; with n, set up question n if needed and print only it')
  .action(
    action(async (n?: string) => {
      const v = o().sessions.current();
      if (!v) return console.log('No active session.');
      if (n === undefined) return printTask(v);
      const i = Number(n) - 1;
      const task = v.tasks[i];
      if (!task) fail(`There is no question ${n}; this session has ${v.tasks.length}.`);
      const { ready } = o().sessions.openTask(task.id);
      const view = await awaitReady(ready);
      printTask(view, i);
    }),
  );

program
  .command('grade')
  .description('run the checks against the lab')
  .option('--blind', 'print the score only, not which checks failed (the exam gives no feedback)')
  .action(
    action(async (opts: { blind?: boolean }) => {
      console.log(c.dim('Grading...'));
      printGrade(await o().sessions.grade(), opts.blind);
    }),
  );

program
  .command('submit')
  .description('exam mode: grade once, then end the session and stop the VMs')
  .action(
    action(async () => {
      console.log(c.dim('Submitting...'));
      const view = await o().sessions.submit();
      if (view.lastGrade) printGrade(view.lastGrade);
    }),
  );

program
  .command('pause')
  .description('exam mode: stop the clock until ./cka resume; the lab keeps running')
  .action(
    action(() => {
      const v = o().sessions.pause();
      console.log(`Exam paused with ${formatDuration(Math.round((v.timeLeftMs ?? 0) / 1000))} left. Continue with ./cka resume.`);
    }),
  );

program
  .command('resume')
  .description('exam mode: check the lab, then restart the clock with the time that was left')
  .action(
    action(async () => {
      console.log(c.dim('Checking the lab...'));
      const v = await o().sessions.resume();
      if (v.deadlineAt) console.log(`Exam resumed. Submit with ./cka submit before ${new Date(v.deadlineAt).toLocaleTimeString()}.`);
    }),
  );

program
  .command('reset')
  .description('restore the snapshot and re-run setup')
  .option('--reroll', 'roll new variables first, for a different variant of the question')
  .action(
    action(async (opts: { reroll?: boolean }) => {
      const { ready } = await o().sessions.reset({ reroll: opts.reroll });
      printTask(await awaitReady(ready));
    }),
  );

program
  .command('hint [task]')
  .description('reveal the next hint (of a task id, for multi-task scenarios)')
  .action(
    action((taskId?: string) => {
      const before = o().sessions.current();
      const v = o().sessions.hint(taskId);
      const t = v.tasks.find((t, i) => t.hintsRevealed.length > (before?.tasks[i]?.hintsRevealed.length ?? 0)) ?? v.tasks[0];
      const label = v.tasks.length > 1 ? `${t.title}: hint` : 'Hint';
      console.log(`${label} ${t.hintsRevealed.length}/${t.hintsTotal}: ${t.hintsRevealed.at(-1)}`);
    }),
  );

program
  .command('solution')
  .description('reveal the solution (marks the attempt as assisted)')
  .action(
    action(() => {
      console.log(o().sessions.solution().solution ?? '');
    }),
  );

program
  .command('end')
  .description('end the session and stop the lab VMs')
  .option('--keep-vms', 'leave the VMs running')
  .action(
    action(async (opts: { keepVms?: boolean }) => {
      const v = await o().sessions.end({ stopVms: !opts.keepVms });
      console.log(`Ended ${v.scenarioId}.${opts.keepVms ? '' : ' Lab VMs stopped.'}`);
    }),
  );

program
  .command('connection')
  .description('print ssh commands and the KUBECONFIG export line')
  .action(
    action(() => {
      const v = o().sessions.current();
      if (!v?.connection) return console.log('No running session.');
      printConnection(v.connection);
    }),
  );

program
  .command('new <path>')
  .description('scaffold a scenario: cka new <domain>/<id>')
  .action(
    action((path: string) => {
      const [domain, id, ...rest] = path.split('/');
      if (!domain || !id || rest.length) fail('expected <domain>/<id>, e.g. troubleshooting/ts-coredns-broken');
      const dir = createScenario(domain, id);
      console.log(`Created ${dir}`);
      console.log(c.dim('Next: edit scenario.yaml, task.md, setup/, solution.sh; then ./cka lint && ./cka dry-run ' + id));
    }),
  );

program
  .command('lint')
  .description('validate every scenario against the schema and check referenced scripts')
  .action(
    action(() => {
      const { issues: scenarioIssues, scenarioCount } = lintScenarios();
      const { issues: lessonIssues, lessonCount } = lintLessons();
      const { issues: quizIssues, quizCount } = lintQuizzes();
      const issues = [...scenarioIssues, ...lessonIssues, ...quizIssues];
      for (const i of issues) {
        const tag = i.level === 'error' ? c.red('error  ') : c.yellow('warning');
        console.log(`${tag} ${i.where}: ${i.message}`);
      }
      const errors = issues.filter((i) => i.level === 'error').length;
      const warnings = issues.length - errors;
      console.log(`\n${scenarioCount} scenarios, ${lessonCount} lessons, ${quizCount} quizzes, ${errors} errors, ${warnings} warnings`);
      return errors ? 1 : 0;
    }),
  );

const learn = program.command('learn').description('guided lessons: list, start, or verify that a lesson completes');

learn
  .command('list')
  .description('list lessons')
  .action(
    action(() => {
      for (const l of o().lessons.list()) {
        console.log(
          `${l.def.track.padEnd(6)} ${l.def.topic.padEnd(13)} ${l.def.id.padEnd(18)} ${l.def.title} ${c.dim(`(${l.def.steps.length} steps, ~${l.def.estimatedMinutes} min)`)}`,
        );
      }
      for (const e of o().lessons.errors) console.log(c.red(`invalid: ${e.file} (run ./cka lint)`));
    }),
  );

learn
  .command('start <id>')
  .description('start a lesson; follow its steps in the web UI (Learn)')
  .action(
    action(async (id: string) => {
      const { ready } = await o().sessions.startLesson(id);
      const view = await awaitReady(ready);
      view.lesson?.steps.forEach((s, i) =>
        console.log(`${String(i + 1).padStart(2)}. ${s.title}\n    ${s.question ? c.yellow(`? ${s.question.prompt.trim()}`) : c.cyan((s.command ?? '').trim().split('\n').join('\n    '))}`),
      );
      printConnection(view.connection);
      console.log(c.dim('\nOpen the web UI to see steps turn green as you run them.'));
    }),
  );

learn
  .command('verify <id>')
  .description("start a lesson, run each step's reference command as the learner, and check that every step completes")
  .option('--keep', 'leave the lab running afterwards')
  .action(
    action(async (id: string, opts: { keep?: boolean }) => {
      const lesson = o().lessons.get(id);
      if (!lesson) fail(`Unknown lesson "${id}".`);
      const { view: started, ready } = await o().sessions.startLesson(id);
      await awaitReady(ready);
      const progress = () => o().store.getSession(started.id)?.learnProgress;
      let failed = 0;
      for (const [i, step] of lesson.def.steps.entries()) {
        // Questions are answered in the pane: give the right answer and check that it counts.
        if (step.question || step.command === undefined) {
          if (step.question) await o().sessions.answerLearnStep(step.question.answer);
          const ok = progress()?.steps[i]?.done;
          if (!ok) failed++;
          console.log(`${ok ? c.green('DONE') : c.red('FAIL')} ${String(i + 1).padStart(2)}. ${step.title} ${c.dim('(question)')}`);
          continue;
        }
        const command = step.command;
        const t0 = Date.now();
        const deadline = t0 + ((step.check?.retrySeconds ?? 0) + 150) * 1000;
        let r = await runAsLearner(o().driver, started.id, step.node, command);
        let lastRun = Date.now();
        while (!progress()?.steps[i]?.done && Date.now() < deadline) {
          await new Promise((res) => setTimeout(res, 1000));
          if (Date.now() - lastRun > 15_000) {
            r = await runAsLearner(o().driver, started.id, step.node, command);
            lastRun = Date.now();
          }
        }
        const p = progress()?.steps[i];
        const secs = `${Math.round((Date.now() - t0) / 1000)}s`;
        if (p?.done) {
          console.log(`${c.green('DONE')} ${String(i + 1).padStart(2)}. ${step.title} ${c.dim(secs)}`);
        } else {
          failed++;
          console.log(`${c.red('FAIL')} ${String(i + 1).padStart(2)}. ${step.title} ${c.dim(secs)}`);
          console.log(c.dim(`       exit ${r.exitCode}: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ')}`));
          if (p?.failure) console.log(c.dim(`       ${p.failure}`));
          await o().sessions.skipLearnStep();
        }
      }
      console.log(
        failed ? c.red(`\n${failed} of ${lesson.def.steps.length} steps did not complete`) : c.green(`\nAll ${lesson.def.steps.length} steps completed`),
      );
      if (!opts.keep) await o().sessions.end();
      return failed ? 1 : 0;
    }),
  );

type AuthoringFn = typeof dryRun;

function collectVar(pair: string, acc: Vars): Vars {
  const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(pair);
  if (!m) fail(`--var expects NAME=value, got "${pair}"`);
  return { ...acc, [m[1]]: m[2] };
}

function printVars(vars: Vars) {
  const entries = Object.entries(vars);
  if (entries.length) console.log(c.dim(`\nvariables: ${entries.map(([k, v]) => `${k}=${v}`).join(' ')}`));
}

/** Every value a variable can take, for --each. */
function eachValues(id: string, name: string): string[] {
  const def = o().library.get(id)?.def.variables[name] ?? fail(`scenario "${id}" declares no variable ${name}`);
  if ('oneOf' in def) return def.oneOf.map(String);
  if ('range' in def) return Array.from({ length: def.range[1] - def.range[0] + 1 }, (_, i) => String(def.range[0] + i));
  if ('node' in def) return def.node === 'any' ? ['controlplane', 'worker-1', 'worker-2'] : ['worker-1', 'worker-2'];
  return fail(`${name} is a random string; --each needs oneOf, range or node`);
}

const authoringCommand = (name: string, fn: AuthoringFn, describe: string, passText: string, failText: string) =>
  program
    .command(`${name} [id]`)
    .description(describe)
    .option('--all', 'run for every scenario')
    .option('--keep', 'leave the session running afterwards')
    .option('--var <NAME=value>', 'pin a variable instead of rolling it (repeatable)', collectVar, {})
    .option('--each <NAME>', 'run once per possible value of a variable, e.g. every fault of a troubleshooting question')
    .action(
      action(async (id: string | undefined, opts: { all?: boolean; keep?: boolean; var: Vars; each?: string }) => {
        const ids = opts.all
          ? o()
              .library.list()
              .map((s) => s.def.id)
          : id
            ? [id]
            : fail('give a scenario id or --all');
        if (opts.all && Object.keys(opts.var).length) fail('--var applies to a single scenario, not --all');
        if (opts.all && opts.each) fail('--each applies to a single scenario, not --all');
        if (opts.each && opts.keep) fail('--keep cannot be combined with --each');
        const runs = opts.each
          ? eachValues(ids[0], opts.each).map((v) => ({ sid: ids[0], vars: { ...opts.var, [opts.each!]: v }, label: `${ids[0]} ${opts.each}=${v}` }))
          : ids.map((sid) => ({ sid, vars: opts.var, label: sid }));
        const summary: [string, boolean][] = [];
        for (const run of runs) {
          console.log(c.bold(`\n== ${name} ${run.label}`));
          const stop = followProgress();
          try {
            const { ok, result, vars } = await fn(o().sessions, run.sid, { keep: opts.keep && runs.length === 1, vars: run.vars });
            // A dry-run applies no solution, so hidden values that were rolled rather than pinned stay hidden.
            const variables = o().library.get(run.sid)?.def.variables;
            printVars(name === 'dry-run' ? { ...visibleVars(vars, variables), ...run.vars } : vars);
            printGrade(result);
            console.log(ok ? c.green(`\n${name} OK: ${passText}`) : c.red(`\n${name} FAILED: ${failText}`));
            summary.push([run.label, ok]);
          } catch (e) {
            console.log(c.red(`\n${name} ERROR: ${(e as Error).message}`));
            summary.push([run.label, false]);
          } finally {
            stop();
          }
        }
        if (runs.length > 1) {
          console.log(c.bold('\nSummary'));
          for (const [label, ok] of summary) console.log(`  ${ok ? c.green('OK  ') : c.red('FAIL')} ${label}`);
        }
        return summary.every(([, ok]) => ok) ? 0 : 1;
      }),
    );

authoringCommand(
  'dry-run',
  dryRun,
  'start a scenario and grade before any fix; it must fail',
  'the break works and the checks are not vacuous',
  'grading passed without a fix, so the setup or checks are wrong',
);
authoringCommand(
  'verify',
  verify,
  'start a scenario, apply its solution and grade; it must pass',
  'the checks are satisfiable',
  'the solution did not satisfy every check',
);

const images = program.command('images').description('manage base images');
images
  .command('build')
  .description('build the lab VMs and their bare, cluster and os base images (15-25 minutes)')
  .option('--force', 'delete and rebuild existing lab VMs')
  .option('--driver <name>', 'VM backend: multipass or tart (default: CKA_DRIVER, then the existing images, then multipass)')
  .action(
    action((opts: { force?: boolean; driver?: string }) => {
      const driver = opts.driver ?? selectDriverName();
      if (driver !== 'multipass' && driver !== 'tart') fail(`images can only be built for the multipass or tart driver, not "${driver}"`);
      return new Promise<number>((resolve) => {
        const script = join(repoRoot, 'tools', 'build-base-images', 'build.sh');
        const p = spawn('bash', [script, ...(opts.force ? ['--force'] : [])], { stdio: 'inherit', env: { ...process.env, CKA_DRIVER: driver } });
        p.on('close', (code) => resolve(code ?? 1));
      });
    }),
  );
images
  .command('extras')
  .description('add the upgrade packages and the local-path provisioner to existing images, without a rebuild (5-10 minutes)')
  .option('--driver <name>', 'VM backend: multipass or tart (default: CKA_DRIVER, then the existing images, then multipass)')
  .action(
    action((opts: { driver?: string }) => {
      const driver = opts.driver ?? selectDriverName();
      if (driver !== 'multipass' && driver !== 'tart') fail(`images can only be extended for the multipass or tart driver, not "${driver}"`);
      return new Promise<number>((resolve) => {
        const script = join(repoRoot, 'tools', 'build-base-images', 'extras.sh');
        const p = spawn('bash', [script], { stdio: 'inherit', env: { ...process.env, CKA_DRIVER: driver } });
        p.on('close', (code) => resolve(code ?? 1));
      });
    }),
  );
images
  .command('os')
  .description('add the plain Ubuntu image of the install playground to existing images, without a rebuild (about 5 minutes)')
  .option('--driver <name>', 'VM backend: multipass or tart (default: CKA_DRIVER, then the existing images, then multipass)')
  .action(
    action((opts: { driver?: string }) => {
      const driver = opts.driver ?? selectDriverName();
      if (driver !== 'multipass' && driver !== 'tart') fail(`images can only be extended for the multipass or tart driver, not "${driver}"`);
      return new Promise<number>((resolve) => {
        const script = join(repoRoot, 'tools', 'build-base-images', 'os.sh');
        const p = spawn('bash', [script], { stdio: 'inherit', env: { ...process.env, CKA_DRIVER: driver } });
        p.on('close', (code) => resolve(code ?? 1));
      });
    }),
  );
images
  .command('list')
  .description('show which base images exist')
  .action(
    action(async () => {
      const active = readImagesMeta(dataDir)?.driver ?? 'multipass';
      console.log(c.dim(`driver: ${o().driver.name}${active !== o().driver.name ? ` (last images built with ${active})` : ''}`));
      for (const img of await o().driver.listBaseImages()) {
        const state = img.available ? c.green('available') : c.red('missing');
        console.log(`${img.name.padEnd(8)} ${state}  ${c.dim(img.kubernetesVersion ? `k8s ${img.kubernetesVersion}, built ${img.builtAt}` : '')}`);
      }
    }),
  );

process.on('SIGINT', () => {
  console.error(c.yellow('\nInterrupted. If a session was provisioning, run ./cka end or ./cka reset.'));
  process.exit(130);
});

program.parseAsync(process.argv);

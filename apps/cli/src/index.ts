import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  createOrchestrator,
  createScenario,
  dryRun,
  lintScenarios,
  logFile,
  repoRoot,
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

function printGrade(r: GradeResult) {
  console.log(c.bold('\nResults'));
  const byId = new Map(r.checks.map((ch) => [ch.id, ch]));
  const groups = r.tasks && r.tasks.length > 1 ? r.tasks : [{ title: '', checkIds: r.checks.map((ch) => ch.id), score: 0, maxScore: 0 }];
  for (const g of groups) {
    if (g.title) console.log(`  ${c.bold(g.title)} ${c.dim(`${g.score}/${g.maxScore}`)}`);
    for (const ch of g.checkIds.map((id) => byId.get(id)!)) {
      const mark = ch.passed ? c.green('PASS') : c.red('FAIL');
      console.log(`  ${mark} ${ch.description} ${c.dim(`(${ch.weight} pt)`)}`);
      if (!ch.passed) console.log(`       ${c.dim(ch.detail)}`);
    }
  }
  const total = `${r.score}/${r.maxScore} (${r.percent}%)`;
  console.log(`\n  Score ${r.allPassed ? c.green(total) : c.yellow(total)}  ${c.dim(`time ${formatDuration(r.elapsedS)}`)}`);
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

function printTask(view: SessionView) {
  console.log(c.bold(`\n${view.scenarioTitle}`) + c.dim(`  [${view.scenarioId}]`));
  const multi = view.tasks.length > 1;
  view.tasks.forEach((t, i) => {
    if (multi) console.log(c.bold(`\nQuestion ${i + 1}: ${t.title}`) + c.dim(` (${t.points} pt)`));
    console.log('\n' + t.markdown.trim());
  });
  printConnection(view.connection);
  console.log(c.dim('\nWhen done: ./cka grade   (hints: ./cka hint, retry: ./cka reset, finish: ./cka end)'));
}

const program = new Command()
  .name('cka')
  .description('CKA practice lab: start scenarios on real VMs, then grade the end state')
  .showHelpAfterError();

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
  .action(
    action(async (id: string) => {
      const { ready } = await o().sessions.start(id, 'practice');
      printTask(await awaitReady(ready));
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
      if (v.readyAt) console.log(`elapsed ${formatDuration(Math.round((Date.now() - Date.parse(v.readyAt)) / 1000))}`);
      printConnection(v.connection);
      if (v.lastGrade) printGrade(v.lastGrade);
    }),
  );

program
  .command('task')
  .description('print the task of the current session')
  .action(
    action(() => {
      const v = o().sessions.current();
      if (!v) return console.log('No active session.');
      printTask(v);
    }),
  );

program
  .command('grade')
  .description('run the checks against the lab')
  .action(
    action(async () => {
      console.log(c.dim('Grading...'));
      printGrade(await o().sessions.grade());
    }),
  );

program
  .command('reset')
  .description('restore the snapshot and re-run setup')
  .action(
    action(async () => {
      const { ready } = await o().sessions.reset();
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
      const { issues, scenarioCount } = lintScenarios();
      for (const i of issues) {
        const tag = i.level === 'error' ? c.red('error  ') : c.yellow('warning');
        console.log(`${tag} ${i.where}: ${i.message}`);
      }
      const errors = issues.filter((i) => i.level === 'error').length;
      const warnings = issues.length - errors;
      console.log(`\n${scenarioCount} scenarios, ${errors} errors, ${warnings} warnings`);
      return errors ? 1 : 0;
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
        const ids = opts.all ? o().library.list().map((s) => s.def.id) : id ? [id] : fail('give a scenario id or --all');
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
  .description('build the lab VMs and their bare/cluster snapshots (15-25 minutes)')
  .option('--force', 'delete and rebuild existing lab VMs')
  .action(
    action(
      (opts: { force?: boolean }) =>
        new Promise<number>((resolve) => {
          const script = join(repoRoot, 'tools', 'build-base-images', 'build.sh');
          const p = spawn('bash', [script, ...(opts.force ? ['--force'] : [])], { stdio: 'inherit' });
          p.on('close', (code) => resolve(code ?? 1));
        }),
    ),
  );
images
  .command('list')
  .description('show which base snapshots exist')
  .action(
    action(async () => {
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

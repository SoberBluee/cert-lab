import { join } from 'node:path';
import type { Check, CheckResult, Driver, ExecResult, Expect, TaskScore, Vars } from '@cka/schema';
import type { LoadedScenario } from './scenarios';

export const ADMIN_KUBECONFIG = { KUBECONFIG: '/etc/kubernetes/admin.conf' };
const RETRY_INTERVAL_MS = 3000;
const CHECK_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 2000;
/** Below sshd's default MaxStartups (10), past which new connections are dropped. */
const MAX_PARALLEL_EXECS = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Limit = <T>(fn: () => Promise<T>) => Promise<T>;

export function limiter(n: number): Limit {
  let active = 0;
  const queue: (() => void)[] = [];
  return async (fn) => {
    if (active < n) active++;
    else await new Promise<void>((r) => queue.push(r));
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const short = (s: string, n = 120) => (s.length > n ? s.slice(0, n) + '...' : s);

export interface Evaluation {
  passed: boolean;
  detail: string;
}

/** Applies every operator in `expect`; all must hold. Comparisons use trimmed stdout. */
export function evaluate(expect: Expect, r: ExecResult): Evaluation {
  const out = r.stdout.trim();
  const fail = (detail: string) => ({ passed: false, detail });

  if (expect.exitCode !== undefined && r.exitCode !== expect.exitCode) {
    return fail(`exit code ${r.exitCode}, expected ${expect.exitCode}`);
  }
  if (expect.equals !== undefined && out !== expect.equals.trim()) {
    return fail(`got "${short(out)}", expected "${short(expect.equals)}"`);
  }
  if (expect.contains !== undefined && !out.includes(expect.contains)) {
    return fail(`output does not contain "${short(expect.contains)}"`);
  }
  if (expect.notContains !== undefined && out.includes(expect.notContains)) {
    return fail(`output contains "${short(expect.notContains)}"`);
  }
  if (expect.matches !== undefined && !new RegExp(expect.matches, 'm').test(out)) {
    return fail(`output does not match /${short(expect.matches)}/`);
  }
  if (expect.notEmpty !== undefined && out.length > 0 !== expect.notEmpty) {
    return fail(expect.notEmpty ? 'output is empty' : `expected empty output, got "${short(out)}"`);
  }
  if (expect.gte !== undefined || expect.lte !== undefined) {
    const n = Number(out);
    if (out === '' || Number.isNaN(n)) return fail(`output "${short(out)}" is not a number`);
    if (expect.gte !== undefined && n < expect.gte) return fail(`${n} is less than ${expect.gte}`);
    if (expect.lte !== undefined && n > expect.lte) return fail(`${n} is greater than ${expect.lte}`);
  }
  return { passed: true, detail: 'ok' };
}

interface Plan {
  node: string;
  command: string;
  expect: Expect;
  env?: Record<string, string>;
}

const remoteCheckPath = (id: string) => `/tmp/cka-checks/${id}.sh`;

function planCheck(check: Check): Plan {
  switch (check.type) {
    case 'kubectl':
      return { node: 'controlplane', command: check.run, expect: check.expect, env: ADMIN_KUBECONFIG };
    case 'ssh':
      return { node: check.node, command: check.run, expect: check.expect, env: ADMIN_KUBECONFIG };
    case 'script':
      return {
        node: check.node,
        command: `bash ${remoteCheckPath(check.id)} ${check.args.map(shq).join(' ')}`,
        expect: check.expect ?? { exitCode: 0 },
        env: ADMIN_KUBECONFIG,
      };
    case 'file': {
      const p = shq(check.path);
      if (!check.exists) return { node: check.node, command: `test ! -e ${p}`, expect: { exitCode: 0 } };
      if (check.sha256) {
        return { node: check.node, command: `sha256sum ${p} | cut -d' ' -f1`, expect: { exitCode: 0, equals: check.sha256 } };
      }
      if (check.contains !== undefined || check.matches !== undefined) {
        return { node: check.node, command: `cat ${p}`, expect: { exitCode: 0, contains: check.contains, matches: check.matches } };
      }
      return { node: check.node, command: `test -e ${p}`, expect: { exitCode: 0 } };
    }
  }
}

function formatOutput(r: ExecResult): string {
  let s = `exit=${r.exitCode}\n${r.stdout.trim()}`;
  if (r.stderr.trim()) s += `\n--- stderr ---\n${r.stderr.trim()}`;
  return s.length > OUTPUT_LIMIT ? s.slice(0, OUTPUT_LIMIT) + '\n...(truncated)' : s;
}

export interface GradeOptions {
  /** Retry failing checks within the settle window. Disabled for dry-run. */
  retry?: boolean;
}

export interface ChecksOutcome {
  checks: CheckResult[];
  tasks: TaskScore[];
  score: number;
  maxScore: number;
}

export interface RunCheckOptions {
  /** Directory that script checks are relative to. */
  dir: string;
  /** Retry window in seconds; 0 runs the check once. */
  windowS: number;
  /** Scenario variables, exported to every check command. */
  vars?: Vars;
  /** Shared cap on concurrent commands. */
  limit?: Limit;
}

/** Runs one read-only check, retrying until it passes or the window runs out. */
export async function runCheck(driver: Driver, sessionId: string, check: Check, opts: RunCheckOptions): Promise<CheckResult> {
  const limit: Limit = opts.limit ?? ((fn) => fn());
  if (check.type === 'script') {
    await limit(() => driver.copyIn(sessionId, check.node, join(opts.dir, check.script), remoteCheckPath(check.id)));
  }
  const plan = planCheck(check);
  const env = { ...opts.vars, ...plan.env };
  const deadline = Date.now() + opts.windowS * 1000;
  for (;;) {
    let r: ExecResult;
    try {
      r = await limit(() => driver.exec(sessionId, plan.node, plan.command, { timeoutMs: CHECK_TIMEOUT_MS, env }));
    } catch (e) {
      r = { exitCode: -1, stdout: '', stderr: (e as Error).message };
    }
    const ev = evaluate(plan.expect, r);
    if (ev.passed || Date.now() + RETRY_INTERVAL_MS > deadline) {
      return {
        id: check.id,
        description: check.description,
        passed: ev.passed,
        weight: check.weight,
        detail: ev.detail,
        output: formatOutput(r),
      };
    }
    await sleep(RETRY_INTERVAL_MS);
  }
}

/** Output of every check of a question that was never opened. */
export const NOT_ATTEMPTED = 'not attempted: the question was never opened';

/**
 * Runs every task's checks in parallel. Each check is retried until it passes or its settle
 * window (check.retrySeconds, else scenario.settleSeconds) runs out. Pass a rendered scenario.
 */
export async function runChecks(
  driver: Driver,
  sessionId: string,
  scenario: LoadedScenario,
  opts: GradeOptions & { vars?: Vars; skipTasks?: string[] } = {},
): Promise<ChecksOutcome> {
  const retry = opts.retry ?? true;
  const limit = limiter(MAX_PARALLEL_EXECS);
  const perTask = await Promise.all(
    scenario.tasks.map(async (task) => {
      // A task that was never set up would pass checks like "every node is Ready" for free.
      const checks = opts.skipTasks?.includes(task.id)
        ? task.checks.map((check): CheckResult => ({
            id: check.id,
            description: check.description,
            passed: false,
            weight: check.weight,
            detail: 'not attempted',
            output: NOT_ATTEMPTED,
          }))
        : await Promise.all(
            task.checks.map((check) =>
              runCheck(driver, sessionId, check, {
                dir: scenario.dir,
                windowS: retry ? (check.retrySeconds ?? scenario.def.settleSeconds) : 0,
                vars: opts.vars,
                limit,
              }),
            ),
          );
      const score: TaskScore = {
        id: task.id,
        title: task.title,
        score: checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0),
        maxScore: checks.reduce((s, c) => s + c.weight, 0),
        checkIds: checks.map((c) => c.id),
      };
      return { checks, score };
    }),
  );

  const checks = perTask.flatMap((t) => t.checks);
  const tasks = perTask.map((t) => t.score);
  return {
    checks,
    tasks,
    score: tasks.reduce((s, t) => s + t.score, 0),
    maxScore: tasks.reduce((s, t) => s + t.maxScore, 0),
  };
}

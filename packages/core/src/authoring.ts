import type { GradeResult, Vars } from '@cka/schema';
import type { SessionManager } from './session';

export interface AuthoringResult {
  ok: boolean;
  result: GradeResult;
  /** Variable values used for this run. */
  vars: Vars;
}

export interface AuthoringOptions {
  keep?: boolean;
  /** Pin variable values instead of rolling them. */
  vars?: Vars;
}

async function startReady(sessions: SessionManager, id: string, mode: 'dry-run' | 'verify', vars?: Vars): Promise<Vars> {
  const { ready } = await sessions.start(id, mode, { vars });
  const view = await ready;
  if (view.state !== 'running') throw new Error(`Provisioning failed: ${view.error ?? view.state}`);
  return view.vars;
}

async function finish(sessions: SessionManager, keep: boolean) {
  if (keep) return;
  await sessions.end().catch(() => {});
}

/**
 * Starts the scenario, runs setup and grades immediately without retries. Passes when the grade
 * is below the maximum: the break works and the checks are not vacuous.
 */
export async function dryRun(sessions: SessionManager, id: string, opts: AuthoringOptions = {}): Promise<AuthoringResult> {
  try {
    const vars = await startReady(sessions, id, 'dry-run', opts.vars);
    const result = await sessions.grade({ retry: false });
    return { ok: result.score < result.maxScore, result, vars };
  } finally {
    await finish(sessions, opts.keep ?? false);
  }
}

/** Starts the scenario, applies the solution and grades. Passes when every check passes. */
export async function verify(sessions: SessionManager, id: string, opts: AuthoringOptions = {}): Promise<AuthoringResult> {
  try {
    const vars = await startReady(sessions, id, 'verify', opts.vars);
    await sessions.applySolution();
    const result = await sessions.grade({ retry: true });
    return { ok: result.allPassed, result, vars };
  } finally {
    await finish(sessions, opts.keep ?? false);
  }
}

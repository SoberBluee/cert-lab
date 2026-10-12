import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { basename, join } from 'node:path';
import { visibleVars, type Driver, type GradeResult, type Mode, type SessionState, type SessionTask, type SessionView, type Step, type Vars } from '@cka/schema';
import { ADMIN_KUBECONFIG, runChecks, type GradeOptions } from './grader';
import { renderScenario, rollScenarioVars } from './vars';
import type { Logger } from './logger';
import type { LoadedScenario, ScenarioLibrary } from './scenarios';
import type { SessionRow, Store } from './store';

export class OrchestratorError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

const ACTIVE: SessionState[] = ['provisioning', 'running', 'grading'];
const ASSIST_MODES: Mode[] = ['practice', 'dry-run', 'verify'];
const tail = (s: string, n = 500) => (s.length > n ? '...' + s.slice(-n) : s).trim();
const short = (s: string, n = 60) => {
  const line = s.trim().split('\n')[0];
  return line.length > n || s.trim().includes('\n') ? line.slice(0, n) + '...' : line;
};
const now = () => new Date().toISOString();
const totalHints = (row: Pick<SessionRow, 'hintsRevealed'>) => Object.values(row.hintsRevealed).reduce((a, b) => a + b, 0);

export interface StartResult {
  view: SessionView;
  /** Resolves when provisioning finishes, successfully or not. Never rejects. */
  ready: Promise<SessionView>;
}

/**
 * Owns the session lifecycle: provisioning -> running -> grading -> running -> completed, with
 * failed reachable from any state. State lives in SQLite so the CLI and the API share it.
 * Emits 'change' with a SessionView whenever this process modifies a session.
 */
export class SessionManager extends EventEmitter {
  constructor(
    private readonly driver: Driver,
    private readonly store: Store,
    private readonly library: ScenarioLibrary,
    private readonly log: Logger,
  ) {
    super();
    this.setMaxListeners(100);
  }

  toView(row: SessionRow): SessionView {
    const raw = this.library.get(row.scenarioId);
    const s = raw && renderScenario(raw, row.vars);
    const tasks: SessionTask[] =
      s?.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        points: t.points,
        context: t.context,
        markdown: t.markdown,
        hintsRevealed: t.hints.slice(0, row.hintsRevealed[t.id] ?? 0),
        hintsTotal: t.hints.length,
      })) ?? [];
    return {
      id: row.id,
      scenarioId: row.scenarioId,
      scenarioTitle: s?.def.title ?? row.scenarioId,
      mode: row.mode,
      state: row.state,
      base: row.base,
      attemptId: row.attemptId,
      startedAt: row.startedAt,
      readyAt: row.readyAt,
      endedAt: row.endedAt,
      error: row.error,
      progress: row.progress,
      connection: row.connection,
      context: s?.def.context,
      tasks,
      vars: row.solutionViewed || row.endedAt ? row.vars : visibleVars(row.vars, raw?.def.variables),
      hintsRevealed: tasks.flatMap((t) => t.hintsRevealed),
      hintsTotal: tasks.reduce((n, t) => n + t.hintsTotal, 0),
      solutionViewed: row.solutionViewed,
      solution: row.solutionViewed ? s?.solutionMd : undefined,
      lastGrade: row.lastGrade,
    };
  }

  /** The open session (running, provisioning, grading or failed), or null. */
  current(): SessionView | null {
    const row = this.store.openSession();
    return row ? this.toView(row) : null;
  }

  private requireOpen(): SessionRow {
    const row = this.store.openSession();
    if (!row) throw new OrchestratorError('There is no active session. Start a scenario first.', 404);
    return row;
  }

  /** The session's scenario, rendered with the variables chosen at start. */
  private scenarioFor(row: SessionRow): LoadedScenario {
    const s = this.library.get(row.scenarioId);
    if (!s) throw new OrchestratorError(`Scenario "${row.scenarioId}" no longer exists on disk.`, 404);
    return renderScenario(s, row.vars);
  }

  private emitChange(id: string) {
    const row = this.store.getSession(id);
    if (row) this.emit('change', this.toView(row));
  }

  private progress(id: string, message: string) {
    const row = this.store.getSession(id);
    if (!row) return;
    this.store.updateSession(id, { progress: [...row.progress, { at: now(), message }] });
    this.log.info({ sessionId: id }, message);
    this.emitChange(id);
  }

  private stillProvisioning(id: string) {
    return this.store.getSession(id)?.state === 'provisioning';
  }

  /** Starts a session. Variables are rolled here (pinned values win) and kept for the session's life. */
  async start(scenarioId: string, mode: Mode = 'practice', opts: { vars?: Vars } = {}): Promise<StartResult> {
    const scenario = this.library.get(scenarioId);
    if (!scenario) throw new OrchestratorError(`Unknown scenario "${scenarioId}".`, 404);
    let vars: Vars;
    try {
      vars = rollScenarioVars(scenario, opts.vars);
    } catch (e) {
      throw new OrchestratorError((e as Error).message, 400);
    }

    const open = this.store.openSession();
    if (open && ACTIVE.includes(open.state)) {
      throw new OrchestratorError(
        `A session for "${open.scenarioId}" is already ${open.state}. End it before starting another one.`,
        409,
      );
    }
    if (open) this.close(open);

    const id = randomUUID();
    const attemptId = this.store.createAttempt({ scenarioId, sessionId: id, mode });
    this.store.createSession({ id, scenarioId, mode, base: scenario.def.base, attemptId, vars });
    this.log.info({ sessionId: id, scenarioId, mode, vars }, 'session created');
    this.emitChange(id);
    const ready = this.provision(id, renderScenario(scenario, vars), vars);
    return { view: this.toView(this.store.getSession(id)!), ready };
  }

  private async provision(id: string, s: LoadedScenario, vars: Vars): Promise<SessionView> {
    const t0 = Date.now();
    try {
      this.progress(id, `Preparing "${s.def.title}" on the ${s.def.base} base`);
      await this.driver.createSession(s.def.nodes, s.def.base, {
        sessionId: id,
        onProgress: (m) => this.progress(id, m),
      });
      if (!this.stillProvisioning(id)) return this.toView(this.store.getSession(id)!);
      const steps = [...s.def.setup, ...s.tasks.flatMap((t) => t.setup)];
      if (steps.length) await this.runSteps(id, s, steps, 'setup', vars);
      const connection = await this.driver.getConnectionInfo(id);
      if (this.stillProvisioning(id)) {
        this.store.updateSession(id, { state: 'running', readyAt: now(), connection });
        this.progress(id, `Lab ready in ${Math.round((Date.now() - t0) / 1000)}s`);
      }
    } catch (e) {
      const message = (e as Error).message;
      this.log.error({ sessionId: id, err: e }, 'provisioning failed');
      if (this.stillProvisioning(id)) {
        this.store.updateSession(id, { state: 'failed', error: message });
        this.emitChange(id);
      }
    }
    return this.toView(this.store.getSession(id)!);
  }

  private async runSteps(id: string, s: LoadedScenario, steps: Step[], label: 'setup' | 'solution', vars: Vars) {
    for (const [i, step] of steps.entries()) {
      const what = step.script ?? short(step.run ?? '');
      this.progress(id, `${label} ${i + 1}/${steps.length} on ${step.node}: ${what}`);
      let command = step.run ?? '';
      if (step.script) {
        const remote = `/tmp/cka-${label}/${i}-${basename(step.script)}`;
        await this.driver.copyIn(id, step.node, join(s.dir, step.script), remote);
        // Deleted right away so learners cannot read the setup (and which faults it can inject).
        command = `bash ${remote}; rc=$?; rm -f ${remote}; exit $rc`;
      }
      const r = await this.driver.exec(id, step.node, command, {
        timeoutMs: step.timeoutSeconds * 1000,
        env: { ...vars, ...ADMIN_KUBECONFIG, CKA_NODE: step.node },
      });
      this.log.debug({ sessionId: id, label, step: i, exitCode: r.exitCode, stdout: tail(r.stdout), stderr: tail(r.stderr) }, 'step finished');
      if (r.exitCode !== 0) {
        throw new OrchestratorError(
          `${label} step ${i + 1} (${what}) failed on ${step.node} with exit code ${r.exitCode}: ${tail(r.stderr || r.stdout) || 'no output'}`,
          500,
        );
      }
    }
  }

  async reset(): Promise<StartResult> {
    const row = this.requireOpen();
    if (row.state === 'provisioning' || row.state === 'grading') {
      throw new OrchestratorError(`Cannot reset while the session is ${row.state}.`, 409);
    }
    const s = this.scenarioFor(row);
    this.finalizeAttempt(row);
    const attemptId = this.store.createAttempt({
      scenarioId: row.scenarioId,
      sessionId: row.id,
      mode: row.mode,
      hintsUsed: totalHints(row),
      solutionViewed: row.solutionViewed,
    });
    this.store.updateSession(row.id, {
      state: 'provisioning',
      attemptId,
      readyAt: undefined,
      error: undefined,
      progress: [],
      lastGrade: undefined,
      connection: undefined,
    });
    this.log.info({ sessionId: row.id, vars: row.vars }, 'session reset');
    this.emitChange(row.id);
    const ready = this.provision(row.id, s, row.vars);
    return { view: this.toView(this.store.getSession(row.id)!), ready };
  }

  async grade(opts: GradeOptions = {}): Promise<GradeResult> {
    const row = this.requireOpen();
    if (row.state !== 'running') {
      throw new OrchestratorError(`Cannot grade while the session is ${row.state}.`, 409);
    }
    const s = this.scenarioFor(row);
    this.store.updateSession(row.id, { state: 'grading' });
    this.emitChange(row.id);
    try {
      const outcome = await runChecks(this.driver, row.id, s, { ...opts, vars: row.vars });
      const elapsedS = row.readyAt ? Math.round((Date.now() - Date.parse(row.readyAt)) / 1000) : 0;
      const result: GradeResult = {
        score: outcome.score,
        maxScore: outcome.maxScore,
        percent: outcome.maxScore > 0 ? Math.round((outcome.score / outcome.maxScore) * 100) : 0,
        allPassed: outcome.score === outcome.maxScore,
        elapsedS,
        gradedAt: now(),
        checks: outcome.checks,
        tasks: outcome.tasks,
      };
      this.store.updateAttempt(row.attemptId, { score: result.score, maxScore: result.maxScore, durationS: elapsedS });
      this.store.replaceCheckResults(
        row.attemptId,
        result.checks.map((c) => ({ checkId: c.id, passed: c.passed, weight: c.weight, output: c.output })),
      );
      if (this.store.getSession(row.id)?.state === 'grading') {
        this.store.updateSession(row.id, { state: 'running', lastGrade: result });
      }
      this.log.info({ sessionId: row.id, score: result.score, maxScore: result.maxScore }, 'graded');
      this.emitChange(row.id);
      return result;
    } catch (e) {
      const message = `Grading failed: ${(e as Error).message}`;
      this.log.error({ sessionId: row.id, err: e }, 'grading failed');
      this.store.updateSession(row.id, { state: 'failed', error: message });
      this.emitChange(row.id);
      throw new OrchestratorError(message, 500);
    }
  }

  /** Reveals the next hint of a task (default: the first task that still has hints). */
  hint(taskId?: string): SessionView {
    const row = this.requireOpen();
    if (row.state !== 'running' && row.state !== 'grading') {
      throw new OrchestratorError(`Hints are available once the lab is running (currently ${row.state}).`, 409);
    }
    if (!ASSIST_MODES.includes(row.mode)) throw new OrchestratorError(`Hints are disabled in ${row.mode} mode.`, 403);
    const s = this.scenarioFor(row);
    const shown = (id: string) => row.hintsRevealed[id] ?? 0;
    const task = taskId
      ? s.tasks.find((t) => t.id === taskId)
      : (s.tasks.find((t) => shown(t.id) < t.hints.length) ?? s.tasks[0]);
    if (!task) throw new OrchestratorError(`Unknown task "${taskId}".`, 404);
    if (shown(task.id) >= task.hints.length) {
      throw new OrchestratorError(s.tasks.length > 1 ? `No more hints for "${task.title}".` : 'No more hints for this scenario.', 400);
    }
    const hintsRevealed = { ...row.hintsRevealed, [task.id]: shown(task.id) + 1 };
    this.store.updateSession(row.id, { hintsRevealed });
    this.store.updateAttempt(row.attemptId, { hintsUsed: totalHints({ hintsRevealed }) });
    this.log.info({ sessionId: row.id, task: task.id, hint: hintsRevealed[task.id] }, 'hint revealed');
    this.emitChange(row.id);
    return this.toView(this.store.getSession(row.id)!);
  }

  solution(): SessionView {
    const row = this.requireOpen();
    if (!ASSIST_MODES.includes(row.mode)) throw new OrchestratorError(`Solutions are disabled in ${row.mode} mode.`, 403);
    const s = this.scenarioFor(row);
    if (!s.solutionMd) throw new OrchestratorError('This scenario has no solution.md.', 404);
    this.store.updateSession(row.id, { solutionViewed: true });
    this.store.updateAttempt(row.attemptId, { solutionViewed: true });
    this.log.warn({ sessionId: row.id }, 'solution revealed; attempt marked assisted');
    this.emitChange(row.id);
    return this.toView(this.store.getSession(row.id)!);
  }

  /** Runs the scenario's solution steps (solution: in scenario.yaml, else solution.sh on controlplane). */
  async applySolution(): Promise<void> {
    const row = this.requireOpen();
    if (row.state !== 'running') throw new OrchestratorError(`Cannot apply the solution while ${row.state}.`, 409);
    const s = this.scenarioFor(row);
    const steps: Step[] | undefined =
      s.def.solution ?? (s.solutionScript ? [{ node: 'controlplane', script: 'solution.sh', timeoutSeconds: 600 }] : undefined);
    if (!steps) throw new OrchestratorError(`Scenario "${s.def.id}" has no solution steps or solution.sh.`, 400);
    await this.runSteps(row.id, s, steps, 'solution', row.vars);
  }

  async end(opts: { stopVms?: boolean } = {}): Promise<SessionView> {
    const row = this.requireOpen();
    this.close(row);
    const view = this.toView(this.store.getSession(row.id)!);
    if (opts.stopVms ?? true) {
      try {
        await this.driver.destroySession(row.id);
      } catch (e) {
        this.log.warn({ sessionId: row.id, err: e }, 'failed to stop lab VMs');
      }
    }
    return view;
  }

  private close(row: SessionRow) {
    this.finalizeAttempt(row);
    this.store.updateSession(row.id, { state: 'completed', endedAt: now() });
    this.log.info({ sessionId: row.id }, 'session ended');
    this.emitChange(row.id);
  }

  /** Marks the attempt ended. Graded attempts keep the duration measured at the last grade. */
  private finalizeAttempt(row: SessionRow) {
    const status = this.store.attemptStatus(row.attemptId);
    if (!status || status.ended) return;
    const patch: { endedAt: string; durationS?: number } = { endedAt: now() };
    if (!status.graded) patch.durationS = row.readyAt ? Math.round((Date.now() - Date.parse(row.readyAt)) / 1000) : 0;
    this.store.updateAttempt(row.attemptId, patch);
  }

  /**
   * Called when the API starts. A session left provisioning or grading by a dead process is
   * marked failed and its VMs are stopped. A running session is kept so it can be resumed.
   */
  async recoverOnStartup(): Promise<void> {
    const row = this.store.openSession();
    if (!row || (row.state !== 'provisioning' && row.state !== 'grading')) return;
    this.store.updateSession(row.id, {
      state: 'failed',
      error: `The orchestrator restarted while this session was ${row.state}. Press Reset to rebuild the lab, or End to tear it down.`,
    });
    this.log.warn({ sessionId: row.id, state: row.state }, 'recovered leaked session');
    try {
      await this.driver.destroySession(row.id);
    } catch (e) {
      this.log.warn({ err: e }, 'failed to stop VMs of leaked session');
    }
  }

  /** Polls the database so changes made by another process (e.g. the CLI) reach SSE clients. */
  watchDatabase(intervalMs = 1500): () => void {
    let last = this.store.latestUpdate();
    const timer = setInterval(() => {
      const u = this.store.latestUpdate();
      if (u !== last) {
        last = u;
        this.emit('change', this.current());
      }
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}

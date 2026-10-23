import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { AttemptRecord, Base, GradeResult, LearnProgress, Mode, ProgressLine, ScenarioStats, SessionState, TaskTime, Vars } from '@cka/schema';
import type { ConnectionInfo } from '@cka/schema';
import { dataDir } from './paths';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  state TEXT NOT NULL,
  base TEXT NOT NULL,
  attempt_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ready_at TEXT,
  ended_at TEXT,
  error TEXT,
  progress TEXT NOT NULL DEFAULT '[]',
  hints_revealed INTEGER NOT NULL DEFAULT 0,
  solution_viewed INTEGER NOT NULL DEFAULT 0,
  last_grade TEXT,
  connection TEXT,
  vars TEXT NOT NULL DEFAULT '{}',
  tasks_ready TEXT,
  preparing_task TEXT,
  learn_progress TEXT,
  task_times TEXT,
  focus_task TEXT,
  focus_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mock_exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  total_score REAL,
  max_score REAL
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id TEXT NOT NULL,
  session_id TEXT,
  mode TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_s INTEGER,
  score REAL,
  max_score REAL,
  hints_used INTEGER NOT NULL DEFAULT 0,
  solution_viewed INTEGER NOT NULL DEFAULT 0,
  mock_exam_id INTEGER REFERENCES mock_exams(id),
  task_times TEXT
);
CREATE INDEX IF NOT EXISTS attempts_scenario ON attempts(scenario_id, started_at);
CREATE TABLE IF NOT EXISTS check_results (
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  check_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  weight REAL NOT NULL,
  output TEXT,
  PRIMARY KEY (attempt_id, check_id)
);
CREATE TABLE IF NOT EXISTS review_queue (
  scenario_id TEXT PRIMARY KEY,
  next_due TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  ease REAL NOT NULL DEFAULT 2.5
);
`;

/** Modes that count towards history and stats. Authoring runs (dry-run, verify) do not. */
const USER_MODES = `('practice', 'drill', 'mock')`;

export interface SessionRow {
  id: string;
  scenarioId: string;
  mode: Mode;
  state: SessionState;
  base: Base;
  attemptId: number;
  startedAt: string;
  readyAt?: string;
  endedAt?: string;
  error?: string;
  progress: ProgressLine[];
  /** Hints revealed per task id. */
  hintsRevealed: Record<string, number>;
  solutionViewed: boolean;
  lastGrade?: GradeResult;
  connection?: ConnectionInfo;
  vars: Record<string, string>;
  /** Tasks whose setup has run; undefined for sessions started before deferred setup, where every task is ready. */
  tasksReady?: string[];
  /** Task whose deferred setup is running right now. */
  preparingTask?: string;
  /** Learn mode: progress through the lesson's steps. */
  learnProgress?: LearnProgress;
  /** Seconds each task was the one open on screen, up to focusAt. */
  taskTimes: Record<string, number>;
  /** The task open on screen since focusAt, if any. */
  focusTask?: string;
  focusAt?: string;
  updatedAt: string;
}

/** hints_revealed held a plain count before multi-task scenarios; that count belongs to task "main". */
function parseHints(v: unknown): Record<string, number> {
  if (typeof v === 'number') return v ? { main: v } : {};
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return Number(v) ? { main: Number(v) } : {};
    try {
      return JSON.parse(v) as Record<string, number>;
    } catch {
      return {};
    }
  }
  return {};
}

type Row = Record<string, unknown>;
const opt = <T>(v: unknown) => (v === null || v === undefined ? undefined : (v as T));
const json = <T>(v: unknown) => (typeof v === 'string' ? (JSON.parse(v) as T) : undefined);

function toSession(r: Row): SessionRow {
  return {
    id: r.id as string,
    scenarioId: r.scenario_id as string,
    mode: r.mode as Mode,
    state: r.state as SessionState,
    base: r.base as Base,
    attemptId: Number(r.attempt_id),
    startedAt: r.started_at as string,
    readyAt: opt(r.ready_at),
    endedAt: opt(r.ended_at),
    error: opt(r.error),
    progress: json<ProgressLine[]>(r.progress) ?? [],
    hintsRevealed: parseHints(r.hints_revealed),
    solutionViewed: Boolean(r.solution_viewed),
    lastGrade: json<GradeResult>(r.last_grade),
    connection: json<ConnectionInfo>(r.connection),
    vars: json<Record<string, string>>(r.vars) ?? {},
    tasksReady: json<string[]>(r.tasks_ready),
    preparingTask: opt(r.preparing_task),
    learnProgress: json<LearnProgress>(r.learn_progress),
    taskTimes: json<Record<string, number>>(r.task_times) ?? {},
    focusTask: opt(r.focus_task),
    focusAt: opt(r.focus_at),
    updatedAt: r.updated_at as string,
  };
}

const SESSION_COLUMNS: Record<string, string> = {
  state: 'state',
  readyAt: 'ready_at',
  endedAt: 'ended_at',
  error: 'error',
  progress: 'progress',
  hintsRevealed: 'hints_revealed',
  solutionViewed: 'solution_viewed',
  lastGrade: 'last_grade',
  connection: 'connection',
  attemptId: 'attempt_id',
  tasksReady: 'tasks_ready',
  preparingTask: 'preparing_task',
  learnProgress: 'learn_progress',
  vars: 'vars',
  taskTimes: 'task_times',
  focusTask: 'focus_task',
  focusAt: 'focus_at',
};

const ATTEMPT_COLUMNS: Record<string, string> = {
  endedAt: 'ended_at',
  durationS: 'duration_s',
  score: 'score',
  maxScore: 'max_score',
  hintsUsed: 'hints_used',
  solutionViewed: 'solution_viewed',
  tasks: 'task_times',
};

function toSql(v: unknown): SQLInputValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v as SQLInputValue;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(file = join(dataDir, 'state.db')) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  private migrate() {
    const cols = (this.db.prepare('PRAGMA table_info(sessions)').all() as Row[]).map((r) => r.name);
    if (!cols.includes('vars')) this.db.exec(`ALTER TABLE sessions ADD COLUMN vars TEXT NOT NULL DEFAULT '{}'`);
    if (!cols.includes('tasks_ready')) this.db.exec('ALTER TABLE sessions ADD COLUMN tasks_ready TEXT');
    if (!cols.includes('preparing_task')) this.db.exec('ALTER TABLE sessions ADD COLUMN preparing_task TEXT');
    if (!cols.includes('learn_progress')) this.db.exec('ALTER TABLE sessions ADD COLUMN learn_progress TEXT');
    for (const c of ['task_times', 'focus_task', 'focus_at']) if (!cols.includes(c)) this.db.exec(`ALTER TABLE sessions ADD COLUMN ${c} TEXT`);
    const attemptCols = (this.db.prepare('PRAGMA table_info(attempts)').all() as Row[]).map((r) => r.name);
    if (!attemptCols.includes('task_times')) this.db.exec('ALTER TABLE attempts ADD COLUMN task_times TEXT');
  }

  private update(table: string, columns: Record<string, string>, id: string | number, patch: Record<string, unknown>) {
    const sets: string[] = [];
    const values: SQLInputValue[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const col = columns[key];
      if (!col) throw new Error(`unknown column ${table}.${key}`);
      sets.push(`${col} = ?`);
      values.push(toSql(value));
    }
    if (table === 'sessions') {
      sets.push('updated_at = ?');
      values.push(new Date().toISOString());
    }
    if (!sets.length) return;
    this.db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  }

  createSession(s: { id: string; scenarioId: string; mode: Mode; base: Base; attemptId: number; vars: Record<string, string> }): SessionRow {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (id, scenario_id, mode, state, base, attempt_id, started_at, vars, updated_at)
         VALUES (?, ?, ?, 'provisioning', ?, ?, ?, ?, ?)`,
      )
      .run(s.id, s.scenarioId, s.mode, s.base, s.attemptId, now, JSON.stringify(s.vars), now);
    return this.getSession(s.id)!;
  }

  updateSession(id: string, patch: Partial<Omit<SessionRow, 'id' | 'scenarioId' | 'mode' | 'base' | 'startedAt' | 'updatedAt'>>) {
    this.update('sessions', SESSION_COLUMNS, id, patch as Record<string, unknown>);
  }

  getSession(id: string): SessionRow | undefined {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
    return r ? toSession(r) : undefined;
  }

  /** The most recent session that has not been explicitly ended (failed sessions stay visible). */
  openSession(): SessionRow | undefined {
    const r = this.db.prepare(`SELECT * FROM sessions WHERE state != 'completed' ORDER BY started_at DESC LIMIT 1`).get() as Row | undefined;
    return r ? toSession(r) : undefined;
  }

  latestUpdate(): string | undefined {
    const r = this.db.prepare('SELECT MAX(updated_at) AS u FROM sessions').get() as Row | undefined;
    return opt(r?.u);
  }

  createAttempt(a: { scenarioId: string; sessionId: string; mode: Mode; hintsUsed?: number; solutionViewed?: boolean }): number {
    const res = this.db
      .prepare(
        `INSERT INTO attempts (scenario_id, session_id, mode, started_at, hints_used, solution_viewed)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(a.scenarioId, a.sessionId, a.mode, new Date().toISOString(), a.hintsUsed ?? 0, a.solutionViewed ? 1 : 0);
    return Number(res.lastInsertRowid);
  }

  updateAttempt(
    id: number,
    patch: Partial<{ endedAt: string; durationS: number; score: number; maxScore: number; hintsUsed: number; solutionViewed: boolean; tasks: TaskTime[] }>,
  ) {
    this.update('attempts', ATTEMPT_COLUMNS, id, patch);
  }

  attemptStatus(id: number): { ended: boolean; graded: boolean } | undefined {
    const r = this.db.prepare('SELECT ended_at, score FROM attempts WHERE id = ?').get(id) as Row | undefined;
    return r ? { ended: r.ended_at !== null, graded: r.score !== null } : undefined;
  }

  replaceCheckResults(attemptId: number, results: { checkId: string; passed: boolean; weight: number; output: string }[]) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM check_results WHERE attempt_id = ?').run(attemptId);
      const ins = this.db.prepare('INSERT INTO check_results (attempt_id, check_id, passed, weight, output) VALUES (?, ?, ?, ?, ?)');
      for (const r of results) ins.run(attemptId, r.checkId, r.passed ? 1 : 0, r.weight, r.output.slice(0, 2000));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  listAttempts(f: { scenarioId?: string; limit?: number } = {}): Omit<AttemptRecord, 'scenarioTitle' | 'domain'>[] {
    const where = [`mode IN ${USER_MODES}`];
    const params: SQLInputValue[] = [];
    if (f.scenarioId) {
      where.push('scenario_id = ?');
      params.push(f.scenarioId);
    }
    const rows = this.db
      .prepare(`SELECT * FROM attempts WHERE ${where.join(' AND ')} ORDER BY started_at DESC LIMIT ?`)
      .all(...params, f.limit ?? 200) as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      scenarioId: r.scenario_id as string,
      mode: r.mode as Mode,
      startedAt: r.started_at as string,
      endedAt: opt(r.ended_at),
      durationS: opt<number>(r.duration_s),
      score: opt<number>(r.score),
      maxScore: opt<number>(r.max_score),
      hintsUsed: Number(r.hints_used),
      solutionViewed: Boolean(r.solution_viewed),
      ...(r.task_times ? { tasks: json<TaskTime[]>(r.task_times) } : {}),
    }));
  }

  /**
   * Graded attempts, oldest first, with their check results, the variables their session rolled, whether
   * the learner used help, and the seconds each question was open.
   */
  gradedAttempts(): {
    id: number;
    scenarioId: string;
    mode: Mode;
    startedAt: string;
    vars: Vars;
    hintsUsed: number;
    solutionViewed: boolean;
    taskSeconds: Record<string, number>;
    checks: { id: string; passed: boolean; weight: number; output: string }[];
  }[] {
    const graded = `mode IN ${USER_MODES} AND score IS NOT NULL`;
    const attempts = this.db
      .prepare(
        `SELECT id, scenario_id, mode, started_at, hints_used, solution_viewed, task_times,
                (SELECT vars FROM sessions WHERE attempt_id = attempts.id LIMIT 1) AS vars
         FROM attempts WHERE ${graded} ORDER BY started_at ASC`,
      )
      .all() as Row[];
    const checks = new Map<number, { id: string; passed: boolean; weight: number; output: string }[]>();
    const rows = this.db
      .prepare(
        // Only the start of the output: enough to tell a question that was never opened.
        `SELECT attempt_id, check_id, passed, weight, substr(output, 1, 64) AS output FROM check_results
         WHERE attempt_id IN (SELECT id FROM attempts WHERE ${graded})`,
      )
      .all() as Row[];
    for (const r of rows) {
      const id = Number(r.attempt_id);
      checks.set(id, [...(checks.get(id) ?? []), { id: r.check_id as string, passed: Boolean(r.passed), weight: Number(r.weight), output: (r.output as string) ?? '' }]);
    }
    return attempts.map((r) => ({
      id: Number(r.id),
      scenarioId: r.scenario_id as string,
      mode: r.mode as Mode,
      startedAt: r.started_at as string,
      vars: json<Vars>(r.vars) ?? {},
      hintsUsed: Number(r.hints_used),
      solutionViewed: Boolean(r.solution_viewed),
      taskSeconds: Object.fromEntries((json<TaskTime[]>(r.task_times) ?? []).map((t) => [t.id, t.seconds])),
      checks: checks.get(Number(r.id)) ?? [],
    }));
  }

  /** Per-scenario stats over graded attempts. */
  scenarioStats(): Map<string, ScenarioStats> {
    const rows = this.db
      .prepare(
        `SELECT scenario_id, score, max_score, started_at FROM attempts
         WHERE mode IN ${USER_MODES} AND score IS NOT NULL ORDER BY started_at ASC`,
      )
      .all() as Row[];
    const stats = new Map<string, ScenarioStats>();
    for (const r of rows) {
      const id = r.scenario_id as string;
      const s = stats.get(id) ?? { attempts: 0 };
      const score = Number(r.score);
      const max = Number(r.max_score);
      s.attempts += 1;
      s.lastScore = score;
      s.lastMaxScore = max;
      s.lastAt = r.started_at as string;
      const pct = max > 0 ? Math.round((score / max) * 100) : 0;
      s.bestPercent = Math.max(s.bestPercent ?? 0, pct);
      stats.set(id, s);
    }
    return stats;
  }
}

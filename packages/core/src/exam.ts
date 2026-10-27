import type { SessionRow } from './store';

/**
 * What an exam's clock is made of: it starts when the lab is ready and stops while the exam is
 * paused. Pauses that have ended add up in pausedMs; the one in progress began at pausedAt.
 */
export type ExamClock = Pick<SessionRow, 'readyAt' | 'pausedAt' | 'pausedMs'>;

/** Milliseconds the clock has run at `at`: the time since the lab was ready, less every pause. */
export function clockElapsedMs(c: ExamClock, at = Date.now()): number {
  if (!c.readyAt) return 0;
  const until = c.pausedAt ? Math.min(at, Date.parse(c.pausedAt)) : at;
  return Math.max(0, until - Date.parse(c.readyAt) - c.pausedMs);
}

/** Milliseconds spent paused at `at`, the pause in progress included. */
export function clockPausedMs(c: ExamClock, at = Date.now()): number {
  return c.pausedMs + (c.pausedAt ? Math.max(0, at - Date.parse(c.pausedAt)) : 0);
}

/** Milliseconds left of `limitMs` at `at`. Frozen while paused. */
export function clockLeftMs(c: ExamClock, limitMs: number, at = Date.now()): number {
  return Math.max(0, limitMs - clockElapsedMs(c, at));
}

/** When `limitMs` runs out: every pause so far pushes it back. None while paused or before the lab is ready. */
export function clockDeadline(c: ExamClock, limitMs: number): string | undefined {
  if (!c.readyAt || c.pausedAt) return undefined;
  return new Date(Date.parse(c.readyAt) + c.pausedMs + limitMs).toISOString();
}

/** The clock resumed at `at`: the pause in progress joins the ones that have ended. */
export function resumeClock(c: ExamClock, at = Date.now()): Pick<SessionRow, 'pausedAt' | 'pausedMs'> {
  return { pausedAt: undefined, pausedMs: clockPausedMs(c, at) };
}

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clockDeadline, clockElapsedMs, clockLeftMs, clockPausedMs, resumeClock, type ExamClock } from './exam';

const T0 = Date.parse('2026-10-27T09:00:00.000Z');
const MIN = 60_000;
const at = (min: number) => T0 + min * MIN;
const iso = (min: number) => new Date(at(min)).toISOString();
const LIMIT = 120 * MIN;

describe('exam clock', () => {
  it('runs from readyAt, and not at all before the lab is ready', () => {
    assert.equal(clockElapsedMs({ pausedMs: 0 }, at(5)), 0);
    assert.equal(clockDeadline({ pausedMs: 0 }, LIMIT), undefined);
    const c: ExamClock = { readyAt: iso(0), pausedMs: 0 };
    assert.equal(clockElapsedMs(c, at(30)), 30 * MIN);
    assert.equal(clockLeftMs(c, LIMIT, at(30)), 90 * MIN);
    assert.equal(clockDeadline(c, LIMIT), iso(120));
  });

  it('stands still while paused, and has no deadline', () => {
    const c: ExamClock = { readyAt: iso(0), pausedAt: iso(30), pausedMs: 0 };
    for (const t of [30, 31, 8 * 60]) {
      assert.equal(clockElapsedMs(c, at(t)), 30 * MIN);
      assert.equal(clockLeftMs(c, LIMIT, at(t)), 90 * MIN);
    }
    assert.equal(clockDeadline(c, LIMIT), undefined);
    assert.equal(clockPausedMs(c, at(8 * 60)), (8 * 60 - 30) * MIN);
  });

  it('resumes with exactly the time that was left, the deadline pushed back by the pause', () => {
    const paused: ExamClock = { readyAt: iso(0), pausedAt: iso(30), pausedMs: 0 };
    const resumedAt = at(30) + 3 * 60 * MIN + 1234;
    const c: ExamClock = { readyAt: iso(0), ...resumeClock(paused, resumedAt) };
    assert.equal(c.pausedAt, undefined);
    assert.equal(c.pausedMs, 3 * 60 * MIN + 1234);
    assert.equal(clockLeftMs(c, LIMIT, resumedAt), 90 * MIN);
    assert.equal(Date.parse(clockDeadline(c, LIMIT)!), resumedAt + 90 * MIN);
    assert.equal(clockElapsedMs(c, resumedAt + 10 * MIN), 40 * MIN);
  });

  it('adds up several pauses', () => {
    let c: ExamClock = { readyAt: iso(0), pausedMs: 0 };
    c = { ...c, pausedAt: iso(10) };
    c = { ...c, ...resumeClock(c, at(70)) };
    c = { ...c, pausedAt: iso(100) };
    assert.equal(clockElapsedMs(c, at(500)), 40 * MIN);
    assert.equal(clockPausedMs(c, at(130)), 90 * MIN);
    c = { ...c, ...resumeClock(c, at(130)) };
    assert.equal(c.pausedMs, 90 * MIN);
    assert.equal(clockElapsedMs(c, at(150)), 60 * MIN);
    assert.equal(clockDeadline(c, LIMIT), iso(120 + 90));
  });

  it('never runs backwards or below zero time left', () => {
    const c: ExamClock = { readyAt: iso(0), pausedMs: 0 };
    assert.equal(clockLeftMs(c, LIMIT, at(500)), 0);
    assert.equal(clockElapsedMs(c, at(-1)), 0);
    // Read at a time before the pause began, the clock still runs up to then.
    assert.equal(clockElapsedMs({ ...c, pausedAt: iso(30) }, at(20)), 20 * MIN);
    assert.equal(clockPausedMs({ ...c, pausedAt: iso(30) }, at(20)), 0);
  });
});

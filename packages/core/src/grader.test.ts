import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { limiter } from './grader';

describe('limiter', () => {
  it('never runs more than n tasks at once and runs them all', async () => {
    const limit = limiter(3);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limit(async () => {
          peak = Math.max(peak, ++active);
          await new Promise((r) => setTimeout(r, 1 + (i % 4)));
          active--;
          if (i === 5) throw new Error('boom');
          return i;
        }).catch(() => -1),
      ),
    );
    assert.equal(peak, 3);
    assert.equal(results.filter((r) => r >= 0).length, 19);
  });
});

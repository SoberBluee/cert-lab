import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeDriver } from '@cka/driver-fake';
import { CheckSchema } from '@cka/schema';
import { limiter, runCheck } from './grader';

describe('runCheck', () => {
  it('fails a script check whose script cannot be copied to its node, without throwing', async () => {
    const driver = new (class extends FakeDriver {
      override async copyIn(): Promise<void> {
        throw new Error('Cannot copy to worker-1: Connection refused');
      }
    })(0);
    const check = CheckSchema.parse({ id: 'q1-script', description: 'the node is fixed', type: 'script', node: 'worker-1', script: 'checks/q1.sh' });
    const result = await runCheck(driver, 's1', check, { dir: '/scenario', windowS: 0 });
    assert.equal(result.id, 'q1-script');
    assert.equal(result.passed, false);
    assert.match(result.output, /Connection refused/);
  });
});

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

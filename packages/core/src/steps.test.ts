import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runBatched, stepBatches } from './steps';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('stepBatches', () => {
  it('groups consecutive laned steps by lane and keeps laneless steps alone', () => {
    const steps = [{ id: 'a', lane: 'q1' }, { id: 'b', lane: 'q2' }, { id: 'c', lane: 'q1' }, { id: 'd' }, { id: 'e', lane: 'q1' }];
    const ids = stepBatches(steps).map((batch) => batch.map((lane) => lane.map(({ step, index }) => `${step.id}${index}`)));
    assert.deepEqual(ids, [[['a0', 'c2'], ['b1']], [['d3']], [['e4']]]);
  });
});

describe('runBatched', () => {
  it('overlaps lanes, keeps each lane in order and waits at laneless steps', async () => {
    const log: string[] = [];
    const steps = [
      { id: 'a1', lane: 'a', ms: 30 },
      { id: 'a2', lane: 'a', ms: 10 },
      { id: 'b1', lane: 'b', ms: 10 },
      { id: 'barrier', ms: 0 },
      { id: 'c1', lane: 'c', ms: 0 },
    ];
    await runBatched(steps, async (s) => {
      log.push(`start ${s.id}`);
      await sleep(s.ms);
      log.push(`end ${s.id}`);
    });
    assert.ok(log.indexOf('start b1') < log.indexOf('end a1'), 'lane b starts while lane a runs');
    assert.ok(log.indexOf('end a1') < log.indexOf('start a2'), 'lane a stays in order');
    assert.equal(log.indexOf('start barrier'), log.indexOf('end a2') + 1, 'the laneless step waits for every lane');
    assert.ok(log.indexOf('end barrier') < log.indexOf('start c1'));
  });

  it('lets the other lanes finish, then rethrows the first failure', async () => {
    const done: string[] = [];
    const steps = [{ id: 'bad', lane: 'a' }, { id: 'good', lane: 'b' }, { id: 'after', lane: 'a' }, { id: 'next' }];
    await assert.rejects(
      runBatched(steps, async (s) => {
        await sleep(s.id === 'good' ? 20 : 0);
        if (s.id === 'bad') throw new Error('step bad failed');
        done.push(s.id);
      }),
      /step bad failed/,
    );
    assert.deepEqual(done, ['good']);
  });
});

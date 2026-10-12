/**
 * Consecutive steps that carry a `lane` form one batch; a step without a lane is a batch of its
 * own. Within a batch, each lane runs its steps in order and the lanes run at the same time.
 */
export function stepBatches<T extends { lane?: string }>(steps: T[]): { step: T; index: number }[][][] {
  const batches: { step: T; index: number }[][][] = [];
  let lanes: Map<string, { step: T; index: number }[]> | undefined;
  steps.forEach((step, index) => {
    if (!step.lane) {
      lanes = undefined;
      batches.push([[{ step, index }]]);
      return;
    }
    if (!lanes) {
      lanes = new Map();
      batches.push([]);
    }
    let lane = lanes.get(step.lane);
    if (!lane) {
      lane = [];
      lanes.set(step.lane, lane);
      batches[batches.length - 1].push(lane);
    }
    lane.push({ step, index });
  });
  return batches;
}

/** Runs steps batch by batch. Every lane of a batch finishes before the first failure is rethrown. */
export async function runBatched<T extends { lane?: string }>(steps: T[], run: (step: T, index: number) => Promise<void>): Promise<void> {
  for (const lanes of stepBatches(steps)) {
    const results = await Promise.allSettled(
      lanes.map(async (lane) => {
        for (const { step, index } of lane) await run(step, index);
      }),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
}

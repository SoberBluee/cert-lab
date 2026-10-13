import type { Scenario } from '@cka/schema';
import type { LoadedScenario } from './scenarios';

/** Reserved scenario id of the playground; a scenario on disk cannot use it. */
export const PLAYGROUND_ID = 'playground';

const def: Scenario = {
  id: PLAYGROUND_ID,
  title: 'Playground',
  domain: 'cluster-architecture',
  difficulty: 1,
  estimatedMinutes: 60,
  points: 1,
  tags: [],
  base: 'cluster',
  nodes: { controlPlane: 1, workers: 2 },
  context: 'kubernetes-admin@kubernetes',
  settleSeconds: 30,
  draft: false,
  variables: {},
  setup: [],
  hints: [],
};

/** A task-free lab on the cluster image. Built in code because ScenarioSchema requires checks. */
export const PLAYGROUND: LoadedScenario = {
  def,
  dir: '',
  relDir: PLAYGROUND_ID,
  task: '',
  tasks: [],
};

import { PLAYGROUNDS, type PlaygroundKind, type Scenario } from '@cka/schema';
import type { LoadedScenario } from './scenarios';

const cluster: Scenario = {
  id: PLAYGROUNDS.cluster,
  title: 'Playground',
  domain: 'cluster-architecture',
  track: 'cka',
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

/** Plain Ubuntu nodes with no runtime, packages or cluster: install one from scratch. */
const install: Scenario = {
  ...cluster,
  id: PLAYGROUNDS.install,
  title: 'Install playground',
  base: 'os',
  context: undefined,
};

/** Task-free labs, whose ids a scenario on disk cannot use. Built in code because ScenarioSchema requires checks. */
export const PLAYGROUND_SCENARIOS: Record<PlaygroundKind, LoadedScenario> = {
  cluster: { def: cluster, dir: '', relDir: cluster.id, task: '', tasks: [] },
  install: { def: install, dir: '', relDir: install.id, task: '', tasks: [] },
};

/** The playground with this scenario id, if it is one. */
export function playgroundById(id: string): LoadedScenario | undefined {
  return Object.values(PLAYGROUND_SCENARIOS).find((p) => p.def.id === id);
}

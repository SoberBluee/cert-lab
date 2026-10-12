import type { QuickQuestion } from '@cka/schema';
import { BUILDERS, CATEGORIES, ScenarioLibrary, Studio } from '@cka/core';

const studio = new Studio(new ScenarioLibrary());
const pools = (fields: { key: string; pool?: string[] }[]) => Object.fromEntries(fields.filter((f) => f.pool).map((f) => [f.key, f.pool!]));

const trouble = (id: string): QuickQuestion => ({ type: 'troubleshoot', category: id, values: {}, randomize: pools(CATEGORIES.find((c) => c.id === id)!.fields) });
const dep = BUILDERS.find((b) => b.id === 'deployment')!;
const create = (addons: string[]): QuickQuestion => ({
  type: 'create',
  builder: 'deployment',
  values: {},
  randomize: pools(dep.fields),
  addons: addons.map((id) => ({ id, values: {}, randomize: pools(dep.addons.find((a) => a.id === id)!.fields) })),
  followUps: [],
});

const labs: [string, QuickQuestion[]][] = [
  ['zz-verify-cp', [trouble('controlplane')]],
  ['zz-verify-ingress', [trouble('ingress')]],
  ['zz-verify-create-ingress', [create(['httproute', 'ingress', 'expose'])]],
  ['zz-verify-mixed', [trouble('controlplane'), trouble('nodes'), create(['expose', 'ingress'])]],
];
for (const [id, questions] of labs) {
  studio.createQuick({ id, title: id, questions });
  console.log(id);
}

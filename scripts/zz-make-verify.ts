import type { QuickQuestion } from '@cka/schema';
import { BUILDERS, ScenarioLibrary, Studio, type Builder, type PartBase } from '@cka/core';

const studio = new Studio(new ScenarioLibrary());
const pools = (fields: { key: string; pool?: string[] }[]) => Object.fromEntries(fields.filter((f) => f.pool).map((f) => [f.key, f.pool!]));

const compatible = (parts: PartBase[]) => {
  let set = parts.reduce<PartBase[]>((acc, p) => (p.conflicts?.some((c) => acc.some((a) => a.id === c)) ? acc : [...acc, p]), []);
  for (let n = -1; n !== set.length; ) {
    n = set.length;
    set = set.filter((p) => (p.requires ?? []).every((r) => set.some((x) => x.id === r)));
  }
  return set;
};

const question = (b: Builder, set: PartBase[]): QuickQuestion => {
  const part = (p: PartBase) => ({ id: p.id, values: {}, randomize: pools(p.fields) });
  return {
    type: 'create',
    builder: b.id,
    values: {},
    randomize: pools(b.fields),
    addons: b.addons.filter((p) => set.includes(p)).map(part),
    followUps: b.followUps.filter((p) => set.includes(p)).map(part),
  };
};

const ids = ['deployment', 'pod', 'pvc', 'pv', 'storageclass'];
const builders = ids.map((id) => BUILDERS.find((b) => b.id === id)!);
const sets = [
  (b: Builder) => compatible([...b.addons, ...b.followUps]),
  (b: Builder) => compatible([...b.followUps, ...[...b.addons].reverse()]),
];
for (const [i, set] of sets.entries()) {
  const id = `zz-verify-create-${i + 1}`;
  studio.createQuick({ id, title: `Verify Create ${i + 1}`, questions: builders.map((b) => question(b, set(b))) });
  console.log(id, builders.map((b) => `${b.id}: ${set(b).map((p) => p.id).join(',')}`).join(' | '));
}

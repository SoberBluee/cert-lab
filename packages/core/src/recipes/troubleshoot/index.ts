import type { CategorySummary } from '@cka/schema';
import { controlPlaneCategory } from './controlplane';
import { ingressCategory } from './ingress';
import { nodesCategory } from './nodes';
import { podsCategory } from './pods';
import { servicesCategory } from './services';
import { storageCategory } from './storage';
import type { FaultCategory } from './types';

export { composeTrouble, WORKERS } from './compose';
export type { Fault, FaultCategory, Shell } from './types';

export const CATEGORIES: FaultCategory[] = [podsCategory, servicesCategory, ingressCategory, nodesCategory, storageCategory, controlPlaneCategory];

export const getCategory = (id: string): FaultCategory | undefined => CATEGORIES.find((c) => c.id === id);

/** Fault ids, independent of field values. */
export const faultList = (c: FaultCategory) => c.faults(sample(c), '/tmp/x').map((f) => ({ id: f.id, label: f.label }));

const sample = (c: FaultCategory) =>
  Object.fromEntries([...c.fields.map((f) => [f.key, f.default]), ['FAULT', ''], ...Object.keys(c.hidden ?? {}).map((k) => [k, ''])]);

export const categorySummaries = (spoilers = false): CategorySummary[] =>
  CATEGORIES.map((c) => {
    const faults = faultList(c);
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      domain: c.domain,
      difficulty: c.difficulty,
      minutes: c.minutes,
      points: c.points,
      tags: c.tags,
      fields: c.fields,
      track: c.track ?? 'troubleshoot',
      disruptive: !!c.disruptive,
      breaksApi: !!c.breaksApi,
      faultCount: faults.length,
      ...(spoilers ? { faults } : {}),
    };
  });

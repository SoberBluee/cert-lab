import { QUICK_MAX_LAYERS, type CategorySummary } from '@cka/schema';
import { admissionCategory } from './admission';
import { apiAccessCategory } from './apiaccess';
import { controllersCategory } from './controllers';
import { controlPlaneCategory } from './controlplane';
import { cronJobsCategory } from './cronjobs';
import { dnsCategory } from './dns';
import { drainCategory } from './drain';
import { gatewayCategory } from './gateway';
import { hpaCategory } from './hpa';
import { ingressCategory } from './ingress';
import { netpolCategory } from './netpol';
import { nodeConfigCategory } from './nodeconfig';
import { nodesCategory } from './nodes';
import { podConfigCategory } from './podconfig';
import { podsCategory } from './pods';
import { provisioningCategory } from './provisioning';
import { rbacCategory } from './rbac';
import { restartsCategory } from './restarts';
import { schedulingCategory } from './scheduling';
import { servicesCategory } from './services';
import { storageCategory } from './storage';
import type { FaultCategory } from './types';
import { unschedulableCategory } from './unschedulable';
import { vpaCategory } from './vpa';

export { composeTrouble, WORKERS, type FaultSlot } from './compose';
export type { Fault, FaultCategory, Shell } from './types';

export const CATEGORIES: FaultCategory[] = [
  podsCategory,
  podConfigCategory,
  schedulingCategory,
  hpaCategory,
  vpaCategory,
  cronJobsCategory,
  rbacCategory,
  servicesCategory,
  netpolCategory,
  dnsCategory,
  ingressCategory,
  nodesCategory,
  storageCategory,
  nodeConfigCategory,
  controlPlaneCategory,
  apiAccessCategory,
  drainCategory,
  restartsCategory,
  admissionCategory,
  unschedulableCategory,
  controllersCategory,
  provisioningCategory,
  gatewayCategory,
];

export const getCategory = (id: string): FaultCategory | undefined => CATEGORIES.find((c) => c.id === id);

/** Fault ids, independent of field values. */
export const faultList = (c: FaultCategory) => c.faults(sample(c), '/tmp/x').map((f) => ({ id: f.id, label: f.label }));

const sample = (c: FaultCategory) =>
  Object.fromEntries([...c.fields.map((f) => [f.key, f.default]), ['FAULT', ''], ...Object.keys(c.hidden ?? {}).map((k) => [k, ''])]);

/** How many faults one question of the category can stack. */
export const maxLayers = (c: FaultCategory) => Math.max(1, Math.min(QUICK_MAX_LAYERS, c.layers?.length ?? 1));

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
      maxLayers: maxLayers(c),
      ...(spoilers ? { faults } : {}),
    };
  });

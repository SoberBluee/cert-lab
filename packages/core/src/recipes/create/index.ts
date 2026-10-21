import type { BuilderSummary, PartSummary } from '@cka/schema';
import { hpaBuilder, vpaBuilder } from './autoscaling';
import { certificatesBuilder, etcdBackupBuilder, etcdRestoreBuilder, installClusterBuilder } from './cluster';
import { cronJobBuilder } from './cronjob';
import { crdsBuilder } from './crds';
import { dynamicStorageBuilder } from './dynamicstorage';
import { gatewayBuilder } from './gateway';
import { deploymentBuilder } from './deployment';
import { helmBuilder } from './helm';
import { infraBuilder } from './infra';
import { kustomizeBuilder } from './kustomize';
import { netopsBuilder } from './netops';
import { observeBuilder } from './observe';
import { podBuilder } from './pod';
import { pvBuilder } from './pv';
import { pvcBuilder } from './pvc';
import { rbacBuilder } from './rbac';
import { storageClassBuilder } from './storageclass';
import type { Builder, PartBase } from './types';
import { upgradeBuilder } from './upgrade';
import { workloadOpsBuilder } from './workloadops';

export { composeCreate, type ChosenPart } from './compose';
export type { Addon, Builder, Choices, CreateCtx, FollowUp, PartBase } from './types';

export const BUILDERS: Builder[] = [
  deploymentBuilder,
  podBuilder,
  rbacBuilder,
  cronJobBuilder,
  pvcBuilder,
  pvBuilder,
  storageClassBuilder,
  hpaBuilder,
  vpaBuilder,
  helmBuilder,
  etcdBackupBuilder,
  etcdRestoreBuilder,
  certificatesBuilder,
  installClusterBuilder,
  kustomizeBuilder,
  crdsBuilder,
  observeBuilder,
  dynamicStorageBuilder,
  upgradeBuilder,
  infraBuilder,
  netopsBuilder,
  workloadOpsBuilder,
  gatewayBuilder,
];

export const getBuilder = (id: string): Builder | undefined => BUILDERS.find((b) => b.id === id);

const partSummary = (p: PartBase): PartSummary => ({
  id: p.id,
  name: p.name,
  description: p.description,
  points: p.points,
  fields: p.fields,
  ...(p.requires ? { requires: p.requires } : {}),
  ...(p.conflicts ? { conflicts: p.conflicts } : {}),
});

export const builderSummaries = (): BuilderSummary[] =>
  BUILDERS.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    domain: b.domain,
    difficulty: b.difficulty,
    minutes: b.minutes,
    points: b.points,
    tags: b.tags,
    fields: b.fields,
    addons: b.addons.map(partSummary),
    followUps: b.followUps.map(partSummary),
    track: b.track ?? 'create',
    breaksApi: !!b.breaksApi,
    base: b.base ?? 'cluster',
    solo: !!b.solo,
  }));

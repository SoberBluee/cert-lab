import { nameField, selectField } from '../types';
import { kgetc, noPod } from './shared';
import type { Addon, Builder, CreateCtx, FollowUp, Manifest } from './types';

const PROVISIONER = 'kubernetes.io/no-provisioner';
const DEFAULT_ANNOTATION = 'storageclass.kubernetes.io/is-default-class';
const BINDINGS = ['Immediate', 'WaitForFirstConsumer'];

const sc = (ctx: CreateCtx, template: string) => kgetc('storageclass', ctx.v.NAME, template);

const expansionCheck = (ctx: CreateCtx, id: string) => ({
  id,
  description: `${ctx.v.NAME} allows volume expansion`,
  type: 'kubectl' as const,
  run: sc(ctx, '{.allowVolumeExpansion}'),
  expect: { equals: 'true' },
  weight: 1,
});

const defaultCheck = (ctx: CreateCtx, id: string) => ({
  id,
  description: `${ctx.v.NAME} is the default StorageClass`,
  type: 'kubectl' as const,
  run: sc(ctx, `{.metadata.annotations.storageclass\\.kubernetes\\.io/is-default-class}`),
  expect: { equals: 'true' },
  weight: 1,
});

const allowExpansion: Addon = {
  id: 'allow-expansion',
  key: 'EXPAND',
  name: 'Allow volume expansion',
  description: 'Claims of this class may be resized later.',
  points: 1,
  conflicts: ['enable-expansion'],
  fields: [],
  apply(ctx) {
    ctx.manifests[0].allowVolumeExpansion = true;
    ctx.bullets.push('Claims using it must be allowed to grow (volume expansion).');
    ctx.checks.push(expansionCheck(ctx, 'expand'));
    ctx.hints.push('allowVolumeExpansion: true is a top-level field of the StorageClass.');
  },
};

const defaultClass: Addon = {
  id: 'default-class',
  key: 'DEFAULT',
  name: 'Default StorageClass',
  description: 'Claims without a storageClassName get this class.',
  points: 1,
  conflicts: ['make-default'],
  fields: [],
  apply(ctx) {
    const m = ctx.manifests[0];
    m.metadata.annotations = { ...m.metadata.annotations, [DEFAULT_ANNOTATION]: 'true' };
    ctx.bullets.push('It must be the cluster default StorageClass.');
    ctx.checks.push(defaultCheck(ctx, 'default'));
    ctx.hints.push(`The default class carries the annotation ${DEFAULT_ANNOTATION}: "true".`);
  },
};

const enableExpansion: FollowUp = {
  id: 'enable-expansion',
  key: 'ENEXPAND',
  name: 'Enable volume expansion in place',
  description: 'After creating it, allow expansion without recreating the class.',
  points: 1,
  conflicts: ['allow-expansion'],
  fields: [],
  apply(ctx) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then allow volume expansion on \`${NAME}\` without deleting it.`);
    ctx.solution.push(`kubectl patch storageclass "${NAME}" -p '{"allowVolumeExpansion": true}'`);
    ctx.checks.push(expansionCheck(ctx, 'enable-expansion'));
    ctx.hints.push(`kubectl patch storageclass ${NAME} -p '{"allowVolumeExpansion": true}'`);
  },
};

const makeDefault: FollowUp = {
  id: 'make-default',
  key: 'MKDEFAULT',
  name: 'Make it the default class',
  description: 'After creating it, mark it as the cluster default.',
  points: 1,
  conflicts: ['default-class'],
  fields: [],
  apply(ctx) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then make \`${NAME}\` the default StorageClass of the cluster.`);
    ctx.solution.push(`kubectl annotate storageclass "${NAME}" ${DEFAULT_ANNOTATION}=true --overwrite`);
    ctx.checks.push(defaultCheck(ctx, 'make-default'));
    ctx.hints.push(`kubectl annotate storageclass ${NAME} ${DEFAULT_ANNOTATION}=true`);
  },
};

const changeBinding: FollowUp = {
  id: 'change-binding',
  key: 'REBIND',
  name: 'Switch the binding mode',
  description: 'volumeBindingMode is immutable: the class has to be recreated under the same name.',
  points: 1,
  replacesChecks: ['binding'],
  fields: [],
  apply(ctx) {
    const { NAME, BINDING } = ctx.v;
    ctx.steps.push(`Then switch \`${NAME}\` from volume binding mode \`${BINDING}\` to the other mode. It must keep its name and every other setting.`);
    ctx.solution.push(
      `new=Immediate; [[ "${BINDING}" == Immediate ]] && new=WaitForFirstConsumer
kubectl get storageclass "${NAME}" -o yaml | sed "s/^volumeBindingMode: .*/volumeBindingMode: $new/" | kubectl replace --force -f -`,
    );
    ctx.checks.push({
      id: 'change-binding',
      description: `${NAME} no longer binds with ${BINDING}`,
      type: 'kubectl',
      run: sc(ctx, '{.volumeBindingMode}'),
      expect: { matches: `^(${BINDINGS.join('|')})$`, notContains: BINDING },
      weight: 2,
    });
    ctx.hints.push(`The field cannot be edited: kubectl get storageclass ${NAME} -o yaml > sc.yaml, change it, then kubectl replace --force -f sc.yaml.`);
  },
};

export const storageClassBuilder: Builder = {
  id: 'storageclass',
  name: 'StorageClass',
  description: 'A StorageClass for statically provisioned volumes, with a reclaim policy and binding mode.',
  domain: 'storage',
  difficulty: 1,
  minutes: 3,
  points: 3,
  tags: ['storageclass'],
  fields: [
    nameField('NAME', 'StorageClass name', ['gold', 'silver', 'bronze']),
    selectField('RECLAIM', 'Reclaim policy', ['Retain', 'Delete']),
    selectField('BINDING', 'Volume binding mode', BINDINGS),
  ],
  addons: [allowExpansion, defaultClass],
  followUps: [enableExpansion, makeDefault, changeBinding],
  build(v) {
    const { NAME, RECLAIM, BINDING } = v;
    const m: Manifest = {
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      metadata: { name: NAME },
      provisioner: PROVISIONER,
      reclaimPolicy: RECLAIM,
      volumeBindingMode: BINDING,
    };
    const ctx: CreateCtx = {
      v,
      ns: '',
      ref: `storageclass/${NAME}`,
      podPath: '',
      title: `StorageClass ${NAME}`,
      intro: `Create a StorageClass \`${NAME}\` for statically provisioned volumes (provisioner \`${PROVISIONER}\`) with reclaim policy \`${RECLAIM}\` and volume binding mode \`${BINDING}\`.`,
      bullets: [],
      steps: [],
      manifests: [m],
      podSpec: noPod('StorageClass'),
      container: noPod('StorageClass'),
      checks: [],
      hints: ['kubectl explain storageclass lists the fields; there is no kubectl create storageclass, so write the YAML.'],
      setup: [],
      solution: [],
    };
    ctx.checks.push(
      {
        id: 'provisioner',
        description: `${NAME} uses ${PROVISIONER}`,
        type: 'kubectl',
        run: sc(ctx, '{.provisioner}'),
        expect: { equals: PROVISIONER },
        weight: 1,
      },
      {
        id: 'reclaim',
        description: `${NAME} has reclaim policy ${RECLAIM}`,
        type: 'kubectl',
        run: sc(ctx, '{.reclaimPolicy}'),
        expect: { equals: RECLAIM },
        weight: 1,
      },
      {
        id: 'binding',
        description: `${NAME} binds with ${BINDING}`,
        type: 'kubectl',
        run: sc(ctx, '{.volumeBindingMode}'),
        expect: { equals: BINDING },
        weight: 1,
      },
    );
    return ctx;
  },
};

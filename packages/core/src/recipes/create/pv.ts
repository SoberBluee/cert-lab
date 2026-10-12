import { createNs, nameField, nsField, selectField } from '../types';
import { kgetc, noPod } from './shared';
import { mayCollide, type Addon, type Builder, type CreateCtx, type FollowUp, type Manifest } from './types';

const CAPACITIES = ['1Gi', '2Gi', '5Gi'];
const NODES = ['worker-1', 'worker-2'];

const pv = (ctx: CreateCtx, template: string) => kgetc('pv', ctx.v.NAME, template);

const nodeAffinity: Addon = {
  id: 'node-affinity',
  key: 'AFFINITY',
  name: 'Pin to a node (nodeAffinity)',
  description: 'The volume lives on one worker, so Pods using it must run there.',
  points: 2,
  fields: [selectField('NODE', 'Worker', NODES, { randomizeByDefault: true })],
  apply(ctx, { NODE }) {
    ctx.manifests[0].spec.nodeAffinity = {
      required: { nodeSelectorTerms: [{ matchExpressions: [{ key: 'kubernetes.io/hostname', operator: 'In', values: [NODE] }] }] },
    };
    ctx.bullets.push(`The volume only exists on \`${NODE}\`: give it a required node affinity on \`kubernetes.io/hostname\`.`);
    ctx.checks.push({
      id: 'affinity',
      description: `${ctx.v.NAME} is pinned to ${NODE}`,
      type: 'kubectl',
      run: pv(
        ctx,
        '{.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].key}={.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values[0]}',
      ),
      expect: { equals: `kubernetes.io/hostname=${NODE}` },
      weight: 2,
    });
    ctx.hints.push('spec.nodeAffinity.required.nodeSelectorTerms[].matchExpressions[] with key kubernetes.io/hostname, operator In.');
  },
};

const labels: Addon = {
  id: 'labels',
  key: 'LABEL',
  name: 'Label for selectors',
  description: 'A tier label that claims can select on.',
  points: 1,
  fields: [nameField('TIER', 'Value of the tier label', ['premium', 'standard', 'archive'])],
  apply(ctx, { TIER }) {
    const m = ctx.manifests[0];
    m.metadata.labels = { ...m.metadata.labels, tier: TIER };
    ctx.bullets.push(`It carries the label \`tier=${TIER}\`.`);
    ctx.checks.push({
      id: 'label',
      description: `${ctx.v.NAME} is labelled tier=${TIER}`,
      type: 'kubectl',
      run: pv(ctx, '{.metadata.labels.tier}'),
      expect: { equals: TIER },
      weight: 1,
    });
    ctx.hints.push(`kubectl label pv ${ctx.v.NAME} tier=${TIER} works too.`);
  },
};

const claim: Addon = {
  id: 'claim',
  key: 'CLAIM',
  name: 'Claim it',
  description: 'A PersistentVolumeClaim in a namespace binds to exactly this volume.',
  points: 1,
  replacesChecks: ['phase'],
  conflicts: ['reserve'],
  fields: [nsField(['vault', 'records', 'ledger'])],
  apply(ctx, { NS }) {
    const { NAME, CAPACITY, ACCESS } = ctx.v;
    ctx.ns = NS;
    ctx.setup.push(createNs(NS));
    ctx.manifests.push({
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: `${NAME}-claim`, namespace: NS },
      spec: {
        storageClassName: 'manual',
        accessModes: [ACCESS],
        volumeName: NAME,
        resources: { requests: { storage: CAPACITY } },
      },
    });
    ctx.bullets.push(`Create a PersistentVolumeClaim \`${NAME}-claim\` in namespace \`${NS}\` that binds to \`${NAME}\` and requests all of it.`);
    ctx.solution.push(`kubectl -n "${NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${NAME}-claim" --timeout=60s`);
    ctx.checks.push({
      id: 'claim-bound',
      description: `PVC ${NAME}-claim is Bound to ${NAME}`,
      type: 'kubectl',
      run: `kubectl -n ${NS} get pvc ${NAME}-claim -o jsonpath='{.status.phase}/{.spec.volumeName}'`,
      expect: { equals: `Bound/${NAME}` },
      weight: 2,
      retrySeconds: 30,
    });
    ctx.hints.push('spec.volumeName on the claim binds it to one named PV. Class, access mode and size must still fit.');
  },
};

const resize: FollowUp = {
  id: 'resize',
  key: 'RESIZE',
  name: 'Change its capacity',
  description: 'After creating it, give the volume a new capacity in place.',
  points: 1,
  replacesChecks: ['capacity'],
  fields: [selectField('CAPACITY', 'New capacity', ['3Gi', '10Gi'])],
  validate: (v, base) => (mayCollide(base.CAPACITY, v.CAPACITY) ? 'The new capacity could equal the original one.' : undefined),
  apply(ctx, { CAPACITY }) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then change the capacity of \`${NAME}\` to \`${CAPACITY}\` without recreating it.`);
    ctx.solution.push(`kubectl patch pv "${NAME}" -p '{"spec": {"capacity": {"storage": "'"${CAPACITY}"'"}}}'`);
    ctx.checks.push({
      id: 'resize',
      description: `${NAME} holds ${CAPACITY}`,
      type: 'kubectl',
      run: pv(ctx, '{.spec.capacity.storage}'),
      expect: { equals: CAPACITY },
      weight: 2,
    });
    ctx.hints.push(`kubectl edit pv ${NAME}: spec.capacity.storage.`);
  },
};

const reserve: FollowUp = {
  id: 'reserve',
  key: 'RESERVE',
  name: 'Reserve it for a future claim',
  description: 'After creating it, pre-bind the volume to a claim that does not exist yet.',
  points: 2,
  conflicts: ['claim'],
  fields: [nsField(['inventory', 'payroll', 'catalogue']), nameField('CLAIM', 'Claim name', ['future-claim', 'reserved-app', 'next-db'])],
  apply(ctx, { NS, CLAIM }) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then reserve \`${NAME}\` for a claim \`${CLAIM}\` in namespace \`${NS}\` that will be created later, so no other claim can take it.`);
    ctx.solution.push(`kubectl patch pv "${NAME}" -p '{"spec": {"claimRef": {"namespace": "'"${NS}"'", "name": "'"${CLAIM}"'"}}}'`);
    ctx.checks.push({
      id: 'reserve',
      description: `${NAME} is reserved for ${NS}/${CLAIM}`,
      type: 'kubectl',
      run: pv(ctx, '{.spec.claimRef.namespace}/{.spec.claimRef.name}'),
      expect: { equals: `${NS}/${CLAIM}` },
      weight: 2,
    });
    ctx.hints.push('spec.claimRef with a namespace and name pre-binds a PV.');
  },
};

const releaseReuse: FollowUp = {
  id: 'release-reuse',
  key: 'REUSE',
  name: 'Release it and make it reusable',
  description: 'After the claim is bound, delete it without losing the volume, then make the volume Available again.',
  points: 1,
  requires: ['claim'],
  replacesChecks: ['reclaim', 'claim-bound'],
  fields: [],
  apply(ctx) {
    const { NAME } = ctx.v;
    const ns = ctx.ns;
    ctx.steps.push(
      `Then delete the claim \`${NAME}-claim\` without losing the volume: \`${NAME}\` must end up with reclaim policy \`Retain\` and be \`Available\` for a new claim.`,
    );
    ctx.solution.push(
      `kubectl patch pv "${NAME}" -p '{"spec": {"persistentVolumeReclaimPolicy": "Retain"}}'`,
      `kubectl -n "${ns}" delete pvc "${NAME}-claim" --wait=true`,
      `kubectl wait --for=jsonpath='{.status.phase}'=Released "pv/${NAME}" --timeout=60s`,
      `kubectl patch pv "${NAME}" --type json -p '[{"op": "remove", "path": "/spec/claimRef"}]'`,
      `kubectl wait --for=jsonpath='{.status.phase}'=Available "pv/${NAME}" --timeout=60s`,
    );
    ctx.checks.push(
      {
        id: 'reuse-retain',
        description: `${NAME} has reclaim policy Retain`,
        type: 'kubectl',
        run: pv(ctx, '{.spec.persistentVolumeReclaimPolicy}'),
        expect: { equals: 'Retain' },
        weight: 1,
      },
      {
        id: 'reuse-claim-gone',
        description: `PVC ${NAME}-claim is deleted`,
        type: 'kubectl',
        run: `kubectl -n ${ns} get pvc ${NAME}-claim --ignore-not-found -o name`,
        expect: { notEmpty: false },
        weight: 1,
      },
      {
        id: 'reuse-available',
        description: `${NAME} is Available with no claimRef`,
        type: 'kubectl',
        run: pv(ctx, '{.status.phase}/{.spec.claimRef.name}'),
        expect: { equals: 'Available/' },
        weight: 2,
        retrySeconds: 30,
      },
    );
    ctx.hints.push('Set Retain before deleting the claim. A Released PV keeps its claimRef; remove it (kubectl edit, or a JSON patch) to make it Available.');
  },
};

export const pvBuilder: Builder = {
  id: 'pv',
  name: 'PersistentVolume',
  description: 'A statically provisioned hostPath PersistentVolume with a capacity, access mode and reclaim policy.',
  domain: 'storage',
  difficulty: 1,
  minutes: 4,
  points: 4,
  tags: ['pv'],
  fields: [
    nameField('NAME', 'PersistentVolume name', ['data-pv', 'logs-pv', 'media-pv']),
    selectField('CAPACITY', 'Capacity', CAPACITIES),
    selectField('ACCESS', 'Access mode', ['ReadWriteOnce', 'ReadWriteMany', 'ReadOnlyMany']),
    selectField('RECLAIM', 'Reclaim policy', ['Retain', 'Delete']),
  ],
  addons: [nodeAffinity, labels, claim],
  followUps: [resize, reserve, releaseReuse],
  build(v) {
    const { NAME, CAPACITY, ACCESS, RECLAIM } = v;
    const m: Manifest = {
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: { name: NAME },
      spec: {
        capacity: { storage: CAPACITY },
        accessModes: [ACCESS],
        persistentVolumeReclaimPolicy: RECLAIM,
        storageClassName: 'manual',
        hostPath: { path: `/srv/${NAME}`, type: 'DirectoryOrCreate' },
      },
    };
    const ctx: CreateCtx = {
      v,
      ns: '',
      ref: `pv/${NAME}`,
      podPath: '',
      title: `PersistentVolume ${NAME}`,
      intro: `Create a PersistentVolume \`${NAME}\` of \`${CAPACITY}\` with access mode \`${ACCESS}\`, reclaim policy \`${RECLAIM}\` and StorageClass \`manual\`, backed by the host directory \`/srv/${NAME}\` (created if missing).`,
      bullets: [],
      steps: [],
      manifests: [m],
      podSpec: noPod('PersistentVolume'),
      container: noPod('PersistentVolume'),
      checks: [],
      hints: ['There is no kubectl create pv: copy a PersistentVolume example from the docs (hostPath) and adjust it.'],
      setup: [],
      solution: [],
    };
    ctx.checks.push(
      {
        id: 'capacity',
        description: `${NAME} holds ${CAPACITY}`,
        type: 'kubectl',
        run: pv(ctx, '{.spec.capacity.storage}'),
        expect: { equals: CAPACITY },
        weight: 1,
      },
      {
        id: 'spec',
        description: `${NAME} is ${ACCESS}, class manual, at /srv/${NAME}`,
        type: 'kubectl',
        run: pv(ctx, '{.spec.accessModes[0]}/{.spec.storageClassName}/{.spec.hostPath.path}'),
        expect: { equals: `${ACCESS}/manual//srv/${NAME}` },
        weight: 1,
      },
      {
        id: 'reclaim',
        description: `${NAME} has reclaim policy ${RECLAIM}`,
        type: 'kubectl',
        run: pv(ctx, '{.spec.persistentVolumeReclaimPolicy}'),
        expect: { equals: RECLAIM },
        weight: 1,
      },
      {
        id: 'phase',
        description: `${NAME} is Available`,
        type: 'kubectl',
        run: pv(ctx, '{.status.phase}'),
        expect: { equals: 'Available' },
        weight: 1,
        retrySeconds: 20,
      },
    );
    return ctx;
  },
};

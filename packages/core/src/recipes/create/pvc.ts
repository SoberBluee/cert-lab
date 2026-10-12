import { createNs, nameField, nsField, selectField } from '../types';
import { noPod } from './shared';
import type { Addon, Builder, CreateCtx, FollowUp, Manifest } from './types';

const MODES: Record<string, { label: string; readOnly: boolean }> = {
  'read-write': { label: 'The Pod can write to the volume', readOnly: false },
  'read-only': { label: 'The Pod mounts the volume read-only', readOnly: true },
};

/** A hostPath PV of class manual that fits any claim this builder asks for. */
const pvYaml = (name: string, path: string, capacity: string, label?: string) => `kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: ${name}${label ? `\n  labels: { tier: ${label} }` : ''}
spec:
  capacity: { storage: ${capacity} }
  accessModes: [ReadWriteOnce, ReadWriteMany]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /srv/${path}
    type: DirectoryOrCreate
EOF`;

/** A smaller decoy PV that the binder prefers, so the claim has to pick the intended one explicitly. */
const decoy = (ctx: CreateCtx, labelled: boolean) => {
  const { NAME } = ctx.v;
  ctx.setup.push(
    `kubectl patch pv "${NAME}-pv" -p '{"spec": {"capacity": {"storage": "2Gi"}}}'`,
    pvYaml(`${NAME}-pv-old`, `${NAME}-old`, '1Gi', labelled ? 'legacy' : undefined),
  );
};

const claimOf = (ctx: CreateCtx) => ctx.manifests.find((m) => m.kind === 'PersistentVolumeClaim')!;

const selector: Addon = {
  id: 'selector',
  key: 'SELECT',
  name: 'Bind by label selector',
  description: 'Two PVs fit; the claim must select the right one by label.',
  points: 1,
  conflicts: ['volume-name'],
  fields: [nameField('TIER', 'Value of the tier label', ['premium', 'standard', 'backup'])],
  apply(ctx, { TIER }) {
    const { NAME } = ctx.v;
    decoy(ctx, true);
    ctx.setup.push(`kubectl label pv "${NAME}-pv" tier="${TIER}" --overwrite`);
    claimOf(ctx).spec.selector = { matchLabels: { tier: TIER } };
    ctx.bullets.push(`Several PVs fit. The claim must pick its volume with a label selector on \`tier=${TIER}\`.`);
    ctx.checks.push({
      id: 'selector',
      description: `the claim selects tier=${TIER}`,
      type: 'kubectl',
      run: `kubectl -n ${ctx.ns} get pvc ${NAME} -o jsonpath='{.spec.selector.matchLabels.tier}'`,
      expect: { equals: TIER },
      weight: 1,
    });
    ctx.hints.push('kubectl get pv --show-labels; then spec.selector.matchLabels on the claim.');
  },
};

const volumeName: Addon = {
  id: 'volume-name',
  key: 'VOLNAME',
  name: 'Bind to a named PV',
  description: 'Two PVs fit; the claim must name the one it wants.',
  points: 1,
  conflicts: ['selector'],
  fields: [],
  apply(ctx) {
    const { NAME } = ctx.v;
    decoy(ctx, false);
    claimOf(ctx).spec.volumeName = `${NAME}-pv`;
    ctx.bullets.push(`Several PVs fit. The claim must bind to \`${NAME}-pv\` by name, leaving \`${NAME}-pv-old\` free.`);
    ctx.checks.push({
      id: 'decoy-free',
      description: `${NAME}-pv-old is still Available`,
      type: 'kubectl',
      run: `kubectl get pv ${NAME}-pv-old -o jsonpath='{.status.phase}'`,
      expect: { equals: 'Available' },
      weight: 1,
    });
    ctx.hints.push('spec.volumeName on the claim binds it to one named PV.');
  },
};

const consumerPod: Addon = {
  id: 'consumer-pod',
  key: 'POD',
  name: 'Mount it in a Pod',
  description: 'A Pod mounts the claim, read-write or read-only.',
  points: 3,
  fields: [
    {
      key: 'MOUNT',
      label: 'Mount path',
      type: 'text',
      default: '/data',
      pattern: '^/[A-Za-z0-9._/-]+$',
      pool: ['/data', '/srv/app', '/var/lib/app'],
    },
    {
      key: 'MODE',
      label: 'Access from the Pod',
      help: Object.entries(MODES)
        .map(([id, m]) => `${id}: ${m.label}`)
        .join('; '),
      type: 'select',
      default: 'read-write',
      options: Object.keys(MODES),
    },
  ],
  apply(ctx, { MOUNT, MODE }) {
    const { NAME } = ctx.v;
    const ro = (MODES[MODE] ?? MODES['read-write']).readOnly;
    const pod = `${NAME}-app`;
    ctx.manifests.push({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: pod, namespace: ctx.ns },
      spec: {
        containers: [
          {
            name: 'app',
            image: 'busybox:1.36',
            command: ['sleep', '1d'],
            volumeMounts: [{ name: 'data', mountPath: MOUNT, ...(ro ? { readOnly: true } : {}) }],
          },
        ],
        volumes: [{ name: 'data', persistentVolumeClaim: { claimName: NAME } }],
      },
    });
    ctx.bullets.push(`Create a Pod \`${pod}\` (image \`busybox:1.36\`, command \`sleep 1d\`) that mounts the claim at \`${MOUNT}\`${ro ? ' read-only' : ''}.`);
    ctx.solution.push(`kubectl -n "${ctx.ns}" wait --for=condition=Ready "pod/${pod}" --timeout=180s`);
    ctx.checks.push(
      {
        id: 'pod-running',
        description: `Pod ${pod} is Running with the claim at ${MOUNT}`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get pod ${pod} -o jsonpath='{.status.phase} {.spec.volumes[*].persistentVolumeClaim.claimName} {.spec.containers[0].volumeMounts[*].mountPath}'`,
        expect: { equals: `Running ${NAME} ${MOUNT}` },
        weight: 2,
        retrySeconds: 30,
      },
      {
        id: 'pod-mode',
        description: ro ? `${MOUNT} is read-only in ${pod}` : `${pod} can write to ${MOUNT}`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} exec ${pod} -- sh -c 'touch "${MOUNT}/.cka-write" 2>/dev/null && echo rw || echo ro'`,
        expect: { equals: ro ? 'ro' : 'rw' },
        weight: 1,
        retrySeconds: 20,
      },
    );
    ctx.hints.push(`volumes: [{name: data, persistentVolumeClaim: {claimName: ${NAME}}}], then a volumeMount${ro ? ' with readOnly: true' : ''}.`);
  },
};

const deleteKeepData: FollowUp = {
  id: 'delete-keep-data',
  key: 'DELETE',
  name: 'Delete the claim, keep the volume',
  description: 'After it is bound, delete the claim (and anything using it); the Retain PV must survive as Released.',
  points: 1,
  replacesChecks: ['bound', 'spec', 'selector', 'pod-running', 'pod-mode'],
  fields: [],
  apply(ctx) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then delete the claim \`${NAME}\` and any Pod using it. \`${NAME}-pv\` must not be deleted.`);
    ctx.solution.push(
      `kubectl -n "${ctx.ns}" delete pod "${NAME}-app" --ignore-not-found --wait=true`,
      `kubectl -n "${ctx.ns}" delete pvc "${NAME}" --wait=true`,
      `kubectl wait --for=jsonpath='{.status.phase}'=Released "pv/${NAME}-pv" --timeout=60s`,
    );
    ctx.checks.push(
      {
        id: 'deleted',
        description: `PVC ${NAME} is deleted`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get pvc ${NAME} --ignore-not-found -o name`,
        expect: { notEmpty: false },
        weight: 2,
      },
      {
        id: 'released',
        description: `${NAME}-pv still exists and is Released`,
        type: 'kubectl',
        run: `kubectl get pv ${NAME}-pv -o jsonpath='{.status.phase}'`,
        expect: { equals: 'Released' },
        weight: 2,
        retrySeconds: 30,
      },
    );
    ctx.hints.push('A claim in use by a Pod stays Terminating until the Pod is gone. With reclaim policy Retain the PV becomes Released.');
  },
};

const rebind: FollowUp = {
  id: 'rebind',
  key: 'REBIND',
  name: 'Bind the released volume again',
  description: 'After the delete, reuse the Released PV for a new claim.',
  points: 1,
  requires: ['delete-keep-data'],
  replacesChecks: ['released'],
  fields: [],
  apply(ctx) {
    const { NAME, SIZE, ACCESS } = ctx.v;
    const next = `${NAME}-v2`;
    ctx.steps.push(
      `Then create a new claim \`${next}\` (StorageClass \`manual\`, \`${ACCESS}\`, \`${SIZE}\`) in the same namespace and bind it to \`${NAME}-pv\`, keeping its data.`,
    );
    ctx.solution.push(
      `kubectl patch pv "${NAME}-pv" --type json -p '[{"op": "remove", "path": "/spec/claimRef"}]'`,
      `kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${next}"
  namespace: "${ctx.ns}"
spec:
  storageClassName: manual
  accessModes: ["${ACCESS}"]
  volumeName: "${NAME}-pv"
  resources:
    requests:
      storage: "${SIZE}"
EOF`,
      `kubectl -n "${ctx.ns}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${next}" --timeout=60s`,
    );
    ctx.checks.push(
      {
        id: 'rebind-bound',
        description: `PVC ${next} is Bound to ${NAME}-pv`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get pvc ${next} -o jsonpath='{.status.phase}/{.spec.volumeName}'`,
        expect: { equals: `Bound/${NAME}-pv` },
        weight: 2,
        retrySeconds: 30,
      },
      {
        id: 'rebind-spec',
        description: `PVC ${next} requests ${SIZE} with ${ACCESS}`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get pvc ${next} -o jsonpath='{.spec.resources.requests.storage}/{.spec.accessModes[0]}'`,
        expect: { equals: `${SIZE}/${ACCESS}` },
        weight: 1,
      },
    );
    ctx.hints.push(`A Released PV still points at the old claim: remove spec.claimRef from ${NAME}-pv, then claim it by volumeName.`);
  },
};

export const pvcBuilder: Builder = {
  id: 'pvc',
  name: 'PersistentVolumeClaim',
  description: 'A claim that binds to an existing PersistentVolume.',
  domain: 'storage',
  difficulty: 1,
  minutes: 4,
  points: 3,
  tags: ['pvc', 'pv'],
  fields: [
    nsField(['billing', 'orders-app', 'photo-lib']),
    nameField('NAME', 'Claim name', ['orders', 'invoices', 'photos'], 'The prepared PV is <claim>-pv.'),
    selectField('SIZE', 'Requested size', ['100Mi', '500Mi', '1Gi']),
    selectField('ACCESS', 'Access mode', ['ReadWriteOnce', 'ReadWriteMany']),
  ],
  addons: [selector, volumeName, consumerPod],
  followUps: [deleteKeepData, rebind],
  build(v) {
    const { NS, NAME, SIZE, ACCESS } = v;
    const claim: Manifest = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: NAME, namespace: NS },
      spec: {
        storageClassName: 'manual',
        accessModes: [ACCESS],
        resources: { requests: { storage: SIZE } },
      },
    };
    const ctx: CreateCtx = {
      v,
      ns: NS,
      ref: `pvc/${NAME}`,
      podPath: '',
      title: `PersistentVolumeClaim ${NAME}`,
      intro: `PersistentVolume \`${NAME}-pv\` (StorageClass \`manual\`, reclaim policy \`Retain\`) already exists. Create a PersistentVolumeClaim \`${NAME}\` in namespace \`${NS}\` requesting \`${SIZE}\` with access mode \`${ACCESS}\` and StorageClass \`manual\`, bound to \`${NAME}-pv\`.`,
      bullets: [],
      steps: [],
      manifests: [claim],
      podSpec: noPod('PersistentVolumeClaim'),
      container: noPod('PersistentVolumeClaim'),
      checks: [],
      hints: [`kubectl get pv ${NAME}-pv shows the class, access modes and capacity the claim must fit.`],
      setup: [createNs(NS), pvYaml(`${NAME}-pv`, NAME, '1Gi')],
      solution: [`kubectl -n "${NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${NAME}" --timeout=60s`],
    };
    ctx.checks.push(
      {
        id: 'bound',
        description: `PVC ${NAME} is Bound to ${NAME}-pv`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pvc ${NAME} -o jsonpath='{.status.phase}/{.spec.volumeName}'`,
        expect: { equals: `Bound/${NAME}-pv` },
        weight: 2,
        retrySeconds: 30,
      },
      {
        id: 'spec',
        description: `PVC ${NAME} requests ${SIZE} with ${ACCESS} and class manual`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pvc ${NAME} -o jsonpath='{.spec.storageClassName}/{.spec.accessModes[0]}/{.spec.resources.requests.storage}'`,
        expect: { equals: `manual/${ACCESS}/${SIZE}` },
        weight: 1,
      },
    );
    return ctx;
  },
};

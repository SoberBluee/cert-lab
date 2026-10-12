import { bare, createNs, nameField, nsField, numberField, selectField, type RecipeCheck } from '../types';
import { envAddon, imagePair, kexec, kget, resourcesAddon, SOURCES } from './shared';
import type { Addon, Builder, CreateCtx, FollowUp, Manifest } from './types';

const LOG = '/data/out.log';

interface CommandPreset {
  label: string;
  /** What the student is asked to make the container do. */
  task: string;
  script: string;
  check: (ctx: CreateCtx) => Omit<RecipeCheck, 'id' | 'weight'>;
}

/** Every preset writes to /data/out.log, so any sidecar preset has something to work with. */
const COMMANDS: Record<string, CommandPreset> = {
  'date-log': {
    label: 'Append the date to /data/out.log every 5 seconds',
    task: `appends the output of \`date\` to \`${LOG}\` every 5 seconds, forever, and also prints it to standard output`,
    script: `while true; do date | tee -a ${LOG}; sleep 5; done`,
    check: (ctx) => ({
      description: `${LOG} keeps growing`,
      type: 'kubectl',
      run: kexec(ctx, `sh -c 'a=$(wc -l < ${LOG}); sleep 6; b=$(wc -l < ${LOG}); [ "$b" -gt "$a" ] && echo growing'`),
      expect: { equals: 'growing' },
    }),
  },
  hostname: {
    label: 'Write the hostname to /data/out.log, then sleep',
    task: `writes its hostname to \`${LOG}\` and to standard output once, then sleeps forever`,
    script: `hostname | tee ${LOG}; sleep infinity`,
    check: (ctx) => ({
      description: `${LOG} holds the Pod's hostname`,
      type: 'kubectl',
      run: kexec(ctx, `cat ${LOG}`),
      expect: { equals: ctx.v.NAME },
    }),
  },
  count: {
    label: 'Count from 1 to 100 into /data/out.log, then sleep',
    task: `writes the numbers 1 to 100, one per line, to \`${LOG}\` and to standard output, then sleeps forever`,
    script: `seq 1 100 | tee ${LOG}; sleep infinity`,
    check: (ctx) => ({
      description: `${LOG} counts to 100`,
      type: 'kubectl',
      run: kexec(ctx, `sh -c 'wc -l < ${LOG}; tail -n 1 ${LOG}' | tr '\\n' ' '`),
      expect: { equals: '100 100' },
    }),
  },
};

interface SidecarPreset {
  label: string;
  task: string;
  apply: (spec: Manifest) => void;
  check: (ctx: CreateCtx) => Omit<RecipeCheck, 'id' | 'weight'>;
}

const SIDECAR_IMAGE = 'busybox:1.36';
const mount = { name: 'data', mountPath: '/data' };

const SIDECARS: Record<string, SidecarPreset> = {
  tailer: {
    label: 'Log tailer container sharing the volume',
    task: `Add a second container \`tailer\` (image \`${SIDECAR_IMAGE}\`) that mounts the same volume and streams \`${LOG}\` to its standard output with \`tail -F\`.`,
    apply: (spec) =>
      spec.containers.push({
        name: 'tailer',
        image: SIDECAR_IMAGE,
        command: ['sh', '-c', `tail -F ${LOG}`],
        volumeMounts: [mount],
      }),
    check: (ctx) => ({
      description: 'container tailer prints the log',
      type: 'kubectl',
      run: `kubectl -n ${ctx.ns} logs ${ctx.ref} -c tailer --tail=5`,
      expect: { notEmpty: true },
    }),
  },
  native: {
    label: 'Native sidecar (init container with restartPolicy: Always)',
    task: `Add a native sidecar: an init container \`shipper\` (image \`${SIDECAR_IMAGE}\`) with \`restartPolicy: Always\` that mounts the same volume and streams \`${LOG}\` with \`tail -F\`.`,
    apply: (spec) =>
      (spec.initContainers = [
        ...(spec.initContainers ?? []),
        {
          name: 'shipper',
          image: SIDECAR_IMAGE,
          restartPolicy: 'Always',
          command: ['sh', '-c', `touch ${LOG}; tail -F ${LOG}`],
          volumeMounts: [mount],
        },
      ]),
    check: (ctx) => ({
      description: 'shipper is a native sidecar printing the log',
      type: 'kubectl',
      run: `echo "$(kubectl -n ${ctx.ns} get ${ctx.ref} -o jsonpath='{.spec.initContainers[?(@.name=="shipper")].restartPolicy}')/$(kubectl -n ${ctx.ns} logs ${ctx.ref} -c shipper --tail=5 | wc -l)"`,
      expect: { matches: '^Always/ *[1-9]' },
    }),
  },
  httpd: {
    label: 'busybox httpd serving the shared file',
    task: `Add a second container \`web\` (image \`${SIDECAR_IMAGE}\`) that mounts the same volume and serves \`/data\` over HTTP on port \`8080\` with \`httpd -f -p 8080 -h /data\`.`,
    apply: (spec) =>
      spec.containers.push({
        name: 'web',
        image: SIDECAR_IMAGE,
        command: ['httpd', '-f', '-p', '8080', '-h', '/data'],
        ports: [{ containerPort: 8080 }],
        volumeMounts: [mount],
      }),
    check: (ctx) => ({
      description: 'http://localhost:8080/out.log serves the log',
      type: 'kubectl',
      run: kexec(ctx, 'wget -qO- -T 3 http://localhost:8080/out.log'),
      expect: { notEmpty: true },
    }),
  },
};

const presetField = (label: string, presets: Record<string, { label: string }>) => ({
  key: 'PRESET',
  label,
  help: Object.entries(presets)
    .map(([id, p]) => `${id}: ${p.label}`)
    .join('; '),
  type: 'select' as const,
  default: Object.keys(presets)[0],
  options: Object.keys(presets),
});

const preset = <T>(presets: Record<string, T>, id: string): T => presets[id] ?? Object.values(presets)[0];

const ensureDataVolume = (ctx: CreateCtx) => {
  const spec = ctx.podSpec();
  if (!spec.volumes?.some((v: Manifest) => v.name === 'data')) spec.volumes = [...(spec.volumes ?? []), { name: 'data', emptyDir: {} }];
  const c = ctx.container();
  if (!c.volumeMounts?.some((m: Manifest) => m.name === 'data')) c.volumeMounts = [...(c.volumeMounts ?? []), { ...mount }];
};

const command: Addon = {
  id: 'command',
  key: 'CMD',
  name: 'Command',
  description: 'The container runs a given shell command, picked from presets, writing to an emptyDir.',
  points: 2,
  fields: [presetField('What the command does', COMMANDS)],
  apply(ctx, { PRESET }) {
    const p = preset(COMMANDS, PRESET);
    ensureDataVolume(ctx);
    ctx.container().command = ['sh', '-c', p.script];
    ctx.bullets.push(`Mount an \`emptyDir\` volume named \`data\` at \`/data\`. The container runs a shell command that ${p.task}.`);
    ctx.checks.push({
      id: 'cmd-output',
      weight: 2,
      retrySeconds: 30,
      ...p.check(ctx),
    } as RecipeCheck);
    ctx.hints.push(`command: ["sh", "-c", "..."] replaces the image's entrypoint. Try the loop with kubectl exec first.`);
  },
};

const sidecar: Addon = {
  id: 'sidecar',
  key: 'SIDECAR',
  name: 'Sidecar',
  description: 'A second container that works with the command output, picked from presets.',
  points: 2,
  requires: ['command'],
  fields: [presetField('Sidecar', SIDECARS)],
  apply(ctx, { PRESET }) {
    const p = preset(SIDECARS, PRESET);
    ensureDataVolume(ctx);
    p.apply(ctx.podSpec());
    ctx.bullets.push(p.task);
    ctx.checks.push({
      id: 'sidecar',
      weight: 2,
      retrySeconds: 30,
      ...p.check(ctx),
    } as RecipeCheck);
    ctx.hints.push('Containers in one Pod share volumes: mount the same emptyDir in both.');
  },
};

const security: Addon = {
  id: 'security',
  key: 'SEC',
  name: 'Security context',
  description: 'The main container runs as a given user with a read-only root filesystem.',
  points: 2,
  fields: [
    numberField('USER', 'runAsUser', ['1000', '2000', '3000'], 1, 65535, {
      randomizeByDefault: true,
    }),
  ],
  apply(ctx, { USER }) {
    const c = ctx.container();
    c.securityContext = {
      ...c.securityContext,
      runAsUser: bare(USER),
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
    };
    ctx.bullets.push(`The container runs as user \`${USER}\`, with a read-only root filesystem and no privilege escalation.`);
    ctx.checks.push(
      {
        id: 'sec-user',
        description: `the container runs as uid ${USER}`,
        type: 'kubectl',
        run: kexec(ctx, 'id -u'),
        expect: { equals: USER },
        weight: 1,
        retrySeconds: 20,
      },
      {
        id: 'sec-readonly',
        description: 'root filesystem is read-only and escalation is off',
        type: 'kubectl',
        run: kget(ctx, '{%.containers[0].securityContext.readOnlyRootFilesystem}/{%.containers[0].securityContext.allowPrivilegeEscalation}'),
        expect: { equals: 'true/false' },
        weight: 1,
      },
    );
    ctx.hints.push('securityContext on the container: runAsUser, readOnlyRootFilesystem, allowPrivilegeEscalation.');
  },
};

const pvcMount: Addon = {
  id: 'pvc',
  key: 'PVC',
  name: 'PersistentVolumeClaim mount',
  description: 'A PV exists; the student claims it and mounts it in the Pod.',
  points: 3,
  fields: [
    nameField('CLAIM', 'Claim name', ['uploads', 'scratch', 'shared-data'], 'The PV is named <claim>-pv.'),
    selectField('SIZE', 'Requested size', ['100Mi', '500Mi', '1Gi']),
    {
      key: 'MOUNT',
      label: 'Mount path',
      type: 'text',
      default: '/var/lib/app',
      pattern: '^/(?!data(/|$))[A-Za-z0-9._/-]+$',
      help: 'An absolute path inside the container, other than /data.',
      pool: ['/var/lib/app', '/srv/files', '/mnt/store'],
    },
  ],
  apply(ctx, { CLAIM, SIZE, MOUNT }) {
    ctx.setup.push(`kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: ${CLAIM}-pv
spec:
  capacity: { storage: 1Gi }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /srv/${CLAIM}
    type: DirectoryOrCreate
EOF`);
    ctx.manifests.unshift({
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: CLAIM, namespace: ctx.ns },
      spec: {
        storageClassName: 'manual',
        accessModes: ['ReadWriteOnce'],
        resources: { requests: { storage: SIZE } },
      },
    });
    const spec = ctx.podSpec();
    spec.volumes = [...(spec.volumes ?? []), { name: 'store', persistentVolumeClaim: { claimName: CLAIM } }];
    const c = ctx.container();
    c.volumeMounts = [...(c.volumeMounts ?? []), { name: 'store', mountPath: MOUNT }];
    ctx.bullets.push(
      `PersistentVolume \`${CLAIM}-pv\` (StorageClass \`manual\`) exists. Create a PersistentVolumeClaim \`${CLAIM}\` requesting \`${SIZE}\` (\`ReadWriteOnce\`) that binds to it, and mount it at \`${MOUNT}\`.`,
    );
    ctx.checks.push(
      {
        id: 'pvc-bound',
        description: `PVC ${CLAIM} is Bound to ${CLAIM}-pv`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get pvc ${CLAIM} -o jsonpath='{.status.phase}/{.spec.volumeName}'`,
        expect: { equals: `Bound/${CLAIM}-pv` },
        weight: 2,
      },
      {
        id: 'pvc-mounted',
        description: `the claim is mounted at ${MOUNT}`,
        type: 'kubectl',
        run: kget(ctx, '{%.containers[0].volumeMounts[*].mountPath}'),
        expect: { contains: MOUNT },
        weight: 1,
      },
    );
    ctx.hints.push(`kubectl get pv ${CLAIM}-pv shows the StorageClass and access mode the claim must match.`);
  },
};

const labelFollowUp = (kind: 'label' | 'annotate'): FollowUp => {
  const label = kind === 'label';
  const what = label ? 'label' : 'annotation';
  return {
    id: kind,
    key: label ? 'LABEL' : 'NOTE',
    name: label ? 'Add a label in place' : 'Add an annotation in place',
    description: `After creating it, add a ${what} to the running Pod.`,
    points: 1,
    fields: label
      ? [nameField('KEY', 'Label key', ['tier', 'team', 'env']), nameField('VALUE', 'Label value', ['backend', 'blue', 'prod'])]
      : [nameField('KEY', 'Annotation key', ['owner', 'contact', 'ticket']), nameField('VALUE', 'Annotation value', ['platform', 'ops-team', 'cka-42'])],
    apply(ctx, { KEY, VALUE }) {
      const { NAME } = ctx.v;
      ctx.steps.push(`Then add the ${what} \`${KEY}=${VALUE}\` to the running Pod \`${NAME}\`, without recreating it.`);
      ctx.solution.push(`kubectl -n "${ctx.ns}" ${kind} pod "${NAME}" "${KEY}=${VALUE}" --overwrite`);
      ctx.checks.push({
        id: kind,
        description: `${NAME} has the ${what} ${KEY}=${VALUE}`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get pod ${NAME} -o jsonpath='{.metadata.${label ? 'labels' : 'annotations'}.${KEY}}'`,
        expect: { equals: VALUE },
        weight: 1,
      });
      ctx.hints.push(`kubectl ${kind} --help`);
    },
  };
};

const NODES = ['worker-1', 'worker-2'];

const initContainer: Addon = {
  id: 'init-container',
  key: 'INIT',
  name: 'Init container',
  description: 'An init container prepares a file that the main container reads.',
  points: 2,
  fields: [nameField('TEXT', 'Content of /init/ready (one word)', ['ready', 'warmed-up', 'seeded'])],
  apply(ctx, { TEXT }) {
    const spec = ctx.podSpec();
    spec.volumes = [...(spec.volumes ?? []), { name: 'init', emptyDir: {} }];
    spec.initContainers = [
      { name: 'prepare', image: SIDECAR_IMAGE, command: ['sh', '-c', `echo ${TEXT} > /init/ready`], volumeMounts: [{ name: 'init', mountPath: '/init' }] },
      ...(spec.initContainers ?? []),
    ];
    const c = ctx.container();
    c.volumeMounts = [...(c.volumeMounts ?? []), { name: 'init', mountPath: '/init' }];
    ctx.bullets.push(
      `Before \`main\` starts, an init container \`prepare\` (image \`${SIDECAR_IMAGE}\`) writes \`${TEXT}\` to \`/init/ready\` on an \`emptyDir\` volume that \`main\` also mounts at \`/init\`.`,
    );
    ctx.checks.push({
      id: 'init-ready',
      description: `main reads "${TEXT}" from /init/ready`,
      type: 'kubectl',
      run: kexec(ctx, 'cat /init/ready'),
      expect: { equals: TEXT },
      weight: 2,
      retrySeconds: 30,
    });
    ctx.hints.push('initContainers run to completion before the containers start; share the file through an emptyDir mounted in both.');
  },
};

const configVolume: Addon = {
  id: 'config-volume',
  key: 'FILES',
  name: 'ConfigMap or Secret as files',
  description: 'A ConfigMap or Secret is created and mounted as a directory of files.',
  points: 3,
  fields: [
    { key: 'SOURCE', label: 'Source', type: 'select', default: 'ConfigMap', options: SOURCES },
    nameField('OBJ', 'ConfigMap or Secret name', ['app-files', 'web-conf', 'tool-settings']),
    {
      key: 'FILE',
      label: 'Key (file name)',
      type: 'text',
      default: 'app.conf',
      pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
      pool: ['app.conf', 'settings.ini', 'motd'],
    },
    {
      key: 'VALUE',
      label: 'File content (one word)',
      type: 'text',
      default: 'enabled',
      pattern: '^[A-Za-z0-9._-]+$',
      pool: ['enabled', 'v2', 'hello'],
      randomizeByDefault: true,
    },
  ],
  apply(ctx, { SOURCE, OBJ, FILE, VALUE }) {
    const secret = SOURCE === 'Secret';
    const kind = secret ? 'Secret' : 'ConfigMap';
    ctx.manifests.unshift({ apiVersion: 'v1', kind, metadata: { name: OBJ, namespace: ctx.ns }, [secret ? 'stringData' : 'data']: { [FILE]: VALUE } });
    const spec = ctx.podSpec();
    spec.volumes = [...(spec.volumes ?? []), { name: 'files', ...(secret ? { secret: { secretName: OBJ } } : { configMap: { name: OBJ } }) }];
    const c = ctx.container();
    c.volumeMounts = [...(c.volumeMounts ?? []), { name: 'files', mountPath: '/etc/app', readOnly: true }];
    ctx.bullets.push(
      `Create a ${kind} \`${OBJ}\` with the key \`${FILE}\` set to \`${VALUE}\`, and mount it read-only at \`/etc/app\`, so the file \`/etc/app/${FILE}\` holds the value.`,
    );
    ctx.checks.push(
      {
        id: 'files-source',
        description: `${kind} ${OBJ} has ${FILE}=${VALUE}`,
        type: 'kubectl',
        run: secret
          ? `kubectl -n ${ctx.ns} get secret ${OBJ} -o go-template='{{index .data "${FILE}" | base64decode}}'`
          : `kubectl -n ${ctx.ns} get configmap ${OBJ} -o go-template='{{index .data "${FILE}"}}'`,
        expect: { equals: VALUE },
        weight: 1,
      },
      {
        id: 'files-mounted',
        description: `/etc/app/${FILE} holds ${VALUE}`,
        type: 'kubectl',
        run: kexec(ctx, `cat /etc/app/${FILE}`),
        expect: { equals: VALUE },
        weight: 2,
        retrySeconds: 30,
      },
    );
    ctx.hints.push(
      secret
        ? `kubectl -n ${ctx.ns} create secret generic ${OBJ} --from-literal=${FILE}=${VALUE}; then a secret volume (secretName: ${OBJ}).`
        : `kubectl -n ${ctx.ns} create configmap ${OBJ} --from-literal=${FILE}=${VALUE}; then a configMap volume.`,
    );
  },
};

const capabilities: Addon = {
  id: 'capabilities',
  key: 'CAPS',
  name: 'Linux capabilities',
  description: 'Drop every capability, then add back exactly one.',
  points: 2,
  fields: [selectField('CAP', 'Capability to add', ['NET_BIND_SERVICE', 'NET_ADMIN', 'SYS_TIME'], { randomizeByDefault: true })],
  apply(ctx, { CAP }) {
    const c = ctx.container();
    c.securityContext = { ...c.securityContext, capabilities: { drop: ['ALL'], add: [CAP] } };
    ctx.bullets.push(`The container drops all Linux capabilities and adds back only \`${CAP}\`.`);
    ctx.checks.push({
      id: 'caps',
      description: `capabilities: drop ALL, add ${CAP}`,
      type: 'kubectl',
      run: kget(ctx, '{%.containers[0].securityContext.capabilities.drop[*]}/{%.containers[0].securityContext.capabilities.add[*]}'),
      expect: { equals: `ALL/${CAP}` },
      weight: 2,
    });
    ctx.hints.push('securityContext.capabilities: {drop: [ALL], add: [...]} on the container (names without the CAP_ prefix).');
  },
};

const execProbe: Addon = {
  id: 'exec-probe',
  key: 'PROBE',
  name: 'Exec liveness probe',
  description: 'A liveness probe that runs a command in the container.',
  points: 1,
  fields: [numberField('PERIOD', 'Probe period (seconds)', ['5', '10', '15'], 1, 60, { randomizeByDefault: true })],
  apply(ctx, { PERIOD }) {
    ctx.container().livenessProbe = { exec: { command: ['ls', '/'] }, periodSeconds: bare(PERIOD) };
    ctx.bullets.push(`Add a liveness probe that runs \`ls /\` in the container every \`${PERIOD}\` seconds.`);
    ctx.checks.push({
      id: 'probe',
      description: `liveness probe runs ls / every ${PERIOD}s`,
      type: 'kubectl',
      run: kget(ctx, '{%.containers[0].livenessProbe.exec.command[*]}/{%.containers[0].livenessProbe.periodSeconds}'),
      expect: { equals: `ls //${PERIOD}` },
      weight: 1,
    });
    ctx.hints.push('livenessProbe: {exec: {command: [ls, /]}, periodSeconds: N}');
  },
};

const PLACEMENTS: Record<string, string> = {
  nodeName: 'Set spec.nodeName (bypasses the scheduler)',
  nodeSelector: 'Select the node by its kubernetes.io/hostname label',
};

const placement: Addon = {
  id: 'placement',
  key: 'PLACE',
  name: 'Run on a given worker',
  description: 'The Pod must run on one worker, via nodeName or a nodeSelector.',
  points: 2,
  fields: [
    {
      key: 'METHOD',
      label: 'How',
      help: Object.entries(PLACEMENTS)
        .map(([id, l]) => `${id}: ${l}`)
        .join('; '),
      type: 'select',
      default: 'nodeName',
      options: Object.keys(PLACEMENTS),
    },
    selectField('NODE', 'Worker', NODES, { randomizeByDefault: true }),
  ],
  apply(ctx, { METHOD, NODE }) {
    const bySelector = METHOD === 'nodeSelector';
    const spec = ctx.podSpec();
    if (bySelector) spec.nodeSelector = { 'kubernetes.io/hostname': NODE };
    else spec.nodeName = NODE;
    ctx.bullets.push(
      bySelector
        ? `It must run on \`${NODE}\`, chosen with a \`nodeSelector\` on the \`kubernetes.io/hostname\` label.`
        : `It must run on \`${NODE}\`, set directly with \`nodeName\` (no nodeSelector or affinity).`,
    );
    ctx.checks.push(
      {
        id: 'place-node',
        description: `the Pod runs on ${NODE}`,
        type: 'kubectl',
        run: kget(ctx, '{.spec.nodeName}'),
        expect: { equals: NODE },
        weight: 1,
        retrySeconds: 20,
      },
      bySelector
        ? {
            id: 'place-how',
            description: `the Pod selects kubernetes.io/hostname=${NODE}`,
            type: 'kubectl',
            run: kget(ctx, '{.spec.nodeSelector.kubernetes\\.io/hostname}'),
            expect: { equals: NODE },
            weight: 1,
          }
        : {
            id: 'place-how',
            description: 'no nodeSelector or affinity is used',
            type: 'kubectl',
            run: kget(ctx, '{.spec.nodeSelector}{.spec.affinity}'),
            expect: { notEmpty: false },
            weight: 1,
          },
    );
    ctx.hints.push(bySelector ? 'kubectl get nodes --show-labels; spec.nodeSelector goes on the Pod spec.' : 'spec.nodeName skips the scheduler entirely.');
  },
};

const updatePodImage: FollowUp = {
  id: 'update-image',
  key: 'UPDATE',
  name: 'Change the image in place',
  description: 'After creating it, change the image of the running Pod without recreating it.',
  points: 1,
  replacesChecks: ['image'],
  fields: [selectField('IMAGE', 'New image', ['busybox:1.36.1', 'alpine:3.21'])],
  validate: (v, base) => imagePair(base.IMAGE, v.IMAGE),
  apply(ctx, { IMAGE }) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then change the image of container \`main\` in the running Pod \`${NAME}\` to \`${IMAGE}\`, without deleting the Pod.`);
    ctx.solution.push(
      `kubectl -n "${ctx.ns}" set image "pod/${NAME}" "main=${IMAGE}"`,
      `timeout 180 bash -c 'until [[ "$(kubectl -n "$0" get pod "$1" -o jsonpath="{.status.containerStatuses[?(@.name==\\"main\\")].restartCount}")" -ge 1 ]] 2>/dev/null; do sleep 2; done' "${ctx.ns}" "${NAME}"`,
      `kubectl -n "${ctx.ns}" wait --for=condition=Ready "pod/${NAME}" --timeout=120s`,
    );
    ctx.checks.push(
      {
        id: 'update-image',
        description: `main runs ${IMAGE}`,
        type: 'kubectl',
        run: kget(ctx, '{.spec.containers[?(@.name=="main")].image}'),
        expect: { equals: IMAGE },
        weight: 1,
      },
      {
        id: 'update-restarted',
        description: `${NAME} was updated in place (main restarted)`,
        type: 'kubectl',
        run: kget(ctx, '{.status.containerStatuses[?(@.name=="main")].restartCount}'),
        expect: { gte: 1 },
        weight: 1,
        retrySeconds: 30,
      },
    );
    ctx.hints.push(`kubectl -n ${ctx.ns} set image pod/${NAME} main=${IMAGE}: the image is one of the few mutable Pod fields.`);
  },
};

const resizePod: FollowUp = {
  id: 'resize',
  key: 'RESIZE',
  name: 'Resize CPU in place',
  description: 'After creating it, change the CPU request of the running Pod with an in-place resize.',
  points: 1,
  requires: ['resources'],
  replacesChecks: ['res-requests'],
  fields: [selectField('CPU', 'New CPU request', ['200m', '250m'], { randomizeByDefault: true })],
  apply(ctx, { CPU }) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then raise the CPU request of \`main\` in the running Pod \`${NAME}\` to \`${CPU}\` with an in-place resize, without recreating the Pod.`);
    ctx.solution.push(
      `kubectl -n "${ctx.ns}" patch pod "${NAME}" --subresource resize -p '{"spec": {"containers": [{"name": "main", "resources": {"requests": {"cpu": "'"${CPU}"'"}}}]}}'`,
    );
    ctx.checks.push(
      {
        id: 'resize-spec',
        description: `main requests ${CPU} CPU`,
        type: 'kubectl',
        run: kget(ctx, '{.spec.containers[?(@.name=="main")].resources.requests.cpu}'),
        expect: { equals: CPU },
        weight: 1,
      },
      {
        id: 'resize-applied',
        description: `the kubelet applied ${CPU} CPU to the running container`,
        type: 'kubectl',
        run: kget(ctx, '{.status.containerStatuses[?(@.name=="main")].resources.requests.cpu}'),
        expect: { equals: CPU },
        weight: 1,
        retrySeconds: 30,
      },
    );
    ctx.hints.push(`kubectl patch pod ${NAME} --subresource resize -p '{"spec": {"containers": [...]}}' changes resources without a restart.`);
  },
};

const saveLogs: FollowUp = {
  id: 'save-logs',
  key: 'LOGS',
  name: 'Save its logs to a file',
  description: 'After creating it, save the logs of the main container on the controlplane.',
  points: 2,
  requires: ['command'],
  fields: [],
  apply(ctx) {
    const { NAME } = ctx.v;
    const file = `/opt/${NAME}.log`;
    ctx.steps.push(`Then, on the \`controlplane\` node, save the logs of container \`main\` of \`${NAME}\` to \`${file}\`.`);
    ctx.solution.push(`kubectl -n "${ctx.ns}" logs "${NAME}" -c main > "${file}"`);
    ctx.checks.push({
      id: 'logs-file',
      description: `${file} holds the logs of main`,
      type: 'ssh',
      node: 'controlplane',
      run: `[ -s ${file} ] && [ "$(head -n 1 ${file})" = "$(kubectl -n ${ctx.ns} logs ${NAME} -c main | head -n 1)" ] && echo ok`,
      expect: { equals: 'ok' },
      weight: 2,
    });
    ctx.hints.push(`kubectl -n ${ctx.ns} logs ${NAME} -c main | sudo tee ${file}`);
  },
};

const copyOut: FollowUp = {
  id: 'copy-out',
  key: 'COPY',
  name: 'Copy a file out of the Pod',
  description: 'After creating it, copy /data/out.log to the controlplane.',
  points: 2,
  requires: ['command'],
  fields: [],
  apply(ctx) {
    const { NAME } = ctx.v;
    const file = `/opt/${NAME}-out.log`;
    ctx.steps.push(`Then copy \`${LOG}\` from container \`main\` of \`${NAME}\` to \`${file}\` on the \`controlplane\` node.`);
    ctx.solution.push(`kubectl -n "${ctx.ns}" cp "${NAME}:${LOG}" "${file}" -c main`);
    ctx.checks.push({
      id: 'copy-file',
      description: `${file} is a copy of ${LOG}`,
      type: 'ssh',
      node: 'controlplane',
      run: `[ -s ${file} ] && [ "$(head -n 1 ${file})" = "$(kubectl -n ${ctx.ns} exec ${NAME} -c main -- head -n 1 ${LOG})" ] && echo ok`,
      expect: { equals: 'ok' },
      weight: 2,
    });
    ctx.hints.push(`kubectl -n ${ctx.ns} cp ${NAME}:${LOG} ./out.log -c main, then move it into place with sudo.`);
  },
};

export const podBuilder: Builder = {
  id: 'pod',
  name: 'Pod',
  description: 'A single Pod, with presets for its command and a sidecar.',
  domain: 'workloads',
  difficulty: 1,
  minutes: 3,
  points: 3,
  tags: ['pod'],
  fields: [
    nsField(['apps', 'jobs', 'sandbox']),
    nameField('NAME', 'Pod name', ['worker', 'logger', 'toolbox', 'frontend', 'backend', 'database', 'cache', 'queue', 'scheduler', 'monitor', 'gateway']),
    selectField('IMAGE', 'Image', ['busybox:1.36', 'busybox:1.37', 'nginx:1.28-alpine', 'httpd:2.4-alpine', 'alpine:3.20']),
  ],
  addons: [command, sidecar, envAddon, security, resourcesAddon, pvcMount, initContainer, configVolume, capabilities, execProbe, placement],
  followUps: [labelFollowUp('label'), labelFollowUp('annotate'), updatePodImage, resizePod, saveLogs, copyOut],
  build(v) {
    const { NS, NAME, IMAGE } = v;
    const pod: Manifest = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: NAME, namespace: NS },
      spec: {
        containers: [{ name: 'main', image: IMAGE, command: ['sleep', '1d'] }],
      },
    };
    const ctx: CreateCtx = {
      v,
      ns: NS,
      ref: `pod/${NAME}`,
      podPath: '.spec',
      title: `Pod ${NAME}`,
      intro: `Create a Pod \`${NAME}\` in namespace \`${NS}\` with one container \`main\` running image \`${IMAGE}\`. It must keep running.`,
      bullets: [],
      steps: [],
      manifests: [pod],
      podSpec: () => pod.spec,
      container: () => pod.spec.containers[0],
      checks: [],
      hints: [`kubectl -n ${NS} run ${NAME} --image=${IMAGE} --dry-run=client -o yaml -- sleep 1d gives you a manifest to start from.`],
      setup: [createNs(NS)],
      solution: [`kubectl -n "${NS}" wait --for=condition=Ready "pod/${NAME}" --timeout=180s`],
    };
    ctx.checks.push(
      {
        id: 'running',
        description: `Pod ${NAME} is Running and ready`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pod ${NAME} -o jsonpath='{.status.phase}/{.status.conditions[?(@.type=="Ready")].status}'`,
        expect: { equals: 'Running/True' },
        weight: 2,
        retrySeconds: 30,
      },
      {
        id: 'image',
        description: `main runs ${IMAGE}`,
        type: 'kubectl',
        run: kget(ctx, '{%.containers[0].name}/{%.containers[0].image}'),
        expect: { equals: `main/${IMAGE}` },
        weight: 1,
      },
    );
    return ctx;
  },
};

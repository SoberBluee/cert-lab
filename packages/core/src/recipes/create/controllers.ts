import { createNs, nameField, nsField, requireLocalPathClass, type RecipeCheck } from '../types';
import { WORKERS } from '../troubleshoot/compose';
import { courseDir, onCp, taskBuilder } from './tasks';

const headlessService = (ns: string, sts: string, headless: boolean) => `apiVersion: v1
kind: Service
metadata: { name: ${sts}-hl, namespace: ${ns} }
spec:
${headless ? '  clusterIP: None\n' : ''}  selector: { app: ${sts} }
  ports: [{ port: 80 }]`;

const statefulSet = (ns: string, sts: string, replicas: number, parallel: boolean, image = 'nginx:1.27-alpine') => `apiVersion: apps/v1
kind: StatefulSet
metadata: { name: ${sts}, namespace: ${ns} }
spec:
  serviceName: ${sts}-hl
${parallel ? '  podManagementPolicy: Parallel\n' : ''}  replicas: ${replicas}
  selector: { matchLabels: { app: ${sts} } }
  template:
    metadata: { labels: { app: ${sts} } }
    spec:
      containers: [{ name: nginx, image: ${image}, ports: [{ containerPort: 80 }] }]`;

/** Removes what an earlier run left: the StatefulSet, its Service and its Pods. */
const resetSts = (ns: string, sts: string) => `${courseDir('sts')}
${createNs(ns)}
kubectl -n "${ns}" delete statefulset "${sts}" --ignore-not-found --wait=true >/dev/null
kubectl -n "${ns}" delete service "${sts}-hl" --ignore-not-found >/dev/null
kubectl -n "${ns}" wait --for=delete pod -l app="${sts}" --timeout=90s >/dev/null 2>&1 || true`;

const headlessCheck = (ns: string, sts: string): RecipeCheck => ({
  id: 'headless',
  description: `Service ${sts}-hl is headless and selects the StatefulSet's Pods`,
  type: 'kubectl',
  run: `kubectl -n ${ns} get service ${sts}-hl -o jsonpath='{.spec.clusterIP}/{.spec.selector.app}'`,
  expect: { equals: `None/${sts}` },
  weight: 1,
});

const fqdnChecks = (ns: string, sts: string, pod: string): RecipeCheck[] => [
  onCp({
    id: 'fqdn',
    description: `/opt/course/sts/fqdn holds the fully qualified DNS name of ${pod}`,
    run: `tr -d '[:space:]' < /opt/course/sts/fqdn 2>/dev/null | sed 's/\\.$//'`,
    expect: { equals: `${pod}.${sts}-hl.${ns}.svc.cluster.local` },
    weight: 1,
  }),
  {
    id: 'resolves',
    description: `that name resolves to the IP of Pod ${pod} inside the cluster`,
    type: 'kubectl',
    run: `ip=$(kubectl -n ${ns} get pod ${pod} -o jsonpath='{.status.podIP}'); [ -n "$ip" ] && kubectl -n ${ns} exec ${sts}-0 -- nslookup ${pod}.${sts}-hl.${ns}.svc.cluster.local 2>/dev/null | grep -qw "$ip" && echo resolved || echo unresolved`,
    expect: { equals: 'resolved' },
    weight: 2,
    retrySeconds: 60,
  },
];

/** The node the labelled-node task asks for, and the label it gets. */
const EDGE_NODE = WORKERS[1];
const EDGE_LABEL = 'node-type=edge';

/** Running Pods of a DaemonSet, one node name per line. */
const dsNodes = (ns: string, ds: string) =>
  `kubectl -n ${ns} get pods -l app=${ds} --field-selector status.phase=Running -o jsonpath='{range .items[*]}{.spec.nodeName}{"\\n"}{end}'`;

const stsHints = (ns: string, sts: string) => [
  `Each StatefulSet Pod gets the DNS name <pod>.<service>.<namespace>.svc.cluster.local, here ${sts}-0.${sts}-hl.${ns}.svc.cluster.local, but only when spec.serviceName names a headless Service that selects it.`,
  'A headless Service has clusterIP: None, so its DNS name returns the Pod IPs instead of one virtual IP.',
];

export const workloadControllersBuilder = taskBuilder({
  id: 'workload-controllers',
  name: 'StatefulSets and DaemonSets',
  description:
    'Give a StatefulSet per-Pod DNS, storage or a canary rollout, or run a DaemonSet on every node, on labelled nodes only, with host logs, or with a surge update.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 7,
  points: 6,
  tags: ['statefulset', 'daemonset', 'headless', 'dns', 'tolerations', 'volumeclaimtemplates', 'partition', 'hostpath', 'downward-api', 'maxsurge'],
  fields: [
    nsField(['stateful', 'data-tier', 'quorum', 'records', 'kv-store', 'agents', 'fleet', 'node-ops', 'cluster-svc', 'storage-ops']),
    nameField('STS', 'StatefulSet name', ['web', 'db', 'cache', 'kv', 'queue', 'ledger', 'search', 'session']),
    nameField('DS', 'DaemonSet name', ['node-probe', 'log-agent', 'net-watch', 'disk-agent', 'metrics-agent', 'trace-agent', 'node-exporter', 'audit-agent']),
  ],
  tasks: {
    'sts-scale': {
      label: 'Fix per-Pod DNS of a StatefulSet and scale it',
      make: ({ NS, STS }) => ({
        title: `Scale StatefulSet ${STS}`,
        text: `StatefulSet \`${STS}\` in namespace \`${NS}\` runs \`2\` replicas and names \`${STS}-hl\` as its governing Service, but its Pods cannot reach each other by their own DNS names.

1. Fix it so that every Pod of \`${STS}\` gets its own DNS name. Keep the Service name \`${STS}-hl\`, and do not recreate the StatefulSet.
2. Scale \`${STS}\` to \`4\` replicas.
3. Write the fully qualified DNS name of its newest Pod to \`/opt/course/sts/fqdn\` on \`controlplane\`.`,
        setup: [
          `${resetSts(NS, STS)}
kubectl apply -f - <<EOF >/dev/null
${headlessService(NS, STS, false)}
---
${statefulSet(NS, STS, 2, false)}
EOF
kubectl -n "${NS}" rollout status "statefulset/${STS}" --timeout=180s >/dev/null`,
        ],
        checks: [
          headlessCheck(NS, STS),
          {
            id: 'scaled',
            description: `StatefulSet ${STS} has 4 of 4 replicas ready and still uses ${STS}-hl`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get statefulset ${STS} -o jsonpath='{.spec.serviceName}/{.spec.replicas}/{.status.readyReplicas}'`,
            expect: { equals: `${STS}-hl/4/4` },
            weight: 2,
            retrySeconds: 90,
          },
          ...fqdnChecks(NS, STS, `${STS}-3`),
        ],
        solution: [
          `kubectl -n ${NS} delete service ${STS}-hl
kubectl apply -f - <<EOF
${headlessService(NS, STS, true)}
EOF
kubectl -n ${NS} scale statefulset ${STS} --replicas=4
kubectl -n ${NS} rollout status statefulset/${STS} --timeout=240s
echo "${STS}-3.${STS}-hl.${NS}.svc.cluster.local" > /opt/course/sts/fqdn`,
        ],
        hints: [
          `kubectl -n ${NS} get service ${STS}-hl: does it have a ClusterIP?`,
          'spec.clusterIP cannot be changed in place: delete the Service and create it again; the StatefulSet does not need to be recreated.',
          ...stsHints(NS, STS),
        ],
      }),
    },
    'sts-create': {
      label: 'Create a StatefulSet with a headless Service and parallel Pods',
      make: ({ NS, STS }) => ({
        title: `StatefulSet ${STS} with per-Pod DNS`,
        text: `In namespace \`${NS}\`:

1. Create a headless Service \`${STS}-hl\` for port \`80\` that selects Pods with label \`app=${STS}\`.
2. Create StatefulSet \`${STS}\` with \`3\` replicas of image \`nginx:1.27-alpine\` and Pod label \`app=${STS}\`. It uses \`${STS}-hl\` as its governing Service, and its Pods are created and deleted all at once rather than one by one.
3. Write the fully qualified DNS name under which Pod \`${STS}-1\` is reachable inside the cluster to \`/opt/course/sts/fqdn\` on \`controlplane\`.`,
        setup: [resetSts(NS, STS)],
        checks: [
          headlessCheck(NS, STS),
          {
            id: 'statefulset',
            description: `StatefulSet ${STS} uses ${STS}-hl and Parallel Pod management, with 3 of 3 replicas ready`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get statefulset ${STS} -o jsonpath='{.spec.serviceName}/{.spec.podManagementPolicy}/{.status.readyReplicas}'`,
            expect: { equals: `${STS}-hl/Parallel/3` },
            weight: 2,
            retrySeconds: 90,
          },
          ...fqdnChecks(NS, STS, `${STS}-1`),
        ],
        solution: [
          `kubectl apply -f - <<EOF
${headlessService(NS, STS, true)}
---
${statefulSet(NS, STS, 3, true)}
EOF
kubectl -n ${NS} rollout status statefulset/${STS} --timeout=240s
echo "${STS}-1.${STS}-hl.${NS}.svc.cluster.local" > /opt/course/sts/fqdn`,
        ],
        hints: [
          'spec.serviceName names the governing Service. podManagementPolicy: Parallel creates and deletes all Pods at once; it can only be set when the StatefulSet is created.',
          ...stsHints(NS, STS),
        ],
      }),
    },
    'sts-storage': {
      label: 'Give every Pod of a StatefulSet its own volume',
      make: ({ NS, STS }) => ({
        title: `StatefulSet ${STS} with per-Pod storage`,
        text: `Headless Service \`${STS}-hl\` in namespace \`${NS}\` selects Pods with label \`app=${STS}\`.

1. Create StatefulSet \`${STS}\` with \`2\` replicas of image \`nginx:1.27-alpine\` and Pod label \`app=${STS}\`, governed by \`${STS}-hl\`. Each Pod gets its own \`100Mi\` \`ReadWriteOnce\` volume of StorageClass \`local-path\` from a claim template named \`data\`, mounted at \`/usr/share/nginx/html\`.
2. Make Pod \`${STS}-0\` serve the text \`hello from ${STS}-0\` at \`/\`, in a way that survives the Pod being deleted and re-created.`,
        setup: [
          `${requireLocalPathClass}
${resetSts(NS, STS)}
kubectl -n "${NS}" delete pvc -l app="${STS}" --ignore-not-found --wait=true >/dev/null
kubectl apply -f - <<EOF >/dev/null
${headlessService(NS, STS, true)}
EOF`,
        ],
        checks: [
          {
            id: 'statefulset',
            description: `StatefulSet ${STS} uses ${STS}-hl and has 2 of 2 replicas ready`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get statefulset ${STS} -o jsonpath='{.spec.serviceName}/{.spec.replicas}/{.status.readyReplicas}'`,
            expect: { equals: `${STS}-hl/2/2` },
            weight: 2,
            retrySeconds: 90,
          },
          {
            id: 'claims',
            description: `claims data-${STS}-0 and data-${STS}-1 are Bound: 100Mi, ReadWriteOnce, StorageClass local-path`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get pvc data-${STS}-0 data-${STS}-1 -o jsonpath='{range .items[*]}{.status.phase}/{.spec.storageClassName}/{.spec.resources.requests.storage}/{.spec.accessModes[0]} {end}'`,
            expect: { equals: 'Bound/local-path/100Mi/ReadWriteOnce Bound/local-path/100Mi/ReadWriteOnce' },
            weight: 2,
            retrySeconds: 60,
          },
          {
            id: 'mount',
            description: 'the claim template data is mounted at /usr/share/nginx/html',
            type: 'kubectl',
            run: `kubectl -n ${NS} get statefulset ${STS} -o jsonpath='{.spec.template.spec.containers[0].volumeMounts[?(@.name=="data")].mountPath}'`,
            expect: { equals: '/usr/share/nginx/html' },
            weight: 1,
          },
          {
            id: 'content',
            description: `${STS}-0 serves "hello from ${STS}-0"`,
            type: 'kubectl',
            run: `kubectl -n ${NS} exec ${STS}-0 -- wget -qO- -T 3 http://localhost/`,
            expect: { contains: `hello from ${STS}-0` },
            weight: 1,
            retrySeconds: 60,
          },
        ],
        solution: [
          `kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ${STS}
  namespace: ${NS}
spec:
  serviceName: ${STS}-hl
  replicas: 2
  selector:
    matchLabels: { app: ${STS} }
  template:
    metadata:
      labels: { app: ${STS} }
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          volumeMounts: [{ name: data, mountPath: /usr/share/nginx/html }]
  volumeClaimTemplates:
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOnce]
        storageClassName: local-path
        resources:
          requests: { storage: 100Mi }
EOF
kubectl -n ${NS} rollout status statefulset/${STS} --timeout=240s
kubectl -n ${NS} exec ${STS}-0 -- sh -c "echo 'hello from ${STS}-0' > /usr/share/nginx/html/index.html"
# The file lives on claim data-${STS}-0, so the re-created Pod serves it too.
kubectl -n ${NS} delete pod ${STS}-0 --wait=true
kubectl -n ${NS} rollout status statefulset/${STS} --timeout=180s`,
        ],
        hints: [
          `spec.volumeClaimTemplates creates one PersistentVolumeClaim per Pod, named <template>-<pod>, here data-${STS}-0. The container mounts it by the template's name.`,
          'local-path binds a claim only once its Pod is scheduled (WaitForFirstConsumer): kubectl get pvc shows Pending until then.',
          'Write the file inside the mounted directory with kubectl exec. A re-created Pod gets the same claim back, so the file is still there.',
        ],
      }),
    },
    'sts-canary': {
      label: 'Roll a new image out to part of a StatefulSet',
      make: ({ NS, STS }) => ({
        title: `Canary release of StatefulSet ${STS}`,
        text: `StatefulSet \`${STS}\` in namespace \`${NS}\` runs \`4\` replicas of image \`nginx:1.26-alpine\`.

Release image \`nginx:1.27-alpine\` as a canary: its Pod template names the new image, Pods \`${STS}-2\` and \`${STS}-3\` run it, and \`${STS}-0\` and \`${STS}-1\` keep running \`nginx:1.26-alpine\` until the release is completed later, even if they are deleted and re-created.

Do not delete any Pod yourself, and do not recreate the StatefulSet.`,
        setup: [
          `${resetSts(NS, STS)}
kubectl apply -f - <<EOF >/dev/null
${headlessService(NS, STS, true)}
---
${statefulSet(NS, STS, 4, true, 'nginx:1.26-alpine')}
EOF
kubectl -n "${NS}" rollout status "statefulset/${STS}" --timeout=180s >/dev/null`,
        ],
        checks: [
          {
            id: 'partition',
            description: `${STS}'s template names nginx:1.27-alpine, with a rolling update partition of 2`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get statefulset ${STS} -o jsonpath='{.spec.updateStrategy.rollingUpdate.partition} {.spec.template.spec.containers[0].image}'`,
            expect: { equals: '2 nginx:1.27-alpine' },
            weight: 2,
          },
          {
            id: 'canary',
            description: `${STS}-2 and ${STS}-3 run nginx:1.27-alpine, ${STS}-0 and ${STS}-1 still run nginx:1.26-alpine`,
            type: 'kubectl',
            run: `for i in 0 1 2 3; do printf '%s=%s ' "$i" "$(kubectl -n ${NS} get pod ${STS}-$i -o jsonpath='{.spec.containers[0].image}')"; done`,
            expect: { equals: '0=nginx:1.26-alpine 1=nginx:1.26-alpine 2=nginx:1.27-alpine 3=nginx:1.27-alpine' },
            weight: 3,
            retrySeconds: 90,
          },
          {
            id: 'ready',
            description: `all 4 replicas of ${STS} are ready, 2 of them updated`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get statefulset ${STS} -o jsonpath='{.status.readyReplicas}/{.status.updatedReplicas}'`,
            expect: { equals: '4/2' },
            weight: 1,
            retrySeconds: 90,
          },
        ],
        solution: [
          `# The partition first: changing the image first would start updating every Pod.
kubectl -n ${NS} patch statefulset ${STS} -p '{"spec":{"updateStrategy":{"type":"RollingUpdate","rollingUpdate":{"partition":2}}}}'
kubectl -n ${NS} set image statefulset/${STS} nginx=nginx:1.27-alpine
kubectl -n ${NS} rollout status statefulset/${STS} --timeout=240s`,
        ],
        hints: [
          'kubectl explain statefulset.spec.updateStrategy.rollingUpdate',
          'A rolling update partition only updates Pods whose ordinal is at least the partition; the others keep, and are re-created from, the old revision.',
          'Set the partition before you change the image: a rolling update starts at the highest ordinal and works down to 0.',
        ],
      }),
    },
    daemonset: {
      label: 'Run a DaemonSet on every node, the control plane included',
      make: ({ NS, DS }) => ({
        title: `DaemonSet ${DS} on every node`,
        text: `In namespace \`${NS}\`, create DaemonSet \`${DS}\` with image \`httpd:2.4-alpine\` and Pod label \`app=${DS}\`. Its Pods request \`10m\` CPU and \`10Mi\` memory, and one of them runs on every node of the cluster, the control plane included.

Do not change any node.`,
        setup: [
          `${createNs(NS)}
kubectl -n "${NS}" delete daemonset "${DS}" --ignore-not-found --wait=true >/dev/null`,
        ],
        checks: [
          {
            id: 'spec',
            description: `${DS} runs httpd:2.4-alpine with label app=${DS}, requesting 10m CPU and 10Mi memory`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get daemonset ${DS} -o jsonpath='{.spec.template.metadata.labels.app} {.spec.template.spec.containers[0].image} {.spec.template.spec.containers[0].resources.requests.cpu} {.spec.template.spec.containers[0].resources.requests.memory}'`,
            expect: { equals: `${DS} httpd:2.4-alpine 10m 10Mi` },
            weight: 2,
          },
          {
            id: 'everywhere',
            description: `a ready Pod of ${DS} runs on every node, controlplane included`,
            type: 'kubectl',
            run: `nodes=$(kubectl get nodes -o name | wc -l); ready=$(kubectl -n ${NS} get daemonset ${DS} -o jsonpath='{.status.numberReady}'); cp=$(kubectl -n ${NS} get pods -l app=${DS} --field-selector spec.nodeName=controlplane,status.phase=Running -o name | wc -l); [ "$ready" = "$nodes" ] && [ "$cp" -ge 1 ] && echo everywhere || echo "ready=$ready of $nodes, on controlplane: $cp"`,
            expect: { equals: 'everywhere' },
            weight: 3,
            retrySeconds: 60,
          },
          {
            id: 'taint',
            description: 'controlplane keeps its NoSchedule taint',
            type: 'kubectl',
            run: `kubectl get node controlplane -o jsonpath='{.spec.taints[?(@.key=="node-role.kubernetes.io/control-plane")].effect}'`,
            expect: { equals: 'NoSchedule' },
            weight: 1,
          },
        ],
        solution: [
          `kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ${DS}
  namespace: ${NS}
spec:
  selector:
    matchLabels: { app: ${DS} }
  template:
    metadata:
      labels: { app: ${DS} }
    spec:
      tolerations:
        - { key: node-role.kubernetes.io/control-plane, operator: Exists, effect: NoSchedule }
      containers:
        - name: ${DS}
          image: httpd:2.4-alpine
          resources:
            requests: { cpu: 10m, memory: 10Mi }
EOF
kubectl -n ${NS} rollout status daemonset/${DS} --timeout=180s`,
        ],
        hints: [
          'kubectl create deployment <name> --image=... --dry-run=client -o yaml gives a start: change the kind to DaemonSet and drop replicas and strategy.',
          'kubectl describe node controlplane | grep Taints shows why Pods do not land there.',
          'A toleration for node-role.kubernetes.io/control-plane:NoSchedule in the Pod template lets the DaemonSet run on the control plane too.',
        ],
      }),
    },
    'ds-node-label': {
      label: 'Run a DaemonSet only on labelled nodes',
      make: ({ NS, DS }) => ({
        title: `DaemonSet ${DS} on edge nodes`,
        text: `In namespace \`${NS}\`:

1. Create DaemonSet \`${DS}\` with image \`httpd:2.4-alpine\` and Pod label \`app=${DS}\`. It runs Pods only on nodes labelled \`${EDGE_LABEL}\`.
2. Label node \`${EDGE_NODE}\` with \`${EDGE_LABEL}\`, so that exactly one Pod of \`${DS}\` runs, on \`${EDGE_NODE}\`.

Do not change any other node.`,
        setup: [
          `${createNs(NS)}
kubectl -n "${NS}" delete daemonset "${DS}" --ignore-not-found --wait=true >/dev/null
kubectl label nodes --all ${EDGE_LABEL.split('=')[0]}- >/dev/null 2>&1 || true`,
        ],
        checks: [
          {
            id: 'spec',
            description: `${DS} runs httpd:2.4-alpine with label app=${DS}`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get daemonset ${DS} -o jsonpath='{.spec.template.metadata.labels.app} {.spec.template.spec.containers[0].image}'`,
            expect: { equals: `${DS} httpd:2.4-alpine` },
            weight: 2,
          },
          {
            id: 'label',
            description: `${EDGE_NODE} is the only node labelled ${EDGE_LABEL}`,
            type: 'kubectl',
            run: `kubectl get nodes -l ${EDGE_LABEL} -o jsonpath='{.items[*].metadata.name}'`,
            expect: { equals: EDGE_NODE },
            weight: 1,
          },
          {
            id: 'placement',
            description: `${DS} wants exactly one Pod, and it runs ready on ${EDGE_NODE}`,
            type: 'kubectl',
            run: `echo "$(kubectl -n ${NS} get daemonset ${DS} -o jsonpath='{.status.desiredNumberScheduled}/{.status.numberReady}') $(${dsNodes(NS, DS)} | xargs)"`,
            expect: { equals: `1/1 ${EDGE_NODE}` },
            weight: 3,
            retrySeconds: 60,
          },
        ],
        solution: [
          `kubectl label node ${EDGE_NODE} ${EDGE_LABEL}
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ${DS}
  namespace: ${NS}
spec:
  selector:
    matchLabels: { app: ${DS} }
  template:
    metadata:
      labels: { app: ${DS} }
    spec:
      nodeSelector: { ${EDGE_LABEL.replace('=', ': ')} }
      containers:
        - name: ${DS}
          image: httpd:2.4-alpine
EOF
kubectl -n ${NS} rollout status daemonset/${DS} --timeout=180s`,
        ],
        hints: [
          'A nodeSelector (or a required nodeAffinity) in the Pod template limits a DaemonSet to the nodes that match it.',
          'kubectl label node <node> key=value adds a label; kubectl get nodes --show-labels or -L key shows them.',
          `kubectl -n ${NS} get daemonset ${DS}: DESIRED counts the nodes the DaemonSet targets.`,
        ],
      }),
    },
    'ds-host-logs': {
      label: "Run a log collector DaemonSet that reads every node's logs",
      make: ({ NS, DS }) => ({
        title: `Log collector DaemonSet ${DS}`,
        text: `In namespace \`${NS}\`, create DaemonSet \`${DS}\` whose Pods carry label \`app=${DS}\` and run on every worker. Each Pod runs one container \`collector\`, image \`busybox:1.36\`, command \`sleep infinity\`:

- the container sees the node's directory \`/var/log\` at \`/host/log\`, read-only
- it has the environment variable \`NODE_NAME\`, set to the name of the node its Pod runs on, without writing any node name into the DaemonSet`,
        setup: [
          `${createNs(NS)}
kubectl -n "${NS}" delete daemonset "${DS}" --ignore-not-found --wait=true >/dev/null`,
        ],
        checks: [
          {
            id: 'workers',
            description: `a Pod of ${DS} runs on every worker`,
            type: 'kubectl',
            run: `${dsNodes(NS, DS)} | grep -E '^(${WORKERS.join('|')})$' | sort -u | xargs`,
            expect: { equals: WORKERS.join(' ') },
            weight: 2,
            retrySeconds: 60,
          },
          {
            id: 'host-log',
            description: "the container sees the node's /var/log at /host/log and cannot write to it",
            type: 'kubectl',
            run: `p=$(kubectl -n ${NS} get pods -l app=${DS} --field-selector status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null); [ -n "$p" ] && kubectl -n ${NS} exec "$p" -- sh -c '[ -d /host/log/pods ] || { echo missing; exit 0; }; touch /host/log/.cka-probe 2>/dev/null && { rm -f /host/log/.cka-probe; echo writable; } || echo read-only' || echo no-pod`,
            expect: { equals: 'read-only' },
            weight: 2,
            retrySeconds: 60,
          },
          {
            id: 'node-name',
            description: 'NODE_NAME in every Pod is the name of its node, and no node name is written into the DaemonSet',
            type: 'kubectl',
            run: `n=0; bad=0; for p in $(kubectl -n ${NS} get pods -l app=${DS} --field-selector status.phase=Running -o name); do n=$((n + 1)); [ "$(kubectl -n ${NS} get "$p" -o jsonpath='{.spec.nodeName}')" = "$(kubectl -n ${NS} exec "$p" -- printenv NODE_NAME 2>/dev/null)" ] || bad=1; done; kubectl -n ${NS} get daemonset ${DS} -o yaml | grep -qE '(${WORKERS.join('|')})' && bad=1; [ "$n" -gt 0 ] && [ "$bad" = 0 ] && echo matches || echo "wrong in $n Pods"`,
            expect: { equals: 'matches' },
            weight: 2,
            retrySeconds: 60,
          },
        ],
        solution: [
          `kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ${DS}
  namespace: ${NS}
spec:
  selector:
    matchLabels: { app: ${DS} }
  template:
    metadata:
      labels: { app: ${DS} }
    spec:
      containers:
        - name: collector
          image: busybox:1.36
          command: ["sleep", "infinity"]
          env:
            - name: NODE_NAME
              valueFrom:
                fieldRef: { fieldPath: spec.nodeName }
          volumeMounts:
            - { name: varlog, mountPath: /host/log, readOnly: true }
      volumes:
        - name: varlog
          hostPath: { path: /var/log, type: Directory }
EOF
kubectl -n ${NS} rollout status daemonset/${DS} --timeout=180s`,
        ],
        hints: [
          'A hostPath volume mounts a directory of the node into the Pod; readOnly: true on the volumeMount makes it read-only in the container.',
          'The downward API fills an environment variable from the Pod itself: env[].valueFrom.fieldRef.fieldPath: spec.nodeName.',
          'kubectl explain daemonset.spec.template.spec.volumes.hostPath',
        ],
      }),
    },
    'ds-surge-update': {
      label: 'Update a DaemonSet without leaving a node without its Pod',
      make: ({ NS, DS }) => ({
        title: `Surge update of DaemonSet ${DS}`,
        text: `DaemonSet \`${DS}\` in namespace \`${NS}\` runs image \`nginx:1.26-alpine\` on every worker.

1. Change its update strategy so that an update never leaves a node without a ready Pod of \`${DS}\`: one node at a time, the new Pod starts next to the old one, which is removed once the new one is ready.
2. Update its image to \`nginx:1.27-alpine\`, and let the update finish.

Do not delete or recreate the DaemonSet.`,
        setup: [
          `${createNs(NS)}
kubectl -n "${NS}" delete daemonset "${DS}" --ignore-not-found --wait=true >/dev/null
kubectl apply -f - <<EOF >/dev/null
apiVersion: apps/v1
kind: DaemonSet
metadata: { name: ${DS}, namespace: ${NS} }
spec:
  selector: { matchLabels: { app: ${DS} } }
  template:
    metadata: { labels: { app: ${DS} } }
    spec:
      containers:
        - name: agent
          image: nginx:1.26-alpine
          readinessProbe: { httpGet: { path: /, port: 80 }, periodSeconds: 5 }
EOF
kubectl -n "${NS}" rollout status "daemonset/${DS}" --timeout=180s >/dev/null`,
        ],
        checks: [
          {
            id: 'strategy',
            description: `${DS} rolls out with maxSurge 1 and maxUnavailable 0`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get daemonset ${DS} -o jsonpath='{.spec.updateStrategy.type}/{.spec.updateStrategy.rollingUpdate.maxSurge}/{.spec.updateStrategy.rollingUpdate.maxUnavailable}'`,
            expect: { equals: 'RollingUpdate/1/0' },
            weight: 2,
          },
          {
            id: 'rolled',
            description: `every worker runs a ready, updated Pod of ${DS} with nginx:1.27-alpine`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get daemonset ${DS} -o jsonpath='{.spec.template.spec.containers[0].image} {.status.updatedNumberScheduled}/{.status.numberReady}/{.status.desiredNumberScheduled}'`,
            expect: { equals: `nginx:1.27-alpine ${WORKERS.length}/${WORKERS.length}/${WORKERS.length}` },
            weight: 3,
            retrySeconds: 90,
          },
          {
            id: 'in-place',
            description: `${DS} was updated, not recreated: it keeps its earlier revision`,
            type: 'kubectl',
            run: `[ "$(kubectl -n ${NS} get controllerrevisions -l app=${DS} -o name | wc -l)" -ge 2 ] && echo updated || echo recreated`,
            expect: { equals: 'updated' },
            weight: 1,
          },
        ],
        solution: [
          `kubectl -n ${NS} patch daemonset ${DS} -p '{"spec":{"updateStrategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":1,"maxUnavailable":0}}}}'
kubectl -n ${NS} set image daemonset/${DS} agent=nginx:1.27-alpine
kubectl -n ${NS} rollout status daemonset/${DS} --timeout=240s`,
        ],
        hints: [
          'kubectl explain daemonset.spec.updateStrategy.rollingUpdate: maxSurge and maxUnavailable.',
          'With maxSurge: 1 and maxUnavailable: 0, a node runs its old and its new Pod side by side until the new one is ready. Both cannot be 0.',
          `kubectl -n ${NS} rollout status daemonset/${DS} waits for the update; kubectl rollout history shows its revisions.`,
        ],
      }),
    },
  },
});

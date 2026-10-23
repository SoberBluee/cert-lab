import { createNs, nameField, nsField, type RecipeCheck } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

const headlessService = (ns: string, sts: string, headless: boolean) => `apiVersion: v1
kind: Service
metadata: { name: ${sts}-hl, namespace: ${ns} }
spec:
${headless ? '  clusterIP: None\n' : ''}  selector: { app: ${sts} }
  ports: [{ port: 80 }]`;

const statefulSet = (ns: string, sts: string, replicas: number, parallel: boolean) => `apiVersion: apps/v1
kind: StatefulSet
metadata: { name: ${sts}, namespace: ${ns} }
spec:
  serviceName: ${sts}-hl
${parallel ? '  podManagementPolicy: Parallel\n' : ''}  replicas: ${replicas}
  selector: { matchLabels: { app: ${sts} } }
  template:
    metadata: { labels: { app: ${sts} } }
    spec:
      containers: [{ name: nginx, image: nginx:1.27-alpine, ports: [{ containerPort: 80 }] }]`;

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

const stsHints = (ns: string, sts: string) => [
  `Each StatefulSet Pod gets the DNS name <pod>.<service>.<namespace>.svc.cluster.local, here ${sts}-0.${sts}-hl.${ns}.svc.cluster.local, but only when spec.serviceName names a headless Service that selects it.`,
  'A headless Service has clusterIP: None, so its DNS name returns the Pod IPs instead of one virtual IP.',
];

export const workloadControllersBuilder = taskBuilder({
  id: 'workload-controllers',
  name: 'StatefulSets and DaemonSets',
  description: 'Give a StatefulSet per-Pod DNS and scale it, create one behind a headless Service, or run a DaemonSet on every node, the control plane included.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 7,
  points: 6,
  tags: ['statefulset', 'daemonset', 'headless', 'dns', 'tolerations'],
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
  },
});

import { createNs, nsField, selectField } from '../types';
import { courseDir, onCp, onWorker, taskBuilder } from './tasks';

/** One line per Running Pod of the app: the node it runs on. */
const runningOn = (ns: string, app: string) =>
  `kubectl -n ${ns} get pods -l app=${app} --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.spec.nodeName}{"\\n"}{end}'`;

/** What setup remembers of the control plane node, to prove it was left alone. */
const CP_STATE = '/root/.cka-controlplane-node';
const cpNode = `kubectl get node controlplane -o jsonpath='{.metadata.labels} {.spec.taints}'`;

const debugUid = (ns: string) => `/root/.cka-debug-uid-${ns}`;

export const workloadPatternsBuilder = taskBuilder({
  id: 'workload-patterns',
  name: 'Workload patterns',
  description: 'Classic Pod puzzles: one Pod per node, readiness that depends on a Service, a Pod on the control plane, three containers on one volume, a static Pod behind a Service, and an ephemeral debug container.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['anti-affinity', 'readinessprobe', 'tolerations', 'multi-container', 'downward-api', 'static-pod', 'nodeport', 'kubectl-debug', 'ephemeral-containers'],
  fields: [
    nsField(['cdn', 'gateway-ns', 'storefront', 'partners', 'sandbox', 'tooling', 'internal', 'mobile', 'portal', 'staging']),
    selectField('NODE', 'Worker', ['worker-1', 'worker-2'], { randomizeByDefault: true }),
  ],
  tasks: {
    'one-per-node': {
      label: 'Run one Pod per worker and leave the extra replica Pending',
      make: ({ NS }) => ({
        title: 'One Pod per node',
        text: `Create Deployment \`edge-cache\` in namespace \`${NS}\` (create it if needed) with \`3\` replicas of \`nginx:1.27-alpine\`, whose Pods carry the label \`app=edge-cache\`. No two Pods may ever run on the same node, and none may run on the control plane.

Two Pods must be \`Running\`; leave the third \`Pending\`.`,
        setup: [`kubectl -n "${NS}" delete deployment edge-cache --ignore-not-found --wait=true >/dev/null 2>&1 || true`],
        checks: [
          {
            id: 'spec',
            description: 'edge-cache asks for 3 replicas of nginx:1.27-alpine',
            type: 'kubectl',
            run: `kubectl -n ${NS} get deployment edge-cache -o jsonpath='{.spec.replicas} {.spec.template.spec.containers[0].image}'`,
            expect: { equals: '3 nginx:1.27-alpine' },
            weight: 1,
          },
          {
            id: 'running',
            description: 'exactly 2 Pods run, one on each worker',
            type: 'kubectl',
            run: `echo "$(${runningOn(NS, 'edge-cache')} | wc -l) $(${runningOn(NS, 'edge-cache')} | sort -u | xargs)"`,
            expect: { matches: '^2 worker-[12] worker-[12]$' },
            weight: 3,
            retrySeconds: 60,
          },
          {
            id: 'pending',
            description: 'the third Pod stays Pending',
            type: 'kubectl',
            run: `kubectl -n ${NS} get pods -l app=edge-cache --field-selector=status.phase=Pending --no-headers 2>/dev/null | wc -l`,
            expect: { equals: '1' },
            weight: 1,
            retrySeconds: 60,
          },
          {
            id: 'rule',
            description: 'the scheduler refuses the third Pod',
            type: 'kubectl',
            run: `kubectl -n ${NS} get pods -l app=edge-cache --field-selector=status.phase=Pending -o jsonpath='{.items[0].status.conditions[?(@.type=="PodScheduled")].reason}'`,
            expect: { equals: 'Unschedulable' },
            weight: 1,
            retrySeconds: 60,
          },
        ],
        solution: [
          `kubectl create namespace ${NS} --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: edge-cache
  namespace: ${NS}
spec:
  replicas: 3
  selector:
    matchLabels: { app: edge-cache }
  template:
    metadata:
      labels: { app: edge-cache }
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - topologyKey: kubernetes.io/hostname
              labelSelector:
                matchLabels: { app: edge-cache }
      containers:
        - name: web
          image: nginx:1.27-alpine
EOF
for _ in $(seq 1 60); do
  [[ "$(${runningOn(NS, 'edge-cache')} | wc -l)" == 2 ]] && break
  sleep 2
done`,
        ],
        hints: [
          'kubectl create deployment edge-cache --image=nginx:1.27-alpine --replicas=3 --dry-run=client -o yaml gives you a starting manifest with the right label.',
          'Required pod anti-affinity on topologyKey kubernetes.io/hostname keeps two Pods with the same label off one node; a topology spread constraint allows 2 and 1.',
          'The control plane carries a NoSchedule taint, so a Pod without a toleration never lands there.',
        ],
      }),
    },
    'ready-if-reachable': {
      label: 'Make a Pod ready only while a Service has a backend',
      make: ({ NS }) => ({
        title: 'Ready only if the Service answers',
        text: `Service \`checkout-api\` in namespace \`${NS}\` has no Pods behind it yet.

1. Create Pod \`gatekeeper\` in \`${NS}\` with image \`nginx:1.27-alpine\`. Give it a liveness probe that runs the command \`true\`, and a readiness probe that runs \`wget\` and only passes while \`http://checkout-api:80\` answers. Start it and see that it runs but is not ready.
2. Create Pod \`backend\` in \`${NS}\` with image \`nginx:1.27-alpine\` so that the Service selects it. \`gatekeeper\` must then become ready on its own.

Do not change the Service.`,
        setup: [
          `${createNs(NS)}
kubectl -n "${NS}" delete pod gatekeeper backend --ignore-not-found --wait=true >/dev/null
kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"checkout-api"},"spec":{"selector":{"role":"checkout-backend"},"ports":[{"port":80}]}}' >/dev/null`,
        ],
        checks: [
          {
            id: 'probes',
            description: 'gatekeeper has the liveness probe, and a wget readiness probe on the Service',
            type: 'kubectl',
            run: `kubectl -n ${NS} get pod gatekeeper -o jsonpath='{.spec.containers[0].livenessProbe.exec.command[*]} / {.spec.containers[0].readinessProbe.exec.command[*]}'`,
            expect: { matches: 'true / .*wget.*checkout-api' },
            weight: 2,
          },
          {
            id: 'ready',
            description: 'gatekeeper is ready and did not restart',
            type: 'kubectl',
            run: `kubectl -n ${NS} get pod gatekeeper -o jsonpath='{.status.containerStatuses[0].ready} {.status.containerStatuses[0].restartCount}'`,
            expect: { equals: 'true 0' },
            weight: 2,
            retrySeconds: 60,
          },
          {
            id: 'backend',
            description: 'backend is an endpoint of checkout-api',
            type: 'kubectl',
            run: `kubectl -n ${NS} get endpointslices -l kubernetes.io/service-name=checkout-api -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}={.conditions.ready}{"\\n"}{end}' | xargs`,
            expect: { equals: 'backend=true' },
            weight: 1,
            retrySeconds: 30,
          },
          {
            id: 'service',
            description: 'the Service keeps its selector',
            type: 'kubectl',
            run: `kubectl -n ${NS} get service checkout-api -o jsonpath='{.spec.selector}'`,
            expect: { equals: '{"role":"checkout-backend"}' },
            weight: 1,
          },
        ],
        solution: [
          `kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: gatekeeper
  namespace: ${NS}
spec:
  containers:
    - name: gatekeeper
      image: nginx:1.27-alpine
      livenessProbe:
        exec: { command: ["true"] }
      readinessProbe:
        exec: { command: ["sh", "-c", "wget -T2 -O- http://checkout-api:80"] }
        periodSeconds: 5
EOF
kubectl -n ${NS} run backend --image=nginx:1.27-alpine --labels=role=checkout-backend
kubectl -n ${NS} wait --for=condition=Ready pod/backend pod/gatekeeper --timeout=120s`,
        ],
        hints: [
          `kubectl -n ${NS} describe service checkout-api shows the selector, and Endpoints stays empty until a ready Pod matches it.`,
          'A probe can run a command with exec: nginx:1.27-alpine has wget, and the Service name resolves inside the namespace.',
          'kubectl run <name> --image=... --labels=key=value creates the second Pod in one line.',
        ],
      }),
    },
    'control-plane-pod': {
      label: 'Schedule a Pod on the control plane without changing the node',
      make: ({ NS }) => ({
        title: 'A Pod on the control plane',
        text: `Create Pod \`cp-agent\` in namespace \`${NS}\` (create it if needed) with image \`httpd:2.4-alpine\` and container name \`cp-agent-container\`. The scheduler must place it on \`controlplane\`, and it must never land on another node.

Do not add labels to any node, and do not remove any taint.`,
        setup: [
          `kubectl -n "${NS}" delete pod cp-agent --ignore-not-found --wait=true >/dev/null 2>&1 || true
${cpNode} > ${CP_STATE}`,
        ],
        checks: [
          {
            id: 'placed',
            description: 'cp-agent runs on controlplane',
            type: 'kubectl',
            run: `kubectl -n ${NS} get pod cp-agent -o jsonpath='{.status.phase} {.spec.nodeName}'`,
            expect: { equals: 'Running controlplane' },
            weight: 3,
            retrySeconds: 60,
          },
          {
            id: 'container',
            description: 'its container is cp-agent-container with image httpd:2.4-alpine',
            type: 'kubectl',
            run: `kubectl -n ${NS} get pod cp-agent -o jsonpath='{.spec.containers[0].name} {.spec.containers[0].image}'`,
            expect: { equals: 'cp-agent-container httpd:2.4-alpine' },
            weight: 1,
          },
          {
            id: 'scheduled',
            description: 'a toleration and a node selection put it there, not a fixed nodeName',
            type: 'kubectl',
            run: `t=$(kubectl -n ${NS} get pod cp-agent -o jsonpath='{.spec.tolerations[*].key}'); s=$(kubectl -n ${NS} get pod cp-agent -o jsonpath='{.spec.nodeSelector}{.spec.affinity.nodeAffinity}'); echo "$t" | grep -q node-role.kubernetes.io/control-plane && [ -n "$s" ] && echo yes || echo no`,
            expect: { equals: 'yes' },
            weight: 1,
          },
          onCp({
            id: 'node-kept',
            description: 'controlplane keeps its labels and taints',
            run: `[ "$(${cpNode})" = "$(cat ${CP_STATE})" ] && echo kept || echo changed`,
            expect: { equals: 'kept' },
            weight: 1,
          }),
        ],
        solution: [
          `kubectl create namespace ${NS} --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: cp-agent
  namespace: ${NS}
spec:
  nodeSelector:
    node-role.kubernetes.io/control-plane: ""
  tolerations:
    - key: node-role.kubernetes.io/control-plane
      operator: Exists
      effect: NoSchedule
  containers:
    - name: cp-agent-container
      image: httpd:2.4-alpine
EOF
kubectl -n ${NS} wait --for=condition=Ready pod/cp-agent --timeout=120s`,
        ],
        hints: [
          'kubectl describe node controlplane shows its taints and labels.',
          'A toleration only allows the node; it does not attract the Pod. A second setting has to keep the Pod off the workers.',
          'controlplane already has a label that no worker has, so no new label is needed: use it in a nodeSelector.',
        ],
      }),
    },
    'three-containers': {
      label: 'Run three containers on one volume, with the node name from the downward API',
      make: ({ NS }) => ({
        title: 'Three containers, one volume',
        text: `Create Pod \`multi-logger\` in namespace \`${NS}\` (create it if needed) with three containers. They share a volume, mounted at \`/vol\` in each, that must not outlive the Pod:

- \`c1\`, image \`nginx:1.27-alpine\`, with an environment variable \`MY_NODE_NAME\` that holds the name of the node the Pod runs on
- \`c2\`, image \`busybox:1.36\`, which appends the output of \`date\` to \`/vol/date.log\` every second
- \`c3\`, image \`busybox:1.36\`, which keeps printing what is added to \`/vol/date.log\` to its standard output`,
        setup: [`kubectl -n "${NS}" delete pod multi-logger --ignore-not-found --wait=true >/dev/null 2>&1 || true`],
        checks: [
          {
            id: 'running',
            description: 'all three containers run',
            type: 'kubectl',
            run: `kubectl -n ${NS} get pod multi-logger -o jsonpath='{range .status.containerStatuses[*]}{.name}={.ready}{"\\n"}{end}' | sort | xargs`,
            expect: { equals: 'c1=true c2=true c3=true' },
            weight: 1,
            retrySeconds: 60,
          },
          {
            id: 'volume',
            description: 'an emptyDir is mounted at /vol in all three',
            type: 'kubectl',
            run: `echo "$(kubectl -n ${NS} get pod multi-logger -o jsonpath='{range .spec.containers[*]}{.volumeMounts[?(@.mountPath=="/vol")].mountPath}{"\\n"}{end}' | grep -c '^/vol$') $(kubectl -n ${NS} get pod multi-logger -o jsonpath='{.spec.volumes[?(@.emptyDir)].name}' | wc -w)"`,
            expect: { equals: '3 1' },
            weight: 1,
          },
          {
            id: 'node-name',
            description: 'MY_NODE_NAME in c1 comes from the Pod spec and holds its node',
            type: 'kubectl',
            run: `[ "$(kubectl -n ${NS} get pod multi-logger -o jsonpath='{.spec.containers[?(@.name=="c1")].env[?(@.name=="MY_NODE_NAME")].valueFrom.fieldRef.fieldPath}')" = spec.nodeName ] && [ "$(kubectl -n ${NS} exec multi-logger -c c1 -- printenv MY_NODE_NAME)" = "$(kubectl -n ${NS} get pod multi-logger -o jsonpath='{.spec.nodeName}')" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 2,
            retrySeconds: 30,
          },
          {
            id: 'logs',
            description: 'c2 keeps writing, and c3 prints it to standard output',
            type: 'kubectl',
            run: `a=$(kubectl -n ${NS} logs multi-logger -c c3 | wc -l); sleep 4; b=$(kubectl -n ${NS} logs multi-logger -c c3 | wc -l); last=$(kubectl -n ${NS} exec multi-logger -c c1 -- tail -n 1 /vol/date.log); [ "$b" -gt "$a" ] && [ -n "$last" ] && echo growing || echo stuck`,
            expect: { equals: 'growing' },
            weight: 2,
            retrySeconds: 30,
          },
        ],
        solution: [
          `kubectl create namespace ${NS} --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: multi-logger
  namespace: ${NS}
spec:
  terminationGracePeriodSeconds: 1
  containers:
    - name: c1
      image: nginx:1.27-alpine
      env:
        - name: MY_NODE_NAME
          valueFrom:
            fieldRef: { fieldPath: spec.nodeName }
      volumeMounts: [{ name: vol, mountPath: /vol }]
    - name: c2
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date >> /vol/date.log; sleep 1; done"]
      volumeMounts: [{ name: vol, mountPath: /vol }]
    - name: c3
      image: busybox:1.36
      command: ["sh", "-c", "until [ -f /vol/date.log ]; do sleep 1; done; tail -f /vol/date.log"]
      volumeMounts: [{ name: vol, mountPath: /vol }]
  volumes:
    - name: vol
      emptyDir: {}
EOF
kubectl -n ${NS} wait --for=condition=Ready pod/multi-logger --timeout=120s`,
        ],
        hints: [
          'An emptyDir volume lives exactly as long as its Pod and is shared by the containers that mount it.',
          'env[].valueFrom.fieldRef.fieldPath reads a Pod field, such as spec.nodeName, into a variable.',
          'tail -f keeps printing as a file grows; start it after the file exists, or let it wait.',
        ],
      }),
    },
    'static-pod-service': {
      label: 'Create a static Pod on a worker and expose it with a NodePort Service',
      make: ({ NODE }) => ({
        title: `Static Pod on ${NODE} with a Service`,
        text: `On \`${NODE}\`, create a static Pod \`static-web\` in namespace \`default\` with image \`nginx:1.27-alpine\` and resource requests of \`10m\` CPU and \`20Mi\` memory.

Then create Service \`static-web-svc\` of type \`NodePort\` in namespace \`default\` that exposes it on port \`80\`. It must have the static Pod as its endpoint and answer on the address of \`${NODE}\`.`,
        setup: ['kubectl -n default delete service static-web-svc --ignore-not-found >/dev/null'],
        checks: [
          {
            id: 'mirror',
            description: `static-web runs on ${NODE} as a static Pod`,
            type: 'kubectl',
            run: `kubectl -n default get pod static-web-${NODE} -o jsonpath='{.status.phase} {.spec.nodeName} {.metadata.annotations.kubernetes\\.io/config\\.mirror}'`,
            expect: { matches: `^Running ${NODE} \\S+$` },
            weight: 2,
            retrySeconds: 60,
          },
          {
            id: 'resources',
            description: 'it uses nginx:1.27-alpine and requests 10m CPU and 20Mi memory',
            type: 'kubectl',
            run: `kubectl -n default get pod static-web-${NODE} -o jsonpath='{.spec.containers[0].image} {.spec.containers[0].resources.requests.cpu} {.spec.containers[0].resources.requests.memory}'`,
            expect: { equals: 'nginx:1.27-alpine 10m 20Mi' },
            weight: 1,
          },
          {
            id: 'service',
            description: 'static-web-svc is a NodePort Service on port 80',
            type: 'kubectl',
            run: `kubectl -n default get service static-web-svc -o jsonpath='{.spec.type} {.spec.ports[0].port}'`,
            expect: { equals: 'NodePort 80' },
            weight: 1,
          },
          {
            id: 'endpoint',
            description: 'the static Pod is its endpoint',
            type: 'kubectl',
            run: `kubectl -n default get endpointslices -l kubernetes.io/service-name=static-web-svc -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{"\\n"}{end}' | xargs`,
            expect: { equals: `static-web-${NODE}` },
            weight: 1,
            retrySeconds: 30,
          },
          onCp({
            id: 'reachable',
            description: `the app answers on the node port of ${NODE}`,
            run: `port=$(kubectl -n default get service static-web-svc -o jsonpath='{.spec.ports[0].nodePort}'); curl -s -m 5 "http://$(getent hosts ${NODE} | awk '{print $1}'):$port/" | grep -q nginx && echo ok || echo fail`,
            expect: { equals: 'ok' },
            weight: 1,
            retrySeconds: 30,
          }),
        ],
        solution: [
          `${onWorker(
            NODE,
            `cat > /etc/kubernetes/manifests/static-web.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: static-web
  namespace: default
  labels: { app: static-web }
spec:
  containers:
    - name: web
      image: nginx:1.27-alpine
      resources:
        requests: { cpu: 10m, memory: 20Mi }
EOF`,
          )}
for _ in $(seq 1 60); do
  [[ "$(kubectl -n default get pod static-web-${NODE} -o jsonpath='{.status.phase}' 2>/dev/null)" == Running ]] && break
  sleep 2
done
kubectl -n default expose pod static-web-${NODE} --name=static-web-svc --type=NodePort --port=80`,
        ],
        hints: [
          `kubectl run static-web --image=nginx:1.27-alpine --dry-run=client -o yaml gives you a manifest. ssh ${NODE} and put it in the kubelet's static Pod directory (staticPodPath in /var/lib/kubelet/config.yaml).`,
          `The API shows a static Pod as a mirror Pod named static-web-${NODE}. You cannot edit it there: change the file.`,
          'A Service finds Pods by their labels, and a mirror Pod has the labels of its manifest. kubectl expose pod builds the Service from them.',
        ],
      }),
    },
    'debug-container': {
      label: 'Attach an ephemeral container to a Pod with no shell',
      make: ({ NS }) => ({
        title: 'Debug a Pod that has no shell',
        text: `Pod \`legacy-api\` in namespace \`${NS}\` runs an image with no shell and no tools, so \`kubectl exec\` is no use. Without restarting or replacing the Pod, attach an ephemeral container named \`debugger\` with image \`busybox:1.36\` that sees the processes of container \`app\`.

Write what \`ps\` prints in that container to \`/opt/course/debug/ps.txt\` on \`controlplane\`.`,
        setup: [
          `${courseDir('debug')}
${createNs(NS)}
kubectl -n "${NS}" delete pod legacy-api --ignore-not-found --wait=true >/dev/null
kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"legacy-api"},"spec":{"terminationGracePeriodSeconds":1,"containers":[{"name":"app","image":"registry.k8s.io/pause:3.10"}]}}' >/dev/null
kubectl -n "${NS}" wait --for=condition=Ready pod/legacy-api --timeout=120s >/dev/null
kubectl -n "${NS}" get pod legacy-api -o jsonpath='{.metadata.uid}' > ${debugUid(NS)}`,
        ],
        checks: [
          {
            id: 'ephemeral',
            description: 'debugger is an ephemeral container with busybox:1.36 that targets app',
            type: 'kubectl',
            run: `kubectl -n ${NS} get pod legacy-api -o jsonpath='{.spec.ephemeralContainers[?(@.name=="debugger")].image} {.spec.ephemeralContainers[?(@.name=="debugger")].targetContainerName}'`,
            expect: { equals: 'busybox:1.36 app' },
            weight: 3,
          },
          onCp({
            id: 'ps',
            description: 'ps.txt shows the process of container app',
            run: `grep -q '/pause' /opt/course/debug/ps.txt 2>/dev/null && echo seen || echo missing`,
            expect: { equals: 'seen' },
            weight: 2,
          }),
          onCp({
            id: 'same-pod',
            description: 'legacy-api was not replaced or restarted',
            run: `[ "$(kubectl -n ${NS} get pod legacy-api -o jsonpath='{.metadata.uid} {.status.containerStatuses[0].restartCount}')" = "$(cat ${debugUid(NS)}) 0" ] && echo same || echo replaced`,
            expect: { equals: 'same' },
            weight: 1,
          }),
        ],
        solution: [
          `kubectl -n ${NS} debug legacy-api --image=busybox:1.36 --target=app --container=debugger -- sh -c 'ps; sleep 3600'
for _ in $(seq 1 30); do
  kubectl -n ${NS} logs legacy-api -c debugger 2>/dev/null | grep -q /pause && break
  sleep 2
done
kubectl -n ${NS} logs legacy-api -c debugger > /opt/course/debug/ps.txt`,
        ],
        hints: [
          'kubectl debug <pod> adds an ephemeral container to a running Pod without restarting it. kubectl debug --help lists its flags.',
          '--target=<container> makes the new container share that container\'s process namespace. Without it, ps shows only its own processes.',
          'The command after -- can be ps itself. kubectl logs <pod> -c <container> reads an ephemeral container like any other.',
        ],
      }),
    },
  },
});

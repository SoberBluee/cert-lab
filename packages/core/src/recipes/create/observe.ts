import { createNs, nsField } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

/** Waits until metrics-server reports usage for every Pod of the namespace. */
const waitPodMetrics = (ns: string, pods: number) => `for _ in $(seq 1 60); do
  [[ "$(kubectl top pod -n "${ns}" --no-headers 2>/dev/null | wc -l)" -ge ${pods} ]] && break
  sleep 5
done
[[ "$(kubectl top pod -n "${ns}" --no-headers 2>/dev/null | wc -l)" -ge ${pods} ]] || { echo "no Pod metrics in ${ns}" >&2; exit 1; }`;

/** The first name a file holds, ignoring blank lines and spaces. */
const firstWord = (file: string) => `$(grep -v '^ *$' ${file} 2>/dev/null | head -1 | awk '{print $1}')`;

/** A Pod that holds `mb` MiB in a memory-backed volume, which counts as its memory use. */
const memPod = (ns: string, name: string, mb: string) => `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"${name}","namespace":"'"${ns}"'","labels":{"app":"perf"}},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sh","-c","dd if=/dev/zero of=/cache/fill bs=1M count=${mb} 2>/dev/null; sleep infinity"],"resources":{"limits":{"memory":"200Mi","cpu":"100m"}},"volumeMounts":[{"name":"cache","mountPath":"/cache"}]}],"volumes":[{"name":"cache","emptyDir":{"medium":"Memory","sizeLimit":"150Mi"}}]}}`;

const cpuPod = (ns: string, name: string, node = '') =>
  `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"${name}","namespace":"'"${ns}"'","labels":{"app":"perf"}},"spec":{${node ? `"nodeName":"${node}",` : ''}"containers":[{"name":"app","image":"busybox:1.36","command":["sh","-c","while true; do :; done"],"resources":{"limits":{"cpu":"800m","memory":"32Mi"}}}]}}`;

/** The first word of every non-blank line of a file, sorted and on one line. */
const words = (file: string) => `$(awk 'NF {print $1}' ${file} 2>/dev/null | sort -u | xargs)`;

/** The full containerd ID of container app of Pod tracker. */
const containerId = (ns: string) => `kubectl -n ${ns} get pod tracker -o jsonpath='{.status.containerStatuses[?(@.name=="app")].containerID}' | sed 's|.*://||'`;

/** The run=<token> that Pod tracker writes into both of its log lines. */
const runToken = (ns: string) => `kubectl -n ${ns} get pod tracker -o jsonpath='{.spec.containers[0].command[2]}' | grep -o 'run=[0-9a-f]*' | head -1`;

export const observeBuilder = taskBuilder({
  id: 'observe',
  name: 'Resource usage and logs',
  description: 'Read kubectl top, logs, events, QoS classes, crictl and api-resources, and write the answers to files, the way exam tasks ask.',
  domain: 'troubleshooting',
  difficulty: 1,
  minutes: 6,
  points: 6,
  tags: ['kubectl-top', 'logs', 'sort-by', 'metrics-server', 'qos', 'crictl', 'events', 'api-resources'],
  fields: [nsField(['perf', 'telemetry', 'insights', 'observe', 'usage', 'capacity', 'watchtower', 'signals', 'probe-ns', 'stats'])],
  tasks: {
    'top-pods': {
      label: 'Find the Pods using the most memory and CPU',
      make: ({ NS }) => ({
        title: `Busiest Pods in ${NS}`,
        text: `The cluster runs metrics-server. On \`controlplane\`:

1. Write the name of the Pod in namespace \`${NS}\` that uses the most **memory** right now to \`/opt/course/top/memory-pod.txt\`.
2. Write the name of the Pod in namespace \`${NS}\` that uses the most **CPU** right now to \`/opt/course/top/cpu-pod.txt\`.

Write only the Pod name into each file.`,
        setup: [
          `${courseDir('top')}
${createNs(NS)}
names=(cache-a cache-b ledger-sync report-gen indexer)
sizes=($(shuf -e 12 30 70 45 20))
for i in 0 1 2 3; do
  kubectl apply -f - <<< '${memPod(NS, `'"\${names[$i]}"'`, `'"\${sizes[$i]}"'`)}' >/dev/null
done
kubectl apply -f - <<< '${cpuPod(NS, `'"\${names[4]}"'`)}' >/dev/null
kubectl -n "${NS}" wait --for=condition=Ready pod -l app=perf --timeout=180s >/dev/null
sleep 30
${waitPodMetrics(NS, 5)}`,
        ],
        checks: [
          onCp({
            id: 'memory',
            description: `memory-pod.txt names the Pod in ${NS} using the most memory`,
            run: `[ "${firstWord('/opt/course/top/memory-pod.txt')}" = "$(kubectl top pod -n ${NS} --sort-by=memory --no-headers | head -1 | awk '{print $1}')" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 3,
            retrySeconds: 30,
          }),
          onCp({
            id: 'cpu',
            description: `cpu-pod.txt names the Pod in ${NS} using the most CPU`,
            run: `[ "${firstWord('/opt/course/top/cpu-pod.txt')}" = "$(kubectl top pod -n ${NS} --sort-by=cpu --no-headers | head -1 | awk '{print $1}')" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 3,
            retrySeconds: 30,
          }),
        ],
        solution: [
          `kubectl top pod -n ${NS} --sort-by=memory --no-headers | head -1 | awk '{print $1}' > /opt/course/top/memory-pod.txt
kubectl top pod -n ${NS} --sort-by=cpu --no-headers | head -1 | awk '{print $1}' > /opt/course/top/cpu-pod.txt`,
        ],
        hints: [
          'kubectl top pod -n <namespace> shows current CPU and memory usage per Pod.',
          'kubectl top pod has --sort-by=cpu and --sort-by=memory, and --no-headers makes the output easy to cut.',
        ],
      }),
    },
    'top-nodes': {
      label: 'Find the busiest node and script the lookup',
      make: ({ NS }) => ({
        title: 'Busiest node',
        text: `The cluster runs metrics-server. On \`controlplane\`:

1. Write the name of the node that uses the most **CPU** right now to \`/opt/course/top/node.txt\`.
2. Write a script \`/opt/course/top/nodes.sh\` that prints every node with its CPU and memory usage, busiest CPU first, using \`kubectl\`.

Only the node name goes into \`node.txt\`.`,
        setup: [
          `${courseDir('top')}
${createNs(NS)}
busy=$(shuf -e worker-1 worker-2 -n 1)
for i in 1 2; do
  kubectl apply -f - <<< '${cpuPod(NS, `burner-'"$i"'`, `'"$busy"'`)}' >/dev/null
done
kubectl -n "${NS}" wait --for=condition=Ready pod -l app=perf --timeout=180s >/dev/null
sleep 45
for _ in $(seq 1 30); do
  [[ "$(kubectl top node --sort-by=cpu --no-headers 2>/dev/null | head -1 | awk '{print $1}')" == "$busy" ]] && break
  sleep 5
done`,
        ],
        checks: [
          onCp({
            id: 'node',
            description: 'node.txt names the node using the most CPU',
            run: `[ "${firstWord('/opt/course/top/node.txt')}" = "$(kubectl top node --sort-by=cpu --no-headers | head -1 | awk '{print $1}')" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 4,
            retrySeconds: 30,
          }),
          onCp({
            id: 'script',
            description: 'nodes.sh prints the nodes, busiest CPU first',
            run: `out=$(runuser -u ubuntu -- bash /opt/course/top/nodes.sh 2>/dev/null | grep -E 'controlplane|worker'); first=$(echo "$out" | head -1 | awk '{print $1}'); [ "$(echo "$out" | wc -l)" -ge 3 ] && [ "$first" = "$(kubectl top node --sort-by=cpu --no-headers | head -1 | awk '{print $1}')" ] && echo works || echo broken`,
            expect: { equals: 'works' },
            weight: 2,
            retrySeconds: 30,
          }),
        ],
        solution: [
          `kubectl top node --sort-by=cpu --no-headers | head -1 | awk '{print $1}' > /opt/course/top/node.txt
echo 'kubectl top node --sort-by=cpu' > /opt/course/top/nodes.sh
chown ubuntu:ubuntu /opt/course/top/*`,
        ],
        hints: [
          'kubectl top node shows the CPU and memory each node uses right now.',
          'kubectl top node --sort-by=cpu puts the busiest node first.',
        ],
      }),
    },
    'previous-logs': {
      label: 'Extract the errors of a crashed container',
      make: ({ NS }) => ({
        title: 'Errors of a crashed container',
        text: `Pod \`pay-0\` in namespace \`${NS}\` runs containers \`api\` and \`proxy\`. Container \`api\` crashed once and was restarted. On \`controlplane\`:

1. Write every line containing \`ERROR\` that the **crashed** instance of container \`api\` logged, and nothing else, to \`/opt/course/logs/errors.txt\`.
2. Write the exit code that crashed instance ended with to \`/opt/course/logs/exit-code.txt\`.`,
        setup: [
          `${courseDir('logs')}
${createNs(NS)}
kubectl -n "${NS}" delete pod pay-0 --ignore-not-found --wait=true >/dev/null
token=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \\n')
kubectl apply -f - <<EOF >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: pay-0
  namespace: ${NS}
spec:
  containers:
    - name: api
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          if [ ! -f /state/crashed ]; then
            echo "INFO starting payment api run=$token"
            echo "ERROR cannot reach ledger at ledger:5432 run=$token"
            echo "INFO retrying in 1s"
            echo "ERROR ledger still down, giving up run=$token"
            touch /state/crashed
            exit 3
          fi
          echo "INFO payment api up"
          while true; do echo "INFO healthy"; sleep 30; done
      volumeMounts: [{ name: state, mountPath: /state }]
    - name: proxy
      image: busybox:1.36
      command: ["sh", "-c", "echo 'ERROR proxy upstream api not ready yet'; echo 'INFO proxy listening on 8080'; sleep infinity"]
  volumes:
    - name: state
      emptyDir: {}
EOF
for _ in $(seq 1 60); do
  [[ "$(kubectl -n "${NS}" get pod pay-0 -o jsonpath='{.status.containerStatuses[?(@.name=="api")].restartCount}')" -ge 1 ]] && break
  sleep 2
done
kubectl -n "${NS}" wait --for=condition=Ready pod/pay-0 --timeout=120s >/dev/null`,
        ],
        checks: [
          onCp({
            id: 'errors',
            description: 'errors.txt holds exactly the ERROR lines of the crashed api container',
            run: `[ "$(grep -v '^ *$' /opt/course/logs/errors.txt 2>/dev/null)" = "$(kubectl -n ${NS} logs pay-0 -c api --previous | grep ERROR)" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 4,
          }),
          onCp({
            id: 'exit-code',
            description: 'exit-code.txt holds the exit code of the crashed instance',
            run: `[ "$(tr -d ' \\n' < /opt/course/logs/exit-code.txt 2>/dev/null)" = "$(kubectl -n ${NS} get pod pay-0 -o jsonpath='{.status.containerStatuses[?(@.name=="api")].lastState.terminated.exitCode}')" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 2,
          }),
        ],
        solution: [
          `kubectl -n ${NS} logs pay-0 -c api --previous | grep ERROR > /opt/course/logs/errors.txt
kubectl -n ${NS} get pod pay-0 -o jsonpath='{.status.containerStatuses[?(@.name=="api")].lastState.terminated.exitCode}' > /opt/course/logs/exit-code.txt`,
        ],
        hints: [
          'kubectl logs <pod> -c <container> picks one container of a multi-container Pod.',
          'kubectl logs --previous (-p) shows the output of the container instance before the last restart.',
          'kubectl describe pod shows Last State: Terminated with its Exit Code; so does .status.containerStatuses[].lastState.',
        ],
      }),
    },
    'sorted-list': {
      label: 'List Pods by creation time and phase',
      make: ({ NS }) => ({
        title: `Pods of ${NS} in order`,
        text: `On \`controlplane\`, using \`kubectl\`:

1. Write the names of all Pods in namespace \`${NS}\`, oldest first by creation time, one per line, to \`/opt/course/sort/pods.txt\`.
2. Write the names of the Pods in namespace \`${NS}\` that are not \`Running\`, one per line, to \`/opt/course/sort/not-running.txt\`.`,
        setup: [
          `${courseDir('sort')}
${createNs(NS)}
kubectl -n "${NS}" delete pod --all --wait=true >/dev/null 2>&1 || true
for name in $(shuf -e zeta-api alpha-worker mid-cache beta-sync omega-report); do
  cmd='"sleep","infinity"'
  [[ "$name" == beta-sync || "$name" == omega-report ]] && cmd='"sh","-c","exit 1"'
  kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"$name"'","namespace":"'"${NS}"'"},"spec":{"restartPolicy":"Never","containers":[{"name":"c","image":"busybox:1.36","command":['"$cmd"']}]}}' >/dev/null
  sleep 2
done
kubectl -n "${NS}" wait --for=jsonpath='{.status.phase}'=Running pod/zeta-api pod/alpha-worker pod/mid-cache --timeout=120s >/dev/null`,
        ],
        checks: [
          onCp({
            id: 'oldest-first',
            description: 'pods.txt lists every Pod, oldest first',
            run: `[ "$(grep -oE 'zeta-api|alpha-worker|mid-cache|beta-sync|omega-report' /opt/course/sort/pods.txt 2>/dev/null | xargs)" = "$(kubectl -n ${NS} get pods --sort-by=.metadata.creationTimestamp --no-headers -o custom-columns=N:.metadata.name | xargs)" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 4,
          }),
          onCp({
            id: 'not-running',
            description: 'not-running.txt lists the Pods that are not Running',
            run: `[ "$(grep -oE 'zeta-api|alpha-worker|mid-cache|beta-sync|omega-report' /opt/course/sort/not-running.txt 2>/dev/null | sort | xargs)" = "$(kubectl -n ${NS} get pods --field-selector=status.phase!=Running --no-headers -o custom-columns=N:.metadata.name | sort | xargs)" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 2,
          }),
        ],
        solution: [
          `kubectl -n ${NS} get pods --sort-by=.metadata.creationTimestamp --no-headers -o custom-columns=NAME:.metadata.name > /opt/course/sort/pods.txt
kubectl -n ${NS} get pods --field-selector=status.phase!=Running --no-headers -o custom-columns=NAME:.metadata.name > /opt/course/sort/not-running.txt`,
        ],
        hints: [
          'kubectl get pods --sort-by=<jsonpath> sorts by any field, for example .metadata.creationTimestamp.',
          '-o custom-columns=NAME:.metadata.name --no-headers prints just the names; --field-selector filters on fields such as status.phase.',
        ],
      }),
    },
    qos: {
      label: 'Find the Pods killed first under memory pressure',
      make: ({ NS }) => ({
        title: `Eviction order in ${NS}`,
        text: `The nodes are running low on memory. On \`controlplane\`:

1. Write the names of the Pods in namespace \`${NS}\` that would be killed first when a node runs out of memory, one per line, to \`/opt/course/qos/first.txt\`.
2. The Pods of Deployment \`billing\` in \`${NS}\` must be among the last to be killed instead: change it so that its Pods get the highest Quality of Service class.

Do not change the images, commands or replica count of \`billing\`.`,
        setup: [
          `${courseDir('qos')}
${createNs(NS)}
kubectl -n "${NS}" delete deployment billing --ignore-not-found --wait=true >/dev/null
kubectl -n "${NS}" delete pod --all --wait=true >/dev/null 2>&1 || true
# Two BestEffort Pods; a Pod with one unconstrained container is still Burstable, and limits alone make a Pod Guaranteed.
names=($(shuf -e api-gw cache-warm report-gen log-ship batch-etl metrics-agg))
kubectl apply -f - <<EOF >/dev/null
apiVersion: v1
kind: Pod
metadata: { name: \${names[0]}, namespace: ${NS} }
spec:
  containers:
    - { name: app, image: busybox:1.36, command: [sleep, infinity] }
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[1]}, namespace: ${NS} }
spec:
  containers:
    - { name: app, image: busybox:1.36, command: [sleep, infinity] }
    - { name: helper, image: busybox:1.36, command: [sleep, infinity] }
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[2]}, namespace: ${NS} }
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: [sleep, infinity]
      resources: { requests: { cpu: 20m, memory: 16Mi } }
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[3]}, namespace: ${NS} }
spec:
  containers:
    - { name: app, image: busybox:1.36, command: [sleep, infinity] }
    - name: helper
      image: busybox:1.36
      command: [sleep, infinity]
      resources: { requests: { memory: 16Mi } }
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[4]}, namespace: ${NS} }
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: [sleep, infinity]
      resources: { limits: { cpu: 50m, memory: 32Mi } }
---
apiVersion: v1
kind: Pod
metadata: { name: \${names[5]}, namespace: ${NS} }
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: [sleep, infinity]
      resources: { requests: { cpu: 20m, memory: 32Mi }, limits: { cpu: 20m, memory: 32Mi } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: billing, namespace: ${NS} }
spec:
  replicas: 2
  selector: { matchLabels: { app: billing } }
  template:
    metadata: { labels: { app: billing } }
    spec:
      terminationGracePeriodSeconds: 2
      containers:
        - name: app
          image: busybox:1.36
          command: [sleep, infinity]
          resources: { requests: { cpu: 30m, memory: 32Mi }, limits: { cpu: 30m, memory: 32Mi } }
        - name: metrics
          image: busybox:1.36
          command: [sleep, infinity]
          resources: { requests: { cpu: 10m, memory: 16Mi } }
EOF
kubectl -n "${NS}" rollout status deployment/billing --timeout=180s >/dev/null
kubectl -n "${NS}" wait --for=condition=Ready pod --all --timeout=180s >/dev/null`,
        ],
        checks: [
          onCp({
            id: 'first',
            description: `first.txt lists exactly the BestEffort Pods of ${NS}`,
            run: `want=$(kubectl -n ${NS} get pods -o jsonpath='{range .items[?(@.status.qosClass=="BestEffort")]}{.metadata.name}{"\\n"}{end}' | sort -u | xargs); [ -n "$want" ] && [ "${words('/opt/course/qos/first.txt')}" = "$want" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 3,
          }),
          {
            id: 'guaranteed',
            description: 'both replicas of billing run in QoS class Guaranteed',
            type: 'kubectl',
            run: `echo "$(kubectl -n ${NS} get deployment billing -o jsonpath='{.status.readyReplicas}') $(kubectl -n ${NS} get pods -l app=billing -o jsonpath='{range .items[*]}{.status.qosClass}{"\\n"}{end}' | sort -u | xargs)"`,
            expect: { equals: '2 Guaranteed' },
            weight: 2,
            retrySeconds: 60,
          },
          {
            id: 'kept',
            description: 'billing keeps its replicas, images and commands',
            type: 'kubectl',
            run: `kubectl -n ${NS} get deployment billing -o jsonpath='{.spec.replicas}{range .spec.template.spec.containers[*]} {.name}={.image}:{.command[*]}{end}'`,
            expect: { equals: '2 app=busybox:1.36:sleep infinity metrics=busybox:1.36:sleep infinity' },
            weight: 1,
          },
        ],
        solution: [
          `kubectl -n ${NS} get pods -o jsonpath='{range .items[?(@.status.qosClass=="BestEffort")]}{.metadata.name}{"\\n"}{end}' > /opt/course/qos/first.txt
kubectl -n ${NS} set resources deployment/billing -c metrics --limits=cpu=10m,memory=16Mi
kubectl -n ${NS} rollout status deployment/billing --timeout=180s`,
        ],
        hints: [
          'kubectl get pod <name> -o jsonpath=\'{.status.qosClass}\' (or kubectl describe pod) shows the QoS class: Guaranteed, Burstable or BestEffort.',
          'When a node runs out of memory, BestEffort Pods go first, Guaranteed Pods last.',
          'A Pod is Guaranteed only when every container has CPU and memory limits and requests equal to them; requests default to the limits when unset.',
        ],
      }),
    },
    crictl: {
      label: 'Inspect a Pod\'s container with crictl',
      make: ({ NS }) => ({
        title: 'Inspect a container with crictl',
        text: `Pod \`tracker\` runs in namespace \`${NS}\`. Using \`crictl\` on the node it runs on:

1. Write the ID of its container \`app\` and that container's \`info.runtimeType\`, separated by a space, to \`/opt/course/crictl/container.txt\` on \`controlplane\`.
2. Write all logs of that container to \`/opt/course/crictl/container.log\` on \`controlplane\`.`,
        setup: [
          `${courseDir('crictl')}
${createNs(NS)}
kubectl -n "${NS}" delete pod tracker --ignore-not-found --wait=true >/dev/null
node=$(shuf -e worker-1 worker-2 -n 1)
token=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \\n')
kubectl apply -f - <<EOF >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: tracker
  namespace: ${NS}
spec:
  nodeSelector: { kubernetes.io/hostname: $node }
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "INFO tracker started run=$token"
          echo "WARN cache cold, warming up run=$token" >&2
          sleep infinity
EOF
kubectl -n "${NS}" wait --for=condition=Ready pod/tracker --timeout=120s >/dev/null`,
        ],
        checks: [
          onCp({
            id: 'container-id',
            description: 'container.txt starts with the ID of container app, in full or shortened as crictl ps prints it',
            run: `id=$(${containerId(NS)}); have=$(awk 'NF {print $1; exit}' /opt/course/crictl/container.txt 2>/dev/null); [ \${#have} -ge 12 ] && [ "\${id#"$have"}" != "$id" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 2,
          }),
          onCp({
            id: 'runtime-type',
            description: 'container.txt then gives the runtimeType crictl reports for it',
            run: `id=$(${containerId(NS)}); node=$(kubectl -n ${NS} get pod tracker -o jsonpath='{.spec.nodeName}'); want=$(runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new "$node" sudo crictl inspect "$id" | jq -r .info.runtimeType); [ -n "$want" ] && [ "$(awk 'NF {print $2; exit}' /opt/course/crictl/container.txt 2>/dev/null)" = "$want" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 1,
          }),
          onCp({
            id: 'logs-stdout',
            description: 'container.log holds what the container wrote to standard output',
            run: `t=$(${runToken(NS)}); grep -q "INFO tracker started $t" /opt/course/crictl/container.log 2>/dev/null && echo yes || echo no`,
            expect: { equals: 'yes' },
            weight: 1,
          }),
          onCp({
            id: 'logs-stderr',
            description: 'container.log also holds what it wrote to standard error',
            run: `t=$(${runToken(NS)}); grep -q "WARN cache cold, warming up $t" /opt/course/crictl/container.log 2>/dev/null && echo yes || echo no`,
            expect: { equals: 'yes' },
            weight: 2,
          }),
        ],
        solution: [
          `node=$(kubectl -n ${NS} get pod tracker -o jsonpath='{.spec.nodeName}')
id=$(runuser -u ubuntu -- ssh "$node" sudo crictl ps -q --name app --label io.kubernetes.pod.name=tracker --label io.kubernetes.pod.namespace=${NS})
echo "$id $(runuser -u ubuntu -- ssh "$node" sudo crictl inspect "$id" | jq -r .info.runtimeType)" > /opt/course/crictl/container.txt
runuser -u ubuntu -- ssh "$node" sudo crictl logs "$id" > /opt/course/crictl/container.log 2>&1
chown ubuntu:ubuntu /opt/course/crictl/*`,
        ],
        hints: [
          `kubectl -n ${NS} get pod tracker -o wide shows the node; ssh to it and run crictl with sudo.`,
          'crictl ps lists the running containers (filter with --name or --label io.kubernetes.pod.name=...); crictl inspect <id> prints JSON that holds info.runtimeType.',
          'crictl logs passes the container\'s standard error through to its own: redirect both streams, with &> or 2>&1.',
        ],
      }),
    },
    events: {
      label: 'List cluster events by time and record what a deletion caused',
      make: ({ NS }) => ({
        title: 'Cluster events',
        text: `On \`controlplane\`:

1. Write a script \`/opt/course/events/cluster-events.sh\` that uses \`kubectl\` to print the events of the whole cluster, ordered by creation time, newest last.
2. Delete the Pod of Deployment \`ticker\` in namespace \`${NS}\`. Write the events this caused, as \`kubectl\` lists them, to \`/opt/course/events/pod-kill.log\`.`,
        setup: [
          `${courseDir('events')}
${createNs(NS)}
${createNs(`${NS}-audit`)}
kubectl -n "${NS}" delete deployment ticker --ignore-not-found --wait=true >/dev/null
kubectl -n "${NS}" wait --for=delete pod -l app=ticker --timeout=90s >/dev/null 2>&1 || true
kubectl -n "${NS}" delete events --all >/dev/null 2>&1 || true
kubectl -n "${NS}" create deployment ticker --image=busybox:1.36 -- sleep infinity >/dev/null
kubectl -n "${NS}" rollout status deployment/ticker --timeout=120s >/dev/null`,
        ],
        checks: [
          // Events expire after an hour, so the check makes its own: one in ${NS}-audit, then one in ${NS}.
          // Listed by namespace and name the second comes first; listed by creation time, last.
          onCp({
            id: 'sorted',
            description: 'cluster-events.sh prints the events of every namespace, oldest first',
            run: `s=$(date +%s); for i in 1 2; do ns=${NS}-audit; [ $i = 2 ] && ns=${NS}; t=$(date -u +%Y-%m-%dT%H:%M:%SZ); kubectl create -f - >/dev/null <<< '{"apiVersion":"v1","kind":"Event","metadata":{"name":"order-probe-'$i'-'$s'","namespace":"'$ns'"},"involvedObject":{"kind":"Pod","name":"order-probe","namespace":"'$ns'"},"reason":"OrderProbe","message":"order probe '$i' '$s'","type":"Normal","firstTimestamp":"'$t'","lastTimestamp":"'$t'"}'; [ $i = 1 ] && sleep 2; done; out=$(sudo -u ubuntu -H bash /opt/course/events/cluster-events.sh 2>/dev/null); a=$(echo "$out" | grep -n "order probe 1 $s" | head -1 | cut -d: -f1); b=$(echo "$out" | grep -n "order probe 2 $s" | head -1 | cut -d: -f1); kubectl -n ${NS}-audit delete event order-probe-1-$s >/dev/null 2>&1; kubectl -n ${NS} delete event order-probe-2-$s >/dev/null 2>&1; [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ] && echo sorted || echo unsorted`,
            expect: { equals: 'sorted' },
            weight: 3,
          }),
          onCp({
            id: 'killed',
            description: 'pod-kill.log shows the deleted ticker Pod being killed',
            run: `old=$(grep -i killing /opt/course/events/pod-kill.log 2>/dev/null | grep -oE 'ticker-[a-z0-9]+-[a-z0-9]+' | head -1); [ -n "$old" ] && ! kubectl -n ${NS} get pod "$old" >/dev/null 2>&1 && echo yes || echo no`,
            expect: { equals: 'yes' },
            weight: 2,
            retrySeconds: 45,
          }),
          onCp({
            id: 'recreated',
            description: 'pod-kill.log shows its replacement being created',
            run: `ok=no; for p in $(kubectl -n ${NS} get pods -l app=ticker -o jsonpath='{.items[*].metadata.name}'); do grep -q "Created pod: $p" /opt/course/events/pod-kill.log 2>/dev/null && ok=yes; done; echo $ok`,
            expect: { equals: 'yes' },
            weight: 1,
          }),
        ],
        solution: [
          `cat > /opt/course/events/cluster-events.sh <<'EOF'
#!/usr/bin/env bash
kubectl get events -A --sort-by=.metadata.creationTimestamp
EOF
chown ubuntu:ubuntu /opt/course/events/cluster-events.sh
old=$(kubectl -n ${NS} get pods -l app=ticker -o jsonpath='{.items[0].metadata.name}')
kubectl -n ${NS} delete pod "$old" --wait=false
for _ in $(seq 1 30); do
  kubectl -n ${NS} get events --field-selector reason=Killing,involvedObject.name="$old" -o name | grep -q . && break
  sleep 2
done
kubectl -n ${NS} rollout status deployment/ticker --timeout=120s
kubectl -n ${NS} get events --sort-by=.metadata.creationTimestamp | grep -E "$old|Created pod" > /opt/course/events/pod-kill.log`,
        ],
        hints: [
          'kubectl get events -A lists the events of every namespace; --sort-by=.metadata.creationTimestamp orders them oldest first.',
          'Deleting a Pod of a Deployment makes the kubelet stop its containers (reason Killing) and the ReplicaSet create a replacement (SuccessfulCreate, then Scheduled, Pulled, Started).',
          'kubectl get events --field-selector involvedObject.name=<pod> narrows the list to one object.',
        ],
      }),
    },
    'api-resources': {
      label: 'List namespaced resource types and count Roles',
      make: ({ NS }) => ({
        title: 'API resources and Roles',
        text: `On \`controlplane\`:

1. Write the names of all namespaced resource types the cluster serves (for example \`pods\` and \`secrets\`), one per line, to \`/opt/course/api-resources/namespaced.txt\`.
2. Of the namespaces whose name starts with \`${NS}-\`, find the one with the most Roles. Write its name and its number of Roles, separated by a space, to \`/opt/course/api-resources/crowded.txt\`.`,
        setup: [
          `${courseDir('api-resources')}
counts=($(shuf -e 2 4 7))
i=0
for team in red blue green; do
  ns="${NS}-$team"
  kubectl create namespace "$ns" >/dev/null 2>&1 || kubectl get namespace "$ns" >/dev/null
  kubectl -n "$ns" delete role --all >/dev/null
  for n in $(seq 1 "\${counts[$i]}"); do
    kubectl -n "$ns" create role "reader-$n" --verb=get,list --resource=pods >/dev/null
  done
  i=$((i + 1))
done`,
        ],
        checks: [
          onCp({
            id: 'namespaced',
            description: 'namespaced.txt lists exactly the namespaced resource types',
            run: `want=$(kubectl api-resources --namespaced=true -o name 2>/dev/null | sed 's/\\..*//' | sort -u | xargs); have=$(awk 'NF && $1 != "NAME" {print $1}' /opt/course/api-resources/namespaced.txt 2>/dev/null | sed 's/\\..*//' | sort -u | xargs); [ -n "$want" ] && [ "$have" = "$want" ] && echo match || echo differs`,
            expect: { equals: 'match' },
            weight: 3,
          }),
          onCp({
            id: 'crowded',
            description: `crowded.txt names the ${NS}- namespace with the most Roles, and how many it has`,
            run: `want=$(for ns in $(kubectl get namespaces -o name | sed 's|^namespace/||' | grep '^${NS}-'); do echo "$ns $(kubectl -n "$ns" get roles --no-headers 2>/dev/null | wc -l)"; done | sort -k2 -n | tail -1); [ -n "$want" ] && [ "$(awk 'NF {print $1, $2; exit}' /opt/course/api-resources/crowded.txt 2>/dev/null)" = "$want" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 3,
          }),
        ],
        solution: [
          `kubectl api-resources --namespaced=true -o name > /opt/course/api-resources/namespaced.txt
for ns in $(kubectl get namespaces -o name | sed 's|^namespace/||' | grep "^${NS}-"); do
  echo "$ns $(kubectl -n "$ns" get roles --no-headers | wc -l)"
done | sort -k2 -n | tail -1 > /opt/course/api-resources/crowded.txt`,
        ],
        hints: [
          'kubectl api-resources lists every resource type the API server serves; --namespaced=true keeps the namespaced ones, and -o name prints only their names.',
          'kubectl -n <namespace> get roles --no-headers | wc -l counts the Roles of one namespace; loop over the namespaces.',
        ],
      }),
    },
  },
});

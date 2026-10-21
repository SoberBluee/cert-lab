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

export const observeBuilder = taskBuilder({
  id: 'observe',
  name: 'Resource usage and logs',
  description: 'Read kubectl top, container logs and sorted listings, and write the answers to files, the way exam tasks ask.',
  domain: 'troubleshooting',
  difficulty: 1,
  minutes: 6,
  points: 6,
  tags: ['kubectl-top', 'logs', 'sort-by', 'metrics-server'],
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
  },
});

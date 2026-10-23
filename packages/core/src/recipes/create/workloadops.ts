import { createNs, nsField, selectField } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

/** Converts a Kubernetes quantity read from jsonpath to millicores or MiB, in awk. */
const toMilli = `awk '{v=$1; if (v ~ /m$/) {sub(/m$/,"",v); print int(v)} else print int(v*1000)}'`;
const toMi = `awk '{v=$1; if (v ~ /Ki$/) {sub(/Ki$/,"",v); print int(v/1024)} else if (v ~ /Mi$/) {sub(/Mi$/,"",v); print int(v)} else if (v ~ /Gi$/) {sub(/Gi$/,"",v); print int(v*1024)} else print int(v/1048576)}'`;

export const workloadOpsBuilder = taskBuilder({
  id: 'workload-ops',
  name: 'Workload operations',
  description: 'Size requests from a node\'s capacity, configure a Job\'s completions and clean-up, rank a PriorityClass, issue a short-lived ServiceAccount token, and call the API from inside a Pod.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['resources', 'job', 'priorityclass', 'serviceaccount-token', 'in-cluster-api'],
  fields: [
    nsField(['blog', 'cms', 'batch-jobs', 'build', 'ops', 'pipeline', 'release', 'platform-ops', 'ci', 'media-jobs']),
    selectField('NODE', 'Worker', ['worker-1', 'worker-2'], { randomizeByDefault: true }),
  ],
  tasks: {
    'split-resources': {
      label: 'Split a node\'s capacity across replicas',
      make: ({ NS, NODE }) => ({
        title: 'Size the requests from the node',
        text: `Deployment \`wordpress\` in namespace \`${NS}\` runs \`3\` replicas pinned to \`${NODE}\`, but its Pods stay \`Pending\`.

Change its resource requests so that the 3 Pods share three quarters of \`${NODE}\`'s **allocatable** CPU and memory evenly (the last quarter stays free for system Pods), rounding down to whole millicores and MiB. The init container must request the same as the main container. All 3 replicas must run.

Do not change the replica count, the node pinning or the images.`,
        setup: [
          `${createNs(NS)}
kubectl apply -f - <<EOF >/dev/null
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wordpress
  namespace: ${NS}
spec:
  replicas: 3
  selector:
    matchLabels: { app: wordpress }
  template:
    metadata:
      labels: { app: wordpress }
    spec:
      nodeSelector: { kubernetes.io/hostname: ${NODE} }
      initContainers:
        - name: init-config
          image: busybox:1.36
          command: ["sh", "-c", "echo configured"]
          resources:
            requests: { cpu: "1", memory: 1Gi }
      containers:
        - name: wordpress
          image: nginx:1.27-alpine
          resources:
            requests: { cpu: "1", memory: 1Gi }
EOF`,
        ],
        checks: [
          {
            id: 'running',
            description: `all 3 replicas of wordpress run on ${NODE}`,
            type: 'kubectl',
            run: `echo "$(kubectl -n ${NS} get deployment wordpress -o jsonpath='{.status.readyReplicas}') $(kubectl -n ${NS} get pods -l app=wordpress --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.spec.nodeName}{"\\n"}{end}' | sort -u | xargs)"`,
            expect: { equals: `3 ${NODE}` },
            weight: 2,
            retrySeconds: 90,
          },
          {
            id: 'requests',
            description: `each container requests a quarter of ${NODE}'s allocatable CPU and memory (rounded down)`,
            type: 'kubectl',
            run: `cpu=$(kubectl get node ${NODE} -o jsonpath='{.status.allocatable.cpu}' | ${toMilli}); mem=$(kubectl get node ${NODE} -o jsonpath='{.status.allocatable.memory}' | ${toMi}); ok=yes; for c in initContainers containers; do rc=$(kubectl -n ${NS} get deployment wordpress -o jsonpath="{.spec.template.spec.$c[0].resources.requests.cpu}" | ${toMilli}); rm=$(kubectl -n ${NS} get deployment wordpress -o jsonpath="{.spec.template.spec.$c[0].resources.requests.memory}" | ${toMi}); [ "$rc" -le $((cpu / 4)) ] && [ "$rc" -ge $((cpu / 4 - cpu / 100)) ] && [ "$rm" -le $((mem / 4)) ] && [ "$rm" -ge $((mem / 4 - mem / 100)) ] || ok=no; done; echo $ok`,
            expect: { equals: 'yes' },
            weight: 3,
          },
          {
            id: 'kept',
            description: 'replicas, node pinning and images are unchanged',
            type: 'kubectl',
            run: `kubectl -n ${NS} get deployment wordpress -o jsonpath='{.spec.replicas} {.spec.template.spec.nodeSelector.kubernetes\\.io/hostname} {.spec.template.spec.initContainers[0].image} {.spec.template.spec.containers[0].image}'`,
            expect: { equals: `3 ${NODE} busybox:1.36 nginx:1.27-alpine` },
            weight: 1,
          },
        ],
        solution: [
          `cpu=$(kubectl get node ${NODE} -o jsonpath='{.status.allocatable.cpu}' | ${toMilli})
mem=$(kubectl get node ${NODE} -o jsonpath='{.status.allocatable.memory}' | ${toMi})
kubectl -n ${NS} set resources deployment/wordpress -c init-config,wordpress --requests=cpu=$((cpu / 4))m,memory=$((mem / 4))Mi
kubectl -n ${NS} rollout status deployment/wordpress --timeout=180s`,
        ],
        hints: [
          `kubectl describe node ${NODE} shows Capacity and Allocatable; the scheduler only looks at Allocatable and at what other Pods request.`,
          'Three quarters split across 3 Pods is one quarter each. CPU in millicores (1 = 1000m), memory in Mi (1Gi = 1024Mi, 1Mi = 1024Ki).',
          'kubectl set resources deployment/<name> -c <containers> --requests=cpu=...,memory=... changes init and main containers alike.',
        ],
      }),
    },
    job: {
      label: 'Create a Job with completions, parallelism and clean-up',
      make: ({ NS }) => ({
        title: 'Parallel Job',
        text: `In namespace \`${NS}\` (create it if needed), create Job \`thumbnails\` that runs image \`busybox:1.36\` with the command \`sh -c "echo resized; sleep 3"\`:

- it must complete \`6\` times, running at most \`2\` Pods at a time
- it gives up after \`3\` failed Pods
- Kubernetes deletes it automatically \`1\` hour after it finishes

Let it run to completion.`,
        setup: [`kubectl -n "${NS}" delete job thumbnails --ignore-not-found --wait=true >/dev/null 2>&1 || true`],
        checks: [
          {
            id: 'spec',
            description: 'thumbnails has completions 6, parallelism 2, backoffLimit 3 and ttlSecondsAfterFinished 3600',
            type: 'kubectl',
            run: `kubectl -n ${NS} get job thumbnails -o jsonpath='{.spec.completions} {.spec.parallelism} {.spec.backoffLimit} {.spec.ttlSecondsAfterFinished}'`,
            expect: { equals: '6 2 3 3600' },
            weight: 3,
          },
          {
            id: 'complete',
            description: 'thumbnails completed 6 Pods',
            type: 'kubectl',
            run: `kubectl -n ${NS} get job thumbnails -o jsonpath='{.status.succeeded}'`,
            expect: { equals: '6' },
            weight: 2,
            retrySeconds: 90,
          },
          {
            id: 'container',
            description: 'it runs busybox:1.36 and prints resized',
            type: 'kubectl',
            run: `echo "$(kubectl -n ${NS} get job thumbnails -o jsonpath='{.spec.template.spec.containers[0].image}') $(kubectl -n ${NS} logs job/thumbnails 2>/dev/null | head -1)"`,
            expect: { equals: 'busybox:1.36 resized' },
            weight: 1,
          },
        ],
        solution: [
          `kubectl create namespace ${NS} --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: thumbnails
  namespace: ${NS}
spec:
  completions: 6
  parallelism: 2
  backoffLimit: 3
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: resize
          image: busybox:1.36
          command: ["sh", "-c", "echo resized; sleep 3"]
EOF
kubectl -n ${NS} wait --for=condition=Complete job/thumbnails --timeout=180s`,
        ],
        hints: [
          'kubectl create job thumbnails --image=busybox:1.36 --dry-run=client -o yaml -- sh -c "..." gives you a starting manifest.',
          'completions, parallelism, backoffLimit and ttlSecondsAfterFinished are all fields of the Job spec (kubectl explain job.spec).',
        ],
      }),
    },
    priority: {
      label: 'Rank a PriorityClass below the highest one',
      make: ({ NS }) => ({
        title: 'PriorityClass relative to the others',
        text: `Deployment \`ops\` in namespace \`${NS}\` must run with a high priority, but not above the most important workloads.

1. Create PriorityClass \`high-ops\` with a value exactly one lower than the highest **user-defined** PriorityClass in the cluster (ignore the built-in \`system-\` classes). It must not become the global default.
2. Make Deployment \`ops\` use it, so that its running Pods carry that priority.`,
        setup: [
          `${createNs(NS)}
kubectl delete priorityclass high-ops --ignore-not-found >/dev/null
top=$(shuf -i 40000-90000 -n 1)
for pc in "team-critical:$top" "batch-low:1000" "team-normal:$((top / 4))"; do
  name=\${pc%%:*} value=\${pc##*:}
  kubectl delete priorityclass "$name" --ignore-not-found >/dev/null
  kubectl create priorityclass "$name" --value="$value" --description="lab class" >/dev/null
done
kubectl -n "${NS}" create deployment ops --image=nginx:1.27-alpine --replicas=2 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}" rollout status deployment/ops --timeout=180s >/dev/null`,
        ],
        checks: [
          {
            id: 'value',
            description: 'high-ops is one below the highest user-defined PriorityClass',
            type: 'kubectl',
            run: `top=$(kubectl get priorityclass -o jsonpath='{range .items[*]}{.metadata.name} {.value}{"\\n"}{end}' | grep -vE '^(system-|high-ops )' | sort -k2 -n | tail -1 | awk '{print $2}'); [ "$(kubectl get priorityclass high-ops -o jsonpath='{.value}')" = "$((top - 1))" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 2,
          },
          {
            id: 'not-default',
            description: 'high-ops is not the global default',
            type: 'kubectl',
            run: `kubectl get priorityclass high-ops -o jsonpath='{.globalDefault}'`,
            expect: { notContains: 'true' },
            weight: 1,
          },
          {
            id: 'pods',
            description: 'the running Pods of ops have the priority of high-ops',
            type: 'kubectl',
            run: `v=$(kubectl get priorityclass high-ops -o jsonpath='{.value}'); n=$(kubectl -n ${NS} get pods -l app=ops --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.spec.priorityClassName}={.spec.priority}{"\\n"}{end}' | grep -c "^high-ops=$v$"); [ "$n" -ge 2 ] && echo yes || echo no`,
            expect: { equals: 'yes' },
            weight: 3,
            retrySeconds: 60,
          },
        ],
        solution: [
          `top=$(kubectl get priorityclass -o jsonpath='{range .items[*]}{.metadata.name} {.value}{"\\n"}{end}' | grep -v '^system-' | sort -k2 -n | tail -1 | awk '{print $2}')
kubectl create priorityclass high-ops --value=$((top - 1)) --description="ops, just below the most critical"
kubectl -n ${NS} patch deployment ops -p '{"spec":{"template":{"spec":{"priorityClassName":"high-ops"}}}}'
kubectl -n ${NS} rollout status deployment/ops --timeout=180s`,
        ],
        hints: [
          'kubectl get priorityclass lists every class with its value; --sort-by=.value helps.',
          'kubectl create priorityclass <name> --value=<n> creates one; globalDefault stays false unless you ask.',
          'Pods get their priority when they are created: changing the Pod template rolls out new Pods that carry it.',
        ],
      }),
    },
    token: {
      label: 'Issue a short-lived ServiceAccount token',
      make: ({ NS }) => ({
        title: 'Token for a ServiceAccount',
        text: `The CI system authenticates as ServiceAccount \`ci\` in namespace \`${NS}\`. On \`controlplane\`, create a token for that ServiceAccount that is valid for exactly \`1\` hour, and write the token, and nothing else, to \`/opt/course/token/ci.token\`.

Do not create a Secret for it: the token must not be long-lived.`,
        setup: [
          `${courseDir('token')}
${createNs(NS)}
kubectl -n "${NS}" delete serviceaccount ci --ignore-not-found >/dev/null
kubectl -n "${NS}" create serviceaccount ci >/dev/null`,
        ],
        checks: [
          onCp({
            id: 'authenticates',
            description: `the token authenticates as system:serviceaccount:${NS}:ci`,
            run: `kubectl --token="$(tr -d ' \\n' < /opt/course/token/ci.token 2>/dev/null)" --kubeconfig=/dev/null --server="$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')" --insecure-skip-tls-verify auth whoami -o jsonpath='{.status.userInfo.username}' 2>/dev/null`,
            expect: { equals: `system:serviceaccount:${NS}:ci` },
            weight: 3,
          }),
          onCp({
            id: 'lifetime',
            description: 'the token is valid for 1 hour',
            run: `p=$(tr -d ' \\n' < /opt/course/token/ci.token 2>/dev/null | cut -d. -f2 | tr '_-' '/+'); while [ $(( \${#p} % 4 )) -ne 0 ]; do p="$p="; done; echo "$p" | base64 -d 2>/dev/null | jq -r '.exp - .iat'`,
            expect: { equals: '3600' },
            weight: 2,
          }),
          {
            id: 'no-secret',
            description: 'no long-lived token Secret exists for ci',
            type: 'kubectl',
            run: `kubectl -n ${NS} get secrets -o jsonpath='{range .items[?(@.type=="kubernetes.io/service-account-token")]}{.metadata.annotations.kubernetes\\.io/service-account\\.name}{"\\n"}{end}' | grep -cx ci || true`,
            expect: { equals: '0' },
            weight: 1,
          },
        ],
        solution: [`kubectl -n ${NS} create token ci --duration=1h > /opt/course/token/ci.token`],
        hints: [
          'kubectl create token <serviceaccount> prints a fresh, time-limited token.',
          'Its --duration flag sets how long it is valid (for example 1h).',
          'A token is a JWT: its middle part, base64-decoded, holds iat and exp.',
        ],
      }),
    },
    'api-call': {
      label: 'Call the API from inside a Pod with its ServiceAccount token',
      make: ({ NS }) => ({
        title: 'Query the API from a Pod',
        text: `ServiceAccount \`secret-reader\` in namespace \`${NS}\` may read the Secrets of that namespace.

1. Create Pod \`api-contact\` in \`${NS}\` with image \`alpine:3.21\` that runs as \`secret-reader\` and keeps running.
2. From inside that Pod, query the Kubernetes API for the Secrets of namespace \`${NS}\`, authenticated with the Pod's ServiceAccount token. Write the raw JSON response to \`/opt/course/api-call/result.json\` on \`controlplane\`.`,
        setup: [
          `${courseDir('api-call')}
${createNs(NS)}
kubectl -n "${NS}" delete pod api-contact --ignore-not-found --wait=true >/dev/null
kubectl -n "${NS}" create serviceaccount secret-reader --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}" create role secret-reader --verb=get,list --resource=secrets --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}" create rolebinding secret-reader --role=secret-reader --serviceaccount="${NS}:secret-reader" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
key=$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \\n')
kubectl -n "${NS}" create secret generic app-credentials --from-literal=api-key="$key" --dry-run=client -o yaml | kubectl apply -f - >/dev/null`,
        ],
        checks: [
          {
            id: 'pod',
            description: 'api-contact runs alpine:3.21 as ServiceAccount secret-reader',
            type: 'kubectl',
            run: `kubectl -n ${NS} get pod api-contact -o jsonpath='{.status.phase} {.spec.serviceAccountName} {.spec.containers[0].image}'`,
            expect: { equals: 'Running secret-reader alpine:3.21' },
            weight: 2,
            retrySeconds: 30,
          },
          onCp({
            id: 'list',
            description: `result.json is the API's SecretList for ${NS}`,
            run: `jq -r '"\\(.kind) \\([.items[]?.metadata.namespace] | unique | join(","))"' /opt/course/api-call/result.json 2>/dev/null`,
            expect: { equals: `SecretList ${NS}` },
            weight: 2,
          }),
          onCp({
            id: 'secret',
            description: 'result.json holds Secret app-credentials with its current data',
            run: `[ -n "$(kubectl -n ${NS} get secret app-credentials -o jsonpath='{.data.api-key}')" ] && [ "$(jq -r '.items[]? | select(.metadata.name == "app-credentials") | .data["api-key"]' /opt/course/api-call/result.json 2>/dev/null)" = "$(kubectl -n ${NS} get secret app-credentials -o jsonpath='{.data.api-key}')" ] && echo yes || echo no`,
            expect: { equals: 'yes' },
            weight: 2,
          }),
        ],
        solution: [
          `kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: api-contact
  namespace: ${NS}
spec:
  serviceAccountName: secret-reader
  containers:
    - name: api-contact
      image: alpine:3.21
      command: ["sleep", "infinity"]
EOF
kubectl -n ${NS} wait --for=condition=Ready pod/api-contact --timeout=120s
kubectl -n ${NS} exec api-contact -- sh -c 'D=/var/run/secrets/kubernetes.io/serviceaccount; wget -qO- --no-check-certificate --header "Authorization: Bearer $(cat $D/token)" "https://kubernetes.default.svc/api/v1/namespaces/$(cat $D/namespace)/secrets"' > /opt/course/api-call/result.json`,
        ],
        hints: [
          'A Pod\'s ServiceAccount token, the cluster CA and the namespace are mounted under /var/run/secrets/kubernetes.io/serviceaccount/.',
          'Inside the cluster the API server is https://kubernetes.default.svc; Secrets of a namespace are at /api/v1/namespaces/<namespace>/secrets.',
          'Send the token as the header "Authorization: Bearer <token>". alpine has wget: wget -qO- --header "..." --no-check-certificate <url>, run with kubectl exec and redirected on controlplane.',
        ],
      }),
    },
  },
});

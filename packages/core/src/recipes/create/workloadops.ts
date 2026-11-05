import { createNs, nsField, selectField } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

/** Converts a Kubernetes quantity read from jsonpath to millicores or MiB, in awk. */
const toMilli = `awk '{v=$1; if (v ~ /m$/) {sub(/m$/,"",v); print int(v)} else print int(v*1000)}'`;
const toMi = `awk '{v=$1; if (v ~ /Ki$/) {sub(/Ki$/,"",v); print int(v/1024)} else if (v ~ /Mi$/) {sub(/Mi$/,"",v); print int(v)} else if (v ~ /Gi$/) {sub(/Gi$/,"",v); print int(v*1024)} else print int(v/1048576)}'`;

/** The release the rollback task asks for, and where setup notes its revision and image. */
const TARGET_RELEASE = '2.3.1';
const rollbackState = (ns: string) => `/root/.cka-rollback-${ns}`;

export const workloadOpsBuilder = taskBuilder({
  id: 'workload-ops',
  name: 'Workload operations',
  description: 'Size requests from a node\'s capacity, configure a Job\'s completions and clean-up, rank a PriorityClass, issue a short-lived ServiceAccount token, call the API from inside a Pod, set quotas and defaults for a namespace, and roll back to a chosen revision.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['resources', 'job', 'priorityclass', 'serviceaccount-token', 'in-cluster-api', 'resourcequota', 'limitrange', 'rollback'],
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
    'quota-limits': {
      label: 'Give a namespace default resources and a quota',
      make: ({ NS }) => ({
        title: `Guard rails for ${NS}`,
        text: `Namespace \`${NS}\` already runs Pod \`existing\`. The team needs guard rails in it:

1. Create LimitRange \`container-defaults\`, so that a container with no resources set gets requests of \`50m\` CPU and \`32Mi\` memory, and limits of \`200m\` CPU and \`128Mi\` memory.
2. Create ResourceQuota \`team-quota\` that allows at most \`2\` Pods and \`500m\` of requested CPU.
3. Create Pod \`quota-probe\` with image \`nginx:1.27-alpine\` and no resources in its manifest.

Any further Pod in the namespace must now be refused.`,
        setup: [
          `${createNs(NS)}
kubectl -n "${NS}" delete resourcequota,limitrange --all >/dev/null
kubectl -n "${NS}" delete pod --all --wait=true >/dev/null
kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"existing"},"spec":{"terminationGracePeriodSeconds":1,"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","infinity"],"resources":{"requests":{"cpu":"100m","memory":"32Mi"},"limits":{"cpu":"100m","memory":"32Mi"}}}]}}' >/dev/null
kubectl -n "${NS}" wait --for=condition=Ready pod/existing --timeout=120s >/dev/null`,
        ],
        checks: [
          {
            id: 'limitrange',
            description: 'container-defaults sets the default limits and requests',
            type: 'kubectl',
            run: `kubectl -n ${NS} get limitrange container-defaults -o jsonpath='{.spec.limits[?(@.type=="Container")].default.cpu} {.spec.limits[?(@.type=="Container")].default.memory} {.spec.limits[?(@.type=="Container")].defaultRequest.cpu} {.spec.limits[?(@.type=="Container")].defaultRequest.memory}'`,
            expect: { equals: '200m 128Mi 50m 32Mi' },
            weight: 2,
          },
          {
            id: 'quota',
            description: 'team-quota allows 2 Pods and 500m of requested CPU',
            type: 'kubectl',
            run: `kubectl -n ${NS} get resourcequota team-quota -o jsonpath='{.spec.hard.pods} {.spec.hard.requests\\.cpu}'`,
            expect: { equals: '2 500m' },
            weight: 1,
          },
          {
            id: 'defaults',
            description: 'quota-probe runs with the defaults',
            type: 'kubectl',
            run: `kubectl -n ${NS} get pod quota-probe -o jsonpath='{.status.phase} {.spec.containers[0].resources.requests.cpu} {.spec.containers[0].resources.requests.memory} {.spec.containers[0].resources.limits.cpu} {.spec.containers[0].resources.limits.memory}'`,
            expect: { equals: 'Running 50m 32Mi 200m 128Mi' },
            weight: 2,
            retrySeconds: 60,
          },
          {
            id: 'refused',
            description: 'the quota refuses a third Pod',
            type: 'kubectl',
            run: `kubectl -n ${NS} run refused-probe --image=nginx:1.27-alpine --dry-run=server 2>&1`,
            expect: { contains: 'exceeded quota' },
            weight: 1,
            retrySeconds: 30,
          },
        ],
        solution: [
          `kubectl apply -f - <<EOF
apiVersion: v1
kind: LimitRange
metadata:
  name: container-defaults
  namespace: ${NS}
spec:
  limits:
    - type: Container
      default: { cpu: 200m, memory: 128Mi }
      defaultRequest: { cpu: 50m, memory: 32Mi }
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-quota
  namespace: ${NS}
spec:
  hard:
    pods: "2"
    requests.cpu: 500m
EOF
kubectl -n ${NS} run quota-probe --image=nginx:1.27-alpine
kubectl -n ${NS} wait --for=condition=Ready pod/quota-probe --timeout=120s`,
        ],
        hints: [
          'kubectl create quota team-quota --hard=pods=2,requests.cpu=500m is one line; a LimitRange has no such command, so write its YAML (kubectl explain limitrange.spec.limits).',
          'default sets the limits, and defaultRequest the requests, of containers that give none.',
          'A quota on requests.cpu refuses Pods without a CPU request, so the LimitRange has to be there first.',
          'kubectl describe resourcequota shows Used against Hard.',
        ],
      }),
    },
    'rollback-revision': {
      label: 'Find a revision by its contents and roll back to it',
      make: ({ NS }) => ({
        title: 'Roll back to a chosen release',
        text: `Deployment \`billing\` in namespace \`${NS}\` has been released five times, and the last releases are bad. Each release sets the environment variable \`RELEASE\` in the Pod template.

1. Find the revision in which \`RELEASE\` was \`${TARGET_RELEASE}\`, and write its number to \`/opt/course/rollback/revision.txt\` on \`controlplane\`.
2. Roll the Deployment back to that revision.`,
        setup: [
          `${courseDir('rollback')}
${createNs(NS)}
kubectl -n "${NS}" delete deployment billing --ignore-not-found --wait=true >/dev/null
others=($(shuf -e 2.2.0 2.3.0 2.3.2 2.4.0))
target=$(shuf -i 2-3 -n 1)
next=0
for rev in 1 2 3 4 5; do
  image=$(shuf -e nginx:1.26-alpine nginx:1.27-alpine nginx:1.28-alpine -n 1)
  if [[ "$rev" == "$target" ]]; then
    release=${TARGET_RELEASE}
    echo "$rev $image" > ${rollbackState(NS)}
  else
    release=\${others[$next]}
    next=$((next + 1))
  fi
  kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"billing"},"spec":{"replicas":2,"selector":{"matchLabels":{"app":"billing"}},"template":{"metadata":{"labels":{"app":"billing"}},"spec":{"terminationGracePeriodSeconds":1,"containers":[{"name":"web","image":"'"$image"'","env":[{"name":"RELEASE","value":"'"$release"'"}]}]}}}}' >/dev/null
  kubectl -n "${NS}" rollout status deployment/billing --timeout=120s >/dev/null
done`,
        ],
        setupTimeout: 420,
        checks: [
          onCp({
            id: 'revision',
            description: `revision.txt holds the revision that had RELEASE=${TARGET_RELEASE}`,
            run: `[ "$(tr -d '[:space:]' < /opt/course/rollback/revision.txt 2>/dev/null)" = "$(awk '{print $1}' ${rollbackState(NS)})" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 2,
          }),
          onCp({
            id: 'rolled-back',
            description: `billing runs 2 ready replicas of that revision's image with RELEASE=${TARGET_RELEASE}`,
            run: `[ "$(kubectl -n ${NS} get deployment billing -o jsonpath='{.status.readyReplicas}/{.status.updatedReplicas} {.spec.template.spec.containers[0].image} {.spec.template.spec.containers[0].env[?(@.name=="RELEASE")].value}')" = "2/2 $(awk '{print $2}' ${rollbackState(NS)}) ${TARGET_RELEASE}" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 3,
            retrySeconds: 60,
          }),
          onCp({
            id: 'renumbered',
            description: 'the Deployment reached it by a rollback, which moved that revision to the top of the history',
            run: `n=$(awk '{print $1}' ${rollbackState(NS)}); kubectl -n ${NS} rollout history deployment/billing | awk 'NR > 2 && NF {print $1}' | grep -qx "$n" && echo "still listed" || echo moved`,
            expect: { equals: 'moved' },
            weight: 1,
          }),
        ],
        solution: [
          `rev=
for r in $(kubectl -n ${NS} rollout history deployment/billing | awk 'NR > 2 && NF {print $1}'); do
  kubectl -n ${NS} rollout history deployment/billing --revision="$r" | grep -q 'RELEASE:.*${TARGET_RELEASE}' && rev=$r
done
echo "$rev" > /opt/course/rollback/revision.txt
kubectl -n ${NS} rollout undo deployment/billing --to-revision="$rev"
kubectl -n ${NS} rollout status deployment/billing --timeout=120s`,
        ],
        hints: [
          'kubectl rollout history deployment/<name> lists the revisions; adding --revision=<n> prints the Pod template of one of them.',
          'kubectl rollout undo goes back one revision unless you name another with --to-revision.',
          'A rollback gets a new revision number, and the old number leaves the history: note it before you roll back.',
        ],
      }),
    },
  },
});

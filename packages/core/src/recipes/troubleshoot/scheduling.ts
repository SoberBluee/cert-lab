import { createNs, nameField, nsField, sq } from '../types';
import type { FaultCategory } from './types';
import { waitUnhealthy } from './wait';

const IMAGE = 'nginx:1.27-alpine';

const waitReady = (ns: string, app: string) => `kubectl -n "${ns}" rollout status "deployment/${app}" --timeout=240s`;

/** Memory quantity in MiB, for summing the requests on a node; defines to_mi in the script. */
const TO_MI = `to_mi() {
  local q="$1"
  case "$q" in
    *Ki) echo $(( \${q%Ki} / 1024 )) ;;
    *Mi) echo "\${q%Mi}" ;;
    *Gi) echo $(( \${q%Gi} * 1024 )) ;;
    *k) echo $(( \${q%k} * 1000 / 1048576 )) ;;
    *M) echo $(( \${q%M} * 1000000 / 1048576 )) ;;
    *G) echo $(( \${q%G} * 1000000000 / 1048576 )) ;;
    "") echo 0 ;;
    *) echo $(( q / 1048576 )) ;;
  esac
}`;

export const schedulingCategory: FaultCategory = {
  id: 'scheduling',
  name: 'Scheduling',
  description: 'A Deployment does not get its Pods: the scheduler cannot place them, or they are never created.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 8,
  points: 5,
  tags: ['troubleshooting', 'scheduling', 'affinity', 'resources', 'priorityclass'],
  settleSeconds: 20,
  fields: [
    nsField(['batch', 'reports', 'analytics', 'jobs', 'compute', 'pipeline', 'etl', 'ml', 'spark', 'queue']),
    nameField('APP', 'Deployment name', ['worker', 'renderer', 'indexer', 'processor', 'aggregator', 'transformer', 'crawler', 'builder', 'compiler', 'runner']),
  ],
  shell: ({ NS, APP }, state) => ({
    title: `Deployment ${APP} not running`,
    text: `Deployment \`${APP}\` in namespace \`${NS}\` should run \`2\` replicas, but it does not. Make both replicas run.

Keep the image, the replica count and the container's requests of \`100m\` CPU and \`64Mi\` memory. Objects in namespace \`${NS}\` that stand in the way may be changed or removed, but do not change any node. Do not delete or recreate the Deployment.`,
    spec: `- \`2\` replicas of image \`${IMAGE}\`, container \`web\`
- requests \`100m\` CPU and \`64Mi\` memory, and no limits
- no affinity, nodeSelector or topology spread constraint, and the default priority
- nothing else in \`${NS}\` takes the capacity those Pods need or keeps them off the workers`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
  labels: { app: ${APP} }
spec:
  replicas: 0
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: web
          image: ${IMAGE}
          ports: [{ containerPort: 80 }]
          resources:
            requests: { cpu: 100m, memory: 64Mi }
EOF
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.metadata.uid}' > "${state}.uid"
chmod 644 "${state}.uid"`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=2
${waitUnhealthy(NS, `app=${APP}`, 15)}
[[ "$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.status.readyReplicas}')" != 2 ]] || { echo "${APP} still runs 2 replicas" >&2; exit 1; }`,
    checks: [
      {
        id: 'ready',
        description: `${APP} has 2 ready replicas`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.status.readyReplicas}/{.status.updatedReplicas}/{.status.replicas}'`,
        expect: { equals: '2/2/2' },
        weight: 3,
        retrySeconds: 60,
      },
      {
        id: 'spec',
        description: 'replicas, image and requests match the spec',
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.replicas} {.spec.template.spec.containers[0].image} {.spec.template.spec.containers[0].resources.requests.cpu} {.spec.template.spec.containers[0].resources.requests.memory}'`,
        expect: { equals: `2 ${IMAGE} 100m 64Mi` },
        weight: 1,
      },
      {
        id: 'same-deployment',
        description: `${APP} was not deleted or recreated`,
        type: 'kubectl',
        run: `[ "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.metadata.uid}')" = "$(cat ${state}.uid)" ] && echo same || echo recreated`,
        expect: { equals: 'same' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} get deployment,replicaset,pods -o wide: are Pods missing altogether, or do they exist and stay Pending?`,
      `Missing Pods were refused when the ReplicaSet tried to create them: kubectl -n ${NS} describe replicaset -l app=${APP} shows the FailedCreate reason.`,
      `Pending Pods were never placed: kubectl -n ${NS} describe pod <pod> shows the scheduler's reason under Events.`,
      `What does the Pod template ask for, and what else runs in the namespace? kubectl -n ${NS} get deployment ${APP} -o yaml, kubectl -n ${NS} get all -o wide, and Allocated resources in kubectl describe node.`,
    ],
  }),
  // Quotas and LimitRanges refuse Pods at admission: they belong to Rejected Pods. These are the scheduler's.
  layers: [
    { name: 'what else runs in the namespace', faults: ['memory-hog', 'agent-anti-affinity'] },
    { name: 'the Pod template', faults: ['node-affinity', 'priority-class', 'topology-spread-zone'] },
  ],
  faults: ({ NS, APP }) => [
    {
      id: 'memory-hog',
      label: 'Other Deployments request nearly all the memory of each worker',
      // Starves every worker: stage it after other questions and fix it first.
      disruptive: true,
      blocksScheduling: 'cluster',
      break: `${TO_MI}
i=0
for n in $(kubectl get nodes -l '!node-role.kubernetes.io/control-plane' -o jsonpath='{.items[*].metadata.name}'); do
  i=$((i + 1))
  alloc=$(to_mi "$(kubectl get node "$n" -o jsonpath='{.status.allocatable.memory}')")
  used=0
  for q in $(kubectl get pods -A --field-selector "spec.nodeName=$n,status.phase!=Succeeded,status.phase!=Failed" -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.resources.requests.memory}{" "}{end}{end}'); do
    used=$((used + $(to_mi "$q")))
  done
  # Leaves 40Mi: less than one replica's 64Mi.
  hog=$((alloc - used - 40))
  (( hog > 64 )) || { echo "worker $n has too little memory left" >&2; exit 1; }
  kubectl -n "${NS}" apply -f - <<< ${sq(`{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"warmup-'"$i"'","labels":{"role":"cache"}},"spec":{"replicas":1,"selector":{"matchLabels":{"app":"warmup-'"$i"'"}},"template":{"metadata":{"labels":{"app":"warmup-'"$i"'","role":"cache"}},"spec":{"nodeSelector":{"kubernetes.io/hostname":"'"$n"'"},"containers":[{"name":"cache","image":"busybox:1.36","command":["sleep","infinity"],"resources":{"requests":{"cpu":"10m","memory":"'"$hog"'Mi"}}}]}}}}`)} >/dev/null
done
kubectl -n "${NS}" wait --for=condition=Available deployment -l role=cache --timeout=180s >/dev/null`,
      fix: `kubectl -n "${NS}" scale deployment -l role=cache --replicas=0`,
      wait: waitReady(NS, APP),
      explain: `Deployments \`warmup-1\` and \`warmup-2\` in \`${NS}\` each pin a Pod to one worker and request almost all of the memory that worker has left, so neither worker can fit a \`${APP}\` Pod's \`64Mi\`. \`kubectl -n ${NS} describe pod <pending-pod>\` says \`Insufficient memory\`; \`kubectl describe node\` shows the memory requests near 100% under Allocated resources, and \`kubectl get pods -A -o wide\` shows whose Pods those are. The spec keeps \`${APP}\`'s requests, and the task lets you change what stands in the way: scale the \`warmup\` Deployments down (or lower their requests).`,
    },
    {
      id: 'agent-anti-affinity',
      label: 'Required anti-affinity against Pods that run on every worker',
      break: `kubectl -n "${NS}" apply -f - <<< ${sq(`{"apiVersion":"apps/v1","kind":"DaemonSet","metadata":{"name":"log-agent"},"spec":{"selector":{"matchLabels":{"app":"log-agent"}},"template":{"metadata":{"labels":{"app":"log-agent","tier":"infra"}},"spec":{"containers":[{"name":"agent","image":"busybox:1.36","command":["sleep","infinity"],"resources":{"requests":{"cpu":"10m","memory":"16Mi"}}}]}}}}`)} >/dev/null
kubectl -n "${NS}" rollout status daemonset/log-agent --timeout=180s >/dev/null
kubectl -n "${NS}" patch deployment "${APP}" -p '{"spec":{"template":{"spec":{"affinity":{"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"tier":"infra"}},"topologyKey":"kubernetes.io/hostname"}]}}}}}}'`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity/podAntiAffinity"}]'`,
      wait: waitReady(NS, APP),
      explain: `The Pod template says \`${APP}\` must never share a node with a Pod labelled \`tier=infra\` (required \`podAntiAffinity\`, \`topologyKey: kubernetes.io/hostname\`). DaemonSet \`log-agent\` runs a \`tier=infra\` Pod on every worker, so no node qualifies and the Pods stay \`Pending\` with "didn't match pod anti-affinity rules". The spec wants no affinity: remove \`podAntiAffinity\` from the template (the agent itself is fine).`,
    },
    {
      id: 'node-affinity',
      label: 'Required node affinity matches no node',
      break: `kubectl -n "${NS}" patch deployment "${APP}" -p '{"spec":{"template":{"spec":{"affinity":{"nodeAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":{"nodeSelectorTerms":[{"matchExpressions":[{"key":"disktype","operator":"In","values":["ssd"]}]}]}}}}}}}'`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity"}]'`,
      wait: waitReady(NS, APP),
      explain:
        'The Pod template requires nodes labelled `disktype=ssd`, and no node has that label, so the Pods stay Pending with "didn\'t match Pod\'s node affinity/selector". The spec allows any node: remove the affinity.',
    },
    {
      id: 'priority-class',
      label: 'Unknown PriorityClass',
      break: `kubectl -n "${NS}" patch deployment "${APP}" -p '{"spec":{"template":{"spec":{"priorityClassName":"critical-batch"}}}}'`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/priorityClassName"}]'`,
      wait: waitReady(NS, APP),
      explain:
        'The Pod template asks for PriorityClass `critical-batch`, which does not exist, so the ReplicaSet\'s creates fail with "no PriorityClass with name critical-batch was found". The spec wants the default priority: remove `priorityClassName`.',
    },
    {
      id: 'topology-spread-zone',
      label: 'Topology spread requires a zone label no node has',
      break: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p ${sq(`[{"op":"add","path":"/spec/template/spec/topologySpreadConstraints","value":[{"maxSkew":1,"topologyKey":"topology.kubernetes.io/zone","whenUnsatisfiable":"DoNotSchedule","labelSelector":{"matchLabels":{"app":"${APP}"}}}]}]`)}`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/topologySpreadConstraints"}]'`,
      wait: waitReady(NS, APP),
      explain:
        'The Pod template sets a topology spread constraint on `topology.kubernetes.io/zone` with `whenUnsatisfiable: DoNotSchedule`, but no node carries that label, so Pods stay Pending. The spec allows any node: remove `topologySpreadConstraints` (or switch `topologyKey` to a label that exists, such as `kubernetes.io/hostname`).',
    },
  ],
};

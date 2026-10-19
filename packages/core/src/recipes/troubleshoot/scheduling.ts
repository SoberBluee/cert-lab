import { createNs, nameField, nsField, sq } from '../types';
import type { FaultCategory } from './types';
import { waitUnhealthy } from './wait';

const IMAGE = 'nginx:1.27-alpine';

/** The ReplicaSet controller backs off after rejected creates; a restart retries at once. */
const retry = (ns: string, app: string) => `kubectl -n "${ns}" rollout restart "deployment/${app}"`;

const waitReady = (ns: string, app: string) => `kubectl -n "${ns}" rollout status "deployment/${app}" --timeout=240s`;

const applyObject = (ns: string, json: string) => `kubectl -n "${ns}" apply -f - <<< '${json}'`;

export const schedulingCategory: FaultCategory = {
  id: 'scheduling',
  name: 'Scheduling',
  description: 'A Deployment does not get its Pods: they are rejected at admission or stay Pending.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 8,
  points: 5,
  tags: ['troubleshooting', 'scheduling', 'resourcequota', 'limitrange', 'affinity'],
  settleSeconds: 20,
  fields: [nsField(['batch', 'reports', 'analytics']), nameField('APP', 'Deployment name', ['worker', 'renderer', 'indexer'])],
  shell: ({ NS, APP }, state) => ({
    title: `Deployment ${APP} not running`,
    text: `Deployment \`${APP}\` in namespace \`${NS}\` should run \`2\` ready replicas, but it does not. Fix it so that it matches this spec and both Pods run:

- \`2\` replicas of image \`${IMAGE}\`, container \`web\`
- requests \`100m\` CPU and \`64Mi\` memory, and no limits
- no restriction on which node it runs, and the default priority

Objects in namespace \`${NS}\` that stand in the way may be changed or removed. Do not delete or recreate the Deployment.`,
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
      `kubectl -n ${NS} get deployment,replicaset,pods -o wide: are there fewer Pods than replicas, or Pods stuck in Pending?`,
      `Missing Pods: kubectl -n ${NS} describe replicaset -l app=${APP} shows why creating them failed (FailedCreate events).`,
      `Pending Pods: kubectl -n ${NS} describe pod <pod> shows the scheduler's reason under Events.`,
      `kubectl -n ${NS} get resourcequota,limitrange: what does the namespace enforce?`,
    ],
  }),
  faults: ({ NS, APP }) => [
    {
      id: 'quota-pods',
      label: 'ResourceQuota allows a single Pod',
      break: applyObject(NS, '{"apiVersion":"v1","kind":"ResourceQuota","metadata":{"name":"pod-quota"},"spec":{"hard":{"pods":"1"}}}'),
      fix: `kubectl -n "${NS}" delete resourcequota pod-quota
${retry(NS, APP)}`,
      wait: waitReady(NS, APP),
      explain: `ResourceQuota \`pod-quota\` caps the namespace at \`1\` Pod, so the ReplicaSet's second create is rejected with "exceeded quota" (\`kubectl -n ${NS} describe rs\`). Delete the quota or raise \`pods\` to at least \`2\`.`,
    },
    {
      id: 'quota-limits',
      label: 'ResourceQuota requires CPU limits',
      break: applyObject(
        NS,
        '{"apiVersion":"v1","kind":"ResourceQuota","metadata":{"name":"compute-quota"},"spec":{"hard":{"requests.cpu":"2","limits.cpu":"4"}}}',
      ),
      fix: `kubectl -n "${NS}" delete resourcequota compute-quota
${retry(NS, APP)}`,
      wait: waitReady(NS, APP),
      explain:
        'ResourceQuota `compute-quota` tracks `limits.cpu`, so every Pod in the namespace must set a CPU limit. The Pods have none and are rejected with "must specify limits.cpu". The spec rules out adding limits to the Deployment: delete the quota, or add a LimitRange that gives containers a default CPU limit.',
    },
    {
      id: 'limitrange-max',
      label: 'LimitRange maximum below the request',
      break: applyObject(
        NS,
        '{"apiVersion":"v1","kind":"LimitRange","metadata":{"name":"container-limits"},"spec":{"limits":[{"type":"Container","max":{"cpu":"50m"}}]}}',
      ),
      fix: `kubectl -n "${NS}" delete limitrange container-limits
${retry(NS, APP)}`,
      wait: waitReady(NS, APP),
      explain:
        'LimitRange `container-limits` caps containers at `50m` CPU. Its max also becomes the default limit, which is below the `100m` request, so every Pod is rejected at admission. Delete the LimitRange or raise its max to at least `100m`.',
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

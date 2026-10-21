import { createNs, nsField } from '../types';
import { WORKERS } from './compose';
import { KUBELET_CONFIG, waitReady } from './nodes';
import type { FaultCategory } from './types';

const IMAGE = 'nginx:1.27-alpine';
const LABEL = 'tier=app';

/**
 * Scales spread up once the worker refuses Pods, and proves one replica stays Pending. Part of each
 * fault's settle rather than the shell's after, which runs before a kubelet change lands.
 */
const scaleUp = (ns: string) => `kubectl -n "${ns}" scale deployment/spread --replicas=2
sleep 15
[[ "$(kubectl -n "${ns}" get deployment spread -o jsonpath='{.status.readyReplicas}')" != 2 ]] || { echo "spread still runs 2 replicas" >&2; exit 1; }`;

const rollout = (ns: string) => `kubectl -n "${ns}" rollout status deployment/spread --timeout=240s`;

/**
 * A symptom-only question: every node is Ready, yet one worker takes no new Pods. The scheduler's
 * message on the Pending Pod says why.
 */
export const unschedulableCategory: FaultCategory = {
  id: 'unschedulable',
  name: 'Unschedulable node',
  description: 'Every node is Ready, but one worker no longer takes new Pods. Only the symptom is given; the scheduler says why.',
  domain: 'troubleshooting',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['troubleshooting', 'scheduling', 'node', 'taints', 'kubelet'],
  disruptive: true,
  settleSeconds: 60,
  hidden: { NODE: WORKERS },
  fields: [nsField(['spread', 'ha', 'replicas', 'zones', 'fleet-apps', 'placement', 'balance', 'workers-ns', 'rack', 'edge'])],
  shell: ({ NS }, state) => ({
    title: 'One worker takes no Pods',
    text: `Deployment \`spread\` in namespace \`${NS}\` must run one replica on each worker, but a replica stays \`Pending\` although every node is \`Ready\`. Fix the cluster so that both replicas run, one per worker, in a way that survives a reboot of the node.

Do not change the Deployment.`,
    spec: `- both workers are labelled \`${LABEL}\`, schedulable and untainted
- the kubelet on each worker keeps the default \`maxPods\` (110)
- \`spread\` requires \`${LABEL}\` and at most one replica per node (required anti-affinity on \`kubernetes.io/hostname\`)`,
    before: `${createNs(NS)}
for n in ${WORKERS.map((w) => `"${w}"`).join(' ')}; do kubectl label node "$n" ${LABEL} --overwrite >/dev/null; done
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spread
  namespace: ${NS}
spec:
  replicas: 0
  selector:
    matchLabels: { app: spread }
  template:
    metadata:
      labels: { app: spread }
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions: [{ key: tier, operator: In, values: [app] }]
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - topologyKey: kubernetes.io/hostname
              labelSelector:
                matchLabels: { app: spread }
      containers:
        - name: web
          image: ${IMAGE}
          resources:
            requests: { cpu: 10m, memory: 16Mi }
EOF
kubectl -n "${NS}" get deployment spread -o jsonpath='{.metadata.uid} {.spec.template.spec}' > "${state}.deploy"
chmod 644 "${state}.deploy"`,
    checks: [
      {
        id: 'spread',
        description: 'spread runs 2 ready replicas on two different workers',
        type: 'kubectl',
        run: `echo "$(kubectl -n ${NS} get deployment spread -o jsonpath='{.status.readyReplicas}') $(kubectl -n ${NS} get pods -l app=spread --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.spec.nodeName}{"\\n"}{end}' | sort -u | grep -c worker)"`,
        expect: { equals: '2 2' },
        weight: 3,
        retrySeconds: 90,
      },
      {
        id: 'schedulable',
        description: 'no worker is cordoned or carries a NoSchedule or NoExecute taint',
        type: 'kubectl',
        run: `kubectl get nodes -l '!node-role.kubernetes.io/control-plane' -o jsonpath='{range .items[*]}{.spec.unschedulable} {range .spec.taints[*]}{.effect} {end}{"\\n"}{end}' | grep -cE 'true|NoSchedule|NoExecute' || true`,
        expect: { equals: '0' },
        weight: 1,
        retrySeconds: 30,
      },
      {
        id: 'capacity',
        description: 'every worker accepts at least 100 Pods',
        type: 'kubectl',
        run: `kubectl get nodes -l '!node-role.kubernetes.io/control-plane' -o jsonpath='{range .items[*]}{.status.allocatable.pods}{"\\n"}{end}' | sort -n | head -1`,
        expect: { gte: 100 },
        weight: 1,
        retrySeconds: 60,
      },
      {
        id: 'unchanged',
        description: 'Deployment spread was not changed or recreated',
        type: 'kubectl',
        run: `[ "$(kubectl -n ${NS} get deployment spread -o jsonpath='{.metadata.uid} {.spec.template.spec}')" = "$(cat ${state}.deploy)" ] && echo unchanged || echo changed`,
        expect: { equals: 'unchanged' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} describe pod <pending-pod>: the scheduler's message counts the nodes and gives the reason it rejected each of them.`,
      'kubectl describe node <node> for both workers: Taints, Unschedulable, Labels and Allocatable (including pods) are what the scheduler looks at. Compare the two.',
      `kubectl -n ${NS} get deployment spread -o yaml shows what the Pods require from a node.`,
      'Some of what a node offers is set by its kubelet: systemctl cat kubelet shows which configuration file it reads.',
    ],
  }),
  faults: ({ NS, NODE }) => [
    {
      id: 'cordoned',
      label: 'Worker cordoned',
      break: `kubectl cordon "${NODE}"`,
      fix: `kubectl uncordon "${NODE}"`,
      settle: scaleUp(NS),
      wait: rollout(NS),
      explain: 'The worker is `Ready` but cordoned (`SchedulingDisabled`), so the scheduler places nothing new on it. `kubectl uncordon` it.',
    },
    {
      id: 'taint-noschedule',
      label: 'NoSchedule taint on the worker',
      break: `kubectl taint node "${NODE}" dedicated=gpu:NoSchedule --overwrite`,
      fix: `kubectl taint node "${NODE}" dedicated-`,
      settle: scaleUp(NS),
      wait: rollout(NS),
      explain:
        'The worker carries `dedicated=gpu:NoSchedule`, and `spread` does not tolerate it (and may not be changed), so the scheduler reports `untolerated taint`. Remove the taint: `kubectl taint node <node> dedicated-`.',
    },
    {
      id: 'taint-noexecute',
      label: 'NoExecute taint on the worker',
      break: `kubectl taint node "${NODE}" maintenance=true:NoExecute --overwrite`,
      fix: `kubectl taint node "${NODE}" maintenance-`,
      settle: scaleUp(NS),
      wait: rollout(NS),
      explain:
        'The worker carries `maintenance=true:NoExecute`: nothing without a toleration may be scheduled there, and Pods already running were evicted. `kubectl describe node` lists it under Taints. Remove it: `kubectl taint node <node> maintenance-`.',
    },
    {
      id: 'label-removed',
      label: 'Worker lost the label the Pods require',
      break: `kubectl label node "${NODE}" tier-`,
      fix: `kubectl label node "${NODE}" ${LABEL} --overwrite`,
      settle: scaleUp(NS),
      wait: rollout(NS),
      explain: `\`spread\` requires nodes labelled \`${LABEL}\`, and the worker no longer carries that label, so the scheduler reports \`didn't match Pod's node affinity/selector\`. \`kubectl get nodes -L tier\` shows the gap. Label the worker again.`,
    },
    {
      id: 'max-pods',
      label: 'kubelet allows only two Pods',
      nodeBreak: `sed -i '/^maxPods:/d' ${KUBELET_CONFIG}
echo 'maxPods: 2' >> ${KUBELET_CONFIG}
grep -qx 'maxPods: 2' ${KUBELET_CONFIG}
systemctl restart kubelet`,
      settle: `for _ in $(seq 1 90); do
  [[ "$(kubectl get node "${NODE}" -o jsonpath='{.status.allocatable.pods}')" == 2 ]] && break
  sleep 2
done
[[ "$(kubectl get node "${NODE}" -o jsonpath='{.status.allocatable.pods}')" == 2 ]] || { echo "the kubelet did not take maxPods 2" >&2; exit 1; }
${waitReady(NODE)}
${scaleUp(NS)}`,
      nodeFix: `sed -i '/^maxPods:/d' ${KUBELET_CONFIG}
systemctl restart kubelet`,
      wait: `${waitReady(NODE)}
${rollout(NS)}`,
      explain: `\`maxPods: 2\` in \`${KUBELET_CONFIG}\` lets the worker run only two Pods, and its DaemonSet Pods already fill them. The node is \`Ready\`, but \`kubectl describe node\` shows \`pods: 2\` under Allocatable and the scheduler reports \`Too many pods\`. Remove the line (the default is 110) and restart the kubelet.`,
    },
  ],
};

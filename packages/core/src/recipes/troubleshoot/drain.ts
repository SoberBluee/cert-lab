import { createNs, nameField, nsField } from '../types';
import { WORKERS } from './compose';
import type { FaultCategory } from './types';

const IMAGE = 'nginx:1.27-alpine';

export const drainCategory: FaultCategory = {
  id: 'drain',
  name: 'Node drain',
  description: 'A PodDisruptionBudget blocks draining a worker that must be emptied.',
  domain: 'troubleshooting',
  difficulty: 3,
  minutes: 12,
  points: 8,
  tags: ['troubleshooting', 'drain', 'pdb', 'disruption'],
  disruptive: true,
  settleSeconds: 60,
  hidden: { NODE: WORKERS },
  fields: [
    nsField(['maintain', 'fleet', 'ops', 'upgrade', 'rolling', 'cluster-ops', 'node-ops', 'infra', 'platform', 'sre']),
    nameField('APP', 'Deployment name', ['checkout', 'cart', 'orders', 'payments', 'inventory', 'shipping', 'notify', 'search', 'catalog', 'loyalty']),
  ],
  shell: ({ NS, APP, NODE }) => ({
    title: 'Node drain is stuck',
    text: `Maintenance requires the worker that runs the Pods of Deployment \`${APP}\` (namespace \`${NS}\`) to be drained: cordoned, with no \`${APP}\` Pods left on it. \`${APP}\` must keep \`2\` ready replicas on the remaining nodes.

Do not delete Deployment \`${APP}\`.`,
    spec: `- PodDisruptionBudget \`${APP}-pdb\` leaves room for an eviction (\`minAvailable\` below the replica count)
- the Pod template of \`${APP}\` lets replicas run on another worker (no \`drain-lab=yes\` nodeSelector)`,
    before: `${createNs(NS)}
kubectl label node "${NODE}" drain-lab=yes --overwrite
for n in ${WORKERS.map((w) => `"${w}"`).join(' ')}; do
  [[ "$n" == "${NODE}" ]] || kubectl label node "$n" drain-lab- --overwrite >/dev/null 2>&1 || true
done
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  replicas: 2
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      nodeSelector: { drain-lab: "yes" }
      containers:
        - name: web
          image: ${IMAGE}
          ports: [{ containerPort: 80 }]
          readinessProbe:
            httpGet: { path: /, port: 80 }
            periodSeconds: 5
          resources:
            requests: { cpu: 50m, memory: 32Mi }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ${APP}-pdb
  namespace: ${NS}
spec:
  minAvailable: 2
  selector:
    matchLabels: { app: ${APP} }
EOF
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s`,
    after: `kubectl uncordon "${NODE}" >/dev/null 2>&1 || true
# Prove a naive drain is blocked by the PDB while pods are pinned here.
if kubectl drain "${NODE}" --ignore-daemonsets --delete-emptydir-data --timeout=20s >/dev/null 2>&1; then
  echo "drain succeeded unexpectedly" >&2
  kubectl uncordon "${NODE}" >/dev/null 2>&1 || true
  exit 1
fi
kubectl uncordon "${NODE}" >/dev/null 2>&1 || true
kubectl -n "${NS}" get pdb "${APP}-pdb" >/dev/null`,
    checks: [
      {
        id: 'cordoned',
        description: 'exactly one worker is cordoned',
        type: 'kubectl',
        run: `kubectl get nodes -l '!node-role.kubernetes.io/control-plane' -o jsonpath='{range .items[*]}{.spec.unschedulable}{"\\n"}{end}' | grep -c '^true$' || true`,
        expect: { equals: '1' },
        weight: 2,
      },
      {
        id: 'empty',
        description: `no ${APP} Pods remain on a cordoned worker`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pods -l app=${APP} -o jsonpath='{range .items[*]}{.spec.nodeName}{"\\n"}{end}' | sort -u | xargs -I{} kubectl get node {} -o jsonpath='{.spec.unschedulable}{"\\n"}' | grep -c '^true$' || true`,
        expect: { equals: '0' },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'ready',
        description: `${APP} still has 2 ready replicas`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.status.readyReplicas}'`,
        expect: { equals: '2' },
        weight: 2,
        retrySeconds: 120,
      },
      {
        id: 'right-node',
        description: `the cordoned worker is the one that ran ${APP}`,
        type: 'kubectl',
        run: `kubectl get nodes -l drain-lab=yes -o jsonpath='{range .items[*]}{.spec.unschedulable}{end}'`,
        expect: { equals: 'true' },
        weight: 2,
      },
    ],
    hints: [
      `kubectl -n ${NS} get pods -o wide shows where ${APP} runs. kubectl drain <node> --ignore-daemonsets --delete-emptydir-data says what blocks it.`,
      `Evictions respect PodDisruptionBudgets: compare kubectl -n ${NS} get pdb with the replica count.`,
      'An evicted Pod is recreated by its Deployment: check where the Pod template lets the new one go.',
    ],
  }),
  faults: ({ NS, APP, NODE }) => [
    {
      id: 'pdb-blocks-drain',
      label: 'PDB minAvailable equals replica count',
      // Objects are created healthy-but-undrainable in before; break is a no-op marker.
      break: `kubectl -n "${NS}" get pdb "${APP}-pdb" >/dev/null
kubectl get node "${NODE}" -o jsonpath='{.metadata.labels.drain-lab}' | grep -q yes`,
      fix: `kubectl -n "${NS}" patch pdb "${APP}-pdb" --type=merge -p '{"spec":{"minAvailable":0}}'
kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s
kubectl drain "${NODE}" --ignore-daemonsets --delete-emptydir-data --force --timeout=180s`,
      wait: `for _ in $(seq 1 60); do
  unsched=$(kubectl get node "${NODE}" -o jsonpath='{.spec.unschedulable}')
  left=$(kubectl -n "${NS}" get pods -l "app=${APP}" --field-selector "spec.nodeName=${NODE}" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  ready=$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.status.readyReplicas}')
  [[ "$unsched" == true && "$left" == 0 && "$ready" == 2 ]] && break
  sleep 3
done`,
      explain: `PodDisruptionBudget \`${APP}-pdb\` sets \`minAvailable: 2\` while the Deployment also has 2 replicas, so every eviction is denied and \`kubectl drain\` hangs. The Pods are also pinned to the maintenance worker with \`nodeSelector: drain-lab=yes\`. Lower \`minAvailable\` (or delete the PDB), remove the nodeSelector so replicas can schedule elsewhere, then drain that worker.`,
    },
  ],
};

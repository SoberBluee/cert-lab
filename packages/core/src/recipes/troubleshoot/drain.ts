import { createNs, nameField, nsField } from '../types';
import { WORKERS } from './compose';
import type { FaultCategory } from './types';

const IMAGE = 'nginx:1.27-alpine';
const LABEL = 'maintenance=due';

const patch = (ns: string, app: string, json: string, type = 'strategic') => `kubectl -n "${ns}" patch deployment "${app}" --type=${type} -p '${json}'`;

/** Pods of the namespace on the node, by name. */
const podsOn = (ns: string, node: string) => `kubectl -n "${ns}" get pods --field-selector "spec.nodeName=${node}" -o name 2>/dev/null`;

const readyOf = (ns: string, app: string) => `kubectl -n "${ns}" get deployment "${app}" -o jsonpath='{.status.readyReplicas}'`;

/**
 * Every fault's last step: the drain itself, once every blocker is fixed, then a wait until the
 * worker is empty and the app is whole again elsewhere.
 */
const drainAndWait = (ns: string, app: string, node: string) => `kubectl drain "${node}" --ignore-daemonsets --delete-emptydir-data --force --timeout=180s
for _ in $(seq 1 60); do
  [[ "$(kubectl get node "${node}" -o jsonpath='{.spec.unschedulable}')" == true && -z "$(${podsOn(ns, node)})" && "$(${readyOf(ns, app)})" == 2 ]] && break
  sleep 3
done`;

export const drainCategory: FaultCategory = {
  id: 'drain',
  name: 'Node drain',
  description: 'A worker must be drained for maintenance, and the drain fails or leaves the app short of replicas.',
  domain: 'troubleshooting',
  difficulty: 2,
  minutes: 10,
  points: 8,
  tags: ['troubleshooting', 'drain', 'pdb', 'disruption'],
  disruptive: true,
  // A worker is drained and cordoned: other questions must start their Pods first.
  blocksScheduling: 'node',
  settleSeconds: 60,
  hidden: { NODE: WORKERS },
  fields: [
    nsField(['maintain', 'fleet', 'ops', 'upgrade', 'rolling', 'cluster-ops', 'node-ops', 'infra', 'platform', 'sre']),
    nameField('APP', 'Deployment name', ['checkout', 'cart', 'orders', 'payments', 'inventory', 'shipping', 'notify', 'search', 'catalog', 'loyalty']),
  ],
  shell: ({ NS, APP, NODE }) => ({
    title: 'Node drain is stuck',
    text: `The worker labelled \`${LABEL}\` must be drained for maintenance: cordoned, with none of the Pods of namespace \`${NS}\` left on it. Deployment \`${APP}\` in \`${NS}\` must keep \`2\` ready replicas on the remaining nodes.

Do not delete Deployment \`${APP}\` or its PodDisruptionBudget, and do not uncordon the worker once it is drained.`,
    spec: `- PodDisruptionBudget \`${APP}-pdb\` lets one of the \`2\` replicas be evicted at a time (\`minAvailable: 1\`)
- the Pod template of \`${APP}\` prefers the maintenance worker but does not require it, and allows two replicas on one node
- \`kubectl drain\` always needs \`--ignore-daemonsets\` (calico-node and kube-proxy run everywhere), \`--delete-emptydir-data\` for Pods with an \`emptyDir\` volume, and \`--force\` for Pods that no controller manages`,
    before: `${createNs(NS)}
kubectl label node "${NODE}" ${LABEL} --overwrite
for n in ${WORKERS.map((w) => `"${w}"`).join(' ')}; do
  [[ "$n" == "${NODE}" ]] || kubectl label node "$n" maintenance- >/dev/null 2>&1 || true
done
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  replicas: 0
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      affinity:
        nodeAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              preference:
                matchExpressions: [{ key: maintenance, operator: In, values: [due] }]
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
  minAvailable: 1
  selector:
    matchLabels: { app: ${APP} }
EOF`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=2
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s
[[ -n "$(${podsOn(NS, NODE)})" ]] || { echo "nothing of ${NS} runs on the maintenance worker" >&2; exit 1; }
# The question only makes sense if the plain drain cannot finish the job: try it, then put everything back.
kubectl drain "${NODE}" --ignore-daemonsets --timeout=20s >/dev/null 2>&1 || true
drained=no
[[ -z "$(${podsOn(NS, NODE)})" && "$(${readyOf(NS, APP)})" == 2 ]] && drained=yes
kubectl uncordon "${NODE}" >/dev/null
[[ "$drained" == no ]] || { echo "the worker drains cleanly" >&2; exit 1; }
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=180s >/dev/null`,
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
        id: 'right-node',
        description: `the cordoned worker is the one labelled ${LABEL}`,
        type: 'kubectl',
        run: `kubectl get nodes -l ${LABEL} -o jsonpath='{range .items[*]}{.spec.unschedulable}{end}'`,
        expect: { equals: 'true' },
        weight: 2,
      },
      {
        id: 'empty',
        description: `no Pod of ${NS} remains on a cordoned worker`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pods -o jsonpath='{range .items[*]}{.spec.nodeName}{"\\n"}{end}' | sort -u | xargs -I{} kubectl get node {} -o jsonpath='{.spec.unschedulable}{"\\n"}' | grep -c '^true$' || true`,
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
    ],
    hints: [
      `kubectl get nodes -l ${LABEL} names the worker; kubectl -n ${NS} get pods -o wide shows what runs on it.`,
      'kubectl drain <node> --ignore-daemonsets reports every Pod it will not evict, and why: read each line. Some blockers only need a flag; others need a change.',
      `Evictions respect PodDisruptionBudgets: kubectl -n ${NS} get pdb shows ALLOWED DISRUPTIONS.`,
      `An evicted Pod is recreated by its controller: if a replacement stays Pending, kubectl -n ${NS} describe pod says what keeps it off the other nodes.`,
    ],
  }),
  layers: [
    { name: 'the PodDisruptionBudget', faults: ['pdb-min-available', 'pdb-max-unavailable-0'] },
    { name: 'where replicas may run', faults: ['pinned-node-selector', 'replica-anti-affinity'] },
    { name: 'Pods drain will not remove by default', faults: ['bare-pod', 'emptydir-pod'] },
  ],
  faults: ({ NS, APP, NODE }) => [
    {
      id: 'pdb-min-available',
      label: 'PDB minAvailable equals the replica count',
      break: `kubectl -n "${NS}" patch pdb "${APP}-pdb" --type=merge -p '{"spec":{"minAvailable":2}}'`,
      fix: `kubectl -n "${NS}" patch pdb "${APP}-pdb" --type=merge -p '{"spec":{"minAvailable":1}}'`,
      wait: drainAndWait(NS, APP, NODE),
      explain: `PodDisruptionBudget \`${APP}-pdb\` sets \`minAvailable: 2\` while \`${APP}\` has 2 replicas, so it allows no disruption at all: \`kubectl drain\` retries "Cannot evict pod as it would violate the pod's disruption budget" until it gives up (\`kubectl -n ${NS} get pdb\` shows ALLOWED DISRUPTIONS 0). Lower \`minAvailable\` to \`1\`, then drain: \`kubectl drain <node> --ignore-daemonsets --delete-emptydir-data --force\`.`,
    },
    {
      id: 'pdb-max-unavailable-0',
      label: 'PDB maxUnavailable is zero',
      break: `kubectl -n "${NS}" patch pdb "${APP}-pdb" --type=merge -p '{"spec":{"minAvailable":null,"maxUnavailable":0}}'`,
      fix: `kubectl -n "${NS}" patch pdb "${APP}-pdb" --type=merge -p '{"spec":{"maxUnavailable":1}}'`,
      wait: drainAndWait(NS, APP, NODE),
      explain: `PodDisruptionBudget \`${APP}-pdb\` sets \`maxUnavailable: 0\`: no Pod of \`${APP}\` may ever be evicted, so the drain retries until it gives up (ALLOWED DISRUPTIONS 0). Allow one: \`maxUnavailable: 1\` (or \`minAvailable: 1\`), then drain the worker.`,
    },
    {
      id: 'pinned-node-selector',
      label: 'Replicas are pinned to the maintenance worker',
      break: patch(NS, APP, '{"spec":{"template":{"spec":{"nodeSelector":{"maintenance":"due"}}}}}'),
      fix: patch(NS, APP, '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]', 'json'),
      wait: drainAndWait(NS, APP, NODE),
      explain: `The Pod template of \`${APP}\` has \`nodeSelector: maintenance=due\`, so both replicas run on the maintenance worker and every replacement can only go back there. Once the worker is cordoned, the first evicted Pod's replacement stays \`Pending\` ("didn't match Pod's node affinity/selector"), the budget then forbids evicting the second, and the drain hangs. Remove the nodeSelector (the preferred node affinity already favours that worker when it is available), then drain.`,
    },
    {
      id: 'replica-anti-affinity',
      label: 'Required anti-affinity keeps one replica per node',
      break: patch(
        NS,
        APP,
        `{"spec":{"template":{"spec":{"affinity":{"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app":"${APP}"}},"topologyKey":"kubernetes.io/hostname"}]}}}}}}`.replace(
          /\$\{Q\d+_\w+\}/g,
          (ref) => `'"${ref}"'`,
        ),
      ),
      fix: patch(NS, APP, '[{"op":"remove","path":"/spec/template/spec/affinity/podAntiAffinity"}]', 'json'),
      wait: drainAndWait(NS, APP, NODE),
      explain: `The Pod template of \`${APP}\` requires that no two replicas share a node (\`podAntiAffinity\` on \`app=${APP}\`, \`topologyKey: kubernetes.io/hostname\`). With one worker cordoned and the control plane tainted, only one node is left, so the drain itself succeeds but the evicted replica's replacement stays \`Pending\` ("didn't match pod anti-affinity rules") and \`${APP}\` is left with 1 ready replica. The spec allows two replicas on one node: remove the anti-affinity (or make it preferred), and the replacement starts on the other worker.`,
    },
    {
      id: 'bare-pod',
      label: 'A Pod without a controller runs on the worker',
      break: `kubectl -n "${NS}" run "${APP}-debug" --image=busybox:1.36 --restart=Never --overrides='{"spec":{"nodeName":"'"${NODE}"'"}}' --command -- sleep infinity >/dev/null
kubectl -n "${NS}" wait --for=condition=Ready "pod/${APP}-debug" --timeout=120s >/dev/null`,
      wait: drainAndWait(NS, APP, NODE),
      explain: `Pod \`${APP}-debug\` was started by hand with \`kubectl run\`: no ReplicaSet, Job or other controller owns it. \`kubectl drain\` refuses to remove such Pods, because nothing would recreate them ("cannot delete Pods that declare no controller (use --force to override)"). Nothing needs fixing in the cluster: drain with \`--force\`, which deletes it (or delete it yourself first).`,
    },
    {
      id: 'emptydir-pod',
      label: 'The replicas keep scratch data in an emptyDir volume',
      break: patch(
        NS,
        APP,
        '{"spec":{"template":{"spec":{"volumes":[{"name":"scratch","emptyDir":{}}],"containers":[{"name":"web","volumeMounts":[{"name":"scratch","mountPath":"/var/cache/scratch"}]}]}}}}',
      ),
      wait: drainAndWait(NS, APP, NODE),
      explain: `The \`${APP}\` Pods mount an \`emptyDir\` volume, whose data is lost when a Pod leaves its node. \`kubectl drain\` will not evict them unless told that is acceptable ("cannot delete Pods with local storage (use --delete-emptydir-data to override)"). Scratch data may go: drain with \`--delete-emptydir-data\`.`,
    },
  ],
};

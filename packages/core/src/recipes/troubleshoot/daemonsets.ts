import { createNs, nameField, nsField, sq } from '../types';
import { WORKERS } from './compose';
import type { FaultCategory } from './types';
import { waitUnhealthy } from './wait';

const IMAGE = 'nginx:1.27-alpine';
const CP_TAINT = 'node-role.kubernetes.io/control-plane';
/** A nodeSelector that keeps the DaemonSet from starting Pods until every break is in place; `after` removes it. */
const HOLD = 'cka.lab/hold';
/** The other DaemonSet of the namespace, which the host port fault adds. */
const EXPORTER = 'legacy-exporter';
const TAINT = 'maintenance=planned:NoSchedule';

const patch = (ns: string, ds: string, json: string, type = 'strategic') => `kubectl -n "${ns}" patch daemonset "${ds}" --type=${type} -p ${sq(json)}`;

const rollout = (ns: string, ds: string) => `kubectl -n "${ns}" rollout status "daemonset/${ds}" --timeout=240s`;

/** Waits until the DaemonSet targets fewer nodes than the cluster has. Gives up quietly. */
const waitFewer = (ns: string, ds: string) => `nodes=$(kubectl get nodes --no-headers | wc -l)
for _ in $(seq 1 20); do
  want=$(kubectl -n "${ns}" get daemonset "${ds}" -o jsonpath='{.status.desiredNumberScheduled}')
  [[ -n "$want" && "$want" -lt "$nodes" ]] && break
  sleep 2
done`;

/**
 * A DaemonSet that should run on every node, the control plane included. Faults sit in its container,
 * in where its Pods may run, or in how it rolls out.
 */
export const daemonSetsCategory: FaultCategory = {
  id: 'daemonsets',
  name: 'DaemonSets',
  description: 'A DaemonSet that should run a ready, up-to-date Pod on every node, the control plane included, does not.',
  domain: 'troubleshooting',
  difficulty: 2,
  minutes: 8,
  points: 8,
  tags: ['troubleshooting', 'daemonset', 'tolerations', 'taints', 'rollout'],
  hidden: { WORKER: WORKERS },
  fields: [
    nsField(['agents', 'observability', 'telemetry', 'monitoring', 'logging', 'security', 'edge-agents', 'platform-ops', 'node-svc', 'collectors']),
    nameField('DS', 'DaemonSet name', ['log-shipper', 'node-monitor', 'net-agent', 'disk-watch', 'metrics-relay', 'trace-collector', 'audit-forwarder', 'sec-scanner', 'cache-warmer', 'dns-probe']),
  ],
  shell: ({ NS, DS }, state) => ({
    title: `DaemonSet ${DS} is not running everywhere`,
    text: `DaemonSet \`${DS}\` in namespace \`${NS}\` should run a ready Pod on every node of the cluster, the control plane included. Every one of those Pods must run the DaemonSet's current Pod template, and later changes to the template must roll out without anyone deleting Pods. Fix it.

Keep the image \`${IMAGE}\`, the readiness probe and the resource requests. Do not delete or recreate the DaemonSet, do not remove the control plane's taint, and leave every other workload in the namespace running.`,
    spec: `- container \`agent\`: image \`${IMAGE}\` on port \`80\`, a readiness probe doing an HTTP GET of \`/\` on port \`80\`, requests \`10m\` CPU and \`16Mi\` memory
- a toleration for the control plane's \`${CP_TAINT}:NoSchedule\` taint, and no nodeSelector, affinity or host port
- update strategy \`RollingUpdate\` with \`maxUnavailable: 1\`
- no worker tainted, and any other DaemonSet of the namespace left as it is`,
    before: `${createNs(NS)}
kubectl -n "${NS}" delete daemonset "${DS}" "${EXPORTER}" --ignore-not-found --wait=true >/dev/null
kubectl -n "${NS}" wait --for=delete pod -l "app in (${DS},${EXPORTER})" --timeout=90s >/dev/null 2>&1 || true
# Other DaemonSets a fault adds, one per line: they must still run at the end.
: > "${state}.others"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ${DS}
  namespace: ${NS}
  labels: { app: ${DS} }
spec:
  selector:
    matchLabels: { app: ${DS} }
  updateStrategy:
    type: RollingUpdate
    rollingUpdate: { maxUnavailable: 1 }
  template:
    metadata:
      labels: { app: ${DS} }
    spec:
      nodeSelector: { ${HOLD}: "yes" }
      tolerations:
        - { key: ${CP_TAINT}, operator: Exists, effect: NoSchedule }
      containers:
        - name: agent
          image: ${IMAGE}
          ports: [{ containerPort: 80 }]
          readinessProbe:
            httpGet: { path: /, port: 80 }
            periodSeconds: 5
          resources:
            requests: { cpu: 10m, memory: 16Mi }
EOF
kubectl -n "${NS}" get daemonset "${DS}" -o jsonpath='{.metadata.uid}' > "${state}.uid"
chmod 644 "${state}.uid" "${state}.others"`,
    after: patch(NS, DS, `[{"op":"remove","path":"/spec/template/spec/nodeSelector/${HOLD.replace('/', '~1')}"}]`, 'json'),
    checks: [
      {
        id: 'everywhere',
        description: `${DS} has a ready Pod on every node, controlplane included`,
        type: 'kubectl',
        run: `n=$(kubectl get nodes --no-headers | wc -l | tr -d ' '); s=$(kubectl -n ${NS} get daemonset ${DS} -o jsonpath='{.status.desiredNumberScheduled}/{.status.numberReady}'); [ "$s" = "$n/$n" ] && echo everywhere || echo "$s of $n nodes"`,
        expect: { equals: 'everywhere' },
        weight: 3,
        retrySeconds: 90,
      },
      {
        id: 'current',
        description: `every Pod of ${DS} runs its current template, and template changes roll out on their own`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get daemonset ${DS} -o jsonpath='{.spec.updateStrategy.type} {.status.updatedNumberScheduled}/{.status.desiredNumberScheduled}'`,
        expect: { matches: '^RollingUpdate ([1-9][0-9]*)/\\1$' },
        weight: 1,
        retrySeconds: 60,
      },
      {
        id: 'spec',
        description: `${DS} keeps image ${IMAGE}, its resource requests and a readiness probe`,
        type: 'kubectl',
        run: `c='{.spec.template.spec.containers[0]'; echo "$(kubectl -n ${NS} get daemonset ${DS} -o jsonpath="$c.image} $c.resources.requests.cpu} $c.resources.requests.memory}") $([ -n "$(kubectl -n ${NS} get daemonset ${DS} -o jsonpath="$c.readinessProbe}")" ] && echo readiness)"`,
        expect: { equals: `${IMAGE} 10m 16Mi readiness` },
        weight: 1,
      },
      {
        id: 'control-plane-taint',
        description: 'controlplane keeps its NoSchedule taint',
        type: 'kubectl',
        run: `kubectl get node controlplane -o jsonpath='{.spec.taints[?(@.key=="${CP_TAINT}")].effect}'`,
        expect: { equals: 'NoSchedule' },
        weight: 1,
      },
      {
        id: 'others',
        description: `every other DaemonSet of ${NS} still runs all its Pods`,
        type: 'kubectl',
        run: `ok=yes; for d in $(cat ${state}.others); do r=$(kubectl -n ${NS} get daemonset "$d" -o jsonpath='{.status.numberReady}' 2>/dev/null); w=$(kubectl -n ${NS} get daemonset "$d" -o jsonpath='{.status.desiredNumberScheduled}' 2>/dev/null); [ -n "$w" ] && [ "$r" = "$w" ] || ok=no; done; echo $ok`,
        expect: { equals: 'yes' },
        weight: 1,
        retrySeconds: 60,
      },
      {
        id: 'same-daemonset',
        description: `${DS} was not deleted or recreated`,
        type: 'kubectl',
        run: `[ "$(kubectl -n ${NS} get daemonset ${DS} -o jsonpath='{.metadata.uid}')" = "$(cat ${state}.uid)" ] && echo same || echo recreated`,
        expect: { equals: 'same' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} get daemonset ${DS}: compare DESIRED with the number of nodes, and READY and UP-TO-DATE with DESIRED.`,
      `kubectl -n ${NS} get pods -l app=${DS} -o wide shows which nodes have a Pod; kubectl -n ${NS} describe pod <pod> says why one is Pending, not ready or failing.`,
      `kubectl describe node <node> | grep Taints, then kubectl -n ${NS} get daemonset ${DS} -o yaml: tolerations, affinity, ports and the update strategy decide where Pods may run and when they are replaced.`,
      `kubectl -n ${NS} rollout status daemonset/${DS} and kubectl -n ${NS} rollout history daemonset/${DS} show whether the Pods run the current template.`,
    ],
  }),
  layers: [
    { name: 'the container', faults: ['image-typo', 'readiness-port'] },
    { name: 'where the Pods may run', faults: ['cp-toleration-typo', 'hostname-affinity', 'hostport-conflict', 'worker-taint'] },
    { name: 'the rollout', faults: ['ondelete-stale'] },
  ],
  faults: ({ NS, DS, WORKER }, state) => [
    {
      id: 'image-typo',
      label: 'Image tag does not exist (ImagePullBackOff)',
      break: `kubectl -n "${NS}" set image "daemonset/${DS}" agent=nginx:1.27-apline`,
      settle: waitUnhealthy(NS, `app=${DS}`),
      fix: `kubectl -n "${NS}" set image "daemonset/${DS}" agent=${IMAGE}`,
      wait: rollout(NS, DS),
      explain: `The image is \`nginx:1.27-apline\`, a tag that does not exist: every Pod sits in \`ErrImagePull\` / \`ImagePullBackOff\`, and \`kubectl describe pod\` names the tag it failed to pull. Set the image back to \`${IMAGE}\`.`,
    },
    {
      id: 'readiness-port',
      label: 'Readiness probe on a port nothing listens on',
      break: patch(NS, DS, '{"spec":{"template":{"spec":{"containers":[{"name":"agent","readinessProbe":{"httpGet":{"port":8080}}}]}}}}'),
      settle: waitUnhealthy(NS, `app=${DS}`),
      fix: patch(NS, DS, '{"spec":{"template":{"spec":{"containers":[{"name":"agent","readinessProbe":{"httpGet":{"port":80}}}]}}}}'),
      wait: rollout(NS, DS),
      explain:
        'The readiness probe asks port `8080`, where nothing listens: the Pods run but are never ready (`0/1`), and their Events show `Readiness probe failed: ... connection refused`. Point the probe at port `80`, where nginx listens.',
    },
    {
      id: 'cp-toleration-typo',
      label: "Toleration misses the control plane's taint",
      break: patch(NS, DS, '{"spec":{"template":{"spec":{"tolerations":[{"key":"node-role.kubernetes.io/controlplane","operator":"Exists","effect":"NoSchedule"}]}}}}'),
      settle: waitFewer(NS, DS),
      fix: patch(NS, DS, `{"spec":{"template":{"spec":{"tolerations":[{"key":"${CP_TAINT}","operator":"Exists","effect":"NoSchedule"}]}}}}`),
      wait: rollout(NS, DS),
      explain: `The toleration's key is \`node-role.kubernetes.io/controlplane\`, but the control plane's taint is \`${CP_TAINT}:NoSchedule\` (\`kubectl describe node controlplane | grep Taints\`). It tolerates nothing, so the DaemonSet targets the workers only: DESIRED is one less than the number of nodes, and no Pod runs on \`controlplane\`. Fix the key; removing the taint instead would open the control plane to every Pod.`,
    },
    {
      id: 'hostname-affinity',
      label: 'Node affinity pinned to a list of node names',
      break: `other=$(for w in ${WORKERS.map((w) => `"${w}"`).join(' ')}; do [[ "$w" == "${WORKER}" ]] || echo "$w"; done)
${patch(NS, DS, `{"spec":{"template":{"spec":{"affinity":{"nodeAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":{"nodeSelectorTerms":[{"matchExpressions":[{"key":"kubernetes.io/hostname","operator":"In","values":["controlplane","'"$other"'"]}]}]}}}}}}}`)}`,
      settle: waitFewer(NS, DS),
      fix: patch(NS, DS, '[{"op":"remove","path":"/spec/template/spec/affinity"}]', 'json'),
      wait: rollout(NS, DS),
      explain: `A required node affinity allows only the nodes whose \`kubernetes.io/hostname\` is \`controlplane\` or the other worker, as if the DaemonSet had been written for the nodes that existed back then: \`${WORKER}\` gets no Pod, and DESIRED is one less than the number of nodes. \`kubectl -n ${NS} get pods -l app=${DS} -o wide\` shows which node is missing. A DaemonSet that runs everywhere needs no affinity: remove it.`,
    },
    {
      id: 'hostport-conflict',
      label: 'Host port already taken by another DaemonSet',
      // A random port, so that two such questions in one lab do not collide.
      break: `port=$(shuf -i 9100-9899 -n 1)
kubectl apply -f - <<< ${sq(
        `{"apiVersion":"apps/v1","kind":"DaemonSet","metadata":{"name":"${EXPORTER}","namespace":"${NS}"},"spec":{"selector":{"matchLabels":{"app":"${EXPORTER}"}},"template":{"metadata":{"labels":{"app":"${EXPORTER}"}},"spec":{"containers":[{"name":"exporter","image":"registry.k8s.io/pause:3.10","ports":[{"containerPort":'"$port"',"hostPort":'"$port"'}],"resources":{"requests":{"cpu":"5m","memory":"8Mi"}}}]}}}}`,
      )} >/dev/null
kubectl -n "${NS}" rollout status "daemonset/${EXPORTER}" --timeout=120s >/dev/null 2>&1 || true
echo "${EXPORTER}" >> "${state}.others"
${patch(NS, DS, `{"spec":{"template":{"spec":{"containers":[{"name":"agent","ports":[{"containerPort":80,"hostPort":'"$port"'}]}]}}}}`)}`,
      settle: waitUnhealthy(NS, `app=${DS}`),
      fix: patch(NS, DS, '[{"op":"remove","path":"/spec/template/spec/containers/0/ports/0/hostPort"}]', 'json'),
      wait: rollout(NS, DS),
      explain: `The container port asks for a host port on every node, but DaemonSet \`${EXPORTER}\` in the same namespace already holds that port on the workers. The Pods there stay \`Pending\` with "didn't have free ports for the requested pod ports"; only \`controlplane\`, where the exporter does not run, gets one. \`kubectl -n ${NS} get daemonset,pods -o wide\` and \`kubectl -n ${NS} get daemonset ${EXPORTER} -o yaml\` show the clash. \`${DS}\` needs no host port: remove \`hostPort\` from its container port, and leave the exporter as it is.`,
    },
    {
      id: 'worker-taint',
      label: 'A worker kept its maintenance taint',
      // The worker takes no new Pods: other questions must start theirs first.
      blocksScheduling: 'node',
      break: `kubectl taint node "${WORKER}" ${TAINT} --overwrite >/dev/null`,
      settle: waitFewer(NS, DS),
      fix: `kubectl taint node "${WORKER}" ${TAINT}-`,
      wait: rollout(NS, DS),
      explain: `Worker \`${WORKER}\` still carries the taint \`${TAINT}\` from a maintenance window (\`kubectl describe node ${WORKER} | grep Taints\`). DaemonSet Pods tolerate only the taints Kubernetes itself sets, such as \`unschedulable\` and \`not-ready\`, so \`${DS}\` targets one node less and \`${WORKER}\` has no Pod. The maintenance is over: remove the taint. A toleration in the DaemonSet would also bring its Pod back, but leave the worker closed to every other Pod.`,
    },
    {
      id: 'ondelete-stale',
      label: 'Pods from an older template, never replaced under OnDelete',
      break: patch(
        NS,
        DS,
        '{"spec":{"updateStrategy":{"type":"OnDelete","rollingUpdate":null},"template":{"spec":{"containers":[{"name":"agent","command":["nginx","-c","/etc/nginx/agent.conf","-g","daemon off;"]}]}}}}',
      ),
      // Once every Pod runs the broken command, the template is put right; OnDelete leaves the Pods as they are.
      settle: `for _ in $(seq 1 45); do
  want=$(kubectl -n "${NS}" get daemonset "${DS}" -o jsonpath='{.status.desiredNumberScheduled}')
  have=$(kubectl -n "${NS}" get pods -l app="${DS}" -o jsonpath='{range .items[*]}{.spec.containers[0].command}{"\\n"}{end}' | grep -c agent.conf || true)
  [[ -n "$want" && "$want" -gt 0 && "$have" -ge "$want" ]] && break
  sleep 2
done
${patch(NS, DS, '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]', 'json')}`,
      fix: patch(NS, DS, '{"spec":{"updateStrategy":{"type":"RollingUpdate","rollingUpdate":{"maxUnavailable":1}}}}'),
      wait: rollout(NS, DS),
      explain: `The Pods crash, and \`kubectl -n ${NS} logs <pod>\` shows nginx failing to open \`/etc/nginx/agent.conf\`, yet the DaemonSet's template runs no such command. The Pods were created from an earlier template, and the update strategy is \`OnDelete\`, so the DaemonSet never replaces them: \`kubectl -n ${NS} get daemonset ${DS}\` shows UP-TO-DATE \`0\`, and \`kubectl -n ${NS} rollout history daemonset/${DS}\` lists the newer revision. Set the update strategy back to \`RollingUpdate\` with \`maxUnavailable: 1\`, and the Pods are replaced from the current template. Deleting the Pods would replace them too, but the next template change would get stuck again.`,
    },
  ],
};

import { createNs, nsField } from '../types';
import { WORKERS } from './compose';
import { KUBELET_CONFIG } from './nodes';
import { nodeReport } from './report';
import type { FaultCategory } from './types';

const CONTAINERD = '/etc/containerd/config.toml';
const WRONG_DNS = '10.96.0.53';
const WRONG_SANDBOX = 'registry.k8s.io/pause:3.10.9';
const ARCHIVE = '/var/log/journal-archive';
const HARDENING = 'node-hardening';

/** One iptables rule of a fault, kept in place by a service. */
interface Rule {
  table: string;
  chain: string;
  spec: string;
}

const KUBELET_PORT: Rule[] = [{ table: 'filter', chain: 'INPUT', spec: '-p tcp --dport 10250 -j REJECT --reject-with tcp-reset' }];

// Raw PREROUTING comes before Felix's rules, which accept the overlay from other nodes. VXLAN is Calico's encapsulation on Tart, IP-in-IP on Multipass.
const OVERLAY: Rule[] = [
  { table: 'raw', chain: 'PREROUTING', spec: '-p udp --dport 4789 -j DROP' },
  { table: 'raw', chain: 'PREROUTING', spec: '-p 4 -j DROP' },
];

/**
 * Installs a service that puts the rules back every few seconds, so deleting a rule by hand does not last:
 * the fix has to find the service too. Written with printf, because fault snippets are indented into a case.
 */
const hardeningService = (rules: Rule[]) => {
  const script = [
    '#!/bin/bash',
    'while true; do',
    ...rules.map((r) => `  iptables -t ${r.table} -C ${r.chain} ${r.spec} 2>/dev/null || iptables -t ${r.table} -I ${r.chain} 1 ${r.spec} 2>/dev/null`),
    '  sleep 3',
    'done',
  ];
  const unit = ['[Unit]', 'Description=Node hardening rules', 'After=network.target', '[Service]', `ExecStart=/usr/local/sbin/${HARDENING}`, 'Restart=always', '[Install]', 'WantedBy=multi-user.target'];
  const lines = (l: string[]) => l.map((x) => `'${x}'`).join(' ');
  return `printf '%s\\n' ${lines(script)} > /usr/local/sbin/${HARDENING}
chmod 755 /usr/local/sbin/${HARDENING}
printf '%s\\n' ${lines(unit)} > /etc/systemd/system/${HARDENING}.service
systemctl daemon-reload
systemctl enable --now ${HARDENING} >/dev/null 2>&1
sleep 1
systemctl is-active --quiet ${HARDENING} || { echo "the hardening service did not start" >&2; exit 1; }`;
};

const removeHardening = (rules: Rule[]) => `systemctl disable --now ${HARDENING}
rm -f /etc/systemd/system/${HARDENING}.service /usr/local/sbin/${HARDENING}
systemctl daemon-reload
${rules.map((r) => `iptables -t ${r.table} -D ${r.chain} ${r.spec} 2>/dev/null || true`).join('\n')}`;

const fleetReady = (ns: string) => `kubectl -n "${ns}" get daemonset fleet-check -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled}'`;

/** Replaces the worker's Pod, so that it starts under the fault. */
const replacePod = (ns: string, node: string) => `kubectl -n "${ns}" delete pod -l app=fleet-check --field-selector "spec.nodeName=${node}" --wait=false >/dev/null`;

const waitFleetDown = (ns: string) => `for _ in $(seq 1 45); do
  [[ "$(${fleetReady(ns)})" != 2/2 ]] && exit 0
  sleep 2
done
echo "fleet-check is still healthy on every worker" >&2
exit 1`;

const waitFleetUp = (ns: string) => `for _ in $(seq 1 90); do
  [[ "$(${fleetReady(ns)})" == 2/2 ]] && break
  sleep 2
done`;

/** The kubelet has just restarted: its Pod is replaced once it serves again. */
const replaceAfterRestart = (ns: string, node: string) => `sleep 8
${replacePod(ns, node)}
${waitFleetDown(ns)}`;

const diskPressure = (node: string) => `kubectl get node "${node}" -o jsonpath='{.status.conditions[?(@.type=="DiskPressure")].status}'`;

const fleetPods = (ns: string, field: string) => `kubectl -n ${ns} get pods -l app=fleet-check --field-selector=status.phase=Running -o jsonpath='{.items[*].${field}}'`;

const report = nodeReport('degraded');

/**
 * A node can pass every status field and still fail what runs on it. Unlike Nodes and Worker node
 * configuration, the fault never shows in the node's Ready condition: it has to be found from what fails.
 */
export const degradedCategory: FaultCategory = {
  id: 'degraded',
  name: 'Ready but broken',
  description: 'Every node reports Ready, but one worker fails what runs on it. Which worker, and which layer, is part of the puzzle.',
  track: 'cluster',
  domain: 'troubleshooting',
  difficulty: 3,
  minutes: 12,
  points: 10,
  tags: ['troubleshooting', 'node', 'kubelet', 'containerd', 'cni', 'iptables', 'diskpressure'],
  disruptive: true,
  // Pods on the worker may not start: other questions must start theirs first.
  blocksScheduling: 'node',
  settleSeconds: 60,
  hidden: { NODE: WORKERS },
  fields: [nsField(['ops', 'fleet-ops', 'oncall', 'sre-tools', 'edge-ops', 'night-shift', 'triage', 'runbook', 'pager', 'hosts'])],
  shell: ({ NS, NODE }, state) => ({
    title: 'Ready, but one worker misbehaves',
    text: `Every node reports \`Ready\`, yet on-call says one worker is misbehaving: workloads and \`kubectl\` commands that involve it fail, while the other worker is fine. DaemonSet \`fleet-check\` in namespace \`${NS}\` should run a ready Pod on every worker, and those Pods should reach each other on port \`8080\`.

Find the worker and fix it, in a way that survives a reboot of the node. ${report.text}

Do not change the DaemonSet, and do not cordon, drain or rebuild any node.`,
    spec: `- three Nodes, and both workers labelled \`fleet=edge\`, which is what \`fleet-check\` selects
- the API server reaches the kubelet on port \`10250\`, and nodes reach each other over Calico's overlay (VXLAN, or IP-in-IP on Multipass), with no extra firewall rule or service on the node
- \`clusterDNS\` in \`${KUBELET_CONFIG}\` is the ClusterIP of Service \`kube-dns\`
- \`sandbox\` in \`${CONTAINERD}\` names the pause image the node has, \`registry.k8s.io/pause:3.10.1\`
- \`/opt/cni/bin\` holds the \`calico\` plugin
- the root filesystem has room to spare, with no node under \`DiskPressure\``,
    before: `${createNs(NS)}
${report.setup(NODE, state)}
for n in ${WORKERS.map((w) => `"${w}"`).join(' ')}; do kubectl label node "$n" fleet=edge --overwrite >/dev/null; done
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fleet-check
  namespace: ${NS}
spec:
  selector:
    matchLabels: { app: fleet-check }
  template:
    metadata:
      labels: { app: fleet-check }
    spec:
      nodeSelector: { fleet: edge }
      terminationGracePeriodSeconds: 1
      containers:
        - name: probe
          image: busybox:1.36
          command: ["sh", "-c", "mkdir -p /www; echo fleet-ok > /www/index.html; exec httpd -f -p 8080 -h /www"]
          readinessProbe:
            exec: { command: ["nslookup", "kubernetes.default.svc.cluster.local"] }
            periodSeconds: 5
            timeoutSeconds: 4
            failureThreshold: 2
          resources:
            requests: { cpu: 10m, memory: 8Mi }
EOF
kubectl -n "${NS}" rollout status daemonset/fleet-check --timeout=240s
kubectl -n "${NS}" get daemonset fleet-check -o jsonpath='{.metadata.uid} {.spec.template.spec}' > "${state}.fleet"
chmod 644 "${state}.fleet"`,
    checks: [
      {
        id: 'all-ready',
        description: 'all 3 nodes are listed and Ready',
        type: 'kubectl',
        run: `kubectl get nodes --no-headers | awk '{print $2}' | sort | uniq -c | xargs`,
        expect: { equals: '3 Ready' },
        weight: 1,
        retrySeconds: 90,
      },
      {
        id: 'no-pressure',
        description: 'no node reports pressure or carries a pressure taint',
        type: 'kubectl',
        run: `kubectl get nodes -o jsonpath='{range .items[*]}{range .status.conditions[?(@.status=="True")]}{.type}{"\\n"}{end}{range .spec.taints[*]}{.key}{"\\n"}{end}{end}' | grep -ci pressure || true`,
        expect: { equals: '0' },
        weight: 1,
        retrySeconds: 90,
      },
      {
        id: 'fleet',
        description: 'fleet-check has a ready Pod on both workers',
        type: 'kubectl',
        run: `echo "$(kubectl -n ${NS} get daemonset fleet-check -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled}') $(${fleetPods(NS, 'spec.nodeName')} | tr ' ' '\\n' | sort -u | xargs)"`,
        expect: { equals: `${WORKERS.length}/${WORKERS.length} ${WORKERS.join(' ')}` },
        weight: 2,
        retrySeconds: 120,
      },
      {
        id: 'kubelet-api',
        description: 'the API server reaches the kubelet on every worker',
        type: 'kubectl',
        run: `for n in ${WORKERS.join(' ')}; do kubectl get --raw "/api/v1/nodes/$n/proxy/healthz" 2>/dev/null || echo "$n unreachable"; echo; done | grep . | sort -u | xargs`,
        expect: { equals: 'ok' },
        weight: 1,
        retrySeconds: 60,
      },
      {
        id: 'mesh',
        description: 'the fleet-check Pods reach each other across the workers',
        type: 'kubectl',
        run: `pods=$(${fleetPods(NS, 'metadata.name')}); ips=$(${fleetPods(NS, 'status.podIP')}); if [ "$(echo $ips | wc -w)" != ${WORKERS.length} ]; then echo "expected ${WORKERS.length} Pods"; else for p in $pods; do for ip in $ips; do kubectl -n ${NS} exec "$p" -- wget -qO- -T 3 "http://$ip:8080/" 2>/dev/null | grep -q fleet-ok && echo ok || echo "$p cannot reach $ip"; done; done | sort -u | xargs; fi`,
        expect: { equals: 'ok' },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'unchanged',
        description: 'DaemonSet fleet-check was not changed or recreated',
        type: 'kubectl',
        run: `[ "$(kubectl -n ${NS} get daemonset fleet-check -o jsonpath='{.metadata.uid} {.spec.template.spec}')" = "$(cat ${state}.fleet)" ] && echo same || echo changed`,
        expect: { equals: 'same' },
        weight: 1,
      },
      ...report.checks(state),
    ],
    hints: [
      `Start from what fails: kubectl -n ${NS} get pods -o wide, then kubectl -n ${NS} describe pod and kubectl -n ${NS} logs for a Pod on each worker. Read the whole error, with the address and the reason it gives.`,
      'kubectl describe node <node> for each worker: Conditions, Taints and Events can differ even when both say Ready. Check that kubectl get nodes lists what you expect.',
      'Test one layer at a time: can a Pod on one worker reach a Pod on the other by IP? Can it resolve a name? Does a new Pod start at all?',
      'On the worker: journalctl -u kubelet -u containerd --since "10 min ago". Compare its files, disks and running services (systemctl list-units --type=service --state=running) with the healthy worker.',
      'If something you remove comes back, a process on the node puts it back: find that too.',
    ],
  }),
  faults: ({ NS, NODE }, state) =>
    report.reported(NODE, state, [
      {
        id: 'kubelet-port-blocked',
        label: 'A firewall rule blocks the kubelet port',
        cause: 'firewall',
        nodeBreak: hardeningService(KUBELET_PORT),
        settle: `for _ in $(seq 1 30); do
  kubectl get --raw "/api/v1/nodes/${NODE}/proxy/healthz" >/dev/null 2>&1 || exit 0
  sleep 2
done
echo "the kubelet on ${NODE} still answers" >&2
exit 1`,
        nodeFix: removeHardening(KUBELET_PORT),
        explain: `Service \`${HARDENING}\` keeps a firewall rule in place that rejects port \`10250\`. The kubelet talks out to the API server, so the node stays \`Ready\` and its Pods run, but everything that goes the other way fails: \`kubectl logs\` and \`kubectl exec\` end with \`dial tcp <node-ip>:10250: connect: connection refused\`. \`ss -ltnp | grep 10250\` shows that the kubelet does listen, which points at the path; \`iptables -S INPUT\` shows the rule. Delete it and it is back within seconds, because \`systemctl list-units --type=service --state=running\` has a service the healthy worker lacks. Disable that service, remove it and delete the rule.`,
      },
      {
        id: 'cluster-dns-wrong',
        label: 'The kubelet hands Pods the wrong DNS server',
        cause: 'kubelet',
        nodeBreak: `cp -a ${KUBELET_CONFIG} "${state}.kubelet-config"
sed -i -E '/^clusterDNS:/{n;s/^- .*/- ${WRONG_DNS}/}' ${KUBELET_CONFIG}
grep -A1 '^clusterDNS:' ${KUBELET_CONFIG} | grep -q '${WRONG_DNS}' || { echo "could not edit ${KUBELET_CONFIG}" >&2; exit 1; }
systemctl restart kubelet || true`,
        settle: replaceAfterRestart(NS, NODE),
        nodeFix: `cp -a "${state}.kubelet-config" ${KUBELET_CONFIG}
systemctl restart kubelet`,
        fix: replacePod(NS, NODE),
        wait: waitFleetUp(NS),
        explain: `\`clusterDNS\` in \`${KUBELET_CONFIG}\` says \`${WRONG_DNS}\`, which is no Service. The kubelet writes that address into every new Pod, so Pods started on this worker cannot resolve anything, while older Pods keep working. The Pod's readiness probe times out on \`nslookup\`; \`kubectl exec <pod> -- cat /etc/resolv.conf\` differs between the workers, and \`kubectl -n kube-system get service kube-dns\` shows the right address. Fix the file and restart the kubelet. A Pod keeps the \`resolv.conf\` it started with, so delete the Pod on that worker as well.`,
      },
      {
        id: 'sandbox-image-wrong',
        label: 'containerd names a sandbox image that does not exist',
        cause: 'containerd',
        nodeBreak: `cp -a ${CONTAINERD} "${state}.containerd"
sed -i -E "s#^([[:space:]]*sandbox = ).*#\\1'${WRONG_SANDBOX}'#" ${CONTAINERD}
grep -q '${WRONG_SANDBOX}' ${CONTAINERD} || { echo "could not edit ${CONTAINERD}" >&2; exit 1; }
systemctl restart containerd`,
        settle: replaceAfterRestart(NS, NODE),
        nodeFix: `cp -a "${state}.containerd" ${CONTAINERD}
systemctl restart containerd`,
        wait: waitFleetUp(NS),
        explain: `\`sandbox\` in \`${CONTAINERD}\` names \`${WRONG_SANDBOX}\`, an image that does not exist. Running Pods are fine, but every new Pod needs a sandbox first, so it stays in \`ContainerCreating\` and \`kubectl describe pod\` shows \`FailedCreatePodSandBox ... failed to get sandbox image\`. \`crictl images | grep pause\` and the same line on the healthy worker show the right tag. Fix it and restart containerd; the Pod starts on the kubelet's next try.`,
      },
      {
        id: 'cni-binary-missing',
        label: 'The Calico CNI plugin binary is gone from the node',
        cause: 'cni',
        nodeBreak: `rm -f /opt/cni/bin/calico
[[ ! -e /opt/cni/bin/calico ]]`,
        settle: `${replacePod(NS, NODE)}
${waitFleetDown(NS)}`,
        fix: `kubectl -n kube-system delete pod -l k8s-app=calico-node --field-selector "spec.nodeName=${NODE}" --wait=false`,
        wait: waitFleetUp(NS),
        explain: `\`/opt/cni/bin/calico\` is gone. The node stays \`Ready\`, because containerd only checks that a CNI configuration exists, and running Pods keep their network. Any Pod that starts or stops needs the plugin, though: a new Pod sits in \`ContainerCreating\` with \`failed to find plugin "calico" in path [/opt/cni/bin]\`, and a deleted one stays \`Terminating\` (\`journalctl -u kubelet\` shows the same message for its sandbox). \`ls /opt/cni/bin\` shows \`calico-ipam\` but no \`calico\`. Calico installs that binary itself: delete the \`calico-node\` Pod on that worker, and its \`install-cni\` init container puts it back.`,
      },
      {
        id: 'overlay-blocked',
        label: 'A firewall rule blocks the Pod network overlay',
        cause: 'firewall',
        nodeBreak: hardeningService(OVERLAY),
        settle: waitFleetDown(NS),
        nodeFix: removeHardening(OVERLAY),
        wait: waitFleetUp(NS),
        explain: `Service \`${HARDENING}\` drops Calico's overlay traffic as it reaches this worker (UDP port \`4789\` for VXLAN, IP protocol \`4\` for IP-in-IP). Node-to-node traffic is untouched, so the node stays \`Ready\` and \`kubectl\` works. Pods on the worker reach each other, but nothing that crosses to another node: \`wget\` from a Pod to a Pod on the other worker times out, and DNS fails when CoreDNS runs elsewhere, which is why the readiness probe fails. Test by Pod IP within and across nodes to narrow it down, then look at the firewall: the rules are in the raw table, which \`iptables -t raw -S PREROUTING\` shows. They come back until the service is disabled and removed, so do that and then delete them.`,
      },
      {
        id: 'disk-full',
        label: 'A large file fills the root filesystem',
        cause: 'disk',
        // Image garbage collection starts at 85% and would delete the lab's images, which cannot be pulled again offline.
        nodeBreak: `for i in $(ctr -n k8s.io images ls -q | grep -v '^sha256:'); do
  ctr -n k8s.io images label "$i" io.cri-containerd.pinned=pinned >/dev/null
done
mkdir -p ${ARCHIVE}
total=$(df --output=size -BM / | tail -1 | tr -dc 0-9)
avail=$(df --output=avail -BM / | tail -1 | tr -dc 0-9)
fallocate -l "$((avail - total * 6 / 100))M" ${ARCHIVE}/capture.tar`,
        settle: `for _ in $(seq 1 90); do
  [[ "$(${diskPressure(NODE)})" == True ]] && exit 0
  sleep 2
done
echo "${NODE} never reported DiskPressure" >&2
exit 1`,
        nodeFix: `rm -rf ${ARCHIVE}
systemctl restart kubelet`,
        wait: `for _ in $(seq 1 90); do
  [[ "$(${diskPressure(NODE)})" == False ]] && break
  sleep 2
done
${waitFleetUp(NS)}`,
        explain: `\`${ARCHIVE}/capture.tar\` fills the root filesystem past the kubelet's limit of 10% free. The node stays \`Ready\`, but reports \`DiskPressure\`, gets the \`node.kubernetes.io/disk-pressure\` taint and evicts its Pods: \`kubectl describe node\` and the Pods' \`Evicted\` status show it. \`df -h /\` confirms it, and \`du -sh /var/log/* | sort -h\` leads to the file. Delete it. The kubelet holds the condition for 5 minutes after the disk recovers (\`evictionPressureTransitionPeriod\`); restarting it clears the condition at once.`,
      },
      {
        id: 'node-object-deleted',
        label: 'The worker\'s Node object was deleted',
        cause: 'node-registration',
        break: `kubectl delete node "${NODE}"`,
        settle: `for _ in $(seq 1 75); do
  [[ -z "$(kubectl -n "${NS}" get pods -l app=fleet-check --field-selector "spec.nodeName=${NODE}" -o name)" ]] && exit 0
  sleep 2
done
echo "the Pods of ${NODE} are still there" >&2
exit 1`,
        nodeFix: 'systemctl restart kubelet',
        fix: `until kubectl get node "${NODE}" >/dev/null 2>&1; do sleep 2; done
kubectl label node "${NODE}" fleet=edge --overwrite`,
        wait: waitFleetUp(NS),
        explain: `Someone ran \`kubectl delete node\`. \`kubectl get nodes\` no longer lists the worker, and the Pod garbage collector removed its Pods, but the machine is fine and its kubelet runs. \`journalctl -u kubelet\` is full of \`nodes "<node>" not found\`: a kubelet registers once, at start. Restart it and the Node is back, with a new age and without the labels it had. So \`fleet-check\` still skips it until you add \`fleet=edge\` again, as \`kubectl get nodes --show-labels\` shows on the other worker and \`kubectl -n ${NS} get daemonset fleet-check -o wide\` shows in the selector.`,
      },
    ]),
};

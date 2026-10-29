import { createNs, nsField } from '../types';
import { WORKERS } from './compose';
import { edit } from './controlplane';
import { waitNotReady, waitReady } from './nodes';
import type { FaultCategory } from './types';

const KUBECONFIG = '/etc/kubernetes/kubelet.conf';
const CONFIG = '/var/lib/kubelet/config.yaml';
const CONTAINERD = '/etc/containerd/config.toml';
const DROPIN = `dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\\n' | grep 10-kubeadm.conf)`;

const restart = 'systemctl restart kubelet || true';

const kubeletCheck = (node: string) => ({
  id: `kubelet-${node}`,
  description: `the kubelet is running and enabled on ${node}`,
  type: 'ssh' as const,
  node,
  run: 'echo $(systemctl is-active kubelet) $(systemctl is-enabled kubelet)',
  expect: { equals: 'active enabled' },
  weight: 1,
});

export const nodeConfigCategory: FaultCategory = {
  id: 'nodeconfig',
  name: 'Worker node configuration',
  description: "One worker's kubelet configuration was edited and the node dropped out. Which file, and on which worker, is part of the puzzle.",
  track: 'cluster',
  domain: 'troubleshooting',
  difficulty: 3,
  minutes: 12,
  points: 7,
  tags: ['troubleshooting', 'node', 'kubelet', 'kubeconfig', 'systemd'],
  disruptive: true,
  // A worker stops taking Pods: other questions must start theirs first.
  blocksScheduling: 'node',
  settleSeconds: 60,
  hidden: { NODE: WORKERS },
  fields: [nsField(['fleet', 'edge', 'infra', 'nodes', 'config', 'workers', 'daemon', 'system', 'host-ops', 'platform'])],
  shell: ({ NS }) => ({
    title: 'Worker after a configuration change',
    text: `One of the workers has not been healthy since a maintenance window. DaemonSet \`node-agent\` in namespace \`${NS}\` should run a ready Pod on every worker. Find the node and fix it so that every node is \`Ready\` and not under memory pressure, \`node-agent\` runs everywhere, and the kubelet is running, enabled and survives a reboot of the node.

Do not change the DaemonSet, and do not rejoin the node to the cluster.`,
    spec: `- the kubelet unit drop-in loads \`${CONFIG}\` and \`${KUBECONFIG}\`, as kubeadm wrote them
- \`${KUBECONFIG}\` points at the API server on port \`6443\`
- \`${CONFIG}\` keeps the kubeadm values: the containerd socket, \`cgroupDriver: systemd\`, the cluster CA, no extra TLS files, and the default eviction thresholds
- \`${CONTAINERD}\` sets \`SystemdCgroup = true\` for the runc runtime`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-agent
  namespace: ${NS}
spec:
  selector:
    matchLabels: { app: node-agent }
  template:
    metadata:
      labels: { app: node-agent }
    spec:
      containers:
        - name: agent
          image: registry.k8s.io/pause:3.10
          resources:
            requests: { cpu: 10m, memory: 8Mi }
EOF
kubectl -n "${NS}" rollout status daemonset/node-agent --timeout=240s`,
    checks: [
      {
        id: 'all-ready',
        description: 'every node is Ready',
        type: 'kubectl',
        run: `kubectl get nodes -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\\n"}{end}' | sort -u | xargs`,
        expect: { equals: 'True' },
        weight: 2,
        retrySeconds: 90,
      },
      {
        id: 'memory-pressure',
        description: 'no node is under MemoryPressure',
        type: 'kubectl',
        run: `kubectl get nodes -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="MemoryPressure")].status}{"\\n"}{end}' | sort -u | xargs`,
        expect: { equals: 'False' },
        weight: 2,
        retrySeconds: 90,
      },
      ...WORKERS.map(kubeletCheck),
      {
        id: 'agent',
        description: 'node-agent has a ready Pod on every worker',
        type: 'kubectl',
        run: `kubectl -n ${NS} get daemonset node-agent -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled}'`,
        expect: { equals: `${WORKERS.length}/${WORKERS.length}` },
        weight: 1,
        retrySeconds: 90,
      },
    ],
    hints: [
      'kubectl get nodes, then kubectl describe node <node>: which node is unhealthy, which condition, and since when?',
      'On that node: systemctl status kubelet and journalctl -u kubelet -n 50. Is the kubelet crash-looping, or running but unable to do its job? If it cannot reach the container runtime, check containerd the same way.',
      'systemctl cat kubelet shows the unit and drop-ins, and so every file and flag the kubelet starts with. Check each path and value against what exists on the node and against a healthy worker.',
      'After editing a file, restart the kubelet (and run systemctl daemon-reload if you changed the unit).',
    ],
  }),
  faults: ({ NS, NODE }) => [
    {
      id: 'kubelet-client-ca',
      label: 'kubelet client CA file path is wrong',
      nodeBreak: `${edit(CONFIG, 's#^([[:space:]]*clientCAFile: /etc/kubernetes/pki/)ca\\.crt$#\\1ca.pem#', 'clientCAFile: /etc/kubernetes/pki/ca.pem$')}\n${restart}`,
      settle: waitNotReady(NODE),
      nodeFix: `${edit(CONFIG, 's#^([[:space:]]*clientCAFile: /etc/kubernetes/pki/)ca\\.pem$#\\1ca.crt#', 'clientCAFile: /etc/kubernetes/pki/ca.crt$')}\nsystemctl restart kubelet`,
      wait: waitReady(NODE),
      explain: `\`authentication.x509.clientCAFile\` in \`${CONFIG}\` points at \`/etc/kubernetes/pki/ca.pem\`, which does not exist, so the kubelet exits at startup (\`unable to load client CA file\`) and systemd keeps restarting it. \`ls /etc/kubernetes/pki\` shows \`ca.crt\`. Fix the path and restart the kubelet.`,
    },
    {
      id: 'runtime-endpoint',
      label: 'kubelet points at the wrong container runtime socket',
      nodeBreak: `${edit(
        CONFIG,
        's#^containerRuntimeEndpoint: unix:///var/run/containerd/containerd\\.sock$#containerRuntimeEndpoint: unix:///var/run/crio/crio.sock#',
        '^containerRuntimeEndpoint: unix:///var/run/crio/crio.sock$',
      )}\n${restart}`,
      settle: waitNotReady(NODE),
      nodeFix: `${edit(
        CONFIG,
        's#^containerRuntimeEndpoint: unix:///var/run/crio/crio\\.sock$#containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock#',
        '^containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock$',
      )}\nsystemctl restart kubelet`,
      wait: waitReady(NODE),
      explain: `\`containerRuntimeEndpoint\` in \`${CONFIG}\` points at the CRI-O socket \`/var/run/crio/crio.sock\`, but the node runs containerd. containerd itself is healthy, yet the kubelet cannot reach a runtime and fails to start. \`journalctl -u kubelet\` names the missing socket; \`/etc/crictl.yaml\` or \`ls /var/run/containerd\` shows the right one. Fix the endpoint and restart the kubelet.`,
    },
    {
      id: 'kubelet-config-flag',
      label: 'kubelet unit loads a configuration file that does not exist',
      nodeBreak: `${DROPIN}
${edit('"$dropin"', 's#--config=/var/lib/kubelet/config\\.yaml#--config=/var/lib/kubelet/kubelet-config.yaml#', '--config=/var/lib/kubelet/kubelet-config.yaml')}
systemctl daemon-reload
${restart}`,
      settle: waitNotReady(NODE),
      nodeFix: `${DROPIN}
${edit('"$dropin"', 's#--config=/var/lib/kubelet/kubelet-config\\.yaml#--config=/var/lib/kubelet/config.yaml#', '--config=/var/lib/kubelet/config.yaml')}
systemctl daemon-reload
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain: `The kubeadm drop-in (\`10-kubeadm.conf\`) starts the kubelet with \`--config=/var/lib/kubelet/kubelet-config.yaml\`, which does not exist, so it exits with \`failed to load Kubelet config file\`. \`systemctl cat kubelet\` shows the flag and \`ls /var/lib/kubelet\` shows \`config.yaml\`. Fix the drop-in, then \`systemctl daemon-reload\` and restart the kubelet.`,
    },
    {
      id: 'kubelet-kubeconfig-flag',
      label: 'kubelet unit loads a kubeconfig that does not exist',
      nodeBreak: `${DROPIN}
${edit('"$dropin"', 's#--kubeconfig=/etc/kubernetes/kubelet\\.conf#--kubeconfig=/etc/kubernetes/kubelet.config#', '--kubeconfig=/etc/kubernetes/kubelet.config')}
systemctl daemon-reload
${restart}`,
      settle: waitNotReady(NODE),
      nodeFix: `${DROPIN}
${edit('"$dropin"', 's#--kubeconfig=/etc/kubernetes/kubelet\\.config#--kubeconfig=/etc/kubernetes/kubelet.conf#', '--kubeconfig=/etc/kubernetes/kubelet.conf')}
systemctl daemon-reload
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain: `The kubeadm drop-in starts the kubelet with \`--kubeconfig=/etc/kubernetes/kubelet.config\`. That file does not exist and the bootstrap kubeconfig is long gone, so the kubelet exits right after start and the node turns \`NotReady\`. \`systemctl cat kubelet\` shows the flag; \`ls /etc/kubernetes\` shows the real \`kubelet.conf\`. Fix the drop-in, then \`systemctl daemon-reload\` and restart the kubelet.`,
    },
    {
      id: 'kubelet-serving-cert',
      label: 'kubelet serving certificate file missing',
      nodeBreak: `printf 'tlsCertFile: /var/lib/kubelet/pki/kubelet-server.crt\\ntlsPrivateKeyFile: /var/lib/kubelet/pki/kubelet-server.key\\n' >> ${CONFIG}
grep -q '^tlsCertFile: ' ${CONFIG} || { echo "could not modify ${CONFIG}" >&2; exit 1; }
${restart}`,
      settle: waitNotReady(NODE),
      nodeFix: `sed -i -E '/^tls(CertFile|PrivateKeyFile): /d' ${CONFIG}
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain: `\`${CONFIG}\` sets \`tlsCertFile\` and \`tlsPrivateKeyFile\` to \`/var/lib/kubelet/pki/kubelet-server.*\`, which do not exist, so the kubelet cannot load its serving certificate and exits at start. \`journalctl -u kubelet\` names the file, and \`ls /var/lib/kubelet/pki\` shows only the self-generated \`kubelet.crt\`/\`kubelet.key\` and the client certificates. Remove both lines (the kubelet then uses its self-signed certificate) and restart it.`,
    },
    {
      id: 'kubelet-eviction-hard',
      label: 'kubelet evictionHard memory threshold is absurd',
      nodeBreak: `cp -a ${CONFIG} ${CONFIG}.cka-bak
sed -i '/^evictionHard:/,/^[^[:space:]]/{ /^evictionHard:/d; /^[[:space:]]/d; }' ${CONFIG} || true
printf '%s\\n' 'evictionHard:' '  memory.available: "99%"' >> ${CONFIG}
grep -q 'memory.available: "99%"' ${CONFIG} || { echo "could not set evictionHard" >&2; exit 1; }
${restart}`,
      settle: `for _ in $(seq 1 90); do
  [[ "$(kubectl get node "${NODE}" -o jsonpath='{.status.conditions[?(@.type=="MemoryPressure")].status}' 2>/dev/null || true)" == True ]] && exit 0
  sleep 2
done
echo "the node never reported MemoryPressure" >&2
exit 1`,
      nodeFix: `if [[ -f ${CONFIG}.cka-bak ]]; then cp -a ${CONFIG}.cka-bak ${CONFIG}; else
  sed -i '/^evictionHard:/,/^[^[:space:]]/{ /^evictionHard:/d; /^[[:space:]]/d; }' ${CONFIG} || true
  sed -i '/memory.available: "99%"/d' ${CONFIG} || true
fi
systemctl restart kubelet`,
      wait: `for _ in $(seq 1 90); do
  ready=$(kubectl get node "${NODE}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
  press=$(kubectl get node "${NODE}" -o jsonpath='{.status.conditions[?(@.type=="MemoryPressure")].status}')
  [[ "$ready" == True && "$press" == False ]] && break
  sleep 2
done
for _ in $(seq 1 60); do
  ready=$(kubectl -n "${NS}" get daemonset node-agent -o jsonpath='{.status.numberReady}')
  want=$(kubectl -n "${NS}" get daemonset node-agent -o jsonpath='{.status.desiredNumberScheduled}')
  [[ "$ready" == "$want" && -n "$ready" ]] && break
  sleep 3
done`,
      explain: `\`${CONFIG}\` sets \`evictionHard.memory.available: "99%"\`, so the kubelet constantly reports MemoryPressure and evicts workload Pods even though the node stays Ready. \`kubectl describe node\` shows the pressure condition and eviction events. Restore the previous kubelet config (or remove that evictionHard entry) and restart the kubelet.`,
    },
    {
      id: 'kubelet-cgroup-driver',
      label: 'containerd cgroup driver is invalid',
      // Kubelet 1.37 (KubeletCgroupDriverFromCRI, locked on) overwrites cgroupDriver from
      // containerd's RuntimeConfig, so a bad value in the kubelet config leaves the node Ready.
      nodeBreak: `${edit(CONTAINERD, 's#^([[:space:]]*SystemdCgroup = )true[[:space:]]*$#\\1"invalid"#', '^[[:space:]]*SystemdCgroup = "invalid"$')}\nsystemctl restart containerd || true\n${restart}`,
      settle: waitNotReady(NODE),
      nodeFix: `${edit(CONTAINERD, 's#^([[:space:]]*SystemdCgroup = )"invalid"[[:space:]]*$#\\1true#', '^[[:space:]]*SystemdCgroup = true$')}\nsystemctl restart containerd\nsystemctl restart kubelet`,
      wait: waitReady(NODE),
      explain: `\`SystemdCgroup\` in \`${CONTAINERD}\` is the string \`"invalid"\`, so containerd cannot load its config and never starts. Kubelet 1.37 asks containerd which cgroup driver to use, and exits when the runtime does not answer, so the node turns \`NotReady\`. \`journalctl -u containerd\` names the field; a healthy worker has \`SystemdCgroup = true\`. Set that, then restart containerd and the kubelet.`,
    },
  ],
};
import { createNs, nsField } from '../types';
import { WORKERS } from './compose';
import type { FaultCategory } from './types';

const readyStatus = (node: string) => `kubectl get node "${node}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'`;

const noScheduleTaint = (node: string) =>
  `kubectl get node "${node}" -o jsonpath='{range .spec.taints[?(@.effect=="NoSchedule")]}{.key}{"\\n"}{end}' | grep -qE '^node.kubernetes.io/(unreachable|not-ready)$'`;

/**
 * The node controller marks a node NotReady about 20s after its last heartbeat (the images set
 * --node-monitor-grace-period=20s; stock clusters take about 40s), and taints it a
 * moment later. Until the taint is there, Pods created by later questions can still land on it.
 */
export const waitNotReady = (node: string) => `for _ in $(seq 1 90); do
  [[ "$(${readyStatus(node)})" != True ]] && ${noScheduleTaint(node)} && exit 0
  sleep 2
done
echo "the node is still Ready, or not yet tainted" >&2
exit 1`;

export const waitReady = (node: string) => `for _ in $(seq 1 90); do
  [[ "$(${readyStatus(node)})" == True ]] && break
  sleep 2
done`;

const DROPIN = `dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\\n' | grep 10-kubeadm.conf)`;

export const KUBELET_CONFIG = '/var/lib/kubelet/config.yaml';
const KUBELET_CONF = '/etc/kubernetes/kubelet.conf';

/** Edits a kubelet file with `sed -E`, proves the edit applied, then restarts the kubelet. */
const editKubelet = (file: string, expr: string, proof: string) => `sed -i -E '${expr}' ${file}
grep -qE -- '${proof}' ${file} || { echo "could not edit ${file}" >&2; exit 1; }
systemctl restart kubelet || true`;

const serviceCheck = (node: string) => ({
  id: `services-${node}`,
  description: `kubelet and containerd are running and enabled on ${node}`,
  type: 'ssh' as const,
  node,
  run: `echo $(systemctl is-active kubelet containerd) $(systemctl is-enabled kubelet containerd) | tr ' ' '\\n' | sort -u | tr '\\n' ' '`,
  expect: { equals: 'active enabled' },
  weight: 1,
});

export const nodesCategory: FaultCategory = {
  id: 'nodes',
  name: 'Nodes',
  description: 'One worker is unhealthy or no longer takes Pods. Which one, and why, is part of the puzzle.',
  domain: 'troubleshooting',
  difficulty: 2,
  minutes: 10,
  points: 6,
  tags: ['troubleshooting', 'node', 'kubelet', 'containerd'],
  disruptive: true,
  // A worker stops taking Pods: other questions must start theirs first.
  blocksScheduling: 'node',
  settleSeconds: 60,
  hidden: { NODE: WORKERS },
  fields: [nsField(['ops', 'infra', 'platform', 'cluster', 'nodes', 'kubelet-lab', 'workers', 'system', 'sre', 'fleet'])],
  layers: [
    { name: 'the container runtime or the network', faults: ['containerd-stopped', 'containerd-config-invalid', 'cni-config-removed', 'cni-conflist-typo', 'ip-forward-and-containerd'] },
    {
      name: 'the kubelet',
      faults: ['kubelet-stopped', 'kubelet-binary-path', 'kubelet-config-invalid', 'kubelet-api-port', 'kubelet-extra-args', 'kubelet-conf-missing', 'kubelet-swap-on'],
    },
    { name: 'scheduling', faults: ['cordoned', 'stray-taint'] },
  ],
  shell: ({ NS }) => ({
    title: 'Unhealthy worker',
    text: `One of the workers is not healthy: DaemonSet \`node-probe\` in namespace \`${NS}\` should run a ready Pod on every worker, and it does not. Find the node and fix it so that every node is \`Ready\` and takes new Pods, and the fix survives a reboot of the node.

Do not change the DaemonSet.`,
    spec: `- kubelet and containerd running and enabled on every worker, with \`net.ipv4.ip_forward=1\` persisted
- the kubelet's unit drop-in, \`${KUBELET_CONFIG}\`, \`${KUBELET_CONF}\` and \`/etc/default/kubelet\` as kubeadm wrote them; no swap
- Calico's \`10-calico.conflist\` in \`/etc/cni/net.d\`, and a valid \`/etc/containerd/config.toml\`
- no worker cordoned or tainted`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-probe
  namespace: ${NS}
spec:
  selector:
    matchLabels: { app: node-probe }
  template:
    metadata:
      labels: { app: node-probe }
    spec:
      containers:
        - name: probe
          image: registry.k8s.io/pause:3.10
          resources:
            requests: { cpu: 10m, memory: 8Mi }
EOF
kubectl -n "${NS}" rollout status daemonset/node-probe --timeout=240s`,
    checks: [
      {
        id: 'all-ready',
        description: 'every node is Ready',
        type: 'kubectl',
        run: `kubectl get nodes -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\\n"}{end}' | sort -u | tr '\\n' ' '`,
        expect: { equals: 'True' },
        weight: 2,
        retrySeconds: 90,
      },
      {
        id: 'schedulable',
        description: 'no worker is cordoned or carries a NoSchedule taint',
        type: 'kubectl',
        run: `kubectl get nodes -l '!node-role.kubernetes.io/control-plane' -o jsonpath='{range .items[*]}{.spec.unschedulable} {range .spec.taints[*]}{.key}={.effect} {end}{"\\n"}{end}' | tr ' ' '\\n' | grep -vE '^$|^dedicated=' | grep -cE 'true|NoSchedule|NoExecute' || true`,
        expect: { equals: '0' },
        weight: 1,
        retrySeconds: 30,
      },
      ...WORKERS.map(serviceCheck),
      {
        id: 'probe',
        description: 'node-probe has a ready Pod on every worker',
        type: 'kubectl',
        run: `kubectl -n ${NS} get daemonset node-probe -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled}/{.status.updatedNumberScheduled}'`,
        expect: {
          equals: `${WORKERS.length}/${WORKERS.length}/${WORKERS.length}`,
        },
        weight: 1,
        retrySeconds: 90,
      },
    ],
    hints: [
      'kubectl get nodes, then kubectl describe node <node>: Conditions, Taints and Unschedulable tell you whether the node is down or only refuses Pods.',
      `kubectl -n ${NS} get pods -o wide shows which worker is missing its probe Pod.`,
      'On a NotReady node: systemctl status kubelet containerd, then journalctl -u kubelet -n 50 (and -u containerd). Fix one error, restart, and read the log again.',
      'systemctl cat kubelet shows the unit, its drop-ins and the files the kubelet reads. Compare paths and settings with what exists on the node and with a healthy worker.',
      'systemctl is-enabled tells you whether a service comes back after a reboot.',
    ],
  }),
  faults: ({ NS, NODE }, state) => [
    {
      id: 'kubelet-stopped',
      label: 'kubelet stopped and disabled',
      nodeBreak: 'systemctl disable --now kubelet',
      settle: waitNotReady(NODE),
      nodeFix: 'systemctl enable --now kubelet',
      wait: waitReady(NODE),
      explain:
        'The kubelet was stopped and disabled, so the node stops sending heartbeats and turns `NotReady`. `systemctl status kubelet` shows it inactive. `systemctl enable --now kubelet` fixes it now and after a reboot.',
    },
    {
      id: 'containerd-stopped',
      label: 'containerd stopped and disabled',
      nodeBreak: 'systemctl disable --now containerd',
      settle: waitNotReady(NODE),
      nodeFix: 'systemctl enable --now containerd\nsystemctl restart kubelet',
      wait: waitReady(NODE),
      explain:
        'The container runtime was stopped and disabled. The kubelet keeps running but reports `container runtime is down` / `NotReady`, and its log is full of CRI connection errors. `systemctl enable --now containerd` fixes it.',
    },
    {
      id: 'ip-forward-and-containerd',
      label: 'IP forwarding off and containerd disabled',
      nodeBreak: `sysctl -w net.ipv4.ip_forward=0 >/dev/null
rm -f /etc/sysctl.d/k8s.conf
systemctl disable --now containerd >/dev/null 2>&1 || true
[[ "$(sysctl -n net.ipv4.ip_forward)" == "0" ]]
[[ "$(systemctl is-enabled containerd 2>/dev/null || true)" != "enabled" ]]`,
      settle: waitNotReady(NODE),
      nodeFix: `printf 'net.ipv4.ip_forward=1\\n' >/etc/sysctl.d/k8s.conf
sysctl --system >/dev/null 2>&1 || sysctl -w net.ipv4.ip_forward=1 >/dev/null
systemctl enable --now containerd
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain:
        '`net.ipv4.ip_forward` is 0, `/etc/sysctl.d/k8s.conf` is missing, and `containerd` was stopped and disabled. The node turns `NotReady`. Put `net.ipv4.ip_forward=1` in `/etc/sysctl.d/k8s.conf`, apply with `sysctl --system`, and `systemctl enable --now containerd`.',
    },
    {
      id: 'kubelet-binary-path',
      label: 'kubelet unit points at the wrong binary',
      nodeBreak: `${DROPIN}
sed -i 's#^ExecStart=/usr/bin/kubelet #ExecStart=/usr/local/bin/kubelet #' "$dropin"
grep -q '^ExecStart=/usr/local/bin/kubelet ' "$dropin"
systemctl daemon-reload
systemctl restart kubelet || true`,
      settle: waitNotReady(NODE),
      nodeFix: `${DROPIN}
sed -i 's#^ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin"
systemctl daemon-reload
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain:
        'The kubeadm drop-in (`10-kubeadm.conf`) starts `/usr/local/bin/kubelet`, which does not exist, so the service fails with `status=203/EXEC`. `systemctl cat kubelet` shows the path; `which kubelet` shows the real one. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.',
    },
    {
      id: 'cordoned',
      label: 'Node cordoned',
      break: `kubectl cordon "${NODE}"`,
      fix: `kubectl uncordon "${NODE}"`,
      explain: 'The node is `Ready` but cordoned (`SchedulingDisabled`), so no new Pods land on it. `kubectl uncordon` it.',
    },
    {
      id: 'stray-taint',
      label: 'Stray NoSchedule taint',
      break: `kubectl taint node "${NODE}" maintenance=true:NoSchedule --overwrite
kubectl -n "${NS}" delete pod -l app=node-probe --field-selector "spec.nodeName=${NODE}" --wait=false`,
      fix: `kubectl taint node "${NODE}" maintenance-`,
      explain:
        'A `maintenance=true:NoSchedule` taint keeps every Pod without a matching toleration off the node, including the probe Pod. `kubectl describe node` lists it under Taints; remove it with `kubectl taint node <node> maintenance-`.',
    },
    {
      id: 'kubelet-config-invalid',
      label: 'kubelet config has the wrong kind',
      nodeBreak: editKubelet(KUBELET_CONFIG, 's/^kind: KubeletConfiguration$/kind: KubeletConfig/', '^kind: KubeletConfig$'),
      settle: waitNotReady(NODE),
      nodeFix: editKubelet(KUBELET_CONFIG, 's/^kind: KubeletConfig$/kind: KubeletConfiguration/', '^kind: KubeletConfiguration$'),
      wait: waitReady(NODE),
      explain: `\`${KUBELET_CONFIG}\` says \`kind: KubeletConfig\`. The kubelet cannot decode its own config and exits at start (no kind "KubeletConfig" is registered), so the node turns \`NotReady\`. \`journalctl -u kubelet\` shows the error. Set \`kind: KubeletConfiguration\` again and restart the kubelet.`,
    },
    {
      id: 'kubelet-api-port',
      label: 'kubelet kubeconfig uses the wrong API port',
      nodeBreak: editKubelet(KUBELET_CONF, 's#^([[:space:]]*server: https://.*):6443$#\\1:6444#', 'server: https://.*:6444$'),
      settle: waitNotReady(NODE),
      nodeFix: editKubelet(KUBELET_CONF, 's#^([[:space:]]*server: https://.*):6444$#\\1:6443#', 'server: https://.*:6443$'),
      wait: waitReady(NODE),
      explain: `The kubelet runs, but \`${KUBELET_CONF}\` points it at port \`6444\` of the API server, so every request fails with "connection refused" and the node stops heartbeating. \`journalctl -u kubelet\` shows the URL; the API server listens on \`6443\` (compare \`~/.kube/config\`). Fix the port and restart the kubelet.`,
    },
    {
      id: 'kubelet-extra-args',
      label: 'kubelet started with an unknown flag',
      nodeBreak: `touch /etc/default/kubelet
cp -a /etc/default/kubelet "${state}.kubelet-default"
grep -q '^KUBELET_EXTRA_ARGS=' /etc/default/kubelet || echo 'KUBELET_EXTRA_ARGS=' >> /etc/default/kubelet
${editKubelet('/etc/default/kubelet', 's#^KUBELET_EXTRA_ARGS=(.*)$#KUBELET_EXTRA_ARGS=\\1 --pod-max-pids-limit=100#', '--pod-max-pids-limit=100')}`,
      settle: waitNotReady(NODE),
      nodeFix: `cp -a "${state}.kubelet-default" /etc/default/kubelet
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain:
        '`/etc/default/kubelet` adds `--pod-max-pids-limit=100` to `KUBELET_EXTRA_ARGS`. No such flag exists (the real one is `--pod-max-pids`), so the kubelet exits with "unknown flag" right after start. `systemctl cat kubelet` shows the drop-in reads that file. Remove the flag and restart the kubelet.',
    },
    {
      id: 'cni-config-removed',
      label: 'CNI configuration removed from the node',
      nodeBreak: `mkdir -p "${state}.cni"
mv /etc/cni/net.d/*.conflist "${state}.cni/"
! ls /etc/cni/net.d/*.conflist >/dev/null 2>&1 || { echo "could not move the CNI config" >&2; exit 1; }`,
      settle: waitNotReady(NODE),
      nodeFix: `mv "${state}.cni/"*.conflist /etc/cni/net.d/
systemctl restart containerd
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain:
        'The Calico network config (`10-calico.conflist`) is gone from `/etc/cni/net.d`. containerd reports the network as not ready, so the node turns `NotReady` with "container runtime network not ready ... cni plugin not initialized" (`kubectl describe node`, `journalctl -u kubelet`). `ls /etc/cni/net.d` is empty. Calico writes that file itself: delete the `calico-node` Pod on that worker (`kubectl -n kube-system delete pod -l k8s-app=calico-node --field-selector spec.nodeName=<node>`) and its `install-cni` init container writes it again. Copying it from the healthy worker also works if you change its `nodename`. Then restart containerd and the kubelet.',
    },
    {
      id: 'containerd-config-invalid',
      label: 'containerd config does not parse',
      nodeBreak: `cp -a /etc/containerd/config.toml "${state}.containerd"
printf '\\n[plugins\\n' >> /etc/containerd/config.toml
systemctl restart containerd || true
systemctl restart kubelet || true`,
      settle: waitNotReady(NODE),
      nodeFix: `cp -a "${state}.containerd" /etc/containerd/config.toml
systemctl restart containerd
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain:
        'The last line of `/etc/containerd/config.toml` is an unclosed `[plugins` table, so containerd fails to start ("failed to load TOML"). The kubelet runs but cannot reach the runtime, and the node turns `NotReady`. `systemctl status containerd` and `journalctl -u containerd -n 20` point at the line. Remove it, then restart containerd and the kubelet.',
    },
    {
      id: 'kubelet-conf-missing',
      label: 'kubelet kubeconfig file is missing',
      nodeBreak: `mv ${KUBELET_CONF} "${state}.kubelet-conf"
[[ ! -f ${KUBELET_CONF} ]]
systemctl restart kubelet || true`,
      settle: waitNotReady(NODE),
      nodeFix: `mv "${state}.kubelet-conf" ${KUBELET_CONF}
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain: `\`${KUBELET_CONF}\` is gone, so the kubelet cannot authenticate to the API server and the node turns \`NotReady\`. \`journalctl -u kubelet\` mentions the missing kubeconfig. A worker's kubelet.conf only names the API server, the cluster CA and the path of the node's own client certificate (\`/var/lib/kubelet/pki/kubelet-client-current.pem\`), so the healthy worker's copy works unchanged: copy it across through controlplane, then restart the kubelet.`,
    },
    {
      id: 'kubelet-swap-on',
      label: 'Swap is enabled so the kubelet refuses to start',
      nodeBreak: `SWAP=/root/cka-swap
dd if=/dev/zero of="$SWAP" bs=1M count=64 status=none
chmod 600 "$SWAP"
mkswap "$SWAP" >/dev/null
swapon "$SWAP"
swapon --show | grep -q cka-swap
sed -i '/^failSwapOn:/d' ${KUBELET_CONFIG}
echo 'failSwapOn: true' >> ${KUBELET_CONFIG}
systemctl restart kubelet || true`,
      settle: waitNotReady(NODE),
      nodeFix: `swapoff /root/cka-swap 2>/dev/null || true
rm -f /root/cka-swap
sed -i '/^failSwapOn:/d' ${KUBELET_CONFIG} || true
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain:
        'A swap file (`/root/cka-swap`) is active and the kubelet runs with `failSwapOn: true`, so it exits rather than start with swap enabled. `swapon --show` lists the file; `journalctl -u kubelet` mentions swap. `swapoff` the file, remove it, and restart the kubelet.',
    },
    {
      id: 'cni-conflist-typo',
      label: 'CNI conflist is present but invalid JSON',
      nodeBreak: `f=$(ls /etc/cni/net.d/*.conflist 2>/dev/null | head -1)
[[ -n "$f" ]] || { echo "no CNI conflist" >&2; exit 1; }
cp -a "$f" "${state}.cni-conflist"
printf '{ "cniVersion": "0.3.1", "name": "broken", "plugins": [ { "type": "not-a-real-cni-plugin" } ]\\n' > "$f"
! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>/dev/null
systemctl restart containerd || true
systemctl restart kubelet || true`,
      settle: waitNotReady(NODE),
      nodeFix: `f=$(ls /etc/cni/net.d/*.conflist 2>/dev/null | head -1)
[[ -f "${state}.cni-conflist" ]] || { echo "missing CNI backup" >&2; exit 1; }
if [[ -n "$f" ]]; then cp -a "${state}.cni-conflist" "$f"; else cp -a "${state}.cni-conflist" /etc/cni/net.d/10-calico.conflist; fi
systemctl restart containerd
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain:
        'A file still sits in `/etc/cni/net.d`, but it is not valid JSON (and names a bogus plugin): `python3 -m json.tool <file>` fails to parse it, and the runtime network never becomes ready, so the node turns `NotReady`. Calico writes that file itself: delete the broken file and the `calico-node` Pod on that worker, and its `install-cni` init container writes a good one. Then restart containerd and the kubelet.',
    },
  ],
};

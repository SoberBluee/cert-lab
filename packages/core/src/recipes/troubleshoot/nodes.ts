import { createNs, nsField } from '../types';
import { WORKERS } from './compose';
import { nodeReport } from './report';
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
const KUBELET_PKI = '/var/lib/kubelet/pki';
const MAINTENANCE_DROPIN = '/etc/systemd/system/kubelet.service.d/20-maintenance.conf';

/** Edits a kubelet file with `sed -E`, proves the edit applied, then restarts the kubelet. */
const editKubelet = (file: string, expr: string, proof: string) => `sed -i -E '${expr}' ${file}
grep -qE -- '${proof}' ${file} || { echo "could not edit ${file}" >&2; exit 1; }
systemctl restart kubelet || true`;

const serviceCheck = (node: string) => ({
  id: `services-${node}`,
  description: `kubelet, containerd and chrony are running and enabled on ${node}`,
  type: 'ssh' as const,
  node,
  run: `echo $(systemctl is-active kubelet containerd chrony) $(systemctl is-enabled kubelet containerd chrony) | tr ' ' '\\n' | sort -u | tr '\\n' ' '`,
  expect: { equals: 'active enabled' },
  weight: 1,
});

const report = nodeReport('nodes');

export const nodesCategory: FaultCategory = {
  id: 'nodes',
  name: 'Nodes',
  description: 'One worker is unhealthy or no longer takes Pods. Which one, and why, is part of the puzzle.',
  domain: 'troubleshooting',
  difficulty: 2,
  minutes: 10,
  points: 8,
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
      faults: [
        'kubelet-stopped',
        'kubelet-binary-path',
        'kubelet-config-invalid',
        'kubelet-api-port',
        'kubelet-extra-args',
        'kubelet-conf-missing',
        'kubelet-swap-on',
        'kubelet-start-condition',
        'kubelet-wrong-identity',
        'clock-skew',
      ],
    },
    { name: 'scheduling', faults: ['cordoned', 'stray-taint'] },
  ],
  shell: ({ NS, NODE }, state) => ({
    title: 'Unhealthy worker',
    text: `One of the workers is not healthy: DaemonSet \`node-probe\` in namespace \`${NS}\` should run a ready Pod on every worker, and it does not. Find the node and fix it so that every node is \`Ready\` and takes new Pods, and the fix survives a reboot of the node. ${report.text}

Do not change the DaemonSet.`,
    spec: `- kubelet, containerd and chrony running and enabled on every worker, with \`net.ipv4.ip_forward=1\` persisted and the clock in sync
- the kubelet's unit and drop-in, \`${KUBELET_CONFIG}\`, \`${KUBELET_CONF}\` and \`/etc/default/kubelet\` as kubeadm wrote them; no swap
- \`kubelet-client-current.pem\` in \`${KUBELET_PKI}\` is the node's own certificate
- Calico's \`10-calico.conflist\` in \`/etc/cni/net.d\`, and a valid \`/etc/containerd/config.toml\`
- no worker cordoned or tainted`,
    before: `${createNs(NS)}
${report.setup(NODE, state)}
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
      ...report.checks(state),
    ],
    hints: [
      'kubectl get nodes, then kubectl describe node <node>: Conditions, Taints and Unschedulable tell you whether the node is down or only refuses Pods.',
      `kubectl -n ${NS} get pods -o wide shows which worker is missing its probe Pod.`,
      'On a NotReady node: systemctl status kubelet containerd, then journalctl -u kubelet -n 50 (and -u containerd). Fix one error, restart, and read the log again.',
      'systemctl cat kubelet shows the unit, its drop-ins and the files the kubelet reads. Compare paths and settings with what exists on the node and with a healthy worker.',
      'systemctl is-enabled tells you whether a service comes back after a reboot.',
      'When the log does not explain it, compare the node with the healthy worker: its files, the identity in its certificates (openssl x509 -subject) and its host settings.',
    ],
  }),
  faults: ({ NS, NODE }, state) => report.reported(NODE, state, [
    {
      id: 'kubelet-stopped',
      label: 'kubelet stopped and disabled',
      cause: 'kubelet',
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
      cause: 'containerd',
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
      cause: 'containerd',
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
      cause: 'kubelet',
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
      cause: 'scheduling',
      break: `kubectl cordon "${NODE}"`,
      fix: `kubectl uncordon "${NODE}"`,
      explain: 'The node is `Ready` but cordoned (`SchedulingDisabled`), so no new Pods land on it. `kubectl uncordon` it.',
    },
    {
      id: 'stray-taint',
      label: 'Stray NoSchedule taint',
      cause: 'scheduling',
      break: `kubectl taint node "${NODE}" maintenance=true:NoSchedule --overwrite
kubectl -n "${NS}" delete pod -l app=node-probe --field-selector "spec.nodeName=${NODE}" --wait=false`,
      fix: `kubectl taint node "${NODE}" maintenance-`,
      explain:
        'A `maintenance=true:NoSchedule` taint keeps every Pod without a matching toleration off the node, including the probe Pod. `kubectl describe node` lists it under Taints; remove it with `kubectl taint node <node> maintenance-`.',
    },
    {
      id: 'kubelet-config-invalid',
      label: 'kubelet config has the wrong kind',
      cause: 'kubelet',
      nodeBreak: editKubelet(KUBELET_CONFIG, 's/^kind: KubeletConfiguration$/kind: KubeletConfig/', '^kind: KubeletConfig$'),
      settle: waitNotReady(NODE),
      nodeFix: editKubelet(KUBELET_CONFIG, 's/^kind: KubeletConfig$/kind: KubeletConfiguration/', '^kind: KubeletConfiguration$'),
      wait: waitReady(NODE),
      explain: `\`${KUBELET_CONFIG}\` says \`kind: KubeletConfig\`. The kubelet cannot decode its own config and exits at start (no kind "KubeletConfig" is registered), so the node turns \`NotReady\`. \`journalctl -u kubelet\` shows the error. Set \`kind: KubeletConfiguration\` again and restart the kubelet.`,
    },
    {
      id: 'kubelet-api-port',
      label: 'kubelet kubeconfig uses the wrong API port',
      cause: 'kubelet',
      nodeBreak: editKubelet(KUBELET_CONF, 's#^([[:space:]]*server: https://.*):6443$#\\1:6444#', 'server: https://.*:6444$'),
      settle: waitNotReady(NODE),
      nodeFix: editKubelet(KUBELET_CONF, 's#^([[:space:]]*server: https://.*):6444$#\\1:6443#', 'server: https://.*:6443$'),
      wait: waitReady(NODE),
      explain: `The kubelet runs, but \`${KUBELET_CONF}\` points it at port \`6444\` of the API server, so every request fails with "connection refused" and the node stops heartbeating. \`journalctl -u kubelet\` shows the URL; the API server listens on \`6443\` (compare \`~/.kube/config\`). Fix the port and restart the kubelet.`,
    },
    {
      id: 'kubelet-extra-args',
      label: 'kubelet started with an unknown flag',
      cause: 'kubelet',
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
      cause: 'cni',
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
      cause: 'containerd',
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
      cause: 'kubelet',
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
      cause: 'kubelet',
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
      cause: 'cni',
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
    {
      id: 'kubelet-start-condition',
      label: 'A drop-in keeps systemd from starting the kubelet',
      cause: 'kubelet',
      nodeBreak: `mkdir -p "$(dirname ${MAINTENANCE_DROPIN})"
printf '[Unit]\\nConditionPathExists=/etc/kubernetes/node-approved\\n' > ${MAINTENANCE_DROPIN}
systemctl daemon-reload
systemctl stop kubelet`,
      settle: waitNotReady(NODE),
      nodeFix: `rm -f ${MAINTENANCE_DROPIN}
systemctl daemon-reload
systemctl start kubelet`,
      wait: waitReady(NODE),
      explain: `A drop-in, \`${MAINTENANCE_DROPIN}\`, sets \`ConditionPathExists\` on a file that does not exist. systemd treats a failed condition as a skip, not an error: \`systemctl start kubelet\` exits 0, nothing runs, and the journal has no kubelet errors. \`systemctl status kubelet\` shows it \`inactive (dead)\` and lists the drop-in, and \`systemctl cat kubelet\` shows the condition. Remove the drop-in, run \`systemctl daemon-reload\` and start the kubelet.`,
    },
    {
      id: 'kubelet-wrong-identity',
      label: 'The kubelet uses the other worker\'s client certificate',
      cause: 'kubelet',
      // Made on controlplane, which has the CA, and copied over before the worker's own step points the kubelet at it.
      break: `other=${WORKERS[0]}
[[ "${NODE}" == "$other" ]] && other=${WORKERS[1]}
work=$(mktemp -d)
openssl genrsa -out "$work/key.pem" 2048 2>/dev/null
openssl req -new -key "$work/key.pem" -subj "/O=system:nodes/CN=system:node:$other" -out "$work/cert.csr" 2>/dev/null
printf 'extendedKeyUsage=clientAuth\\nkeyUsage=critical,digitalSignature,keyEncipherment\\n' > "$work/ext"
openssl x509 -req -in "$work/cert.csr" -CA /etc/kubernetes/pki/ca.crt -CAkey /etc/kubernetes/pki/ca.key -CAcreateserial -CAserial "$work/serial" -days 200 -extfile "$work/ext" -out "$work/cert.pem" 2>/dev/null
cat "$work/cert.pem" "$work/key.pem" | runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new "${NODE}" "sudo tee ${KUBELET_PKI}/kubelet-client-backup.pem >/dev/null"
rm -rf "$work"`,
      nodeBreak: `chmod 600 ${KUBELET_PKI}/kubelet-client-backup.pem
ln -sfn ${KUBELET_PKI}/kubelet-client-backup.pem ${KUBELET_PKI}/kubelet-client-current.pem
systemctl restart kubelet || true`,
      settle: waitNotReady(NODE),
      nodeFix: `own=$(ls ${KUBELET_PKI}/kubelet-client-20*.pem | tail -1)
ln -sfn "$own" ${KUBELET_PKI}/kubelet-client-current.pem
rm -f ${KUBELET_PKI}/kubelet-client-backup.pem
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain: `\`kubelet-client-current.pem\` in \`${KUBELET_PKI}\` points at \`kubelet-client-backup.pem\`, a valid certificate for the other worker. The API server accepts it, so there is no x509 error, but the kubelet is now the wrong node: \`journalctl -u kubelet\` shows \`User "system:node:<other>" cannot get resource ...\` and \`forbidden\`, and the node turns \`NotReady\`. \`openssl x509 -in ${KUBELET_PKI}/kubelet-client-current.pem -noout -subject\` names the other worker. The node's own certificate is still there under its dated name: point the symlink at it and restart the kubelet.`,
    },
    {
      id: 'clock-skew',
      label: 'The clock is two years behind and chrony is off',
      cause: 'clock',
      // The kubelet keeps its open connection whatever the clock says: only a new TLS handshake fails.
      nodeBreak: `systemctl disable --now chrony >/dev/null 2>&1
date -s '2 years ago' >/dev/null
systemctl restart kubelet || true`,
      settle: waitNotReady(NODE),
      // Where no NTP server is in reach, the API server's Date header gives the time.
      nodeFix: `systemctl enable --now chrony
apiTime() { date -d "$(curl -skI -m 5 https://controlplane:6443/livez | sed -n 's/^[Dd]ate: //p' | tr -d '\\r')" +%s; }
inSync() { (( \${1:-0} - $(date +%s) < 60 && $(date +%s) - \${1:-0} < 60 )); }
now=$(apiTime)
for _ in $(seq 1 15); do
  chronyc -a makestep >/dev/null 2>&1 || true
  inSync "$now" && break
  sleep 2
  now=$(apiTime)
done
inSync "$now" || date -s "@$now" >/dev/null
systemctl restart kubelet`,
      wait: waitReady(NODE),
      explain: `The worker's clock is two years behind and chrony is stopped and disabled. The API server's certificate is not valid yet by that clock, so every new connection fails with \`x509: certificate has expired or is not yet valid\` and the node turns \`NotReady\`. \`date\` and \`timedatectl\` show it at once. The journal sorts by time, so \`journalctl -u kubelet -n 50\` hides new lines behind older ones that look newer; use \`--since "5 min ago"\`. \`systemctl enable --now chrony\`, step the clock with \`chronyc -a makestep\` (repeat until it has a source), and restart the kubelet.`,
    },
  ]),
};

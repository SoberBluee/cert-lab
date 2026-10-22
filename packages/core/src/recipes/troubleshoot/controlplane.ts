import { createNs, nsField } from '../types';
import { KUBELET_CONFIG, waitNotReady, waitReady } from './nodes';
import type { FaultCategory } from './types';

export const M = '/etc/kubernetes/manifests';
const KUBELET_CONF = '/etc/kubernetes/kubelet.conf';

/** Answers without kubectl, so it works while the API server is down. */
export const readyz = `curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true`;

export const apiDown = `for _ in $(seq 1 90); do
  [[ "$(${readyz})" != ok ]] && exit 0
  sleep 2
done
echo "the API server is still healthy" >&2
exit 1`;

export const CP_PODS = [
  'controlplane=True',
  ...['etcd', 'kube-apiserver', 'kube-controller-manager', 'kube-scheduler'].map((c) => `${c}-controlplane=True`),
].join(' ');

/**
 * Static Pods keep their last reported status when the kubelet stops, so they only count while
 * node controlplane itself is Ready.
 */
export const cpPods = `{ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\\n"}{end}' | sort; } | xargs`;

/** A restarted API server can sit in CrashLoopBackOff for a few minutes, hence the long waits. */
export const waitHealthy = (ns: string) => `for _ in $(seq 1 240); do
  [[ "$(${readyz})" == ok ]] && break
  sleep 2
done
for _ in $(seq 1 120); do
  [[ "$(${cpPods} 2>/dev/null || true)" == "${CP_PODS}" ]] && break
  sleep 3
done
kubectl -n "${ns}" rollout status deployment/web --timeout=300s`;

const podReady = (component: string) =>
  `kubectl -n kube-system get pod ${component}-controlplane -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true`;

/** The kubelet notices a changed manifest within about 20s and replaces the static pod. */
const componentDown = (component: string) => `for _ in $(seq 1 60); do
  [[ "$(${podReady(component)})" != True ]] && break
  sleep 3
done
[[ "$(${podReady(component)})" != True ]] || { echo "${component} is still Ready" >&2; exit 1; }
sleep 5`;

/**
 * Runs web before the API breaks. In a layered question the scheduler or controller manager may
 * already be down, and then nothing would ever roll out: scale only.
 */
export const scaleUp = (ns: string) => `kubectl -n "${ns}" scale deployment/web --replicas=2
if [[ "$(${podReady('kube-scheduler')})" == True && "$(${podReady('kube-controller-manager')})" == True ]]; then
  kubectl -n "${ns}" rollout status deployment/web --timeout=240s
fi`;

/** `sed -E` over a file, then proof that it changed. */
export const edit = (file: string, expr: string, proof: string) => `sed -i -E '${expr}' ${file}
grep -qE -- '${proof}' ${file} || { echo "could not modify ${file}" >&2; exit 1; }`;

const waitPending = (ns: string) => `sleep 15
[[ "$(kubectl -n "${ns}" get deployment web -o jsonpath='{.status.readyReplicas}')" != 2 ]] || { echo "web is still running" >&2; exit 1; }`;

const PKI = '/etc/kubernetes/pki';
export const ETCDCTL = `ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 --cacert=${PKI}/etcd/ca.crt --cert=${PKI}/etcd/server.crt --key=${PKI}/etcd/server.key`;
/** The node's apt etcdctl (3.4) restores snapshots in a format etcd 3.6+ cannot read; the etcd image ships a matching etcdutl. */
export const INSTALL_ETCDUTL = 'command -v etcdutl >/dev/null || install -m 755 "/proc/$(pgrep -xo etcd)/root/usr/local/bin/etcdutl" /usr/local/bin/etcdutl';

/** kubectl as system:masters: RBAC does not apply, so it works on an etcd that lost the cluster's RoleBindings. */
const masterKubectl = `kubectl --kubeconfig "$( [[ -f /etc/kubernetes/super-admin.conf ]] && echo /etc/kubernetes/super-admin.conf || echo /etc/kubernetes/admin.conf )"`;

/** A flag of a static Pod manifest that can point at a file that does not exist. */
interface FileFlag {
  /** The flag without its dashes; also a value of the fault's hidden variable. */
  flag: string;
  good: string;
  bad: string;
}

/** Points the flag that hidden variable `pick` names at its missing file (`to: 'bad'`), or back. */
const fileCase = (manifest: string, pick: string, flags: FileFlag[], to: 'bad' | 'good') => `case "${pick}" in
${flags
  .map((f) => {
    const [from, dest] = to === 'bad' ? [f.good, f.bad] : [f.bad, f.good];
    return `  ${f.flag})\n${edit(manifest, `s#^([[:space:]]*- --${f.flag}=)${from}$#\\1${dest}#`, `- --${f.flag}=${dest}$`).replace(/^/gm, '    ')}\n    ;;`;
  })
  .join('\n')}
  *) echo "unknown flag ${pick}" >&2; exit 1 ;;
esac`;

/** Every flag of the family and its real file, for the solution: the rolled one is named above it. */
const fileTable = (flags: FileFlag[]) => flags.map((f) => `- \`--${f.flag}\`: \`${f.good}\` (broken: \`${f.bad}\`)`).join('\n');

const APISERVER_FILES: FileFlag[] = [
  { flag: 'etcd-certfile', good: `${PKI}/apiserver-etcd-client.crt`, bad: `${PKI}/etcd/apiserver-etcd-client.crt` },
  { flag: 'etcd-keyfile', good: `${PKI}/apiserver-etcd-client.key`, bad: `${PKI}/etcd/apiserver-etcd-client.key` },
  { flag: 'tls-private-key-file', good: `${PKI}/apiserver.key`, bad: `${PKI}/apiserver.pem` },
  { flag: 'service-account-key-file', good: `${PKI}/sa.pub`, bad: `${PKI}/sa.pem` },
];
const ETCD_FILES: FileFlag[] = [
  { flag: 'cert-file', good: `${PKI}/etcd/server.crt`, bad: `${PKI}/etcd/server.cert` },
  { flag: 'key-file', good: `${PKI}/etcd/server.key`, bad: `${PKI}/etcd/server.pem` },
  { flag: 'trusted-ca-file', good: `${PKI}/etcd/ca.crt`, bad: `${PKI}/etcd/ca.pem` },
];
const CM_FILES: FileFlag[] = [
  { flag: 'kubeconfig', good: '/etc/kubernetes/controller-manager.conf', bad: '/etc/kubernetes/controller-manager.config' },
  { flag: 'service-account-private-key-file', good: `${PKI}/sa.key`, bad: `${PKI}/sa.pem` },
];
const SCHED_CONFIG = '/etc/kubernetes/sched-config.yaml';

/**
 * Which flag a "missing file" fault breaks, rolled per question: one fault per component teaches the
 * lesson once, and the flag still varies. Only scripts and the solution see these.
 */
export const FILE_PICKS = {
  APISERVER_FILE: APISERVER_FILES.map((f) => f.flag),
  ETCD_FILE: ETCD_FILES.map((f) => f.flag),
  SCHEDULER_FILE: ['kubeconfig', 'config'],
  CM_FILE: CM_FILES.map((f) => f.flag),
};

export const controlPlaneCategory: FaultCategory = {
  id: 'controlplane',
  name: 'Control plane',
  description: 'A control plane component on the controlplane node is broken: the API server, etcd, the scheduler, the controller manager or the kubelet.',
  track: 'cluster',
  domain: 'troubleshooting',
  difficulty: 3,
  minutes: 12,
  points: 8,
  tags: ['troubleshooting', 'control-plane', 'static-pod', 'etcd', 'kubelet'],
  disruptive: true,
  breaksApi: true,
  settleSeconds: 60,
  fields: [nsField(['ops', 'core', 'platform', 'controlplane', 'etcd-lab', 'apiserver', 'scheduler', 'controller', 'cluster', 'mgmt'])],
  shell: ({ NS }) => ({
    title: 'Control plane after maintenance',
    text: `After a maintenance window on the control plane, the cluster misbehaves. Fix it so that the API server answers, the control plane components on \`controlplane\` all run \`Ready\`, every node is \`Ready\`, and Deployment \`web\` in namespace \`${NS}\` runs \`2\` ready replicas.

Do not change the Deployment, and leave only the four control plane manifests in \`${M}\`.`,
    spec: `- \`etcd\`, \`kube-apiserver\`, \`kube-controller-manager\` and \`kube-scheduler\` run as static Pods from \`${M}\`, with the flags, paths and images kubeadm wrote
- the kubelet on \`controlplane\` uses \`${KUBELET_CONF}\` and \`staticPodPath: ${M}\``,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: ${NS}
spec:
  replicas: 0
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          resources:
            requests: { cpu: 10m, memory: 16Mi }
EOF`,
    checks: [
      {
        id: 'api-ready',
        description: 'the API server reports ready',
        type: 'kubectl',
        run: 'kubectl get --raw /readyz',
        expect: { equals: 'ok' },
        weight: 2,
        retrySeconds: 120,
      },
      {
        id: 'components',
        description: 'node controlplane and its etcd, kube-apiserver, kube-controller-manager and kube-scheduler are Ready',
        type: 'kubectl',
        run: cpPods,
        expect: { equals: CP_PODS },
        weight: 2,
        retrySeconds: 120,
      },
      {
        id: 'nodes-ready',
        description: 'every node is Ready',
        type: 'kubectl',
        run: `kubectl get nodes -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\\n"}{end}' | sort -u | xargs`,
        expect: { equals: 'True' },
        weight: 1,
        retrySeconds: 90,
      },
      {
        id: 'web-ready',
        description: 'web runs 2 ready replicas',
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment web -o jsonpath='{.spec.replicas}/{.status.readyReplicas}'`,
        expect: { equals: '2/2' },
        weight: 2,
        retrySeconds: 120,
      },
      {
        id: 'manifests',
        description: `${M} holds only the four control plane manifests`,
        type: 'ssh',
        node: 'controlplane',
        run: `ls ${M} | sort | xargs`,
        expect: { equals: 'etcd.yaml kube-apiserver.yaml kube-controller-manager.yaml kube-scheduler.yaml' },
        weight: 1,
      },
    ],
    hints: [
      'Start with the symptom: does kubectl answer at all? If it does, kubectl get nodes and kubectl -n kube-system get pods show which component is unhealthy; Pending or missing Pods point at the scheduler or the controller manager.',
      'Without the API, on controlplane: crictl ps -a, then crictl logs <container-id> shows why a static Pod keeps exiting. journalctl -u kubelet shows Pods the kubelet cannot even start.',
      `Static Pod manifests live in ${M}; the kubelet restarts a component when its manifest changes. Check every flag, path and image against what exists (ls /etc/kubernetes/pki, crictl images).`,
      `If no control plane container runs at all, or controlplane itself is NotReady: systemctl status kubelet, journalctl -u kubelet -n 50, and the paths in ${KUBELET_CONF} and ${KUBELET_CONFIG}.`,
    ],
  }),
  // The scheduler or controller manager breaks first, while the API still answers; the API server
  // or etcd breaks second. Both fixes are file edits, so their order does not matter.
  hidden: FILE_PICKS,
  layers: [
    {
      name: 'the scheduler or the controller manager',
      faults: [
        'scheduler-command',
        'scheduler-missing-file',
        'scheduler-image-tag',
        'scheduler-manifest-removed',
        'scheduler-manifest-yaml',
        'controller-manager-missing-file',
        'controller-manager-command',
      ],
    },
    {
      name: 'the API server or etcd',
      faults: [
        'apiserver-etcd-port',
        'apiserver-etcd-flags',
        'apiserver-missing-file',
        'apiserver-admission-plugin',
        'apiserver-authz-mode',
        'apiserver-probe-port',
        'apiserver-manifest-removed',
        'apiserver-manifest-copy',
        'apiserver-advertise-address',
        'etcd-missing-file',
        'etcd-client-urls',
        'etcd-image-tag',
        'etcd-restore-half-done',
        'kubelet-static-pod-path',
      ],
    },
  ],
  faults: ({ NS, APISERVER_FILE, ETCD_FILE, SCHEDULER_FILE, CM_FILE }, state) => [
    {
      id: 'apiserver-missing-file',
      label: 'An API server flag points at a file that does not exist',
      break: `${scaleUp(NS)}
${fileCase(`${M}/kube-apiserver.yaml`, APISERVER_FILE, APISERVER_FILES, 'bad')}`,
      settle: apiDown,
      fix: fileCase(`${M}/kube-apiserver.yaml`, APISERVER_FILE, APISERVER_FILES, 'good'),
      wait: waitHealthy(NS),
      explain: `In this run \`--${APISERVER_FILE}\` in \`${M}/kube-apiserver.yaml\` names a file that does not exist, so the API server exits at startup and kubectl gets \`connection refused\`. Without the API, read the container's last words on the node: \`crictl ps -a | grep kube-apiserver\`, then \`crictl logs <id>\` ends with "no such file or directory" and the path. \`ls ${PKI}\` (and \`${PKI}/etcd\`) shows where the file really is. Every flag this fault can break, with its real file:

${fileTable(APISERVER_FILES)}`,
    },
    {
      id: 'etcd-missing-file',
      label: 'An etcd flag points at a file that does not exist',
      break: `${scaleUp(NS)}
${fileCase(`${M}/etcd.yaml`, ETCD_FILE, ETCD_FILES, 'bad')}`,
      settle: apiDown,
      fix: fileCase(`${M}/etcd.yaml`, ETCD_FILE, ETCD_FILES, 'good'),
      wait: waitHealthy(NS),
      explain: `In this run \`--${ETCD_FILE}\` in \`${M}/etcd.yaml\` names a file that does not exist. etcd exits at startup and the API server loses its storage with it: kubectl fails, and the kube-apiserver logs only show etcd connection errors. Follow them one component further: \`crictl ps -a | grep etcd\` and \`crictl logs <id>\` of the etcd container name the missing file; \`ls ${PKI}/etcd\` shows the real one. Every flag this fault can break:

${fileTable(ETCD_FILES)}`,
    },
    {
      id: 'scheduler-missing-file',
      label: 'A scheduler flag points at a file that does not exist',
      break: `case "${SCHEDULER_FILE}" in
  kubeconfig)
${edit(`${M}/kube-scheduler.yaml`, 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\\.conf$#\\1.config#', '- --kubeconfig=/etc/kubernetes/scheduler.config$').replace(/^/gm, '    ')}
    ;;
  config)
    sed -i -E '/^[[:space:]]*- kube-scheduler$/a\\    - --config=${SCHED_CONFIG}' ${M}/kube-scheduler.yaml
    grep -qE -- '- --config=${SCHED_CONFIG.replace(/\./g, '\\.')}$' ${M}/kube-scheduler.yaml || { echo "could not set scheduler --config" >&2; exit 1; }
    ;;
  *) echo "unknown flag ${SCHEDULER_FILE}" >&2; exit 1 ;;
esac
${componentDown('kube-scheduler')}
kubectl -n "${NS}" scale deployment/web --replicas=2`,
      settle: waitPending(NS),
      fix: `case "${SCHEDULER_FILE}" in
  kubeconfig)
${edit(`${M}/kube-scheduler.yaml`, 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\\.config$#\\1.conf#', '- --kubeconfig=/etc/kubernetes/scheduler.conf$').replace(/^/gm, '    ')}
    ;;
  config)
    sed -i -E '\\#^[[:space:]]*- --config=${SCHED_CONFIG}$#d' ${M}/kube-scheduler.yaml
    ! grep -qE -- '- --config=' ${M}/kube-scheduler.yaml || { echo "could not remove scheduler --config" >&2; exit 1; }
    ;;
esac`,
      wait: waitHealthy(NS),
      explain: `In this run the scheduler's \`--${SCHEDULER_FILE}\` flag in \`${M}/kube-scheduler.yaml\` names a file that does not exist, so the scheduler exits at startup and the new \`web\` Pods stay \`Pending\` with no scheduling events. \`kubectl -n kube-system logs kube-scheduler-controlplane\` (or \`crictl logs\`) names the file. The two ways this fault breaks the scheduler:

- \`--kubeconfig\` points at \`/etc/kubernetes/scheduler.config\`; \`ls /etc/kubernetes\` shows the real \`scheduler.conf\`
- an added \`--config=${SCHED_CONFIG}\`, a scheduler configuration that was never written: remove the flag (kubeadm's scheduler needs no \`--config\`), or write the file`,
    },
    {
      id: 'controller-manager-missing-file',
      label: 'A controller manager flag points at a file that does not exist',
      break: `${fileCase(`${M}/kube-controller-manager.yaml`, CM_FILE, CM_FILES, 'bad')}
${componentDown('kube-controller-manager')}
kubectl -n "${NS}" scale deployment/web --replicas=2`,
      settle: waitPending(NS),
      fix: fileCase(`${M}/kube-controller-manager.yaml`, CM_FILE, CM_FILES, 'good'),
      wait: waitHealthy(NS),
      explain: `In this run \`--${CM_FILE}\` in \`${M}/kube-controller-manager.yaml\` names a file that does not exist. The controller manager exits at startup, so \`web\` is scaled to 2 but no ReplicaSet creates Pods: \`kubectl get deploy\` shows 0 of 2 and there are no Pods at all, which tells it apart from a broken scheduler (Pods that stay \`Pending\`). Its logs name the missing file. Every flag this fault can break:

${fileTable(CM_FILES)}`,
    },
    {
      id: 'apiserver-authz-mode',
      label: 'API server authorization mode is misspelled',
      break: `${scaleUp(NS)}
${edit(`${M}/kube-apiserver.yaml`, 's#^([[:space:]]*- --authorization-mode=)Node,RBAC$#\\1Node,RABC#', '- --authorization-mode=Node,RABC$')}`,
      settle: apiDown,
      fix: edit(`${M}/kube-apiserver.yaml`, 's#^([[:space:]]*- --authorization-mode=)Node,RABC$#\\1Node,RBAC#', '- --authorization-mode=Node,RBAC$'),
      wait: waitHealthy(NS),
      explain: `\`--authorization-mode\` in \`${M}/kube-apiserver.yaml\` is \`Node,RABC\`. The API server rejects the unknown mode at startup and exits, so kubectl gets \`connection refused\`. \`crictl logs\` of the last kube-apiserver container names the bad value. Set it back to \`Node,RBAC\`.`,
    },
    {
      id: 'apiserver-probe-port',
      label: "The API server's liveness and startup probes check the wrong port",
      break: `${scaleUp(NS)}
sed -n -E '/^    livenessProbe:$/,/^    [a-zA-Z]/ s/^[[:space:]]+port: (.*)$/\\1/p' ${M}/kube-apiserver.yaml | head -1 > "${state}.probe-port"
[[ -s "${state}.probe-port" ]] || { echo "could not read the probe port" >&2; exit 1; }
for probe in livenessProbe startupProbe; do
  sed -i -E '/^    '"$probe"':$/,/^    [a-zA-Z]/ s/^([[:space:]]+port: ).*$/\\16444/' ${M}/kube-apiserver.yaml
done
[[ "$(grep -cE '^[[:space:]]+port: 6444$' ${M}/kube-apiserver.yaml)" == 2 ]] || { echo "could not move the probes" >&2; exit 1; }`,
      // The API keeps answering until the startup probe gives up (about 4 minutes), then restarts in a loop.
      settle: `for _ in $(seq 1 60); do
  kubectl -n kube-system get events --field-selector involvedObject.name=kube-apiserver-controlplane,reason=Unhealthy -o jsonpath='{.items[*].message}' 2>/dev/null | grep -q ':6444' && exit 0
  sleep 3
done
echo "the API server's probes still pass" >&2
exit 1`,
      fix: `orig="$(cat "${state}.probe-port")"
for probe in livenessProbe startupProbe; do
  sed -i -E '/^    '"$probe"':$/,/^    [a-zA-Z]/ s/^([[:space:]]+port: )6444$/\\1'"$orig"'/' ${M}/kube-apiserver.yaml
done
! grep -qE '^[[:space:]]+port: 6444$' ${M}/kube-apiserver.yaml || { echo "could not restore the probes" >&2; exit 1; }`,
      wait: waitHealthy(NS),
      explain: `The \`livenessProbe\` and \`startupProbe\` of \`${M}/kube-apiserver.yaml\` check port \`6444\`, where nothing listens. The API server itself is fine, so kubectl works at first and the logs are clean; but the startup probe never passes, the Pod never turns Ready, and after about four minutes the kubelet kills the container and starts it again, over and over. The evidence is in the kubelet, not the component: \`kubectl -n kube-system describe pod kube-apiserver-controlplane\` lists \`Unhealthy\` events for probes to \`:6444\`, and \`crictl ps -a\` shows the restarts. Point both probes back at the port the readiness probe uses (\`probe-port\`, 6443).`,
    },
    {
      id: 'apiserver-manifest-copy',
      label: 'A second copy of the API server manifest',
      break: `${scaleUp(NS)}
sed -E 's#^(  name: )kube-apiserver$#\\1kube-apiserver-new#' ${M}/kube-apiserver.yaml > ${M}/kube-apiserver-new.yaml
grep -qE '^  name: kube-apiserver-new$' ${M}/kube-apiserver-new.yaml || { echo "could not write the copy" >&2; exit 1; }`,
      settle: `for _ in $(seq 1 60); do
  kubectl -n kube-system get pod kube-apiserver-new-controlplane >/dev/null 2>&1 && exit 0
  sleep 3
done
echo "the copy never started" >&2
exit 1`,
      fix: `rm -f ${M}/kube-apiserver-new.yaml`,
      wait: `for _ in $(seq 1 60); do
  kubectl -n kube-system get pod kube-apiserver-new-controlplane >/dev/null 2>&1 || break
  sleep 3
done
${waitHealthy(NS)}`,
      explain: `\`${M}\` holds \`kube-apiserver-new.yaml\`, an edited copy of the API server manifest with the Pod name \`kube-apiserver-new\`. The kubelet runs every manifest in that directory, so it starts a second API server, which cannot bind \`6443\` ("address already in use") and crash-loops as \`kube-apiserver-new-controlplane\`; kubectl still works through the first one. Static Pods are not deleted with kubectl: remove the extra file (keep backups outside \`${M}\`).`,
    },
    {
      id: 'etcd-restore-half-done',
      label: 'Half-finished etcd restore: etcd starts on an empty data directory',
      break: `${scaleUp(NS)}
${INSTALL_ETCDUTL}
${ETCDCTL} snapshot save /var/tmp/cka-etcd-snapshot.db >/dev/null
rm -rf /var/lib/etcd-restore
etcdutl snapshot restore /var/tmp/cka-etcd-snapshot.db --data-dir /var/lib/etcd-restore >/dev/null 2>&1
${edit(`${M}/etcd.yaml`, 's#^([[:space:]]*- --data-dir=)/var/lib/etcd$#\\1/var/lib/etcd-restore#', '- --data-dir=/var/lib/etcd-restore$')}
# What a restart of the control plane after a restore does: the API server reconnects to the new, empty etcd.
for _ in $(seq 1 60); do
  [[ "$(crictl ps --name '^etcd$' -q 2>/dev/null | head -1)" != "" ]] && crictl inspect "$(crictl ps --name '^etcd$' -q | head -1)" 2>/dev/null | grep -q -- '--data-dir=/var/lib/etcd-restore' && break
  sleep 2
done
crictl ps --name kube-apiserver -q | xargs -r crictl stop >/dev/null 2>&1 || true`,
      settle: `for _ in $(seq 1 120); do
  if [[ "$(${readyz})" == ok ]] && ! ${masterKubectl} get namespace "${NS}" >/dev/null 2>&1; then exit 0; fi
  sleep 3
done
echo "the API server still sees the cluster's data" >&2
exit 1`,
      fix: `old="$(crictl ps --name '^etcd$' -q | head -1)"
${edit(`${M}/etcd.yaml`, 's#^([[:space:]]*- --data-dir=)/var/lib/etcd-restore$#\\1/var/lib/etcd#', '- --data-dir=/var/lib/etcd$')}
${edit(`${M}/etcd.yaml`, 's#^([[:space:]]*path: )/var/lib/etcd$#\\1/var/lib/etcd-restore#', 'path: /var/lib/etcd-restore$')}
for _ in $(seq 1 60); do
  new="$(crictl ps --name '^etcd$' -q | head -1)"
  [[ -n "$new" && "$new" != "$old" ]] && break
  sleep 2
done
crictl ps --name kube-apiserver -q | xargs -r crictl stop`,
      wait: `for _ in $(seq 1 120); do
  ${masterKubectl} get namespace "${NS}" >/dev/null 2>&1 && break
  sleep 3
done
${waitHealthy(NS)}`,
      explain: `Someone restored an etcd snapshot into \`/var/lib/etcd-restore\` and then changed only \`--data-dir\` in \`${M}/etcd.yaml\`. But etcd runs in a container, and \`--data-dir\` is a path inside it: the \`etcd-data\` volume still mounts the host's \`/var/lib/etcd\` at \`/var/lib/etcd\`, so \`/var/lib/etcd-restore\` is an empty directory in the container and etcd starts a brand-new, empty cluster. The API answers, but everything is gone: namespaces, Deployments, and the kubeadm RoleBinding that makes \`admin.conf\` an admin, so kubectl says \`Forbidden\` (\`/etc/kubernetes/super-admin.conf\` still works). The kubelets then stop the Pods the API no longer lists.

Finish the restore the kubeadm way: keep \`--data-dir=/var/lib/etcd\` and point the \`etcd-data\` volume's \`hostPath\` at \`/var/lib/etcd-restore\`. Once etcd has restarted on the restored data, restart the API server too (\`crictl stop\` its container; the kubelet starts a new one), so it does not serve what it cached from the empty etcd.`,
    },
    {
      id: 'apiserver-etcd-port',
      label: 'API server talks to the etcd peer port',
      break: `${scaleUp(NS)}
${edit(`${M}/kube-apiserver.yaml`, 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2379$#\\1:2380#', '- --etcd-servers=https://127.0.0.1:2380$')}`,
      settle: apiDown,
      fix: edit(`${M}/kube-apiserver.yaml`, 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\\1:2379#', '- --etcd-servers=https://127.0.0.1:2379$'),
      wait: waitHealthy(NS),
      explain: `\`--etcd-servers\` in \`${M}/kube-apiserver.yaml\` points at port \`2380\`, etcd's peer port, instead of the client port \`2379\`. The API server cannot reach its storage and keeps exiting, so kubectl fails. \`crictl logs\` of the kube-apiserver container shows the etcd connection errors; \`--listen-client-urls\` in \`etcd.yaml\` shows the right port.`,
    },
    {
      id: 'apiserver-etcd-flags',
      label: 'API server etcd flag name, scheme and CA are wrong',
      break: `${scaleUp(NS)}
sed -i -E 's#^([[:space:]]*- --etcd-servers=)https://127.0.0.1:2379$#\\1http://127.0.0.1:2379#' ${M}/kube-apiserver.yaml
sed -i -E 's#^([[:space:]]*- --)etcd-servers=#\\1etcd-server=#' ${M}/kube-apiserver.yaml
grep -qE -- '- --etcd-server=http://127.0.0.1:2379$' ${M}/kube-apiserver.yaml || { echo "could not break --etcd-servers" >&2; exit 1; }
sed -i -E 's#^([[:space:]]*- --etcd-cafile=)/etc/kubernetes/pki/etcd/ca.crt$#\\1/etc/kubernetes/pki/ca.crt#' ${M}/kube-apiserver.yaml
grep -qE -- '- --etcd-cafile=/etc/kubernetes/pki/ca.crt$' ${M}/kube-apiserver.yaml || { echo "could not break --etcd-cafile" >&2; exit 1; }`,
      settle: apiDown,
      fix: `sed -i -E 's#^([[:space:]]*- --)etcd-server=#\\1etcd-servers=#' ${M}/kube-apiserver.yaml
sed -i -E 's#^([[:space:]]*- --etcd-servers=)http://127.0.0.1:2379$#\\1https://127.0.0.1:2379#' ${M}/kube-apiserver.yaml
sed -i -E 's#^([[:space:]]*- --etcd-cafile=)/etc/kubernetes/pki/ca.crt$#\\1/etc/kubernetes/pki/etcd/ca.crt#' ${M}/kube-apiserver.yaml`,
      wait: waitHealthy(NS),
      explain: `\`--etcd-servers\` was renamed to \`--etcd-server\` (singular), downgraded to \`http://\`, and \`--etcd-cafile\` points at the cluster CA instead of \`/etc/kubernetes/pki/etcd/ca.crt\`. The API server cannot talk to etcd and keeps exiting. \`crictl logs\` of kube-apiserver and a side-by-side with \`etcd.yaml\` show the correct flag name, \`https\`, and etcd CA path.`,
    },
    {
      id: 'scheduler-command',
      label: 'Typo in the scheduler command',
      break: `${edit(`${M}/kube-scheduler.yaml`, 's#^([[:space:]]*)- kube-scheduler$#\\1- kube-schedular#', '- kube-schedular$')}
${componentDown('kube-scheduler')}
kubectl -n "${NS}" scale deployment/web --replicas=2`,
      settle: waitPending(NS),
      fix: edit(`${M}/kube-scheduler.yaml`, 's#^([[:space:]]*)- kube-schedular$#\\1- kube-scheduler#', '- kube-scheduler$'),
      wait: waitHealthy(NS),
      explain: `The command in \`${M}/kube-scheduler.yaml\` runs \`kube-schedular\`, a binary that does not exist, so the scheduler never starts and new Pods stay \`Pending\` with no events. \`kubectl -n kube-system describe pod kube-scheduler-controlplane\` shows the failing command.`,
    },
    {
      id: 'kubelet-client-cert',
      label: 'controlplane kubelet client certificate path is wrong',
      break: `${scaleUp(NS)}
${edit(KUBELET_CONF, 's#^([[:space:]]*client-certificate: /var/lib/kubelet/pki/)kubelet-client-current.pem$#\\1kubelet-client.pem#', 'client-certificate: /var/lib/kubelet/pki/kubelet-client.pem$')}
systemctl restart kubelet || true`,
      settle: waitNotReady('controlplane'),
      fix: `${edit(KUBELET_CONF, 's#^([[:space:]]*client-certificate: /var/lib/kubelet/pki/)kubelet-client.pem$#\\1kubelet-client-current.pem#', 'client-certificate: /var/lib/kubelet/pki/kubelet-client-current.pem$')}
systemctl restart kubelet`,
      wait: `${waitReady('controlplane')}
${waitHealthy(NS)}`,
      explain: `\`client-certificate\` in \`${KUBELET_CONF}\` points at \`/var/lib/kubelet/pki/kubelet-client.pem\`, which does not exist, so the kubelet on controlplane cannot authenticate and exits. The node turns \`NotReady\` while the static pods keep running. \`journalctl -u kubelet\` shows the missing file; \`ls /var/lib/kubelet/pki\` shows \`kubelet-client-current.pem\`. Fix the path and restart the kubelet.`,
    },
    {
      id: 'kubelet-static-pod-path',
      label: 'controlplane kubelet watches the wrong static pod directory',
      break: `${scaleUp(NS)}
${edit(KUBELET_CONFIG, `s#^staticPodPath: ${M}$#staticPodPath: /etc/kubernetes/manifest#`, '^staticPodPath: /etc/kubernetes/manifest$')}
systemctl restart kubelet || true`,
      settle: apiDown,
      fix: `${edit(KUBELET_CONFIG, `s#^staticPodPath: /etc/kubernetes/manifest$#staticPodPath: ${M}#`, `^staticPodPath: ${M}$`)}
systemctl restart kubelet`,
      wait: waitHealthy(NS),
      explain: `\`staticPodPath\` in \`${KUBELET_CONFIG}\` is \`/etc/kubernetes/manifest\`, a directory that does not exist. The kubelet runs, but it finds no static pod manifests and stops etcd, the API server, the scheduler and the controller manager, so kubectl fails. \`crictl ps\` on controlplane shows no control plane containers, and \`journalctl -u kubelet\` mentions the missing path. Set it back to \`${M}\` and restart the kubelet.`,
    },
    {
      id: 'scheduler-image-tag',
      label: 'Scheduler image tag does not exist',
      break: `grep -oE 'kube-scheduler:[^[:space:]"]+' ${M}/kube-scheduler.yaml | head -1 > "${state}.scheduler-image"
${edit(`${M}/kube-scheduler.yaml`, 's#^([[:space:]]*image: [^[:space:]]*kube-scheduler:)[^[:space:]]+$#\\1v0.0.0#', 'kube-scheduler:v0\\.0\\.0$')}
${componentDown('kube-scheduler')}
kubectl -n "${NS}" scale deployment/web --replicas=2`,
      settle: waitPending(NS),
      fix: `sed -i -E "s#kube-scheduler:v0\\.0\\.0#$(cat "${state}.scheduler-image")#" ${M}/kube-scheduler.yaml
grep -q 'kube-scheduler:v0\\.0\\.0' ${M}/kube-scheduler.yaml && { echo "could not restore the scheduler image" >&2; exit 1; }`,
      wait: waitHealthy(NS),
      explain: `The image in \`${M}/kube-scheduler.yaml\` has tag \`v0.0.0\`, which does not exist. The kubelet cannot pull it (\`ErrImagePull\` in \`kubectl -n kube-system describe pod kube-scheduler-controlplane\`, or \`crictl ps -a\` shows no scheduler), so new Pods stay \`Pending\`. Use the same tag as the other control plane images (\`grep image: ${M}/*.yaml\`, or \`kubeadm config images list\`).`,
    },
    {
      id: 'apiserver-admission-plugin',
      label: 'API server enables an admission plugin that does not exist',
      break: `${scaleUp(NS)}
${edit(`${M}/kube-apiserver.yaml`, 's#^([[:space:]]*- --enable-admission-plugins=[^[:space:]]+)$#\\1,PodSecurityPolicy#', '- --enable-admission-plugins=.*,PodSecurityPolicy$')}`,
      settle: apiDown,
      fix: edit(`${M}/kube-apiserver.yaml`, 's#^([[:space:]]*- --enable-admission-plugins=[^[:space:]]+),PodSecurityPolicy$#\\1#', '- --enable-admission-plugins=[^,[:space:]]+(,[^,[:space:]]+)*$'),
      wait: waitHealthy(NS),
      explain: `\`--enable-admission-plugins\` in \`${M}/kube-apiserver.yaml\` adds \`PodSecurityPolicy\`, a plugin that was removed from Kubernetes in 1.25. The API server exits at startup ("unknown admission plugins"), so kubectl gets \`connection refused\`. \`crictl ps -a\` and \`crictl logs\` of the last kube-apiserver container show the error. Remove the plugin from the list.`,
    },
    {
      id: 'apiserver-manifest-removed',
      label: 'API server static Pod manifest is missing',
      break: `${scaleUp(NS)}
mv ${M}/kube-apiserver.yaml /var/tmp/cka-kube-apiserver.yaml
[[ ! -f ${M}/kube-apiserver.yaml ]]`,
      settle: apiDown,
      fix: `mv /var/tmp/cka-kube-apiserver.yaml ${M}/kube-apiserver.yaml
[[ -f ${M}/kube-apiserver.yaml ]]`,
      wait: waitHealthy(NS),
      explain: `\`${M}/kube-apiserver.yaml\` was moved aside, so the kubelet no longer runs the API server and nothing listens on \`6443\`. \`ls ${M}\` is missing the file; a copy sits in \`/var/tmp/cka-kube-apiserver.yaml\`. Put it back.`,
    },
    {
      id: 'etcd-client-urls',
      label: 'etcd listens on the wrong client port',
      break: `${scaleUp(NS)}
sed -i -E '/--listen-client-urls=/s/:2379/:2378/g' ${M}/etcd.yaml
sed -i -E '/--advertise-client-urls=/s/:2379/:2378/g' ${M}/etcd.yaml
grep -qE -- '--listen-client-urls=.*:2378' ${M}/etcd.yaml || { echo "could not break listen-client-urls" >&2; exit 1; }
grep -qE -- '--advertise-client-urls=.*:2378' ${M}/etcd.yaml || { echo "could not break advertise-client-urls" >&2; exit 1; }`,
      settle: apiDown,
      fix: `sed -i -E '/--listen-client-urls=/s/:2378/:2379/g' ${M}/etcd.yaml
sed -i -E '/--advertise-client-urls=/s/:2378/:2379/g' ${M}/etcd.yaml`,
      wait: waitHealthy(NS),
      explain: `\`--listen-client-urls\` and \`--advertise-client-urls\` in \`${M}/etcd.yaml\` use port \`2378\` instead of \`2379\`. The API server still dials \`2379\` (\`--etcd-servers\` in \`kube-apiserver.yaml\`), so it cannot reach etcd and keeps exiting. Put both URLs back on \`2379\`.`,
    },
    {
      id: 'etcd-image-tag',
      label: 'etcd image tag does not exist',
      break: `${scaleUp(NS)}
grep -oE 'etcd:[^[:space:]"]+' ${M}/etcd.yaml | head -1 > "${state}.etcd-image"
${edit(`${M}/etcd.yaml`, 's#^([[:space:]]*image: [^[:space:]]*etcd:)[^[:space:]]+$#\\1v0.0.0#', 'etcd:v0\\.0\\.0$')}`,
      settle: apiDown,
      fix: `sed -i -E "s#etcd:v0\\.0\\.0#$(cat "${state}.etcd-image")#" ${M}/etcd.yaml
grep -q 'etcd:v0\\.0\\.0' ${M}/etcd.yaml && { echo "could not restore the etcd image" >&2; exit 1; }`,
      wait: waitHealthy(NS),
      explain: `The image in \`${M}/etcd.yaml\` has tag \`v0.0.0\`, which does not exist. The kubelet cannot pull etcd (\`ErrImagePull\`), so storage never comes up and the API server fails. Use the same tag as before (\`cat\` a backup, or match \`kubeadm config images list\`).`,
    },
    {
      id: 'scheduler-manifest-removed',
      label: 'Scheduler static Pod manifest is missing',
      break: `mv ${M}/kube-scheduler.yaml /var/tmp/cka-kube-scheduler.yaml
[[ ! -f ${M}/kube-scheduler.yaml ]]
${componentDown('kube-scheduler')}
kubectl -n "${NS}" scale deployment/web --replicas=2`,
      settle: waitPending(NS),
      fix: `mv /var/tmp/cka-kube-scheduler.yaml ${M}/kube-scheduler.yaml
[[ -f ${M}/kube-scheduler.yaml ]]`,
      wait: waitHealthy(NS),
      explain: `\`${M}/kube-scheduler.yaml\` was moved aside, so the kubelet stops the scheduler and new Pods stay \`Pending\`. \`ls ${M}\` is missing the file; restore it from \`/var/tmp/cka-kube-scheduler.yaml\`.`,
    },
    {
      id: 'scheduler-manifest-yaml',
      label: 'Scheduler manifest is not valid YAML',
      break: `${edit(`${M}/kube-scheduler.yaml`, 's#^    image: (registry\\.k8s\\.io/kube-scheduler:)#   image: \\1#', '^   image: registry.k8s.io/kube-scheduler:')}
${componentDown('kube-scheduler')}
kubectl -n "${NS}" scale deployment/web --replicas=2`,
      settle: waitPending(NS),
      fix: edit(`${M}/kube-scheduler.yaml`, 's#^   image: (registry\\.k8s\\.io/kube-scheduler:)#    image: \\1#', '^    image: registry.k8s.io/kube-scheduler:'),
      wait: waitHealthy(NS),
      explain: `The \`image:\` line in \`${M}/kube-scheduler.yaml\` is indented by three spaces instead of four, so the kubelet cannot parse the manifest and drops the scheduler Pod. New \`web\` Pods stay \`Pending\`. \`journalctl -u kubelet\` reports the bad manifest; fix the indentation.`,
    },
    {
      id: 'controller-manager-command',
      label: 'Typo in the controller manager command',
      break: `${edit(`${M}/kube-controller-manager.yaml`, 's#^([[:space:]]*)- kube-controller-manager$#\\1- kube-controller-managr#', '- kube-controller-managr$')}
${componentDown('kube-controller-manager')}
kubectl -n "${NS}" scale deployment/web --replicas=2`,
      settle: waitPending(NS),
      fix: edit(`${M}/kube-controller-manager.yaml`, 's#^([[:space:]]*)- kube-controller-managr$#\\1- kube-controller-manager#', '- kube-controller-manager$'),
      wait: waitHealthy(NS),
      explain: `The command in \`${M}/kube-controller-manager.yaml\` runs \`kube-controller-managr\`, which does not exist, so the controller manager never starts. The Deployment is scaled but no ReplicaSet creates Pods. Fix the binary name in the manifest.`,
    },
    {
      id: 'kubelet-api-server-port',
      label: 'controlplane kubelet kubeconfig uses the wrong API port',
      break: `${scaleUp(NS)}
${edit(KUBELET_CONF, 's#^([[:space:]]*server: https://.*):6443$#\\1:6444#', 'server: https://.*:6444$')}
systemctl restart kubelet || true`,
      settle: waitNotReady('controlplane'),
      fix: `${edit(KUBELET_CONF, 's#^([[:space:]]*server: https://.*):6444$#\\1:6443#', 'server: https://.*:6443$')}
systemctl restart kubelet`,
      wait: `${waitReady('controlplane')}
${waitHealthy(NS)}`,
      explain: `\`${KUBELET_CONF}\` on controlplane points the kubelet at port \`6444\`, so heartbeats fail with \`connection refused\` and the node turns \`NotReady\` (static pods may still look Ready). Set \`server:\` back to port \`6443\` and restart the kubelet.`,
    },
    {
      id: 'apiserver-advertise-address',
      label: 'API server advertise-address is a non-routable IP',
      break: `${scaleUp(NS)}
grep -oE -- '--advertise-address=[^[:space:]]+' ${M}/kube-apiserver.yaml | head -1 | sed 's/^--advertise-address=//' > "${state}.advertise"
${edit(`${M}/kube-apiserver.yaml`, 's#^([[:space:]]*- --advertise-address=).*$#\\1not-a-valid-ip#', '- --advertise-address=not-a-valid-ip$')}`,
      settle: apiDown,
      fix: `addr=$(cat "${state}.advertise")
sed -i -E 's#^([[:space:]]*- --advertise-address=).*$#\\1'"$addr"'#' ${M}/kube-apiserver.yaml
grep -qE -- '- --advertise-address='"$addr"'$' ${M}/kube-apiserver.yaml || { echo "could not restore advertise-address" >&2; exit 1; }`,
      wait: waitHealthy(NS),
      explain: `\`--advertise-address\` in \`${M}/kube-apiserver.yaml\` is \`not-a-valid-ip\`, so the API server exits at startup. Set it back to the control plane node's IPv4 address (\`ip -4 addr\` or the value that was in the manifest before).`,
    },
  ],
};

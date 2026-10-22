import { createNs, nameField, nsField, selectField, type RecipeCheck } from '../types';
import { CP_PODS, cpPods, ETCDCTL, INSTALL_ETCDUTL, readyz } from '../troubleshoot/controlplane';
import { noPod } from './shared';
import type { Builder, CreateCtx, FollowUp, Addon } from './types';

const PKI = '/etc/kubernetes/pki';
const APISERVER_CRT = `${PKI}/apiserver.crt`;
const STATE = '/root/.cka';

const ssh = (c: Omit<Extract<RecipeCheck, { type: 'ssh' }>, 'type' | 'node'>): RecipeCheck => ({ type: 'ssh', node: 'controlplane', ...c });

const clusterCtx = (v: CreateCtx['v'], what: string, title: string, intro: string): CreateCtx => ({
  v,
  ns: '',
  ref: '',
  podPath: '',
  title,
  intro,
  bullets: [],
  steps: [],
  manifests: [],
  podSpec: noPod(what),
  container: noPod(what),
  checks: [],
  hints: [],
  setup: [],
  solution: [],
});

/** Until the API server answers and the four control plane Pods are Ready. */
const waitControlPlane = `for _ in $(seq 1 240); do
  [[ "$(${readyz})" == ok ]] && break
  sleep 2
done
for _ in $(seq 1 120); do
  [[ "$(${cpPods} 2>/dev/null || true)" == "${CP_PODS}" ]] && break
  sleep 3
done`;

const cpChecks = (): RecipeCheck[] => [
  {
    id: 'api',
    description: 'The API server answers',
    type: 'kubectl',
    run: 'kubectl get --raw /readyz',
    expect: { equals: 'ok' },
    weight: 1,
    retrySeconds: 180,
  },
  {
    id: 'control-plane',
    description: 'node controlplane is Ready, and etcd, kube-apiserver, kube-controller-manager and kube-scheduler run Ready on it',
    type: 'kubectl',
    run: cpPods,
    expect: { equals: CP_PODS },
    weight: 1,
    retrySeconds: 180,
  },
];

const dirOf = (path: string) => `"$(dirname "${path}")"`;

const statusTable: Addon = {
  id: 'status-table',
  key: 'STATUS',
  name: 'Save its status',
  description: 'Also save the snapshot status, as a table, to a file.',
  points: 1,
  fields: [selectField('FILE', 'Status file', ['/opt/backups/etcd-status.txt', '/root/etcd-status.txt', '/srv/etcd/status.txt'])],
  apply(ctx, { FILE }) {
    const { BACKUP } = ctx.v;
    ctx.bullets.push(`Save the status of the snapshot, as printed by \`etcdctl snapshot status\` in table format, to \`${FILE}\` on \`controlplane\`.`);
    ctx.setup.push(`rm -f "${FILE}"`);
    ctx.checks.push(
      ssh({
        id: 'status-table',
        description: `${FILE} holds the snapshot status as a table`,
        run: `rev=$(ETCDCTL_API=3 etcdctl snapshot status "${BACKUP}" -w json 2>/dev/null | jq -r .revision); grep -q "TOTAL KEYS" "${FILE}" 2>/dev/null && grep -qw -- "$rev" "${FILE}" && echo table || echo missing`,
        expect: { equals: 'table' },
        weight: 1,
      }),
    );
    ctx.solution.push(`mkdir -p ${dirOf(FILE)}\nETCDCTL_API=3 etcdctl snapshot status "${BACKUP}" -w table > "${FILE}"`);
    ctx.hints.push('etcdctl snapshot status <file> -w table prints the hash, revision, total keys and size.');
  },
};

export const etcdBackupBuilder: Builder = {
  id: 'etcd-backup',
  name: 'etcd backup',
  description: 'Snapshot the etcd database of the cluster to a file, talking TLS to the etcd static Pod.',
  domain: 'cluster-architecture',
  difficulty: 2,
  minutes: 6,
  points: 5,
  tags: ['etcd', 'backup'],
  track: 'cluster',
  fields: [
    selectField(
      'BACKUP',
      'Snapshot file',
      [
        '/opt/backups/etcd.db',
        '/srv/etcd/snapshot.db',
        '/root/etcd-backup.db',
        '/var/backups/etcd-snap.db',
        '/opt/etcd/backup.db',
        '/mnt/backups/etcd.db',
        '/home/ubuntu/etcd.db',
        '/var/lib/etcd-backups/snap.db',
      ],
      { randomizeByDefault: true },
    ),
    nameField('MARKER', 'ConfigMap the snapshot must contain', [
      'backup-marker',
      'pre-backup',
      'audit-mark',
      'snap-token',
      'etcd-check',
      'restore-proof',
      'cluster-stamp',
      'backup-id',
      'snap-label',
      'verify-cm',
    ]),
  ],
  addons: [statusTable],
  followUps: [],
  build(v) {
    const { BACKUP, MARKER } = v;
    const ctx = clusterCtx(
      v,
      'etcd backup',
      'Back up etcd',
      `Take a snapshot of the cluster's etcd database and save it on \`controlplane\` at \`${BACKUP}\`. etcd runs as a static Pod on \`controlplane\` and only accepts TLS clients; the snapshot must include ConfigMap \`${MARKER}\` in namespace \`default\`.`,
    );
    ctx.setup.push(`rm -f "${BACKUP}"
mkdir -p ${dirOf(BACKUP)}
kubectl -n default create configmap "${MARKER}" --from-literal=created="$(date -Is)" --dry-run=client -o yaml | kubectl apply -f - >/dev/null`);
    ctx.checks.push(
      ssh({
        id: 'snapshot-size',
        description: `${BACKUP} exists and is larger than 1 MB`,
        run: `stat -c %s "${BACKUP}" 2>/dev/null || echo 0`,
        expect: { gte: 1000000 },
        weight: 2,
      }),
      ssh({
        id: 'snapshot-valid',
        description: `${BACKUP} is a valid etcd snapshot`,
        run: `ETCDCTL_API=3 etcdctl snapshot status "${BACKUP}" -w json 2>/dev/null | jq -r '.totalKey > 0'`,
        expect: { equals: 'true' },
        weight: 2,
      }),
      ssh({
        id: 'snapshot-fresh',
        description: `The snapshot contains ConfigMap ${MARKER}`,
        run: `grep -qa -- "/registry/configmaps/default/${MARKER}" "${BACKUP}" 2>/dev/null && echo yes || echo no`,
        expect: { equals: 'yes' },
        weight: 1,
      }),
    );
    ctx.solution.push(`mkdir -p ${dirOf(BACKUP)}\n${ETCDCTL} snapshot save "${BACKUP}"`);
    ctx.hints.push(
      'The endpoint and certificate paths are in /etc/kubernetes/manifests/etcd.yaml: --listen-client-urls, --trusted-ca-file, --cert-file and --key-file.',
      'ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 --cacert=... --cert=... --key=... snapshot save <file>',
    );
    return ctx;
  },
};

export const etcdRestoreBuilder: Builder = {
  id: 'etcd-restore',
  name: 'etcd restore',
  description: 'Roll the cluster back to an etcd snapshot: restore it into a new data directory and point the etcd static Pod at it.',
  domain: 'cluster-architecture',
  difficulty: 3,
  minutes: 12,
  points: 7,
  tags: ['etcd', 'restore', 'static-pod'],
  track: 'cluster',
  breaksApi: true,
  fields: [
    nsField(['ledger', 'records', 'archive', 'finance', 'history', 'audit', 'vault', 'snapshots', 'recovery', 'state']),
    selectField(
      'SNAPSHOT',
      'Snapshot file',
      [
        '/opt/backups/etcd-snapshot.db',
        '/var/backups/etcd.db',
        '/srv/etcd/backup.db',
        '/opt/etcd/restore-snap.db',
        '/mnt/backups/etcd-snap.db',
        '/root/etcd-snapshot.db',
        '/var/lib/etcd-backups/cluster.db',
        '/home/ubuntu/etcd-snap.db',
      ],
      { randomizeByDefault: true },
    ),
    selectField(
      'DATADIR',
      'New data directory',
      [
        '/var/lib/etcd-restore',
        '/var/lib/etcd-from-backup',
        '/var/lib/etcd-new',
        '/var/lib/etcd-recovered',
        '/var/lib/etcd-rolled-back',
        '/var/lib/etcd-snap',
        '/data/etcd-restore',
        '/opt/etcd-data',
      ],
      { randomizeByDefault: true },
    ),
  ],
  addons: [],
  followUps: [],
  build(v) {
    const { NS, SNAPSHOT, DATADIR } = v;
    const ctx = clusterCtx(
      v,
      'etcd restore',
      'Restore etcd',
      `A snapshot of etcd was saved on \`controlplane\` at \`${SNAPSHOT}\`. Since then, ConfigMap \`after-backup\` was created in namespace \`${NS}\` by mistake. Roll the cluster back to the snapshot:`,
    );
    ctx.bullets.push(
      `restore the snapshot into the new data directory \`${DATADIR}\``,
      `make the etcd static Pod on \`controlplane\` use \`${DATADIR}\``,
      'afterwards the API server answers, and the control plane Pods run Ready',
      'restoring discards everything created after the snapshot, so do this question before the others',
    );
    ctx.setup.push(`${createNs(NS)}
kubectl -n "${NS}" create configmap before-backup --from-literal=state=kept --dry-run=client -o yaml | kubectl apply -f - >/dev/null
rm -rf "${DATADIR}"
${INSTALL_ETCDUTL}
mkdir -p ${dirOf(SNAPSHOT)}
${ETCDCTL} snapshot save "${SNAPSHOT}" >/dev/null
kubectl -n "${NS}" create configmap after-backup --from-literal=state=lost --dry-run=client -o yaml | kubectl apply -f - >/dev/null`);
    ctx.checks.push(
      ...cpChecks(),
      {
        id: 'rolled-back',
        description: `Namespace ${NS} holds before-backup but no longer after-backup`,
        type: 'kubectl',
        run: `kubectl -n "${NS}" get configmaps -o jsonpath='{range .items[*]}{.metadata.name}{"\\n"}{end}' | grep -v kube-root-ca.crt | sort | xargs`,
        expect: { equals: 'before-backup' },
        weight: 3,
        retrySeconds: 120,
      },
      ssh({
        id: 'data-dir',
        description: `etcd runs from ${DATADIR}`,
        run: `test -d "${DATADIR}/member" && grep -q -- "${DATADIR}" /etc/kubernetes/manifests/etcd.yaml && echo restored || echo missing`,
        expect: { equals: 'restored' },
        weight: 2,
      }),
    );
    ctx.solution.push(`etcdutl snapshot restore "${SNAPSHOT}" --data-dir "${DATADIR}"
sed -i -E "s#path: /var/lib/etcd\\$#path: ${DATADIR}#" /etc/kubernetes/manifests/etcd.yaml
grep -q -- "path: ${DATADIR}" /etc/kubernetes/manifests/etcd.yaml
${waitControlPlane}
[[ "$(${readyz})" == ok ]]`);
    ctx.hints.push(
      'etcdutl snapshot restore <file> --data-dir <dir> writes a new data directory; it does not need the endpoint or certificates.',
      'In /etc/kubernetes/manifests/etcd.yaml, change the hostPath of the etcd-data volume. The kubelet recreates the Pod, and the API server can take a minute or two to answer again.',
    );
    return ctx;
  },
};

const RENEW_FP = `${STATE}/apiserver-fingerprint`;
const fingerprint = (crt: string) => `openssl x509 -in ${crt} -noout -fingerprint -sha256`;

const renew: FollowUp = {
  id: 'renew',
  key: 'RENEW',
  name: 'Renew it',
  description: 'Renew the API server certificate with kubeadm and restart the API server so that it serves the new one.',
  points: 2,
  fields: [],
  replacesChecks: ['expiry'],
  apply(ctx) {
    const { EXPIRY } = ctx.v;
    ctx.steps.push(`Then renew the API server's serving certificate with \`kubeadm\`, and make the running API server serve the renewed certificate.`);
    ctx.checks.push(
      ssh({
        id: 'expiry',
        description: `${EXPIRY} holds the expiry date of the certificate`,
        run: `[ "$(xargs < "${EXPIRY}" 2>/dev/null)" = "$(xargs < ${STATE}/apiserver-enddate)" ] && echo match || echo differs`,
        expect: { equals: 'match' },
        weight: 2,
      }),
      ssh({
        id: 'renewed',
        description: `${APISERVER_CRT} was renewed`,
        run: `[ "$(${fingerprint(APISERVER_CRT)})" != "$(cat ${RENEW_FP})" ] && echo renewed || echo old`,
        expect: { equals: 'renewed' },
        weight: 1,
      }),
      ssh({
        id: 'serving',
        description: 'The API server serves the renewed certificate',
        run: `[ "$(echo | openssl s_client -connect 127.0.0.1:6443 2>/dev/null | openssl x509 -noout -fingerprint -sha256)" = "$(${fingerprint(APISERVER_CRT)})" ] && echo serving || echo stale`,
        expect: { equals: 'serving' },
        weight: 1,
        retrySeconds: 120,
      }),
    );
    ctx.solution.push(`kubeadm certs renew apiserver
mv /etc/kubernetes/manifests/kube-apiserver.yaml /root/kube-apiserver.yaml
for _ in $(seq 1 60); do
  [[ -z "$(crictl ps -q --name kube-apiserver 2>/dev/null)" ]] && break
  sleep 2
done
mv /root/kube-apiserver.yaml /etc/kubernetes/manifests/kube-apiserver.yaml
${waitControlPlane}`);
    ctx.hints.push(
      'kubeadm certs check-expiration lists every certificate; kubeadm certs renew apiserver renews one.',
      'The API server reads its certificate at start: move its manifest out of /etc/kubernetes/manifests, wait for the container to stop, then move it back.',
    );
  },
};

const csrUser: Addon = {
  id: 'user-csr',
  key: 'USER',
  name: 'User via CSR',
  description: 'A new user authenticated by a client certificate signed through a CertificateSigningRequest, with read access to Pods.',
  points: 5,
  fields: [
    nameField('NAME', 'User name', ['jane', 'auditor', 'dev-anna', 'sam', 'ops-kim', 'dev-lee', 'qa-rita', 'sre-tom', 'admin-pat', 'eng-maya']),
    nsField(['team-a', 'qa', 'payments', 'developers', 'platform', 'security', 'finance', 'support', 'engineering', 'product']),
    selectField('KUBECONFIG', 'Kubeconfig file', ['/opt/certs/user.kubeconfig', '/root/user.kubeconfig'], { randomizeByDefault: true }),
  ],
  apply(ctx, { NAME, NS, KUBECONFIG }) {
    ctx.bullets.push(
      `Create a client certificate for user \`${NAME}\` through a CertificateSigningRequest named \`${NAME}\` (signer \`kubernetes.io/kube-apiserver-client\`), and approve it.`,
      `Write a kubeconfig for \`${NAME}\` to \`${KUBECONFIG}\` on \`controlplane\`, using the cluster's API server and CA.`,
      `Let \`${NAME}\` get, list and watch Pods in namespace \`${NS}\`, and nothing more, with a Role and RoleBinding named \`${NAME}-pods\`.`,
    );
    ctx.setup.push(`${createNs(NS)}
kubectl delete csr "${NAME}" --ignore-not-found >/dev/null
rm -f "${KUBECONFIG}"`);
    const as = `kubectl --kubeconfig "${KUBECONFIG}"`;
    ctx.checks.push(
      {
        id: 'csr-approved',
        description: `CSR ${NAME} is approved for the kube-apiserver-client signer`,
        type: 'kubectl',
        run: `kubectl get csr "${NAME}" -o jsonpath='{.status.conditions[?(@.type=="Approved")].status}/{.spec.signerName}'`,
        expect: { equals: 'True/kubernetes.io/kube-apiserver-client' },
        weight: 1,
      },
      ssh({
        id: 'user-auth',
        description: `${KUBECONFIG} authenticates as ${NAME}`,
        run: `${as} auth whoami -o jsonpath='{.status.userInfo.username}' 2>/dev/null || true`,
        expect: { equals: NAME },
        weight: 2,
      }),
      ssh({
        id: 'user-can-list',
        description: `${NAME} can list Pods in ${NS}`,
        run: `${as} -n "${NS}" auth can-i list pods 2>/dev/null || true`,
        expect: { equals: 'yes' },
        weight: 1,
      }),
      ssh({
        id: 'user-cannot-delete',
        description: `${NAME} cannot delete Pods in ${NS}`,
        run: `${as} -n "${NS}" auth can-i delete pods 2>/dev/null || true`,
        expect: { equals: 'no' },
        weight: 1,
      }),
    );
    ctx.solution.push(`d=$(mktemp -d)
openssl genrsa -out "$d/user.key" 2048
openssl req -new -key "$d/user.key" -subj "/CN=${NAME}" -out "$d/user.csr"
kubectl apply -f - <<EOF
apiVersion: certificates.k8s.io/v1
kind: CertificateSigningRequest
metadata:
  name: ${NAME}
spec:
  request: $(base64 -w0 < "$d/user.csr")
  signerName: kubernetes.io/kube-apiserver-client
  usages: [client auth]
EOF
kubectl certificate approve "${NAME}"
for _ in $(seq 1 30); do
  [[ -n "$(kubectl get csr "${NAME}" -o jsonpath='{.status.certificate}')" ]] && break
  sleep 1
done
kubectl get csr "${NAME}" -o jsonpath='{.status.certificate}' | base64 -d > "$d/user.crt"
mkdir -p ${dirOf(KUBECONFIG)}
server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
kubectl config --kubeconfig "${KUBECONFIG}" set-cluster kubernetes --server="$server" --certificate-authority=${PKI}/ca.crt --embed-certs=true
kubectl config --kubeconfig "${KUBECONFIG}" set-credentials "${NAME}" --client-certificate="$d/user.crt" --client-key="$d/user.key" --embed-certs=true
kubectl config --kubeconfig "${KUBECONFIG}" set-context "${NAME}" --cluster=kubernetes --user="${NAME}" --namespace="${NS}"
kubectl config --kubeconfig "${KUBECONFIG}" use-context "${NAME}"
kubectl -n "${NS}" create role "${NAME}-pods" --verb=get,list,watch --resource=pods --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "${NS}" create rolebinding "${NAME}-pods" --role="${NAME}-pods" --user="${NAME}" --dry-run=client -o yaml | kubectl apply -f -
rm -rf "$d"`);
    ctx.hints.push(
      'openssl genrsa and openssl req -subj "/CN=<user>" make the key and request; the CSR spec.request is the base64 of the request on one line.',
      'kubectl certificate approve <name>, then read .status.certificate and base64 -d it; kubectl config --kubeconfig <file> set-cluster, set-credentials --embed-certs and set-context build the kubeconfig.',
    );
  },
};

export const certificatesBuilder: Builder = {
  id: 'certificates',
  name: 'Certificates',
  description: 'Inspect the kubeadm PKI: find when the API server certificate expires, renew it, or sign a new user in through a CSR.',
  domain: 'cluster-architecture',
  difficulty: 2,
  minutes: 5,
  points: 2,
  tags: ['certificates', 'pki', 'kubeadm'],
  track: 'cluster',
  fields: [selectField('EXPIRY', 'Expiry date file', ['/opt/certs/apiserver-expiry.txt', '/root/apiserver-expiry.txt'], { randomizeByDefault: true })],
  addons: [csrUser],
  followUps: [renew],
  build(v) {
    const { EXPIRY } = v;
    const ctx = clusterCtx(
      v,
      'certificates',
      'Cluster certificates',
      `On \`controlplane\`, find when the API server's serving certificate expires. Write its expiry date to \`${EXPIRY}\`, exactly as \`openssl x509 -enddate\` prints it after \`notAfter=\` (for example \`Jan  1 00:00:00 2027 GMT\`).`,
    );
    ctx.setup.push(`rm -f "${EXPIRY}"
mkdir -p ${dirOf(EXPIRY)}
install -d -m 700 ${STATE}
openssl x509 -in ${APISERVER_CRT} -noout -enddate | cut -d= -f2 > ${STATE}/apiserver-enddate
${fingerprint(APISERVER_CRT)} > ${RENEW_FP}`);
    ctx.checks.push(
      ssh({
        id: 'expiry',
        description: `${EXPIRY} holds the expiry date of the certificate`,
        run: `[ "$(xargs < "${EXPIRY}" 2>/dev/null)" = "$(openssl x509 -in ${APISERVER_CRT} -noout -enddate | cut -d= -f2 | xargs)" ] && echo match || echo differs`,
        expect: { equals: 'match' },
        weight: 2,
      }),
    );
    ctx.solution.push(`mkdir -p ${dirOf(EXPIRY)}\nopenssl x509 -in ${APISERVER_CRT} -noout -enddate | cut -d= -f2 > "${EXPIRY}"`);
    ctx.hints.push(
      'The API server certificate is /etc/kubernetes/pki/apiserver.crt (see --tls-cert-file in its manifest).',
      'kubeadm certs check-expiration shows the same date in another format; openssl x509 -in <crt> -noout -enddate prints the exact text.',
    );
    return ctx;
  },
};

const CALICO = '/root/calico.yaml';

export const installClusterBuilder: Builder = {
  id: 'install-cluster',
  name: 'Install a cluster',
  description: 'Build a cluster from scratch with kubeadm on nodes that have only the tools installed: init, network plugin, worker joins.',
  domain: 'cluster-architecture',
  difficulty: 3,
  minutes: 25,
  points: 9,
  tags: ['kubeadm', 'install', 'cni'],
  track: 'cluster',
  base: 'bare',
  solo: true,
  fields: [
    selectField('CIDR', 'Pod network CIDR', ['10.244.0.0/16', '192.168.0.0/16'], { randomizeByDefault: true }),
    selectField('WORKERS', 'Workers to join', ['2', '1'], { pool: undefined }),
  ],
  addons: [],
  followUps: [],
  build(v) {
    const { CIDR, WORKERS } = v;
    const workers = WORKERS === '1' ? ['worker-1'] : ['worker-1', 'worker-2'];
    const nodes = ['controlplane', ...workers];
    const joined = workers.map((w) => `\`${w}\``).join(' and ');
    const ctx = clusterCtx(
      v,
      'install',
      'Install a cluster',
      `The nodes \`controlplane\`, \`worker-1\` and \`worker-2\` have containerd, kubeadm, kubelet and kubectl installed, but no cluster. Build one with kubeadm:`,
    );
    ctx.bullets.push(
      `initialise the control plane on \`controlplane\` with pod network CIDR \`${CIDR}\``,
      `make \`kubectl\` work for user \`ubuntu\` on \`controlplane\` through \`~/.kube/config\``,
      `install Calico from \`${CALICO}\` (already downloaded) with its IP pool set to \`${CIDR}\``,
      `join ${joined} as worker node${workers.length > 1 ? 's' : ''}`,
      'every node is Ready and CoreDNS runs',
    );
    ctx.checks.push(
      {
        id: 'nodes',
        description: `${nodes.join(', ')} are Ready`,
        type: 'kubectl',
        run: `kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\\n"}{end}' | sort | xargs`,
        expect: { equals: nodes.map((n) => `${n}=True`).join(' ') },
        weight: 3,
        retrySeconds: 120,
      },
      {
        id: 'pod-cidr',
        description: `The cluster was initialised with pod network ${CIDR}`,
        type: 'kubectl',
        run: `kubectl -n kube-system get configmap kubeadm-config -o jsonpath='{.data.ClusterConfiguration}' | awk '/podSubnet:/ {print $2}'`,
        expect: { equals: CIDR },
        weight: 1,
      },
      {
        id: 'calico',
        description: `Calico runs on every node with IP pool ${CIDR}`,
        type: 'kubectl',
        run: `echo "$(kubectl -n kube-system get daemonset calico-node -o jsonpath='{.status.numberReady}') $(kubectl get ippools.crd.projectcalico.org -o jsonpath='{.items[*].spec.cidr}')"`,
        expect: { equals: `${nodes.length} ${CIDR}` },
        weight: 2,
        retrySeconds: 120,
      },
      {
        id: 'coredns',
        description: 'CoreDNS runs 2 ready replicas',
        type: 'kubectl',
        run: `kubectl -n kube-system get deployment coredns -o jsonpath='{.status.readyReplicas}'`,
        expect: { equals: '2' },
        weight: 2,
        retrySeconds: 120,
      },
      ssh({
        id: 'ubuntu-kubectl',
        description: 'kubectl works for user ubuntu on controlplane',
        run: `sudo -u ubuntu -H kubectl get --raw /readyz 2>/dev/null || true`,
        expect: { equals: 'ok' },
        weight: 1,
      }),
    );
    ctx.solution.push(`# Same as kubeadm init --pod-network-cidr ${CIDR} --node-name controlplane, with more time for a slow first start.
cat > /root/kubeadm-init.yaml <<EOF
apiVersion: kubeadm.k8s.io/v1beta4
kind: InitConfiguration
nodeRegistration:
  name: controlplane
timeouts:
  controlPlaneComponentHealthCheck: 10m0s
  kubernetesAPICall: 5m0s
---
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
kubernetesVersion: $(kubeadm version -o short)
networking:
  podSubnet: ${CIDR}
EOF
if ! kubeadm init --config /root/kubeadm-init.yaml; then
  kubeadm reset -f
  kubeadm init --config /root/kubeadm-init.yaml
fi
mkdir -p /home/ubuntu/.kube
cp /etc/kubernetes/admin.conf /home/ubuntu/.kube/config
chown -R ubuntu:ubuntu /home/ubuntu/.kube
export KUBECONFIG=/etc/kubernetes/admin.conf
sed -E -e 's|^( *)# - name: CALICO_IPV4POOL_CIDR|\\1- name: CALICO_IPV4POOL_CIDR|' -e "s|^( *)#   value: \\"192.168.0.0/16\\"|\\1  value: \\"${CIDR}\\"|" ${CALICO} > /root/calico-lab.yaml
kubectl apply -f /root/calico-lab.yaml
join="$(kubeadm token create --print-join-command)"
for n in ${workers.join(' ')}; do
  sudo -u ubuntu ssh -o StrictHostKeyChecking=accept-new "$n" "sudo $join --node-name $n"
done
kubectl wait --for=condition=Ready nodes --all --timeout=600s
kubectl -n kube-system rollout status daemonset/calico-node --timeout=600s
kubectl -n kube-system rollout status deployment/coredns --timeout=300s`);
    ctx.hints.push(
      'kubeadm init --pod-network-cidr <cidr> prints the kubeconfig commands and the kubeadm join command for the workers.',
      `In ${CALICO}, uncomment CALICO_IPV4POOL_CIDR and its value in the calico-node DaemonSet and set the CIDR, then kubectl apply -f it.`,
      'kubeadm token create --print-join-command prints a fresh join command; run it with sudo on each worker (ssh worker-1 from controlplane).',
    );
    return ctx;
  },
};

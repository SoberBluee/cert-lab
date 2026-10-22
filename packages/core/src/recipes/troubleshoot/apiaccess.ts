import { createNs, nsField } from '../types';
import { apiDown, CP_PODS, cpPods, edit, M, scaleUp, waitHealthy } from './controlplane';
import type { FaultCategory } from './types';

const APISERVER = `${M}/kube-apiserver.yaml`;
const USER_KUBECONFIGS = ['/root/.kube/config', '/home/ubuntu/.kube/config'];
const PKI = '/etc/kubernetes/pki';

/** Each kubeconfig as its owner: root can read any file, ubuntu only what it is allowed to. */
const userReadyz = `{ kubectl --kubeconfig /root/.kube/config get --raw /readyz 2>/dev/null || echo fail; echo; sudo -u ubuntu -H kubectl --kubeconfig /home/ubuntu/.kube/config get --raw /readyz 2>/dev/null || echo fail; echo; } | xargs`;

const userKubectlDown = `for _ in $(seq 1 30); do
  [[ "$(${userReadyz})" != "ok ok" ]] && exit 0
  sleep 2
done
echo "kubectl still works with the user kubeconfigs" >&2
exit 1`;

const setCa = (crt: string) => `for f in ${USER_KUBECONFIGS.join(' ')}; do
  kubectl config --kubeconfig "$f" set clusters.kubernetes.certificate-authority-data "$(base64 -w0 ${PKI}/${crt})" >/dev/null
done`;

const saveUserKubeconfigs = (state: string) => USER_KUBECONFIGS.map((f, i) => `cp -a ${f} "${state}.kubeconfig-${i}"`).join('\n');
const restoreUserKubeconfigs = (state: string) => USER_KUBECONFIGS.map((f, i) => `cp -a "${state}.kubeconfig-${i}" ${f}`).join('\n');

/** Runs `kubectl config <args>` against both user kubeconfigs; `$f` is the file. */
const configBoth = (args: string) => `for f in ${USER_KUBECONFIGS.join(' ')}; do
  kubectl config --kubeconfig "$f" ${args} >/dev/null
done`;

/** Server certificate flags of the API server that can point at a missing file, rolled per question. */
const CERT_FLAGS = [
  { flag: 'client-ca-file', good: `${PKI}/ca.crt`, bad: `${PKI}/ca.cert` },
  { flag: 'tls-cert-file', good: `${PKI}/apiserver.crt`, bad: `${PKI}/apiserver.cert` },
];

const certCase = (pick: string, to: 'bad' | 'good') => `case "${pick}" in
${CERT_FLAGS.map((f) => {
  const [from, dest] = to === 'bad' ? [f.good, f.bad] : [f.bad, f.good];
  return `  ${f.flag})\n${edit(APISERVER, `s#^([[:space:]]*- --${f.flag}=)${from}$#\\1${dest}#`, `- --${f.flag}=${dest}$`).replace(/^/gm, '    ')}\n    ;;`;
}).join('\n')}
  *) echo "unknown flag ${pick}" >&2; exit 1 ;;
esac`;

const serverPort = (from: number, to: number) =>
  USER_KUBECONFIGS.map((f) => edit(f, `s#^([[:space:]]*server: https://[^[:space:]]+):${from}$#\\1:${to}#`, `server: https://[^[:space:]]+:${to}$`)).join('\n');

export const apiAccessCategory: FaultCategory = {
  id: 'apiaccess',
  name: 'API access',
  description: 'kubectl on the controlplane stopped working after a certificate and configuration change: the API server or the client side is broken.',
  track: 'cluster',
  domain: 'troubleshooting',
  difficulty: 3,
  minutes: 12,
  points: 8,
  tags: ['troubleshooting', 'kubeconfig', 'kube-apiserver', 'static-pod', 'certificates'],
  disruptive: true,
  breaksApi: true,
  settleSeconds: 60,
  fields: [nsField(['ops', 'core', 'mgmt', 'control', 'api-lab', 'admin', 'cluster-ops', 'kube-system-lab', 'access', 'platform'])],
  hidden: { APISERVER_CERT: CERT_FLAGS.map((f) => f.flag) },
  // User kubeconfigs break first, while the API still answers; the API server breaks second.
  layers: [
    {
      name: 'the user kubeconfigs',
      faults: ['kubeconfig-server-port', 'kubeconfig-wrong-ca', 'kubeconfig-current-context', 'kubeconfig-client-key', 'kubeconfig-server-host', 'kubeconfig-permissions'],
    },
    { name: 'the API server', faults: ['apiserver-cert-file', 'apiserver-secure-port', 'apiserver-manifest-yaml'] },
  ],
  shell: ({ NS }) => ({
    title: 'kubectl stopped working',
    text: `\`kubectl\` on \`controlplane\` fails after a certificate and configuration change, for \`root\`, for \`ubuntu\`, or for both. Make \`kubectl\` work again as the cluster admin with \`/root/.kube/config\` and with \`/home/ubuntu/.kube/config\`, with the API server answering on \`https://controlplane:6443\`, every control plane component on \`controlplane\` \`Ready\`, and Deployment \`web\` in namespace \`${NS}\` running \`2\` ready replicas.

Do not regenerate any certificate, do not change the Deployment, and leave only the four control plane manifests in \`${M}\`.`,
    spec: `- \`${APISERVER}\` keeps the kubeadm flags: secure port \`6443\`, bind address \`0.0.0.0\`, and the CA, serving certificate and key from \`${PKI}\`
- both user kubeconfigs match \`/etc/kubernetes/admin.conf\`: server \`https://<controlplane-ip>:6443\`, the cluster CA, a matching client certificate and key, a current context that exists, and readable file permissions`,
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
        id: 'user-kubectl',
        description: 'kubectl works with /root/.kube/config and /home/ubuntu/.kube/config',
        type: 'kubectl',
        run: userReadyz,
        expect: { equals: 'ok ok' },
        weight: 2,
        retrySeconds: 60,
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
        id: 'web-ready',
        description: 'web runs 2 ready replicas',
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment web -o jsonpath='{.spec.replicas}/{.status.readyReplicas}'`,
        expect: { equals: '2/2' },
        weight: 1,
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
      'Read the exact kubectl error: "connection refused", "x509: certificate signed by unknown authority" and a hang point at different places.',
      'Is the API server up at all? curl -k https://127.0.0.1:6443/readyz, ss -ltnp | grep 6443, and crictl ps -a | grep kube-apiserver (as root).',
      `If the kube-apiserver container is missing or keeps exiting: crictl logs <container-id>, journalctl -u kubelet | grep -i apiserver, and compare the flags in ${APISERVER} with the files in ${PKI}.`,
      `If the API server is healthy, the kubeconfig is wrong: compare the server and certificate-authority-data in ~/.kube/config with /etc/kubernetes/admin.conf (kubectl config view --raw).`,
    ],
  }),
  faults: ({ NS, APISERVER_CERT }, state) => [
    {
      id: 'kubeconfig-server-port',
      label: 'User kubeconfigs point at the wrong port',
      break: `${scaleUp(NS)}\n${serverPort(6443, 6433)}`,
      settle: userKubectlDown,
      fix: serverPort(6433, 6443),
      wait: waitHealthy(NS),
      explain: `\`server:\` in \`/root/.kube/config\` and \`/home/ubuntu/.kube/config\` uses port \`6433\` instead of \`6443\`, so kubectl gets \`connection refused\` even though the API server is healthy (\`curl -k https://127.0.0.1:6443/readyz\` answers \`ok\`). Fix the port in both files, or copy \`/etc/kubernetes/admin.conf\` over them.`,
    },
    {
      id: 'kubeconfig-wrong-ca',
      label: 'User kubeconfigs trust the wrong CA',
      break: `${scaleUp(NS)}\n${setCa('front-proxy-ca.crt')}`,
      settle: userKubectlDown,
      fix: setCa('ca.crt'),
      wait: waitHealthy(NS),
      explain: `\`certificate-authority-data\` in both user kubeconfigs holds the front-proxy CA (\`${PKI}/front-proxy-ca.crt\`) instead of the cluster CA, so kubectl rejects the API server's certificate: \`x509: certificate signed by unknown authority\`. Put \`${PKI}/ca.crt\` back (\`kubectl config set clusters.kubernetes.certificate-authority-data $(base64 -w0 ${PKI}/ca.crt)\`), or copy \`/etc/kubernetes/admin.conf\` over them.`,
    },
    {
      id: 'apiserver-cert-file',
      label: 'An API server certificate flag points at a file that does not exist',
      break: `${scaleUp(NS)}
${certCase(APISERVER_CERT, 'bad')}`,
      settle: apiDown,
      fix: certCase(APISERVER_CERT, 'good'),
      wait: waitHealthy(NS),
      explain: `In this run \`--${APISERVER_CERT}\` in \`${APISERVER}\` names a file that does not exist, so the API server exits at startup and kubectl gets \`connection refused\`, while \`curl -k https://127.0.0.1:6443/readyz\` gets nothing either. \`crictl logs\` of the last kube-apiserver container names the missing file, and \`ls ${PKI}\` shows the real one. Every flag this fault can break:

${CERT_FLAGS.map((f) => `- \`--${f.flag}\`: \`${f.good}\` (broken: \`${f.bad}\`)`).join('\n')}`,
    },
    {
      id: 'apiserver-secure-port',
      label: 'API server listens on the wrong port',
      break: `${scaleUp(NS)}
${edit(APISERVER, 's#^([[:space:]]*- --secure-port=)6443$#\\16444#', '- --secure-port=6444$')}`,
      settle: apiDown,
      fix: edit(APISERVER, 's#^([[:space:]]*- --secure-port=)6444$#\\16443#', '- --secure-port=6443$'),
      wait: waitHealthy(NS),
      explain: `\`--secure-port\` in \`${APISERVER}\` is \`6444\`, so nothing answers on \`6443\`: kubectl, the kubelets and the other components get \`connection refused\`, and the API server's own probes (which target the \`probe-port\`, 6443) fail until the kubelet restarts it. \`ss -ltnp\` shows it listening on 6444. Set the port back to \`6443\`.`,
    },
    {
      id: 'apiserver-manifest-yaml',
      label: 'API server manifest is not valid YAML',
      break: `${scaleUp(NS)}
${edit(APISERVER, 's#^    image: (registry\\.k8s\\.io/kube-apiserver:)#   image: \\1#', '^   image: registry.k8s.io/kube-apiserver:')}`,
      settle: apiDown,
      fix: edit(APISERVER, 's#^   image: (registry\\.k8s\\.io/kube-apiserver:)#    image: \\1#', '^    image: registry.k8s.io/kube-apiserver:'),
      wait: waitHealthy(NS),
      explain: `The \`image:\` line in \`${APISERVER}\` is indented by three spaces instead of four, which makes the file invalid YAML. The kubelet cannot parse the manifest, so it drops the kube-apiserver static pod: no container at all in \`crictl ps -a\`, and \`journalctl -u kubelet\` reports the manifest it could not decode. Fix the indentation.`,
    },
    {
      id: 'kubeconfig-current-context',
      label: 'User kubeconfigs use a context that does not exist',
      break: `${scaleUp(NS)}
${configBoth('set current-context admin@production')}`,
      settle: userKubectlDown,
      fix: configBoth('use-context "$(kubectl config --kubeconfig "$f" get-contexts -o name | head -1)"'),
      wait: waitHealthy(NS),
      explain: `\`current-context\` in both user kubeconfigs is \`admin@production\`, which is not defined in them, so kubectl fails with "context was not found for specified context". The API server is healthy. \`kubectl config get-contexts\` lists the real context: switch back with \`kubectl config use-context <name>\` (as root and as ubuntu).`,
    },
    {
      id: 'kubeconfig-client-key',
      label: 'User kubeconfigs hold a key that does not match the certificate',
      break: `${scaleUp(NS)}
${saveUserKubeconfigs(state)}
${configBoth(`set "users.$(kubectl config --kubeconfig "$f" view -o jsonpath='{.users[0].name}')".client-key-data "$(base64 -w0 ${PKI}/apiserver-kubelet-client.key)"`)}`,
      settle: userKubectlDown,
      fix: restoreUserKubeconfigs(state),
      wait: waitHealthy(NS),
      explain: `\`client-key-data\` of the user in both user kubeconfigs is the key of \`${PKI}/apiserver-kubelet-client.key\`, which does not belong to the user's \`client-certificate-data\`. kubectl fails before it sends anything ("tls: private key does not match public key"). The admin credentials are intact in \`/etc/kubernetes/admin.conf\`: copy it over \`/root/.kube/config\` and \`/home/ubuntu/.kube/config\` (keeping ubuntu as the owner), or copy its \`client-key-data\` into them.`,
    },
    {
      id: 'kubeconfig-server-host',
      label: 'User kubeconfigs name an API host that no longer exists',
      break: `${scaleUp(NS)}
${saveUserKubeconfigs(state)}
${USER_KUBECONFIGS.map((f) => edit(f, 's#^([[:space:]]*server: https://)[^[:space:]]+$#\\1controlplane-old:6443#', 'server: https://controlplane-old:6443$')).join('\n')}`,
      settle: userKubectlDown,
      fix: restoreUserKubeconfigs(state),
      wait: waitHealthy(NS),
      explain: `\`server:\` in both user kubeconfigs is \`https://controlplane-old:6443\`, a name left over from before the node was renamed. Nothing resolves it, so kubectl fails with "no such host" while the API server is healthy (\`curl -k https://127.0.0.1:6443/readyz\`). Restore the real \`server:\` from \`/etc/kubernetes/admin.conf\`, or copy that file over the kubeconfigs.`,
    },
    {
      id: 'kubeconfig-permissions',
      label: "ubuntu's kubeconfig is owned by root and unreadable for ubuntu",
      break: `${scaleUp(NS)}
chown root:root /home/ubuntu/.kube/config
chmod 600 /home/ubuntu/.kube/config
! sudo -u ubuntu -H test -r /home/ubuntu/.kube/config || { echo "ubuntu can still read its kubeconfig" >&2; exit 1; }`,
      settle: userKubectlDown,
      fix: `chown ubuntu:ubuntu /home/ubuntu/.kube/config
chmod 600 /home/ubuntu/.kube/config`,
      wait: waitHealthy(NS),
      explain: `\`/home/ubuntu/.kube/config\` belongs to \`root\` with mode \`600\`, as happens after \`sudo cp /etc/kubernetes/admin.conf ~/.kube/config\` without the \`chown\` kubeadm prints. kubectl as root works; as ubuntu it fails with "permission denied" (\`ls -l ~/.kube/config\`). Give the file back to ubuntu: \`sudo chown ubuntu:ubuntu /home/ubuntu/.kube/config\`.`,
    },
  ],
};

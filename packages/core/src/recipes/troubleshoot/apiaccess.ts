import { createNs, nsField } from '../types';
import { apiDown, CP_PODS, cpPods, edit, M, scaleUp, waitHealthy } from './controlplane';
import type { FaultCategory } from './types';

const APISERVER = `${M}/kube-apiserver.yaml`;
const USER_KUBECONFIGS = ['/root/.kube/config', '/home/ubuntu/.kube/config'];
const PKI = '/etc/kubernetes/pki';

const userReadyz = `for f in ${USER_KUBECONFIGS.join(' ')}; do kubectl --kubeconfig "$f" get --raw /readyz 2>/dev/null || echo fail; echo; done | xargs`;

const userKubectlDown = `for _ in $(seq 1 30); do
  [[ "$(${userReadyz})" == "fail fail" ]] && exit 0
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
  // User kubeconfigs break first, while the API still answers; the API server breaks second.
  layers: [
    {
      name: 'the user kubeconfigs',
      faults: ['kubeconfig-server-port', 'kubeconfig-wrong-ca', 'kubeconfig-current-context', 'kubeconfig-client-key', 'kubeconfig-server-host', 'kubeconfig-permissions'],
    },
    { name: 'the API server', faults: ['apiserver-client-ca', 'apiserver-secure-port', 'apiserver-manifest-yaml', 'apiserver-tls-cert-path', 'apiserver-bind-address'] },
  ],
  shell: ({ NS }) => ({
    title: 'kubectl stopped working',
    text: `\`kubectl\` on \`controlplane\` fails for both \`root\` and \`ubuntu\` after a certificate and configuration change. Make \`kubectl\` work again as the cluster admin with \`/root/.kube/config\` and with \`/home/ubuntu/.kube/config\`, with the API server answering on \`https://controlplane:6443\`, every control plane component on \`controlplane\` \`Ready\`, and Deployment \`web\` in namespace \`${NS}\` running \`2\` ready replicas.

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
  faults: ({ NS }, state) => [
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
      id: 'apiserver-client-ca',
      label: 'API server client CA file path is wrong',
      break: `${scaleUp(NS)}
${edit(APISERVER, `s#^([[:space:]]*- --client-ca-file=${PKI}/ca)\\.crt$#\\1.cert#`, `- --client-ca-file=${PKI}/ca.cert$`)}`,
      settle: apiDown,
      fix: edit(APISERVER, `s#^([[:space:]]*- --client-ca-file=${PKI}/ca)\\.cert$#\\1.crt#`, `- --client-ca-file=${PKI}/ca.crt$`),
      wait: waitHealthy(NS),
      explain: `\`--client-ca-file\` in \`${APISERVER}\` points at \`${PKI}/ca.cert\`, which does not exist, so the API server exits at startup and kubectl gets \`connection refused\`. \`crictl logs\` of the last kube-apiserver container shows the missing file; \`ls ${PKI}\` shows \`ca.crt\`.`,
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
      id: 'apiserver-tls-cert-path',
      label: 'API server serving certificate path is wrong',
      break: `${scaleUp(NS)}
${edit(APISERVER, `s#^([[:space:]]*- --tls-cert-file=${PKI}/apiserver)\\.crt$#\\1.cert#`, `- --tls-cert-file=${PKI}/apiserver.cert$`)}`,
      settle: apiDown,
      fix: edit(APISERVER, `s#^([[:space:]]*- --tls-cert-file=${PKI}/apiserver)\\.cert$#\\1.crt#`, `- --tls-cert-file=${PKI}/apiserver.crt$`),
      wait: waitHealthy(NS),
      explain: `\`--tls-cert-file\` in \`${APISERVER}\` points at \`${PKI}/apiserver.cert\`, which does not exist, so the API server cannot load its serving certificate and exits at startup; kubectl gets \`connection refused\`. \`crictl logs\` of the last kube-apiserver container names the file, and \`ls ${PKI}\` shows \`apiserver.crt\`.`,
    },
    {
      id: 'kubeconfig-server-host',
      label: 'User kubeconfigs point at a host that is not listening',
      break: `${scaleUp(NS)}
${saveUserKubeconfigs(state)}
${USER_KUBECONFIGS.map((f) => edit(f, 's#^([[:space:]]*server: https://)[^[:space:]]+$#\\1127.0.0.1:1#', 'server: https://127.0.0.1:1$')).join('\n')}`,
      settle: userKubectlDown,
      fix: restoreUserKubeconfigs(state),
      wait: waitHealthy(NS),
      explain: `\`server:\` in both user kubeconfigs is \`https://127.0.0.1:1\`, where nothing listens, so kubectl gets \`connection refused\` while the API server is healthy on \`6443\` (\`curl -k https://127.0.0.1:6443/readyz\`). Restore the real \`server:\` from \`/etc/kubernetes/admin.conf\`, or copy that file over the kubeconfigs.`,
    },
    {
      id: 'apiserver-bind-address',
      label: 'API server binds only on a loopback alias',
      break: `${scaleUp(NS)}
if grep -qE -- '- --bind-address=' ${APISERVER}; then
  ${edit(APISERVER, 's#^([[:space:]]*- --bind-address=).*$#\\1127.0.0.2#', '- --bind-address=127.0.0.2$')}
else
  sed -i -E '/^[[:space:]]*- --secure-port=6443$/a\\    - --bind-address=127.0.0.2' ${APISERVER}
  grep -qE -- '- --bind-address=127.0.0.2$' ${APISERVER} || { echo "could not set bind-address" >&2; exit 1; }
fi`,
      settle: apiDown,
      fix: `sed -i -E 's#^([[:space:]]*- --bind-address=)127\\.0\\.0\\.2$#\\10.0.0.0#' ${APISERVER}
grep -qE -- '- --bind-address=0.0.0.0$' ${APISERVER} || { echo "could not restore bind-address" >&2; exit 1; }`,
      wait: waitHealthy(NS),
      explain: `\`--bind-address\` in \`${APISERVER}\` is \`127.0.0.2\`, so the API server does not accept connections on \`127.0.0.1:6443\` and kubectl gets \`connection refused\`. \`ss -ltnp\` shows it listening only on \`127.0.0.2\`. Set \`--bind-address\` back to \`0.0.0.0\`.`,
    },
    {
      id: 'kubeconfig-permissions',
      label: 'User kubeconfig files are mode 000',
      break: `${scaleUp(NS)}
for f in ${USER_KUBECONFIGS.join(' ')}; do
  cp -a "$f" "$f.cka-mode"
  chmod 000 "$f"
  [[ "$(stat -c '%a' "$f" 2>/dev/null || stat -f '%OLp' "$f")" == "0" ]] || [[ "$(stat -c '%a' "$f" 2>/dev/null || stat -f '%OLp' "$f")" == "000" ]] || { echo "could not chmod $f" >&2; exit 1; }
done`,
      settle: userKubectlDown,
      fix: `for f in ${USER_KUBECONFIGS.join(' ')}; do
  chmod 600 "$f"
  [[ -f "$f.cka-mode" ]] && chown --reference="$f.cka-mode" "$f" 2>/dev/null || true
done
chown ubuntu:ubuntu /home/ubuntu/.kube/config 2>/dev/null || true`,
      wait: waitHealthy(NS),
      explain: `\`/root/.kube/config\` and \`/home/ubuntu/.kube/config\` are mode \`000\`, so kubectl fails with "permission denied" even though the API server is healthy. \`chmod 600\` both files (and ensure ubuntu owns its copy).`,
    },
  ],
};

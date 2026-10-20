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

export const scaleUp = (ns: string) => `kubectl -n "${ns}" scale deployment/web --replicas=2
kubectl -n "${ns}" rollout status deployment/web --timeout=240s`;

/** `sed -E` over a file, then proof that it changed. */
export const edit = (file: string, expr: string, proof: string) => `sed -i -E '${expr}' ${file}
grep -qE -- '${proof}' ${file} || { echo "could not modify ${file}" >&2; exit 1; }`;

const waitPending = (ns: string) => `sleep 15
[[ "$(kubectl -n "${ns}" get deployment web -o jsonpath='{.status.readyReplicas}')" != 2 ]] || { echo "web is still running" >&2; exit 1; }`;

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
    text: `After a maintenance window on the control plane, the cluster misbehaves. Deployment \`web\` in namespace \`${NS}\` should run \`2\` ready replicas.

Find the problem and fix it so that:

- the API server answers, and \`etcd\`, \`kube-apiserver\`, \`kube-controller-manager\` and \`kube-scheduler\` run Ready on \`controlplane\`
- every node is \`Ready\`
- \`web\` runs \`2\` ready replicas
- \`/etc/kubernetes/manifests\` holds only the four control plane manifests

Do not change the Deployment.`,
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
      'kubectl get nodes and kubectl -n kube-system get pods: which component is unhealthy? If kubectl itself fails or hangs, the API server or etcd is down.',
      'Without the API, on controlplane: crictl ps -a, then crictl logs <container-id> shows why a static pod keeps exiting.',
      `Static pod manifests live in ${M}; the kubelet restarts a component when its manifest changes. Compare flags and paths with the files that exist (ls /etc/kubernetes/pki).`,
      `If controlplane itself is NotReady, or no control plane container runs at all: systemctl status kubelet, journalctl -u kubelet -n 50, and the paths in ${KUBELET_CONF} and ${KUBELET_CONFIG} (staticPodPath).`,
    ],
  }),
  faults: ({ NS }, state) => [
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
      id: 'apiserver-etcd-certfile',
      label: 'API server etcd client certificate path is wrong',
      break: `${scaleUp(NS)}
${edit(
  `${M}/kube-apiserver.yaml`,
  's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/apiserver-etcd-client.crt$#\\1/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt#',
  '- --etcd-certfile=/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$',
)}`,
      settle: apiDown,
      fix: edit(
        `${M}/kube-apiserver.yaml`,
        's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$#\\1/etc/kubernetes/pki/apiserver-etcd-client.crt#',
        '- --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt$',
      ),
      wait: waitHealthy(NS),
      explain: `\`--etcd-certfile\` in \`${M}/kube-apiserver.yaml\` points at \`/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt\`, which does not exist. The certificate lives one directory up, in \`/etc/kubernetes/pki/\`. The API server exits at startup with "no such file or directory", which \`crictl logs\` shows.`,
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
      id: 'etcd-cert-path',
      label: 'etcd server certificate path is wrong',
      break: `${scaleUp(NS)}
${edit(`${M}/etcd.yaml`, 's#^([[:space:]]*- --cert-file=/etc/kubernetes/pki/etcd/server)\\.crt$#\\1.cert#', '- --cert-file=/etc/kubernetes/pki/etcd/server.cert$')}`,
      settle: apiDown,
      fix: edit(
        `${M}/etcd.yaml`,
        's#^([[:space:]]*- --cert-file=/etc/kubernetes/pki/etcd/server)\\.cert$#\\1.crt#',
        '- --cert-file=/etc/kubernetes/pki/etcd/server.crt$',
      ),
      wait: waitHealthy(NS),
      explain: `\`--cert-file\` in \`${M}/etcd.yaml\` points at \`server.cert\` instead of \`server.crt\`. etcd exits at startup, and the API server loses its storage with it. kubectl fails, the kube-apiserver logs show etcd connection errors, and \`crictl logs\` of the etcd container shows the missing file.`,
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
      id: 'controller-manager-kubeconfig',
      label: 'Controller manager kubeconfig path is wrong',
      break: `${edit(
        `${M}/kube-controller-manager.yaml`,
        's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/controller-manager)\\.conf$#\\1.config#',
        '- --kubeconfig=/etc/kubernetes/controller-manager.config$',
      )}
${componentDown('kube-controller-manager')}
kubectl -n "${NS}" scale deployment/web --replicas=2`,
      settle: waitPending(NS),
      fix: edit(
        `${M}/kube-controller-manager.yaml`,
        's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/controller-manager)\\.config$#\\1.conf#',
        '- --kubeconfig=/etc/kubernetes/controller-manager.conf$',
      ),
      wait: waitHealthy(NS),
      explain: `\`--kubeconfig\` in \`${M}/kube-controller-manager.yaml\` points at \`controller-manager.config\` instead of \`controller-manager.conf\`. The controller manager exits at startup, so the Deployment is scaled but no ReplicaSet creates Pods (\`kubectl get deploy\` shows 0 of 2, with no Pods at all). Its logs show the missing file.`,
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
      id: 'scheduler-kubeconfig-path',
      label: 'Scheduler kubeconfig path is wrong',
      break: `${edit(`${M}/kube-scheduler.yaml`, 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\\.conf$#\\1.config#', '- --kubeconfig=/etc/kubernetes/scheduler.config$')}
${componentDown('kube-scheduler')}
kubectl -n "${NS}" scale deployment/web --replicas=2`,
      settle: waitPending(NS),
      fix: edit(`${M}/kube-scheduler.yaml`, 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\\.config$#\\1.conf#', '- --kubeconfig=/etc/kubernetes/scheduler.conf$'),
      wait: waitHealthy(NS),
      explain: `\`--kubeconfig\` in \`${M}/kube-scheduler.yaml\` points at \`/etc/kubernetes/scheduler.config\` instead of \`scheduler.conf\`. The scheduler exits at startup, so the new \`web\` Pods stay \`Pending\` with no scheduling events. \`kubectl -n kube-system logs kube-scheduler-controlplane\` (or \`crictl logs\`) shows the missing file; \`ls /etc/kubernetes\` shows the real one.`,
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
      id: 'controller-manager-sa-key',
      label: 'Controller manager service account key path is wrong',
      break: `${edit(
        `${M}/kube-controller-manager.yaml`,
        's#^([[:space:]]*- --service-account-private-key-file=/etc/kubernetes/pki/sa)\\.key$#\\1.pem#',
        '- --service-account-private-key-file=/etc/kubernetes/pki/sa.pem$',
      )}
${componentDown('kube-controller-manager')}
kubectl -n "${NS}" scale deployment/web --replicas=2`,
      settle: waitPending(NS),
      fix: edit(
        `${M}/kube-controller-manager.yaml`,
        's#^([[:space:]]*- --service-account-private-key-file=/etc/kubernetes/pki/sa)\\.pem$#\\1.key#',
        '- --service-account-private-key-file=/etc/kubernetes/pki/sa.key$',
      ),
      wait: waitHealthy(NS),
      explain: `\`--service-account-private-key-file\` in \`${M}/kube-controller-manager.yaml\` points at \`/etc/kubernetes/pki/sa.pem\`, which does not exist. The controller manager exits at startup, so \`web\` is scaled to 2 but no ReplicaSet creates Pods. Its logs (\`crictl logs\`) name the missing key; \`ls /etc/kubernetes/pki\` shows \`sa.key\`.`,
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
      id: 'apiserver-etcd-keyfile',
      label: 'API server etcd client key path is wrong',
      break: `${scaleUp(NS)}
${edit(
  `${M}/kube-apiserver.yaml`,
  's#^([[:space:]]*- --etcd-keyfile=)/etc/kubernetes/pki/apiserver-etcd-client.key$#\\1/etc/kubernetes/pki/etcd/apiserver-etcd-client.key#',
  '- --etcd-keyfile=/etc/kubernetes/pki/etcd/apiserver-etcd-client.key$',
)}`,
      settle: apiDown,
      fix: edit(
        `${M}/kube-apiserver.yaml`,
        's#^([[:space:]]*- --etcd-keyfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.key$#\\1/etc/kubernetes/pki/apiserver-etcd-client.key#',
        '- --etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key$',
      ),
      wait: waitHealthy(NS),
      explain: `\`--etcd-keyfile\` in \`${M}/kube-apiserver.yaml\` points at \`/etc/kubernetes/pki/etcd/apiserver-etcd-client.key\`, which does not exist. The key lives with the certificate in \`/etc/kubernetes/pki/\`. The API server exits at startup; \`crictl logs\` shows the missing key.`,
    },
    {
      id: 'apiserver-tls-key-path',
      label: 'API server TLS private key path is wrong',
      break: `${scaleUp(NS)}
${edit(
  `${M}/kube-apiserver.yaml`,
  's#^([[:space:]]*- --tls-private-key-file=/etc/kubernetes/pki/apiserver)\\.key$#\\1.pem#',
  '- --tls-private-key-file=/etc/kubernetes/pki/apiserver.pem$',
)}`,
      settle: apiDown,
      fix: edit(
        `${M}/kube-apiserver.yaml`,
        's#^([[:space:]]*- --tls-private-key-file=/etc/kubernetes/pki/apiserver)\\.pem$#\\1.key#',
        '- --tls-private-key-file=/etc/kubernetes/pki/apiserver.key$',
      ),
      wait: waitHealthy(NS),
      explain: `\`--tls-private-key-file\` in \`${M}/kube-apiserver.yaml\` points at \`apiserver.pem\`, which does not exist, so the API server cannot load its serving key and exits; kubectl gets \`connection refused\`. \`ls /etc/kubernetes/pki\` shows \`apiserver.key\`.`,
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
      id: 'etcd-key-path',
      label: 'etcd server key path is wrong',
      break: `${scaleUp(NS)}
${edit(`${M}/etcd.yaml`, 's#^([[:space:]]*- --key-file=/etc/kubernetes/pki/etcd/server)\\.key$#\\1.pem#', '- --key-file=/etc/kubernetes/pki/etcd/server.pem$')}`,
      settle: apiDown,
      fix: edit(`${M}/etcd.yaml`, 's#^([[:space:]]*- --key-file=/etc/kubernetes/pki/etcd/server)\\.pem$#\\1.key#', '- --key-file=/etc/kubernetes/pki/etcd/server.key$'),
      wait: waitHealthy(NS),
      explain: `\`--key-file\` in \`${M}/etcd.yaml\` points at \`server.pem\` instead of \`server.key\`. etcd exits at startup and the API server loses its storage. \`crictl logs\` of the etcd container shows the missing file.`,
    },
    {
      id: 'etcd-trusted-ca-path',
      label: 'etcd trusted CA path is wrong',
      break: `${scaleUp(NS)}
${edit(`${M}/etcd.yaml`, 's#^([[:space:]]*- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca)\\.crt$#\\1.pem#', '- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.pem$')}`,
      settle: apiDown,
      fix: edit(`${M}/etcd.yaml`, 's#^([[:space:]]*- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca)\\.pem$#\\1.crt#', '- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt$'),
      wait: waitHealthy(NS),
      explain: `\`--trusted-ca-file\` in \`${M}/etcd.yaml\` points at \`ca.pem\`, which does not exist. etcd exits; the API server cannot reach storage and kubectl fails. \`ls /etc/kubernetes/pki/etcd\` shows \`ca.crt\`.`,
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
      id: 'etcd-data-dir',
      label: 'etcd data directory path is wrong',
      break: `${scaleUp(NS)}
${edit(`${M}/etcd.yaml`, 's#^([[:space:]]*- --data-dir=)/var/lib/etcd$#\\1/var/lib/etcd-broken#', '- --data-dir=/var/lib/etcd-broken$')}`,
      settle: apiDown,
      fix: edit(`${M}/etcd.yaml`, 's#^([[:space:]]*- --data-dir=)/var/lib/etcd-broken$#\\1/var/lib/etcd#', '- --data-dir=/var/lib/etcd$'),
      wait: waitHealthy(NS),
      explain: `\`--data-dir\` in \`${M}/etcd.yaml\` points at \`/var/lib/etcd-broken\`, which is empty or missing. etcd cannot open its database and exits; the API goes down with it. Set the path back to \`/var/lib/etcd\`.`,
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
sed -i -E "s#^([[:space:]]*- --advertise-address=).*\$#\\1\${addr}#" ${M}/kube-apiserver.yaml
grep -qE -- "- --advertise-address=\${addr}\$" ${M}/kube-apiserver.yaml || { echo "could not restore advertise-address" >&2; exit 1; }`,
      wait: waitHealthy(NS),
      explain: `\`--advertise-address\` in \`${M}/kube-apiserver.yaml\` is \`not-a-valid-ip\`, so the API server exits at startup. Set it back to the control plane node's IPv4 address (\`ip -4 addr\` or the value that was in the manifest before).`,
    },
    {
      id: 'apiserver-service-account-key',
      label: 'API server service-account-key-file path is wrong',
      break: `${scaleUp(NS)}
${edit(
  `${M}/kube-apiserver.yaml`,
  's#^([[:space:]]*- --service-account-key-file=/etc/kubernetes/pki/sa)\\.pub$#\\1.pem#',
  '- --service-account-key-file=/etc/kubernetes/pki/sa.pem$',
)}`,
      settle: apiDown,
      fix: edit(
        `${M}/kube-apiserver.yaml`,
        's#^([[:space:]]*- --service-account-key-file=/etc/kubernetes/pki/sa)\\.pem$#\\1.pub#',
        '- --service-account-key-file=/etc/kubernetes/pki/sa.pub$',
      ),
      wait: waitHealthy(NS),
      explain: `\`--service-account-key-file\` in \`${M}/kube-apiserver.yaml\` points at \`sa.pem\`, which does not exist. The API server exits at startup; \`ls /etc/kubernetes/pki\` shows \`sa.pub\`. Set the path back to \`/etc/kubernetes/pki/sa.pub\`.`,
    },
    {
      id: 'scheduler-leader-elect',
      label: 'Scheduler --config points at a missing file',
      break: `if grep -qE -- '- --config=' ${M}/kube-scheduler.yaml; then
  ${edit(`${M}/kube-scheduler.yaml`, 's#^([[:space:]]*- --config=).*$#\\1/etc/kubernetes/sched-config.yaml#', '- --config=/etc/kubernetes/sched-config\\.yaml$')}
else
  sed -i -E '/^[[:space:]]*- kube-scheduler$/a\\    - --config=/etc/kubernetes/sched-config.yaml' ${M}/kube-scheduler.yaml
  grep -qE -- '- --config=/etc/kubernetes/sched-config\\.yaml$' ${M}/kube-scheduler.yaml || { echo "could not set scheduler --config" >&2; exit 1; }
fi
${componentDown('kube-scheduler')}
kubectl -n "${NS}" scale deployment/web --replicas=2`,
      settle: waitPending(NS),
      fix: `sed -i -E '/^[[:space:]]*- --config=\\/etc\\/kubernetes\\/sched-config\\.yaml$/d' ${M}/kube-scheduler.yaml
! grep -qE -- '- --config=/etc/kubernetes/sched-config\\.yaml$' ${M}/kube-scheduler.yaml || { echo "could not remove scheduler --config" >&2; exit 1; }`,
      wait: waitHealthy(NS),
      explain: `\`${M}/kube-scheduler.yaml\` passes \`--config=/etc/kubernetes/sched-config.yaml\`, which does not exist, so the scheduler exits and new Pods stay \`Pending\`. Remove that flag (kubeadm schedulers use \`--kubeconfig\` / \`--authentication-kubeconfig\` instead) so the scheduler starts again.`,
    },
    {
      id: 'etcd-peer-urls',
      label: 'etcd peer URLs use the wrong port',
      break: `${scaleUp(NS)}
sed -i -E '/--listen-peer-urls=/s/:2380/:2381/g' ${M}/etcd.yaml
sed -i -E '/--initial-advertise-peer-urls=/s/:2380/:2381/g' ${M}/etcd.yaml
grep -qE -- '--listen-peer-urls=.*:2381' ${M}/etcd.yaml || { echo "could not break listen-peer-urls" >&2; exit 1; }
grep -qE -- '--initial-advertise-peer-urls=.*:2381' ${M}/etcd.yaml || { echo "could not break initial-advertise-peer-urls" >&2; exit 1; }`,
      settle: apiDown,
      fix: `sed -i -E '/--listen-peer-urls=/s/:2381/:2380/g' ${M}/etcd.yaml
sed -i -E '/--initial-advertise-peer-urls=/s/:2381/:2380/g' ${M}/etcd.yaml`,
      wait: waitHealthy(NS),
      explain: `\`--listen-peer-urls\` and \`--initial-advertise-peer-urls\` in \`${M}/etcd.yaml\` use port \`2381\` instead of \`2380\`. etcd becomes unhealthy and the API server loses storage. Put both peer URLs back on \`2380\`.`,
    },
  ],
};

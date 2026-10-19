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
  fields: [nsField(['ops', 'core', 'platform'])],
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
  ],
};

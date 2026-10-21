import { labVersions } from '../../config';
import type { RecipeCheck } from '../types';
import { onCp, onWorker, taskBuilder } from './tasks';

/**
 * Written by the image extras (tools/build-base-images/extras.sh) on every node:
 * PREVIOUS / CURRENT (v1.36.x / v1.37.1) and their package versions, served by a local apt repo.
 */
const VERSIONS = '/opt/cka/versions.env';
const POD_CIDR = '10.244.0.0/16';
const CALICO = '/root/calico.yaml';

const needExtras = `[[ -f ${VERSIONS} ]] || { echo "these lab images have no upgrade packages: run ./cka images extras (or rebuild the images)" >&2; exit 1; }
. ${VERSIONS}`;

/** Installs kubeadm, kubelet and kubectl at the package version in variable $1 (PREVIOUS_PKG or CURRENT_PKG). */
const pinPackages = (which: 'PREVIOUS_PKG' | 'CURRENT_PKG') => `set -euo pipefail
. ${VERSIONS}
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -q --allow-downgrades --allow-change-held-packages "kubeadm=$${which}" "kubelet=$${which}" "kubectl=$${which}" >/dev/null
apt-mark hold kubeadm kubelet kubectl >/dev/null
systemctl daemon-reload
systemctl enable kubelet >/dev/null 2>&1`;

/**
 * Builds the cluster on the bare snapshot: controlplane at `cp` and both workers at `workers`,
 * Calico from the staged manifest, workers joined. Everything comes from the images, so it works offline.
 */
const buildCluster = (cp: 'PREVIOUS' | 'CURRENT', workers: 'PREVIOUS' | 'CURRENT') => `${needExtras}
bash <<'CKA_PIN_EOF'
${pinPackages(`${cp}_PKG`)}
CKA_PIN_EOF
for n in worker-1 worker-2; do
  runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new "$n" sudo bash -s <<'CKA_PIN_EOF'
${pinPackages(`${workers}_PKG`)}
CKA_PIN_EOF
done
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
kubernetesVersion: $${cp}
networking:
  podSubnet: ${POD_CIDR}
EOF
kubeadm init --config /root/kubeadm-init.yaml >/root/kubeadm-init.log 2>&1 || { kubeadm reset -f >/dev/null 2>&1; kubeadm init --config /root/kubeadm-init.yaml >/root/kubeadm-init.log 2>&1; }
mkdir -p /root/.kube /home/ubuntu/.kube
cp /etc/kubernetes/admin.conf /root/.kube/config
cp /etc/kubernetes/admin.conf /home/ubuntu/.kube/config
chown -R ubuntu:ubuntu /home/ubuntu/.kube
export KUBECONFIG=/etc/kubernetes/admin.conf
sed -E -e 's|^( *)# - name: CALICO_IPV4POOL_CIDR|\\1- name: CALICO_IPV4POOL_CIDR|' -e 's|^( *)#   value: "192.168.0.0/16"|\\1  value: "${POD_CIDR}"|' ${CALICO} > /root/calico-lab.yaml
kubectl apply -f /root/calico-lab.yaml >/dev/null
join="$(kubeadm token create --print-join-command)"
for n in worker-1 worker-2; do
  runuser -u ubuntu -- ssh "$n" "sudo $join --node-name $n" >/dev/null 2>&1
done
kubectl wait --for=condition=Ready nodes --all --timeout=600s >/dev/null
kubectl -n kube-system rollout status daemonset/calico-node --timeout=600s >/dev/null
kubectl -n kube-system rollout status deployment/coredns --timeout=300s >/dev/null`;

const kubeletOf = (node: string) => `kubectl get node ${node} -o jsonpath='{.status.nodeInfo.kubeletVersion}'`;

const allReady: RecipeCheck = {
  id: 'nodes-ready',
  description: 'every node is Ready',
  type: 'kubectl',
  run: `kubectl get nodes -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\\n"}{end}' | sort -u | xargs`,
  expect: { equals: 'True' },
  weight: 1,
  retrySeconds: 180,
};

const upgradePackage = (pkg: string) => `apt-mark unhold ${pkg} >/dev/null
apt-get install -y -q "${pkg}=$CURRENT_PKG" >/dev/null
apt-mark hold ${pkg} >/dev/null`;

export const upgradeBuilder = taskBuilder({
  id: 'upgrade',
  name: 'Cluster upgrade',
  description: 'Upgrade a kubeadm cluster one minor version: the control plane, then a worker, the way the kubeadm upgrade guide does it.',
  domain: 'cluster-architecture',
  difficulty: 3,
  minutes: 20,
  points: 8,
  tags: ['kubeadm', 'upgrade', 'drain'],
  track: 'cluster',
  // The cluster to upgrade is built at setup, from the bare snapshot, at the previous version.
  base: 'bare',
  solo: true,
  breaksApi: true,
  tasks: {
    'control-plane': {
      label: 'Upgrade the control plane node',
      make: () => {
        const { current, previous } = labVersions();
        return {
          title: 'Upgrade the control plane',
          text: `The cluster runs Kubernetes ${previous}. Upgrade the control plane node \`controlplane\` to Kubernetes \`${current}\` with kubeadm: the control plane components, then the kubelet and kubectl on that node. Drain it first, and leave it \`Ready\` and schedulable again afterwards.

Do not upgrade the workers. The packages are available through apt on every node.`,
          setup: [buildCluster('PREVIOUS', 'PREVIOUS')],
          setupTimeout: 1200,
          checks: [
            {
              id: 'apiserver',
              description: `the API server runs ${current}`,
              type: 'kubectl',
              run: `kubectl version -o json | jq -r .serverVersion.gitVersion`,
              expect: { equals: `v${current}` },
              weight: 2,
              retrySeconds: 120,
            },
            {
              id: 'kubelet',
              description: `the kubelet on controlplane runs ${current}`,
              type: 'kubectl',
              run: kubeletOf('controlplane'),
              expect: { equals: `v${current}` },
              weight: 2,
              retrySeconds: 120,
            },
            onCp({
              id: 'tools',
              description: `kubeadm and kubectl on controlplane are ${current}`,
              run: `echo "$(kubeadm version -o short) $(kubectl version --client -o json | jq -r .clientVersion.gitVersion)"`,
              expect: { equals: `v${current} v${current}` },
              weight: 1,
            }),
            {
              id: 'schedulable',
              description: 'controlplane is not cordoned',
              type: 'kubectl',
              run: `kubectl get node controlplane -o jsonpath='{.spec.unschedulable}'`,
              expect: { notContains: 'true' },
              weight: 1,
            },
            {
              id: 'workers-kept',
              description: `both workers still run ${previous}`,
              type: 'kubectl',
              run: `echo "$(${kubeletOf('worker-1')}) $(${kubeletOf('worker-2')})"`,
              expect: { matches: `^v${previous.replace(/\./g, '\\.')}\\.\\d+ v${previous.replace(/\./g, '\\.')}\\.\\d+$` },
              weight: 1,
            },
            allReady,
          ],
          solution: [
            `${needExtras}
export DEBIAN_FRONTEND=noninteractive
kubectl drain controlplane --ignore-daemonsets --delete-emptydir-data
${upgradePackage('kubeadm')}
kubeadm upgrade plan
kubeadm upgrade apply -y "$CURRENT"
${upgradePackage('kubelet')}
${upgradePackage('kubectl')}
systemctl daemon-reload
systemctl restart kubelet
for _ in $(seq 1 120); do kubectl get --raw /readyz >/dev/null 2>&1 && break; sleep 2; done
kubectl uncordon controlplane
kubectl wait --for=condition=Ready node/controlplane --timeout=300s`,
          ],
          hints: [
            'The kubeadm upgrade guide on kubernetes.io lists the steps in order: upgrade kubeadm, kubeadm upgrade plan, kubeadm upgrade apply, then the kubelet and kubectl.',
            'apt-cache madison kubeadm lists the versions apt can install. The packages are held: apt-mark unhold them first.',
            'After installing the new kubelet: systemctl daemon-reload && systemctl restart kubelet, then kubectl uncordon.',
          ],
        };
      },
    },
    worker: {
      label: 'Upgrade a worker node',
      make: () => {
        const { current, previous } = labVersions();
        return {
          title: 'Upgrade a worker',
          text: `The control plane runs Kubernetes \`${current}\`, but both workers still run ${previous}. Upgrade \`worker-1\` to \`${current}\` with kubeadm: kubeadm itself, the node's configuration, then the kubelet and kubectl. Drain it before you upgrade its kubelet, and make it schedulable again afterwards.

Leave \`worker-2\` as it is. The packages are available through apt on every node.`,
          setup: [buildCluster('CURRENT', 'PREVIOUS')],
          setupTimeout: 1200,
          checks: [
            {
              id: 'kubelet',
              description: `the kubelet on worker-1 runs ${current}`,
              type: 'kubectl',
              run: kubeletOf('worker-1'),
              expect: { equals: `v${current}` },
              weight: 3,
              retrySeconds: 120,
            },
            {
              id: 'tools',
              description: `kubeadm on worker-1 is ${current}`,
              type: 'ssh',
              node: 'worker-1',
              run: 'kubeadm version -o short',
              expect: { equals: `v${current}` },
              weight: 1,
            },
            {
              id: 'schedulable',
              description: 'worker-1 is not cordoned',
              type: 'kubectl',
              run: `kubectl get node worker-1 -o jsonpath='{.spec.unschedulable}'`,
              expect: { notContains: 'true' },
              weight: 2,
              retrySeconds: 60,
            },
            {
              id: 'worker-2-kept',
              description: `worker-2 still runs ${previous}`,
              type: 'kubectl',
              run: kubeletOf('worker-2'),
              expect: { matches: `^v${previous.replace(/\./g, '\\.')}\\.\\d+$` },
              weight: 1,
            },
            allReady,
          ],
          solution: [
            `kubectl drain worker-1 --ignore-daemonsets --delete-emptydir-data
${onWorker(
  'worker-1',
  `set -euo pipefail
. ${VERSIONS}
export DEBIAN_FRONTEND=noninteractive
${upgradePackage('kubeadm')}
kubeadm upgrade node
${upgradePackage('kubelet')}
${upgradePackage('kubectl')}
systemctl daemon-reload
systemctl restart kubelet`,
)}
kubectl uncordon worker-1
kubectl wait --for=condition=Ready node/worker-1 --timeout=300s`,
          ],
          hints: [
            'On a worker the kubeadm step is kubeadm upgrade node, not kubeadm upgrade apply.',
            'Drain from controlplane (kubectl drain worker-1 --ignore-daemonsets), upgrade on the worker (ssh worker-1, then sudo), uncordon from controlplane.',
            'apt-cache madison kubeadm lists the versions apt can install. The packages are held: apt-mark unhold them first.',
          ],
        };
      },
    },
    plan: {
      label: 'Prepare an upgrade and read its plan',
      make: () => {
        const { current, previous } = labVersions();
        return {
          title: 'Plan a cluster upgrade',
          text: `The cluster runs Kubernetes ${previous}. The team will upgrade it to \`${current}\` next week. On \`controlplane\`, prepare without upgrading the cluster:

1. Upgrade only the \`kubeadm\` package on \`controlplane\` to \`${current}\`.
2. Write the version that \`kubeadm upgrade plan\` offers to upgrade the cluster to (as it prints it, for example \`v1.2.3\`) to \`/opt/course/upgrade/target.txt\`.
3. Write the version the API server runs now to \`/opt/course/upgrade/current.txt\`.

Do not apply the upgrade.`,
          setup: [
            `${buildCluster('PREVIOUS', 'PREVIOUS')}
rm -rf /opt/course/upgrade
mkdir -p /opt/course/upgrade
chown -R ubuntu:ubuntu /opt/course`,
          ],
          setupTimeout: 1200,
          checks: [
            onCp({
              id: 'kubeadm',
              description: `kubeadm on controlplane is ${current}`,
              run: 'kubeadm version -o short',
              expect: { equals: `v${current}` },
              weight: 2,
            }),
            onCp({
              id: 'target',
              description: 'target.txt holds the version kubeadm upgrade plan offers',
              run: `[ "$(tr -d ' \\n' < /opt/course/upgrade/target.txt 2>/dev/null)" = "$(kubeadm upgrade plan 2>/dev/null | grep -oE 'kubeadm upgrade apply v[0-9.]+' | head -1 | awk '{print $4}')" ] && echo match || echo differs`,
              expect: { equals: 'match' },
              weight: 2,
              retrySeconds: 30,
            }),
            onCp({
              id: 'current',
              description: 'current.txt holds the version the API server runs',
              run: `[ "$(tr -d ' \\n' < /opt/course/upgrade/current.txt 2>/dev/null | sed 's/^v//')" = "$(kubectl version -o json | jq -r .serverVersion.gitVersion | sed 's/^v//')" ] && echo match || echo differs`,
              expect: { equals: 'match' },
              weight: 1,
            }),
            {
              id: 'not-applied',
              description: `the API server and every kubelet still run ${previous}`,
              type: 'kubectl',
              run: `echo "$(kubectl version -o json | jq -r .serverVersion.gitVersion) $(kubectl get nodes -o jsonpath='{.items[*].status.nodeInfo.kubeletVersion}')" | tr ' ' '\\n' | grep -vc "^v${previous}\\." || true`,
              expect: { equals: '0' },
              weight: 2,
            },
            allReady,
          ],
          solution: [
            `${needExtras}
export DEBIAN_FRONTEND=noninteractive
${upgradePackage('kubeadm')}
kubeadm upgrade plan 2>/dev/null | grep -oE 'kubeadm upgrade apply v[0-9.]+' | head -1 | awk '{print $4}' > /opt/course/upgrade/target.txt
kubectl version -o json | jq -r .serverVersion.gitVersion > /opt/course/upgrade/current.txt`,
          ],
          hints: [
            'apt-cache madison kubeadm lists the versions apt can install; the package is held, so apt-mark unhold it first.',
            'kubeadm upgrade plan only reads: it prints the versions you could upgrade to and the kubeadm upgrade apply command for each.',
            'kubectl version shows the client and the server (API server) versions.',
          ],
        };
      },
    },
  },
});

#!/usr/bin/env bash
# Question 1: builds the cluster at the previous version, then puts the app and its budget on the worker to upgrade.
set -euo pipefail

[[ -f /opt/cka/versions.env ]] || { echo "these lab images have no upgrade packages: run ./cka images extras (or rebuild the images)" >&2; exit 1; }
. /opt/cka/versions.env
bash <<'CKA_PIN_EOF'
set -euo pipefail
. /opt/cka/versions.env
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -q --allow-downgrades --allow-change-held-packages "kubeadm=$PREVIOUS_PKG" "kubelet=$PREVIOUS_PKG" "kubectl=$PREVIOUS_PKG" >/dev/null
apt-mark hold kubeadm kubelet kubectl >/dev/null
systemctl daemon-reload
systemctl enable kubelet >/dev/null 2>&1
CKA_PIN_EOF
for n in worker-1 worker-2; do
  runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new "$n" sudo bash -s <<'CKA_PIN_EOF'
set -euo pipefail
. /opt/cka/versions.env
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -q --allow-downgrades --allow-change-held-packages "kubeadm=$PREVIOUS_PKG" "kubelet=$PREVIOUS_PKG" "kubectl=$PREVIOUS_PKG" >/dev/null
apt-mark hold kubeadm kubelet kubectl >/dev/null
systemctl daemon-reload
systemctl enable kubelet >/dev/null 2>&1
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
kubernetesVersion: $PREVIOUS
networking:
  podSubnet: 10.244.0.0/16
EOF
kubeadm init --config /root/kubeadm-init.yaml >/root/kubeadm-init.log 2>&1 || { kubeadm reset -f >/dev/null 2>&1; kubeadm init --config /root/kubeadm-init.yaml >/root/kubeadm-init.log 2>&1; }
mkdir -p /root/.kube /home/ubuntu/.kube
cp /etc/kubernetes/admin.conf /root/.kube/config
cp /etc/kubernetes/admin.conf /home/ubuntu/.kube/config
chown -R ubuntu:ubuntu /home/ubuntu/.kube
export KUBECONFIG=/etc/kubernetes/admin.conf
sed -E -e 's|^( *)# - name: CALICO_IPV4POOL_CIDR|\1- name: CALICO_IPV4POOL_CIDR|' -e 's|^( *)#   value: "192.168.0.0/16"|\1  value: "10.244.0.0/16"|' /root/calico.yaml > /root/calico-lab.yaml
kubectl apply -f /root/calico-lab.yaml >/dev/null
join="$(kubeadm token create --print-join-command)"
for n in worker-1 worker-2; do
  runuser -u ubuntu -- ssh "$n" "sudo $join --node-name $n" >/dev/null 2>&1
done
kubectl wait --for=condition=Ready nodes --all --timeout=600s >/dev/null
kubectl -n kube-system rollout status daemonset/calico-node --timeout=600s >/dev/null
kubectl -n kube-system rollout status deployment/coredns --timeout=300s >/dev/null

# All three nodes registered and Ready before the workload goes on.
timeout 300 bash -c 'until [ "$(kubectl get nodes --no-headers 2>/dev/null | grep -c " Ready ")" = 3 ]; do sleep 3; done'

other=worker-1
[[ "${Q1_NODE}" == worker-1 ]] && other=worker-2

# The other worker is cordoned for a moment, so the app's single Pod lands on the worker to upgrade.
kubectl cordon "$other" >/dev/null
kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - >/dev/null <<YAML
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${Q1_APP} }
  template:
    metadata:
      labels: { app: ${Q1_APP} }
    spec:
      terminationGracePeriodSeconds: 2
      containers:
        - name: app
          image: docker.io/library/busybox:1.36
          imagePullPolicy: IfNotPresent
          command: [ sleep, infinity ]
          resources:
            requests: { cpu: 10m, memory: 16Mi }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
spec:
  minAvailable: 1
  selector:
    matchLabels: { app: ${Q1_APP} }
YAML
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s >/dev/null

node="$(kubectl -n "${Q1_NS}" get pods -l "app=${Q1_APP}" -o jsonpath='{.items[0].spec.nodeName}')"
[[ "$node" == "${Q1_NODE}" ]] || { echo "${Q1_APP} landed on '$node', not ${Q1_NODE}" >&2; exit 1; }
kubectl uncordon "$other" >/dev/null

# What the checks compare against: the Pod a drain has to move, and the budget that must stay as it is.
kubectl -n "${Q1_NS}" get pods -l "app=${Q1_APP}" -o jsonpath='{.items[0].metadata.uid}' > /var/tmp/cka-q1.pod
kubectl -n "${Q1_NS}" get pdb "${Q1_APP}" -o jsonpath='{.metadata.uid}' > /var/tmp/cka-q1.pdb
[[ -s /var/tmp/cka-q1.pod && -s /var/tmp/cka-q1.pdb ]] || { echo "could not record the Pod and the budget" >&2; exit 1; }
chmod 644 /var/tmp/cka-q1.pod /var/tmp/cka-q1.pdb

# Wait until the budget has counted the Pod, so a drain is blocked from the start.
timeout 60 bash -c "until [ \"\$(kubectl -n '${Q1_NS}' get pdb '${Q1_APP}' -o jsonpath='{.status.currentHealthy}/{.status.disruptionsAllowed}')\" = 1/0 ]; do sleep 2; done"

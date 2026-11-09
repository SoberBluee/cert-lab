#!/usr/bin/env bash
set -euo pipefail
. /opt/cka/versions.env
export DEBIAN_FRONTEND=noninteractive
export KUBECONFIG=/etc/kubernetes/admin.conf

# Control plane: kubeadm first, then the components, then the kubelet and kubectl.
kubectl drain controlplane --ignore-daemonsets --delete-emptydir-data
apt-mark unhold kubeadm >/dev/null
apt-get install -y -q "kubeadm=$CURRENT_PKG" >/dev/null
apt-mark hold kubeadm >/dev/null
kubeadm upgrade plan >/dev/null
kubeadm upgrade apply -y "$CURRENT"
apt-mark unhold kubelet kubectl >/dev/null
apt-get install -y -q "kubelet=$CURRENT_PKG" "kubectl=$CURRENT_PKG" >/dev/null
apt-mark hold kubelet kubectl >/dev/null
systemctl daemon-reload
systemctl restart kubelet
for _ in $(seq 1 120); do kubectl get --raw /readyz >/dev/null 2>&1 && break; sleep 2; done
kubectl uncordon controlplane

# The budget allows no eviction while the app has one Pod: give it a second one elsewhere first.
kubectl cordon "${Q1_NODE}"
kubectl -n "${Q1_NS}" scale deployment "${Q1_APP}" --replicas=2
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s
kubectl drain "${Q1_NODE}" --ignore-daemonsets --delete-emptydir-data --timeout=300s

runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new "${Q1_NODE}" sudo bash -s <<'CKA_NODE_EOF'
set -euo pipefail
. /opt/cka/versions.env
export DEBIAN_FRONTEND=noninteractive
apt-mark unhold kubeadm kubelet kubectl >/dev/null
apt-get install -y -q "kubeadm=$CURRENT_PKG" >/dev/null
kubeadm upgrade node
apt-get install -y -q "kubelet=$CURRENT_PKG" "kubectl=$CURRENT_PKG" >/dev/null
apt-mark hold kubeadm kubelet kubectl >/dev/null
systemctl daemon-reload
systemctl restart kubelet
CKA_NODE_EOF

kubectl uncordon "${Q1_NODE}"
kubectl -n "${Q1_NS}" scale deployment "${Q1_APP}" --replicas=1
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s
kubectl wait --for=condition=Ready nodes --all --timeout=300s

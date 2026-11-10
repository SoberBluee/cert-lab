#!/usr/bin/env bash
# Question 1: Upgrade the control plane. Solution step on controlplane, applied by "cka verify".
set -euo pipefail

[[ -f /opt/cka/versions.env ]] || { echo "these lab images have no upgrade packages: run ./cka images extras (or rebuild the images)" >&2; exit 1; }
. /opt/cka/versions.env
export DEBIAN_FRONTEND=noninteractive
kubectl drain controlplane --ignore-daemonsets --delete-emptydir-data
apt-mark unhold kubeadm >/dev/null
apt-get install -y -q "kubeadm=$CURRENT_PKG" >/dev/null
apt-mark hold kubeadm >/dev/null
kubeadm upgrade plan
kubeadm upgrade apply -y "$CURRENT"
apt-mark unhold kubelet >/dev/null
apt-get install -y -q "kubelet=$CURRENT_PKG" >/dev/null
apt-mark hold kubelet >/dev/null
apt-mark unhold kubectl >/dev/null
apt-get install -y -q "kubectl=$CURRENT_PKG" >/dev/null
apt-mark hold kubectl >/dev/null
systemctl daemon-reload
systemctl restart kubelet
for _ in $(seq 1 120); do kubectl get --raw /readyz >/dev/null 2>&1 && break; sleep 2; done
kubectl uncordon controlplane
kubectl wait --for=condition=Ready node/controlplane --timeout=300s

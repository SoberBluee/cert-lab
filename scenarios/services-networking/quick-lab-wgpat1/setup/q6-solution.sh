#!/usr/bin/env bash
# Question 6: Restore etcd. Solution step on controlplane, applied by "cka verify".
set -euo pipefail

etcdutl snapshot restore "${Q6_SNAPSHOT}" --data-dir "${Q6_DATADIR}"
sed -i -E "s#path: /var/lib/etcd\$#path: ${Q6_DATADIR}#" /etc/kubernetes/manifests/etcd.yaml
grep -q -- "path: ${Q6_DATADIR}" /etc/kubernetes/manifests/etcd.yaml
for _ in $(seq 1 240); do
  [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
  sleep 2
done
for _ in $(seq 1 120); do
  [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
  sleep 3
done
[[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]]

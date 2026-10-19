#!/usr/bin/env bash
set -euo pipefail

M=/etc/kubernetes/manifests/kube-apiserver.yaml
sed -i -E 's#^([[:space:]]*- --)etcd-server=#\1etcd-servers=#' "$M"
sed -i -E 's#^([[:space:]]*- --etcd-servers=)http://127.0.0.1:2379$#\1https://127.0.0.1:2379#' "$M"
sed -i -E 's#^([[:space:]]*- --etcd-cafile=)/etc/kubernetes/pki/ca.crt$#\1/etc/kubernetes/pki/etcd/ca.crt#' "$M"

for _ in $(seq 1 240); do
  [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
  sleep 2
done
want="etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True"
for _ in $(seq 1 120); do
  got="$(kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' 2>/dev/null | sort | xargs || true)"
  [[ "$got" == "$want" ]] && break
  sleep 3
done

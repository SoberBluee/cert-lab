#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root on controlplane.
set -euo pipefail

M=/etc/kubernetes/manifests/kube-apiserver.yaml

case "$API_FAULT" in
  authz-mode) word=RBACC ;;
  admission-plugin) word=PodNodeSelectors ;;
  unknown-flag) word=enable-bootstrap-token-authn ;;
esac

line=""
for _ in $(seq 1 60); do
  line="$(grep -rh -- "$word" /var/log/pods/kube-system_kube-apiserver-controlplane_*/ 2>/dev/null | head -1 || true)"
  [[ -n "$line" ]] && break
  sleep 3
done
[[ -n "$line" ]] || { echo "no kube-apiserver log line mentions $word" >&2; exit 1; }
echo "$line" > /opt/course/1/apiserver-error.log

sed -i -E 's#^([[:space:]]*- --authorization-mode=)Node,RBACC$#\1Node,RBAC#' "$M"
sed -i -E 's#^([[:space:]]*- --enable-admission-plugins=)NodeRestriction,PodNodeSelectors$#\1NodeRestriction#' "$M"
sed -i -E 's#^([[:space:]]*- --enable-bootstrap-token-auth)n=true$#\1=true#' "$M"
sed -i -E 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\1:2379#' "$M"
sed -i -E 's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$#\1/etc/kubernetes/pki/apiserver-etcd-client.crt#' "$M"
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

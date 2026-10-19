#!/usr/bin/env bash
# Break apiserver etcd flags: wrong flag name + http, and wrong etcd CA.
set -euo pipefail

M=/etc/kubernetes/manifests/kube-apiserver.yaml

sed -i -E 's#^([[:space:]]*- --etcd-servers=)https://127.0.0.1:2379$#\1http://127.0.0.1:2379#' "$M"
sed -i -E 's#^([[:space:]]*- --)etcd-servers=#\1etcd-server=#' "$M"
grep -qE -- '- --etcd-server=http://127.0.0.1:2379$' "$M" || {
  echo "could not break --etcd-servers" >&2
  exit 1
}

sed -i -E 's#^([[:space:]]*- --etcd-cafile=)/etc/kubernetes/pki/etcd/ca.crt$#\1/etc/kubernetes/pki/ca.crt#' "$M"
grep -qE -- '- --etcd-cafile=/etc/kubernetes/pki/ca.crt$' "$M" || {
  echo "could not break --etcd-cafile" >&2
  exit 1
}

readyz() { curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true; }
for _ in $(seq 1 90); do
  [[ "$(readyz)" != ok ]] && exit 0
  sleep 2
done
echo "the API server is still healthy" >&2
exit 1

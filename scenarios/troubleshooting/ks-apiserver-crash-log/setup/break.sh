#!/usr/bin/env bash
# Two faults in the kube-apiserver manifest: a flag that stops it at startup ($API_FAULT), and a
# broken etcd client flag ($ETCD_FAULT). The API server fails on the first before it ever reaches
# etcd, so the second shows only after the first fix.
set -euo pipefail

M=/etc/kubernetes/manifests/kube-apiserver.yaml
mkdir -p /opt/course/1
rm -f /opt/course/1/apiserver-error.log
chown -R ubuntu:ubuntu /opt/course

edit() { # sed -E expression, proof regex
  sed -i -E "$1" "$M"
  grep -qE -- "$2" "$M" || { echo "could not edit $M ($2)" >&2; exit 1; }
}

case "$API_FAULT" in
  authz-mode) edit 's#^([[:space:]]*- --authorization-mode=)Node,RBAC$#\1Node,RBACC#' '- --authorization-mode=Node,RBACC$' ;;
  admission-plugin) edit 's#^([[:space:]]*- --enable-admission-plugins=)NodeRestriction$#\1NodeRestriction,PodNodeSelectors#' '- --enable-admission-plugins=NodeRestriction,PodNodeSelectors$' ;;
  unknown-flag) edit 's#^([[:space:]]*- --enable-bootstrap-token-auth)=true$#\1n=true#' '- --enable-bootstrap-token-authn=true$' ;;
  *) echo "unknown API_FAULT $API_FAULT" >&2; exit 1 ;;
esac

case "$ETCD_FAULT" in
  port) edit 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2379$#\1:2380#' '- --etcd-servers=https://127.0.0.1:2380$' ;;
  certfile) edit 's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/apiserver-etcd-client.crt$#\1/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt#' '- --etcd-certfile=/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$' ;;
  cafile) edit 's#^([[:space:]]*- --etcd-cafile=)/etc/kubernetes/pki/etcd/ca.crt$#\1/etc/kubernetes/pki/ca.crt#' '- --etcd-cafile=/etc/kubernetes/pki/ca.crt$' ;;
  *) echo "unknown ETCD_FAULT $ETCD_FAULT" >&2; exit 1 ;;
esac

readyz() { curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true; }
for _ in $(seq 1 90); do
  [[ "$(readyz)" != ok ]] && exit 0
  sleep 2
done
echo "the API server is still healthy" >&2
exit 1

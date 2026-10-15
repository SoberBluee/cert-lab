#!/usr/bin/env bash
# Records the etcd revision at lab start so the check can tell a fresh snapshot from an old one.
set -euo pipefail

kubectl create configmap q3-backup-marker --from-literal=created="$(date -Is)" >/dev/null 2>&1 || true
rev=$(ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  endpoint status -w json | jq -r '.[0].Status.header.revision')
[[ "$rev" =~ ^[0-9]+$ ]] || { echo "could not read the etcd revision" >&2; exit 1; }
install -d -m 700 /root/.cka
echo "$rev" > /root/.cka/q3-etcd-rev

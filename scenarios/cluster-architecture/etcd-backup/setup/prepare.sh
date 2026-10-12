#!/usr/bin/env bash
set -euo pipefail

rm -rf /opt/backups
kubectl create configmap backup-marker --from-literal=created="$(date -Is)"

export ETCDCTL_API=3
rev=$(etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  endpoint status -w json | jq -r '.[0].Status.header.revision')
[[ "$rev" =~ ^[0-9]+$ ]] || { echo "could not read the etcd revision" >&2; exit 1; }
install -d -m 700 /root/.cka
echo "$rev" > /root/.cka/etcd-rev

#!/usr/bin/env bash
set -euo pipefail

rm -rf "${DATADIR}"
command -v etcdutl >/dev/null || install -m 755 "/proc/$(pgrep -xo etcd)/root/usr/local/bin/etcdutl" /usr/local/bin/etcdutl
mkdir -p "$(dirname "${SNAPSHOT}")" /opt/course
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save "${SNAPSHOT}" >/dev/null
chown -R ubuntu:ubuntu /opt/course
test -s "${SNAPSHOT}"

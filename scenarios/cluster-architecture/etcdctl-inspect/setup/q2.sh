#!/usr/bin/env bash
set -euo pipefail

mkdir -p /opt/course/etcd
chown -R ubuntu:ubuntu /opt/course
kubectl create namespace "${Q2_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q2_NS}" >/dev/null
kubectl -n "${Q2_NS}" create secret generic "${Q2_SECRET}" --from-literal=apikey="${Q2_VALUE}" >/dev/null

#!/usr/bin/env bash
set -euo pipefail

mkdir -p /opt/course/tokens
chown -R ubuntu:ubuntu /opt/course
kubectl create namespace "${Q2_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q2_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q2_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl -n "${Q2_NS}" create serviceaccount "${Q2_SA}" >/dev/null

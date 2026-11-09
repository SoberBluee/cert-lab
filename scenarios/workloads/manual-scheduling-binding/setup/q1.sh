#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl -n "${Q1_NS}" run "${Q1_POD}" --image=nginx:1.27-alpine >/dev/null
kubectl -n "${Q1_NS}" get pod "${Q1_POD}" -o jsonpath='{.metadata.uid}' > /var/tmp/cka-q1.uid
chmod 644 /var/tmp/cka-q1.uid
sleep 3
phase="$(kubectl -n "${Q1_NS}" get pod "${Q1_POD}" -o jsonpath='{.status.phase}')"
[[ "$phase" == Pending ]] || { echo "expected a Pending Pod, got $phase" >&2; exit 1; }

#!/usr/bin/env bash
set -euo pipefail

for ns in "${Q1_NS}" data-tier; do
  kubectl create namespace "$ns" >/dev/null 2>&1 || kubectl get namespace "$ns" >/dev/null
  timeout 60 bash -c "until kubectl -n '$ns' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
done
kubectl -n data-tier create deployment "${Q1_DB}" --image=nginx:1.27-alpine --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n data-tier expose deployment "${Q1_DB}" --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${Q1_NS}" run client --image=busybox:1.36 --command -- sleep 1d >/dev/null
kubectl -n data-tier rollout status "deployment/${Q1_DB}" --timeout=180s >/dev/null
kubectl -n "${Q1_NS}" wait --for=condition=Ready pod/client --timeout=120s >/dev/null

#!/usr/bin/env bash
# A Deployment without CPU requests, so a plain HPA cannot compute utilization.
set -euo pipefail

kubectl delete namespace "$Q3_NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$Q3_NS" >/dev/null
kubectl -n "$Q3_NS" create deployment "$Q3_DEPLOY" --image=nginx:1.27-alpine --replicas=2 >/dev/null
kubectl -n "$Q3_NS" rollout status "deployment/$Q3_DEPLOY" --timeout=180s >/dev/null

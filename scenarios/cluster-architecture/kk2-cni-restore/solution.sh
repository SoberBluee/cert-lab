#!/usr/bin/env bash
set -euo pipefail
# Node-side restore runs via solution-node.sh on workers.
for _ in $(seq 1 60); do
  ready=$(kubectl get node "${NODE}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)
  [[ "$ready" == "True" ]] && break
  sleep 2
done
kubectl delete pod cni-probe --ignore-not-found >/dev/null 2>&1 || true

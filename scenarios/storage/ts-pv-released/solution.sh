#!/usr/bin/env bash
set -euo pipefail
kubectl patch pv "${CLAIM}-pv" --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'
for _ in $(seq 1 30); do
  [[ "$(kubectl -n "${NS}" get pvc "${CLAIM}" -o jsonpath='{.status.phase}')" == Bound ]] && break
  sleep 2
done
kubectl -n "${NS}" wait --for=condition=Ready "pod/${CLAIM}-app" --timeout=180s

#!/usr/bin/env bash
set -euo pipefail

for _ in $(seq 1 90); do
  press=$(kubectl get node "${Q2_NODE}" -o jsonpath='{.status.conditions[?(@.type=="MemoryPressure")].status}' 2>/dev/null || true)
  [[ "$press" == True ]] && exit 0
  sleep 2
done
echo "${Q2_NODE} never reported MemoryPressure" >&2
exit 1

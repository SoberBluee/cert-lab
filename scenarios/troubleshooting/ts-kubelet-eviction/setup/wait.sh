#!/usr/bin/env bash
set -euo pipefail

for _ in $(seq 1 90); do
  press=$(kubectl get node "${NODE}" -o jsonpath='{.status.conditions[?(@.type=="MemoryPressure")].status}' 2>/dev/null || true)
  agents=$(kubectl -n "${NS}" get pods -l app=node-agent --field-selector "spec.nodeName=${NODE}" --no-headers 2>/dev/null | grep -c Running || true)
  [[ "$press" == True || "$agents" == 0 ]] && exit 0
  sleep 2
done
echo "node-agent still running without MemoryPressure" >&2
exit 1

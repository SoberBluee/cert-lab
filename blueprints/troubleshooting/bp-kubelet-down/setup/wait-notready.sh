#!/usr/bin/env bash
# The node controller marks a node NotReady about 40s after its last heartbeat.
set -euo pipefail

for _ in $(seq 1 60); do
  [[ "$(kubectl get node "$NODE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')" != True ]] && exit 0
  sleep 2
done
echo "$NODE is still Ready after stopping the kubelet" >&2
exit 1

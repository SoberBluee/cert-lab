#!/usr/bin/env bash
# Waits for the node to turn NotReady, then binds a Pod to it that cannot start until the node is fixed.
set -euo pipefail

mkdir -p /opt/course/3
rm -f /opt/course/3/causes.txt
chown -R ubuntu:ubuntu /opt/course

ready() { kubectl get node "$NODE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true; }
for _ in $(seq 1 90); do
  [[ "$(ready)" != True ]] && break
  sleep 2
done
[[ "$(ready)" != True ]] || { echo "$NODE is still Ready" >&2; exit 1; }

kubectl delete pod node-probe --ignore-not-found --wait=true >/dev/null
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata: { name: node-probe, namespace: default }
spec:
  nodeName: ${NODE}
  tolerations: [{ operator: Exists }]
  containers:
    - name: probe
      image: busybox:1.36
      command: [sh, -c, "sleep 1d"]
EOF

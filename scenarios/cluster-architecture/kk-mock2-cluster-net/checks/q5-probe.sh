#!/usr/bin/env bash
# Keep under the grader's 30s check timeout; retrySeconds covers slow CNI recovery.
set -uo pipefail
kubectl delete pod cni-probe --ignore-not-found --wait=false >/dev/null 2>&1 || true
sleep 1
kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: cni-probe
spec:
  nodeName: ${Q5_NODE}
  containers:
    - name: c
      image: busybox:1.36
      command: ["sleep", "120"]
EOF
if kubectl wait --for=condition=Ready pod/cni-probe --timeout=20s >/dev/null 2>&1; then
  echo ok
else
  echo fail
fi

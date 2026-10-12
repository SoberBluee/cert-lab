#!/usr/bin/env bash
# NS, POD and DISK come from the scenario variables.
set -euo pipefail

kubectl create namespace "$NS"
timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl -n "$NS" apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: $POD
spec:
  nodeSelector:
    disk: $DISK
  containers:
    - name: main
      image: busybox:1.36
      command: ["sh", "-c", "sleep 1d"]
EOF
sleep 5
[[ "$(kubectl -n "$NS" get pod "$POD" -o jsonpath='{.status.phase}')" == Pending ]]

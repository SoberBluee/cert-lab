#!/usr/bin/env bash
set -euo pipefail
kubectl delete pod "${POD}" --ignore-not-found >/dev/null 2>&1 || true
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${POD}
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ["/bin/sh", "-c"]
      args:
        - while true; do date >> /tmp/now.txt; sleep 2; done
EOF
kubectl wait --for=condition=Ready "pod/${POD}" --timeout=120s

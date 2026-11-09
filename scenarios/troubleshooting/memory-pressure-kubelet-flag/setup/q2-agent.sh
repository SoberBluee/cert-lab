#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q2_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q2_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q2_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-agent
  namespace: ${Q2_NS}
spec:
  selector:
    matchLabels: { app: node-agent }
  template:
    metadata:
      labels: { app: node-agent }
    spec:
      containers:
        - name: agent
          image: registry.k8s.io/pause:3.10
          resources:
            requests: { cpu: 10m, memory: 8Mi }
EOF
kubectl -n "${Q2_NS}" rollout status daemonset/node-agent --timeout=240s

#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl create -f - <<EOF
apiVersion: v1
kind: Binding
metadata:
  name: ${Q1_POD}
  namespace: ${Q1_NS}
target:
  apiVersion: v1
  kind: Node
  name: worker-2
EOF

# Question 2
kubectl -n "${Q2_NS}" run "${Q2_POD}" --image=nginx:1.27-alpine --overrides='{"spec":{"nodeName":"worker-1"}}'

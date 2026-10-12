#!/usr/bin/env bash
set -euo pipefail

kubectl label node worker-2 disktype=ssd --overwrite
kubectl -n analytics patch deployment reports --type json -p '[
  {"op": "add", "path": "/spec/template/spec/tolerations", "value": [
    {"key": "dedicated", "operator": "Equal", "value": "analytics", "effect": "NoSchedule"}
  ]}
]'

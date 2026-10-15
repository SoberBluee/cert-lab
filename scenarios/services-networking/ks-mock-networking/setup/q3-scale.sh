#!/usr/bin/env bash
# A 2-replica StatefulSet whose governing Service exists but has a ClusterIP, so no per-Pod DNS records exist.
set -euo pipefail

timeout 60 bash -c "until kubectl -n '$Q3_NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata: { name: ${Q3_STS}-hl, namespace: ${Q3_NS} }
spec:
  selector: { app: ${Q3_STS} }
  ports: [{ port: 80 }]
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: ${Q3_STS}, namespace: ${Q3_NS} }
spec:
  serviceName: ${Q3_STS}-hl
  replicas: 2
  selector: { matchLabels: { app: ${Q3_STS} } }
  template:
    metadata: { labels: { app: ${Q3_STS} } }
    spec:
      containers: [{ name: nginx, image: nginx:1.27-alpine, ports: [{ containerPort: 80 }] }]
EOF
kubectl -n "$Q3_NS" rollout status "statefulset/$Q3_STS" --timeout=180s >/dev/null

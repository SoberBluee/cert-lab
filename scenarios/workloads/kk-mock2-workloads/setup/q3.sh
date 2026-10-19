#!/usr/bin/env bash
set -euo pipefail

kubectl get apiservice v1beta1.metrics.k8s.io >/dev/null 2>&1 || {
  echo "this cluster image has no metrics-server: rebuild images with ./cka images build --force" >&2
  exit 1
}
kubectl create namespace "${Q3_NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${Q3_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl -n "${Q3_NS}" delete hpa "${Q3_APP}-hpa" --ignore-not-found >/dev/null 2>&1 || true

kubectl -n "${Q3_NS}" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q3_APP}
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${Q3_APP} }
  template:
    metadata:
      labels: { app: ${Q3_APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          resources:
            requests: { cpu: 50m, memory: 32Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: ${Q3_APP}-svc
spec:
  selector: { app: ${Q3_APP} }
  ports: [{ port: 80 }]
EOF
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=180s

#!/usr/bin/env bash
set -euo pipefail

kubectl get apiservice v1beta1.metrics.k8s.io >/dev/null 2>&1 || {
  echo "this cluster image has no metrics-server: rebuild images with ./cka images build --force" >&2
  exit 1
}
kubectl create namespace "${NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl -n "${NS}" delete hpa "${APP}-hpa" --ignore-not-found >/dev/null 2>&1 || true

kubectl -n "${NS}" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
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
  name: ${APP}-svc
spec:
  selector: { app: ${APP} }
  ports: [{ port: 80 }]
EOF
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=180s

#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q2_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q2_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q2_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${Q2_APP}-nginx
  namespace: ${Q2_NS}
data:
  default.conf: |
    server {
      listen 8080;
      location / { default_type text/plain; return 200 "app ok\n"; }
    }
    server {
      listen 9100;
      location / { default_type text/plain; return 200 "metrics ok\n"; }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
  labels: { app: ${Q2_APP} }
spec:
  replicas: 2
  selector:
    matchLabels: { app: ${Q2_APP} }
  template:
    metadata:
      labels: { app: ${Q2_APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports:
            - { name: http, containerPort: 8080 }
            - { name: metrics, containerPort: 9100 }
          volumeMounts:
            - { name: conf, mountPath: /etc/nginx/conf.d }
      volumes:
        - name: conf
          configMap: { name: ${Q2_APP}-nginx }
EOF
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=180s

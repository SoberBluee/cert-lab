#!/usr/bin/env bash
# NS, APP and PORT come from the scenario variables.
set -euo pipefail

kubectl create namespace "$NS"
kubectl -n "$NS" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $APP
  labels: { app: $APP }
spec:
  replicas: 2
  selector:
    matchLabels: { app: $APP, tier: backend }
  template:
    metadata:
      labels: { app: $APP, tier: backend }
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: $APP-svc
spec:
  selector: { app: $APP-server, tier: backend }
  ports:
    - port: $PORT
      targetPort: 8080
EOF
kubectl -n "$NS" rollout status "deployment/$APP" --timeout=240s

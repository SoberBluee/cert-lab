#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  replicas: 2
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ name: http, containerPort: 80 }]
          readinessProbe:
            httpGet: { path: /, port: http }
            periodSeconds: 5
---
apiVersion: v1
kind: Pod
metadata:
  name: client
  namespace: ${NS}
spec:
  containers:
    - name: client
      image: busybox:1.36
      command: ["sleep", "infinity"]
EOF

kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s
kubectl -n "${NS}" wait --for=condition=Ready "pod/client" --timeout=180s

kubectl -n "${NS}" apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  type: ExternalName
  externalName: nowhere.invalid
EOF

! kubectl -n "${NS}" exec client -- wget -qO- -T 3 "http://${APP}" >/dev/null 2>&1

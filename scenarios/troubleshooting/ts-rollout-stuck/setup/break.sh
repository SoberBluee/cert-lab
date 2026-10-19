#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${APP}-config
  namespace: ${NS}
data:
  mode: production
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
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
          env:
            - name: APP_MODE
              valueFrom:
                configMapKeyRef: { name: ${APP}-config, key: mode }
          readinessProbe:
            httpGet: { path: /, port: 80 }
          livenessProbe:
            tcpSocket: { port: 80 }
          resources:
            requests: { cpu: 50m, memory: 32Mi }
            limits: { cpu: 250m, memory: 128Mi }
EOF

kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s
kubectl -n "${NS}" patch deployment "${APP}" --type=strategic -p '{"spec":{"paused":true}}'
kubectl -n "${NS}" patch deployment "${APP}" --type=strategic -p '{"spec":{"template":{"metadata":{"annotations":{"cka.lab/roll":"1"}}}}}'

for _ in $(seq 1 30); do
  paused=$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.spec.paused}')
  updated=$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.status.updatedReplicas}')
  desired=$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.spec.replicas}')
  if [[ "$paused" == true ]] && { [[ -z "$updated" ]] || [[ "$updated" != "$desired" ]]; }; then exit 0; fi
  sleep 2
done
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.spec.paused}' | grep -qx true

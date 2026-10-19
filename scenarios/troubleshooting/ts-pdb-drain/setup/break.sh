#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl label node "${NODE}" drain-lab=yes --overwrite
for n in worker-1 worker-2; do
  [[ "$n" == "${NODE}" ]] || kubectl label node "$n" drain-lab- --overwrite >/dev/null 2>&1 || true
done

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
      nodeSelector: { drain-lab: "yes" }
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          readinessProbe:
            httpGet: { path: /, port: 80 }
            periodSeconds: 5
          resources:
            requests: { cpu: 50m, memory: 32Mi }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ${APP}-pdb
  namespace: ${NS}
spec:
  minAvailable: 2
  selector:
    matchLabels: { app: ${APP} }
EOF

kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s
kubectl uncordon "${NODE}" >/dev/null 2>&1 || true
if kubectl drain "${NODE}" --ignore-daemonsets --delete-emptydir-data --timeout=20s >/dev/null 2>&1; then
  echo "drain succeeded unexpectedly" >&2
  kubectl uncordon "${NODE}" >/dev/null 2>&1 || true
  exit 1
fi
kubectl uncordon "${NODE}" >/dev/null 2>&1 || true

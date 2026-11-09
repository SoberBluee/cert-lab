#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
  labels: { app: ${Q1_APP} }
spec:
  replicas: 2
  selector:
    matchLabels: { app: ${Q1_APP} }
  template:
    metadata:
      labels: { app: ${Q1_APP} }
    spec:
      nodeSelector:
        kubernetes.io/hostname: worker-1
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          resources:
            requests: { cpu: 50m, memory: 32Mi }
EOF
kubectl -n "${Q1_NS}" get deployment "${Q1_APP}" -o jsonpath='{.metadata.uid} {.spec.replicas} {.spec.template.spec.containers[0].image}' > /var/tmp/cka-q1.uid
chmod 644 /var/tmp/cka-q1.uid
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s

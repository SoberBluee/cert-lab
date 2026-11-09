#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
spec:
  selector: { app: ${Q1_APP} }
  ports:
    - { port: 80 }
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
spec:
  serviceName: ${Q1_APP}
  replicas: 2
  selector:
    matchLabels: { app: ${Q1_APP} }
  template:
    metadata:
      labels: { app: ${Q1_APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
EOF
kubectl -n "${Q1_NS}" run client --image=busybox:1.36 --command -- sleep 1d >/dev/null
kubectl -n "${Q1_NS}" get statefulset "${Q1_APP}" -o jsonpath='{.metadata.uid}' > /var/tmp/cka-q1.uid
chmod 644 /var/tmp/cka-q1.uid
kubectl -n "${Q1_NS}" rollout status "statefulset/${Q1_APP}" --timeout=240s >/dev/null
kubectl -n "${Q1_NS}" wait --for=condition=Ready pod/client --timeout=120s >/dev/null

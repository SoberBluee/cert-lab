#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: v1
kind: ResourceQuota
metadata:
  name: pods
  namespace: ${Q1_NS}
spec:
  hard: { pods: "3" }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
  labels: { app: ${Q1_APP} }
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
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
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s >/dev/null
kubectl -n "${Q1_NS}" get deployment "${Q1_APP}" -o jsonpath='{.metadata.uid}' > /var/tmp/cka-q1.uid
kubectl -n "${Q1_NS}" get resourcequota pods -o jsonpath='{.metadata.uid}/{.spec.hard.pods}' > /var/tmp/cka-q1.quota
chmod 644 /var/tmp/cka-q1.uid /var/tmp/cka-q1.quota
kubectl -n "${Q1_NS}" set image "deployment/${Q1_APP}" web=nginx:1.28-alpine >/dev/null
for _ in $(seq 1 30); do
  failed="$(kubectl -n "${Q1_NS}" get replicaset -l "app=${Q1_APP}" -o jsonpath='{.items[*].status.conditions[?(@.type=="ReplicaFailure")].message}' 2>/dev/null || true)"
  [[ "$failed" == *'exceeded quota'* ]] && exit 0
  sleep 2
done
echo "expected the quota to refuse the surge Pod" >&2
exit 1

#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q1_POD}
  namespace: ${Q1_NS}
spec:
  containers:
    - name: web
      image: nginx:1.27-alpine
      ports: [{ containerPort: 80 }]
EOF
kubectl -n "${Q1_NS}" wait --for=condition=Ready "pod/${Q1_POD}" --timeout=180s
kubectl -n "${Q1_NS}" get pod "${Q1_POD}" -o jsonpath='{.metadata.uid}' > /var/tmp/cka-q1.uid
chmod 644 /var/tmp/cka-q1.uid

#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q2_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q2_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q2_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
  labels: { app: ${Q2_APP} }
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${Q2_APP} }
  template:
    metadata:
      labels: { app: ${Q2_APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          readinessProbe:
            httpGet: { path: /, port: 80 }
            periodSeconds: 3
          securityContext:
            capabilities: { drop: [ALL] }
---
apiVersion: v1
kind: Service
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
spec:
  selector: { app: ${Q2_APP} }
  ports:
    - { port: 80 }
EOF
kubectl -n "${Q2_NS}" get deployment "${Q2_APP}" -o jsonpath='{.metadata.uid} {.spec.template.spec.containers[0].image}' > /var/tmp/cka-q2.uid
chmod 644 /var/tmp/cka-q2.uid
for _ in $(seq 1 60); do
  kubectl -n "${Q2_NS}" logs "deployment/${Q2_APP}" 2>/dev/null | grep -q 'Operation not permitted' && exit 0
  sleep 2
done
echo "expected nginx to report a refused operation" >&2
exit 1

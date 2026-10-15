#!/usr/bin/env bash
set -euo pipefail

kubectl delete namespace "$NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$NS" >/dev/null
timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-all-egress, namespace: ${NS} }
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress: [{}]
---
apiVersion: v1
kind: Pod
metadata: { name: ${CLIENT}, namespace: ${NS}, labels: { role: ${CLIENT} } }
spec:
  containers: [{ name: client, image: busybox:1.36, command: ["sleep", "infinity"] }]
---
apiVersion: v1
kind: Pod
metadata: { name: ${DB}, namespace: ${NS}, labels: { role: ${DB} } }
spec:
  containers:
    - name: db
      image: busybox:1.36
      command: ["sh", "-c", "mkdir -p /tmp/www && echo '${DB} ok' > /tmp/www/index.html && exec httpd -f -p ${DB_PORT} -h /tmp/www"]
      ports: [{ containerPort: ${DB_PORT} }]
---
apiVersion: v1
kind: Service
metadata: { name: ${DB}, namespace: ${NS} }
spec:
  selector: { role: ${DB} }
  ports: [{ port: ${DB_PORT} }]
---
apiVersion: v1
kind: Pod
metadata: { name: cache, namespace: ${NS}, labels: { role: cache } }
spec:
  containers: [{ name: cache, image: nginx:1.27-alpine, ports: [{ containerPort: 80 }] }]
---
apiVersion: v1
kind: Service
metadata: { name: cache, namespace: ${NS} }
spec:
  selector: { role: cache }
  ports: [{ port: 80 }]
EOF

kubectl -n "$NS" wait --for=condition=Ready "pod/${CLIENT}" "pod/${DB}" pod/cache --timeout=180s >/dev/null

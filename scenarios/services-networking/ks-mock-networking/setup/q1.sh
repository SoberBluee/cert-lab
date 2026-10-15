#!/usr/bin/env bash
# client, db (port 5432) and cache Pods, plus an existing allow-all egress policy that undermines any restriction.
set -euo pipefail

kubectl delete namespace "$Q1_NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$Q1_NS" >/dev/null
timeout 60 bash -c "until kubectl -n '$Q1_NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-all-egress, namespace: ${Q1_NS} }
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress: [{}]
---
apiVersion: v1
kind: Pod
metadata: { name: client, namespace: ${Q1_NS}, labels: { role: client } }
spec:
  containers: [{ name: client, image: busybox:1.36, command: ["sleep", "infinity"] }]
---
apiVersion: v1
kind: Pod
metadata: { name: db, namespace: ${Q1_NS}, labels: { role: db } }
spec:
  containers:
    - name: db
      image: busybox:1.36
      command: ["sh", "-c", "mkdir -p /tmp/www && echo 'db ok' > /tmp/www/index.html && exec httpd -f -p 5432 -h /tmp/www"]
      ports: [{ containerPort: 5432 }]
---
apiVersion: v1
kind: Service
metadata: { name: db, namespace: ${Q1_NS} }
spec:
  selector: { role: db }
  ports: [{ port: 5432 }]
---
apiVersion: v1
kind: Pod
metadata: { name: cache, namespace: ${Q1_NS}, labels: { role: cache } }
spec:
  containers: [{ name: cache, image: nginx:1.27-alpine, ports: [{ containerPort: 80 }] }]
---
apiVersion: v1
kind: Service
metadata: { name: cache, namespace: ${Q1_NS} }
spec:
  selector: { role: cache }
  ports: [{ port: 80 }]
EOF

kubectl -n "$Q1_NS" wait --for=condition=Ready pod/client pod/db pod/cache --timeout=180s >/dev/null

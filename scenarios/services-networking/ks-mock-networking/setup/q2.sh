#!/usr/bin/env bash
# frontend and api backends; the api Service targets a port name the container does not have.
set -euo pipefail

kubectl delete namespace "$Q2_NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$Q2_NS" >/dev/null
timeout 60 bash -c "until kubectl -n '$Q2_NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata: { name: frontend, namespace: ${Q2_NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: frontend } }
  template:
    metadata: { labels: { app: frontend } }
    spec:
      containers:
        - name: web
          image: busybox:1.36
          command: ["sh", "-c", "mkdir -p /tmp/www && echo 'frontend ${Q2_NS}' > /tmp/www/index.html && exec httpd -f -p 80 -h /tmp/www"]
          ports: [{ name: http, containerPort: 80 }]
---
apiVersion: v1
kind: Service
metadata: { name: frontend, namespace: ${Q2_NS} }
spec:
  selector: { app: frontend }
  ports: [{ port: 80, targetPort: http }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: api, namespace: ${Q2_NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: api } }
  template:
    metadata: { labels: { app: api } }
    spec:
      containers:
        - name: api
          image: busybox:1.36
          command: ["sh", "-c", "mkdir -p /tmp/www/api && echo 'api ${Q2_NS}' > /tmp/www/api/index.html && exec httpd -f -p 8080 -h /tmp/www"]
          ports: [{ name: http, containerPort: 8080 }]
---
apiVersion: v1
kind: Service
metadata: { name: api, namespace: ${Q2_NS} }
spec:
  selector: { app: api }
  ports: [{ port: 8080, targetPort: web }]
EOF

kubectl -n "$Q2_NS" rollout status deployment/frontend --timeout=180s >/dev/null
kubectl -n "$Q2_NS" rollout status deployment/api --timeout=180s >/dev/null

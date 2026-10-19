#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl -n "${NS}" apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${APP}-config
data:
  index.html: |
    <html><body><h1>${APP} is up</h1></body></html>
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          volumeMounts:
            - name: nginx-config-volume
              mountPath: /usr/share/nginx/html
              readOnly: true
      volumes:
        - name: nginx-config-volume
          configMap:
            name: ${APP}-configuration
---
apiVersion: v1
kind: Service
metadata:
  name: ${APP}
spec:
  type: NodePort
  selector: { app: ${APP} }
  ports:
    - port: 80
      targetPort: 80
      nodePort: ${NODEPORT}
EOF

for _ in $(seq 1 30); do
  kubectl -n "${NS}" get pods -l "app=${APP}" -o name 2>/dev/null | grep -q . && break
  sleep 2
done

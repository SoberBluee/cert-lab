#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q3_NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${Q3_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl -n "${Q3_NS}" apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${Q3_APP}-config
data:
  index.html: |
    <html><body><h1>${Q3_APP} is up</h1></body></html>
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q3_APP}
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${Q3_APP} }
  template:
    metadata:
      labels: { app: ${Q3_APP} }
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
            name: ${Q3_APP}-configuration
---
apiVersion: v1
kind: Service
metadata:
  name: ${Q3_APP}
spec:
  type: NodePort
  selector: { app: ${Q3_APP} }
  ports:
    - port: 80
      targetPort: 80
      nodePort: ${Q3_NODEPORT}
EOF

for _ in $(seq 1 30); do
  kubectl -n "${Q3_NS}" get pods -l "app=${Q3_APP}" -o name 2>/dev/null | grep -q . && break
  sleep 2
done

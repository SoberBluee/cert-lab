#!/usr/bin/env bash
set -euo pipefail

for ns in "${Q2_NS}" platform; do
  kubectl create namespace "$ns" >/dev/null 2>&1 || kubectl get namespace "$ns" >/dev/null
  timeout 60 bash -c "until kubectl -n '$ns' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
done
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-v2-nginx
  namespace: platform
data:
  default.conf: |
    server {
      listen 80;
      location / { default_type text/plain; return 200 "api v2\n"; }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-v2
  namespace: platform
  labels: { app: api-v2 }
spec:
  replicas: 1
  selector:
    matchLabels: { app: api-v2 }
  template:
    metadata:
      labels: { app: api-v2 }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          volumeMounts:
            - { name: conf, mountPath: /etc/nginx/conf.d }
      volumes:
        - name: conf
          configMap: { name: api-v2-nginx }
---
apiVersion: v1
kind: Service
metadata:
  name: api-v2
  namespace: platform
spec:
  selector: { app: api-v2 }
  ports:
    - { port: 80 }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q2_SVC}
  namespace: ${Q2_NS}
  labels: { app: ${Q2_SVC} }
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${Q2_SVC} }
  template:
    metadata:
      labels: { app: ${Q2_SVC} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
---
apiVersion: v1
kind: Service
metadata:
  name: ${Q2_SVC}
  namespace: ${Q2_NS}
spec:
  selector: { app: ${Q2_SVC} }
  ports:
    - { port: 80 }
EOF
kubectl -n "${Q2_NS}" run client --image=busybox:1.36 --command -- sleep 1d >/dev/null
kubectl -n "${Q2_NS}" get service "${Q2_SVC}" -o jsonpath='{.metadata.uid}' > /var/tmp/cka-q2.uid
chmod 644 /var/tmp/cka-q2.uid
kubectl -n platform rollout status deployment/api-v2 --timeout=180s >/dev/null
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_SVC}" --timeout=180s >/dev/null
kubectl -n "${Q2_NS}" wait --for=condition=Ready pod/client --timeout=120s >/dev/null

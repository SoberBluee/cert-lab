#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${Q1_APP}-nginx
  namespace: ${Q1_NS}
data:
  default.conf: |
    server {
      listen 8080;
      location /ready { default_type text/plain; return 200 "ready\n"; }
      location / { root /usr/share/nginx/html; }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
  labels: { app: ${Q1_APP} }
spec:
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
          ports:
            - { name: http, containerPort: 8080 }
          readinessProbe:
            httpGet: { path: /ready, port: 80 }
            periodSeconds: 3
          volumeMounts:
            - { name: conf, mountPath: /etc/nginx/conf.d }
      volumes:
        - name: conf
          configMap: { name: ${Q1_APP}-nginx }
---
apiVersion: v1
kind: Service
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
spec:
  selector: { app: ${Q1_APP} }
  ports:
    - { port: 80, targetPort: http }
EOF
kubectl -n "${Q1_NS}" get deployment "${Q1_APP}" -o jsonpath='{.metadata.uid}' > /var/tmp/cka-q1.uid
kubectl -n "${Q1_NS}" get configmap "${Q1_APP}-nginx" -o jsonpath='{.data.default\.conf}' | sha256sum > /var/tmp/cka-q1.conf
chmod 644 /var/tmp/cka-q1.uid /var/tmp/cka-q1.conf
for _ in $(seq 1 60); do
  [[ "$(kubectl -n "${Q1_NS}" get pods -l "app=${Q1_APP}" --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l | tr -d ' ')" == 2 ]] && exit 0
  sleep 2
done
echo "expected 2 running Pods" >&2
exit 1

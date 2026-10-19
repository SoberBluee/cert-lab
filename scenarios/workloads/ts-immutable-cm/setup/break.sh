#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${APP}-content
  namespace: ${NS}
immutable: true
data:
  index.html: "<h1>wrong page</h1>"
---
apiVersion: v1
kind: Secret
metadata:
  name: ${APP}-secret
  namespace: ${NS}
stringData:
  token: s3cr3t-${APP}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  replicas: 2
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          readinessProbe:
            httpGet: { path: /, port: 80 }
            periodSeconds: 5
          volumeMounts:
            - { name: content, mountPath: /usr/share/nginx/html }
            - { name: secret, mountPath: /etc/${APP}, readOnly: true }
      volumes:
        - name: content
          configMap: { name: ${APP}-content }
        - name: secret
          secret:
            secretName: ${APP}-secret
            items: [{ key: token, path: token }]
EOF

kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s
# Symptom: page is wrong (checks fail until CM is recreated).
page=$(kubectl -n "${NS}" exec "deployment/${APP}" -- wget -qO- -T 3 http://localhost:80/ || true)
[[ "$page" == *wrong* ]] || { echo "expected wrong page" >&2; exit 1; }

#!/usr/bin/env bash
# Builds web -> api with three chained faults: egress policy blocks DNS, wrong Secret key, wrong targetPort name.
set -euo pipefail

kubectl delete namespace "$NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$NS" >/dev/null
timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
mkdir -p /opt/course/chain
rm -f /opt/course/chain/causes.txt
chown -R ubuntu:ubuntu /opt/course

kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata: { name: ${APP}-api-creds, namespace: ${NS} }
stringData: { token: "${TOKEN}" }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: ${APP}-web-egress, namespace: ${NS} }
spec:
  podSelector: { matchLabels: { app: ${APP}-web } }
  policyTypes: [Egress]
  egress:
    - to: [{ podSelector: { matchLabels: { app: ${APP}-api } } }]
      ports: [{ protocol: TCP, port: 8080 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: ${APP}-api, namespace: ${NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: ${APP}-api } }
  template:
    metadata: { labels: { app: ${APP}-api } }
    spec:
      containers:
        - name: api
          image: busybox:1.36
          command: ["sh", "-c", "mkdir -p /tmp/www && echo \"api ok: \$API_TOKEN\" > /tmp/www/index.html && exec httpd -f -p 8080 -h /tmp/www"]
          ports: [{ name: http, containerPort: 8080 }]
          env:
            - name: API_TOKEN
              valueFrom: { secretKeyRef: { name: ${APP}-api-creds, key: api-token } }
---
apiVersion: v1
kind: Service
metadata: { name: ${APP}-api, namespace: ${NS} }
spec:
  selector: { app: ${APP}-api }
  ports: [{ port: 80, targetPort: api-http }]
---
apiVersion: v1
kind: Pod
metadata: { name: ${APP}-admin, namespace: ${NS}, labels: { app: ${APP}-admin } }
spec:
  containers: [{ name: admin, image: nginx:1.27-alpine, ports: [{ containerPort: 80 }] }]
---
apiVersion: v1
kind: Service
metadata: { name: ${APP}-admin, namespace: ${NS} }
spec:
  selector: { app: ${APP}-admin }
  ports: [{ port: 80 }]
---
apiVersion: v1
kind: ConfigMap
metadata: { name: ${APP}-web-conf, namespace: ${NS} }
data:
  default.conf: |
    server {
      listen 80;
      location /healthz { return 200 "ok\n"; }
      location / { proxy_pass http://${APP}-api; }
    }
EOF

# Give Calico time to program the egress policy before the frontend starts.
sleep 8

kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata: { name: ${APP}-web, namespace: ${NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: ${APP}-web } }
  template:
    metadata: { labels: { app: ${APP}-web } }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          readinessProbe: { httpGet: { path: /healthz, port: 80 }, periodSeconds: 5 }
          volumeMounts: [{ name: conf, mountPath: /etc/nginx/conf.d }]
      volumes: [{ name: conf, configMap: { name: ${APP}-web-conf } }]
---
apiVersion: v1
kind: Service
metadata: { name: ${APP}-web, namespace: ${NS} }
spec:
  type: NodePort
  selector: { app: ${APP}-web }
  ports: [{ port: 80, targetPort: 80, nodePort: ${NODEPORT} }]
EOF

kubectl -n "$NS" wait --for=condition=Ready "pod/${APP}-admin" --timeout=180s >/dev/null

# The frontend must be visibly crashing and the API stuck before the session starts.
for _ in $(seq 1 60); do
  web="$(kubectl -n "$NS" get pods -l "app=${APP}-web" -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}' 2>/dev/null || true)"
  api="$(kubectl -n "$NS" get pods -l "app=${APP}-api" -o jsonpath='{.items[0].status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)"
  [[ "${web:-0}" -ge 1 && "$api" == CreateContainerConfigError ]] && exit 0
  sleep 3
done
echo "faults did not show: web restarts=${web:-?} api=${api:-?}" >&2
exit 1

#!/usr/bin/env bash
# Builds web -> api with three chained faults, one per hop: the frontend's egress policy
# ($DNS_FAULT), the API Pods ($API_FAULT) and the API Service ($SVC_FAULT).
set -euo pipefail

kubectl delete namespace "$NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$NS" >/dev/null
timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
mkdir -p /opt/course/chain
rm -f /opt/course/chain/causes.txt
chown -R ubuntu:ubuntu /opt/course

api_rule="    - to: [{ podSelector: { matchLabels: { app: ${APP}-api } } }]
      ports: [{ protocol: TCP, port: 8080 }]"
dns_rule="    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } } }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]"
case "$DNS_FAULT" in
  no-dns) egress="$api_rule" ;;
  dns-port) egress="$api_rule
${dns_rule//port: 53/port: 5353}" ;;
  api-port) egress="${api_rule//port: 8080/port: 80}
$dns_rule" ;;
  *) echo "unknown DNS_FAULT $DNS_FAULT" >&2; exit 1 ;;
esac

secret_name="${APP}-api-creds"; secret_key=token; api_image=busybox:1.36
case "$API_FAULT" in
  secret-key) secret_key=api-token ;;
  secret-name) secret_name="${APP}-api-credentials" ;;
  image-tag) api_image=busybox:1.366 ;;
  *) echo "unknown API_FAULT $API_FAULT" >&2; exit 1 ;;
esac

svc_selector="${APP}-api"; svc_port=80; svc_target=http
case "$SVC_FAULT" in
  target-port) svc_target=api-http ;;
  selector) svc_selector="${APP}-apis" ;;
  port) svc_port=8080 ;;
  *) echo "unknown SVC_FAULT $SVC_FAULT" >&2; exit 1 ;;
esac

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
${egress}
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
          image: ${api_image}
          command: ["sh", "-c", "mkdir -p /tmp/www && echo \"api ok: \$API_TOKEN\" > /tmp/www/index.html && exec httpd -f -p 8080 -h /tmp/www"]
          ports: [{ name: http, containerPort: 8080 }]
          env:
            - name: API_TOKEN
              valueFrom: { secretKeyRef: { name: ${secret_name}, key: ${secret_key} } }
---
apiVersion: v1
kind: Service
metadata: { name: ${APP}-api, namespace: ${NS} }
spec:
  selector: { app: ${svc_selector} }
  ports: [{ port: ${svc_port}, targetPort: ${svc_target} }]
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

# The frontend must be visibly broken (crashing without DNS, or up but unable to reach the API)
# and the API stuck before the session starts.
for _ in $(seq 1 60); do
  web_restarts="$(kubectl -n "$NS" get pods -l "app=${APP}-web" -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}' 2>/dev/null || true)"
  web_ready="$(kubectl -n "$NS" get pods -l "app=${APP}-web" -o jsonpath='{.items[0].status.containerStatuses[0].ready}' 2>/dev/null || true)"
  api="$(kubectl -n "$NS" get pods -l "app=${APP}-api" -o jsonpath='{.items[0].status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)"
  if [[ "$DNS_FAULT" == api-port ]]; then web_ok=$([[ "$web_ready" == true ]] && echo y || echo n); else web_ok=$([[ "${web_restarts:-0}" -ge 1 ]] && echo y || echo n); fi
  [[ "$web_ok" == y && "$api" =~ ^(CreateContainerConfigError|ErrImagePull|ImagePullBackOff)$ ]] && exit 0
  sleep 3
done
echo "faults did not show: web restarts=${web_restarts:-?} ready=${web_ready:-?} api=${api:-?}" >&2
exit 1

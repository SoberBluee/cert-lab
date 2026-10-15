#!/usr/bin/env bash
# frontend (CLIENT_NS) -> api (API_NS) with three faults, one per layer: the client's egress policy
# ($EGRESS_FAULT), the API's ingress policy ($INGRESS_FAULT) and the API Service ($SERVICE_FAULT).
set -euo pipefail

for ns in "$CLIENT_NS" "$API_NS"; do kubectl delete namespace "$ns" --ignore-not-found --wait=true >/dev/null; done
kubectl -n default delete pod canary --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$CLIENT_NS" >/dev/null
kubectl create namespace "$API_NS" >/dev/null
kubectl label namespace "$CLIENT_NS" team=frontend >/dev/null
kubectl label namespace "$API_NS" team=backend >/dev/null
for ns in "$CLIENT_NS" "$API_NS"; do
  timeout 60 bash -c "until kubectl -n '$ns' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
done

api_rule="    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: ${API_NS} } }, podSelector: { matchLabels: { app: api } } }]
      ports: [{ protocol: TCP, port: 80 }]"
dns_rule="    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }, podSelector: { matchLabels: { k8s-app: kube-dns } } }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]"
case "$EGRESS_FAULT" in
  no-dns) egress="$api_rule" ;;
  dns-port) egress="$api_rule
${dns_rule//port: 53/port: 5353}" ;;
  api-port) egress="${api_rule//port: 80/port: 8080}
$dns_rule" ;;
  *) echo "unknown EGRESS_FAULT $EGRESS_FAULT" >&2; exit 1 ;;
esac

from_ns="{ matchLabels: { team: frontend } }"
from_pods=""
ingress_port=80
case "$INGRESS_FAULT" in
  ns-label) from_ns="{ matchLabels: { team: frontend-web } }" ;;
  pod-selector) from_pods=", podSelector: { matchLabels: { app: web } }" ;;
  port) ingress_port=8080 ;;
  *) echo "unknown INGRESS_FAULT $INGRESS_FAULT" >&2; exit 1 ;;
esac

selector=api
target_port=80
case "$SERVICE_FAULT" in
  target-port) target_port=8080 ;;
  selector) selector=api-server ;;
  port-name) target_port=https ;;
  *) echo "unknown SERVICE_FAULT $SERVICE_FAULT" >&2; exit 1 ;;
esac

kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata: { name: api-page, namespace: ${API_NS} }
data:
  index.html: "api ok ${TOKEN}"
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: api, namespace: ${API_NS} }
spec:
  replicas: 2
  selector: { matchLabels: { app: api } }
  template:
    metadata: { labels: { app: api } }
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          ports: [{ name: http, containerPort: 80 }]
          volumeMounts: [{ name: page, mountPath: /usr/share/nginx/html }]
          resources: { requests: { cpu: 10m, memory: 16Mi } }
      volumes: [{ name: page, configMap: { name: api-page } }]
---
apiVersion: v1
kind: Service
metadata: { name: api, namespace: ${API_NS} }
spec:
  selector: { app: ${selector} }
  ports: [{ port: 80, targetPort: ${target_port} }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-ingress, namespace: ${API_NS} }
spec:
  podSelector: { matchLabels: { app: api } }
  policyTypes: [Ingress]
  ingress:
    - from: [{ namespaceSelector: ${from_ns}${from_pods} }]
      ports: [{ protocol: TCP, port: ${ingress_port} }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny-egress, namespace: ${CLIENT_NS} }
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
${egress}
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: frontend, namespace: ${CLIENT_NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: frontend } }
  template:
    metadata: { labels: { app: frontend } }
    spec:
      containers:
        - name: frontend
          image: busybox:1.36
          command: [sh, -c, "while true; do wget -qO- -T 3 http://api.${API_NS}.svc.cluster.local || echo request failed; sleep 10; done"]
          resources: { requests: { cpu: 10m, memory: 16Mi } }
---
apiVersion: v1
kind: Pod
metadata: { name: canary, namespace: default, labels: { app: canary } }
spec:
  containers:
    - name: httpd
      image: httpd:2.4-alpine
      resources: { requests: { cpu: 10m, memory: 16Mi } }
EOF

kubectl -n "$API_NS" rollout status deployment/api --timeout=180s
kubectl -n "$CLIENT_NS" rollout status deployment/frontend --timeout=180s
kubectl -n default wait --for=condition=Ready pod/canary --timeout=180s

sleep 5
if kubectl -n "$CLIENT_NS" exec deploy/frontend -- wget -qO- -T 4 "http://api.${API_NS}.svc.cluster.local" 2>/dev/null | grep -q "api ok"; then
  echo "frontend can already reach the API" >&2
  exit 1
fi

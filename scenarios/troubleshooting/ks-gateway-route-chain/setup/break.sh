#!/usr/bin/env bash
# Gateway -> HTTPRoute -> Service -> Pods, broken at three hops: the route's parent reference
# ($PARENT_FAULT), the route's matching or backend ($ROUTE_FAULT), and the Pods behind the Service ($BACKEND_FAULT).
set -euo pipefail

parent="{ name: traefik-gateway, namespace: traefik, sectionName: web }"
case "$PARENT_FAULT" in
  section-name) parent="{ name: traefik-gateway, namespace: traefik, sectionName: websecure }" ;;
  namespace) parent="{ name: traefik-gateway, sectionName: web }" ;;
  gateway-name) parent="{ name: traefik-gw, namespace: traefik, sectionName: web }" ;;
  *) echo "unknown PARENT_FAULT $PARENT_FAULT" >&2; exit 1 ;;
esac

host="$HOST"
backend_port=80
match=""
case "$ROUTE_FAULT" in
  hostname)
    host="$(sed 's/\.local$/.lcoal/' <<< "$HOST")"
    [[ "$host" != "$HOST" ]] || { echo "could not derive the misspelt host" >&2; exit 1; }
    ;;
  backend-port) backend_port=8080 ;;
  path) match="matches: [{ path: { type: PathPrefix, value: /${APP} } }]
      " ;;
  *) echo "unknown ROUTE_FAULT $ROUTE_FAULT" >&2; exit 1 ;;
esac

probe_path=/
probe_port=80
port_name=http
case "$BACKEND_FAULT" in
  probe-path) probe_path=/healthz ;;
  probe-port) probe_port=8080 ;;
  port-name) port_name=web ;;
  *) echo "unknown BACKEND_FAULT $BACKEND_FAULT" >&2; exit 1 ;;
esac

kubectl delete namespace "$NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$NS" >/dev/null
timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata: { name: ${APP}-page, namespace: ${NS} }
data:
  index.html: "${APP} ok ${TOKEN}"
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: ${APP}, namespace: ${NS} }
spec:
  replicas: 2
  selector: { matchLabels: { app: ${APP} } }
  template:
    metadata: { labels: { app: ${APP} } }
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          ports: [{ name: ${port_name}, containerPort: 80 }]
          readinessProbe:
            httpGet: { path: ${probe_path}, port: ${probe_port} }
            periodSeconds: 5
          volumeMounts: [{ name: page, mountPath: /usr/share/nginx/html }]
          resources: { requests: { cpu: 10m, memory: 16Mi } }
      volumes: [{ name: page, configMap: { name: ${APP}-page } }]
---
apiVersion: v1
kind: Service
metadata: { name: ${APP}, namespace: ${NS} }
spec:
  selector: { app: ${APP} }
  ports: [{ name: http, port: 80, targetPort: http }]
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: ${APP}, namespace: ${NS} }
spec:
  parentRefs:
    - ${parent}
  hostnames: ["${host}"]
  rules:
    - ${match}backendRefs: [{ name: ${APP}, port: ${backend_port} }]
EOF

sleep 15
code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H "Host: ${HOST}" http://controlplane:30080/ || true)"
[[ "$code" != 200 ]] || { echo "the route already serves ${HOST}" >&2; exit 1; }

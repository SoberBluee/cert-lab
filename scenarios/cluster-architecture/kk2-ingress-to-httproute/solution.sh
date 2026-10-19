#!/usr/bin/env bash
set -euo pipefail
kubectl -n "${NS}" apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: ${APP}-route
spec:
  parentRefs:
    - name: traefik-gateway
      namespace: traefik
      sectionName: web
  hostnames: ["${APP}.${NS}.lab"]
  rules:
    - matches:
        - path: { type: PathPrefix, value: / }
      backendRefs:
        - name: ${APP}
          port: 80
EOF
kubectl -n "${NS}" delete ingress "${APP}" --ignore-not-found
for _ in $(seq 1 60); do
  curl -s -m 3 -H "Host: ${APP}.${NS}.lab" http://controlplane:30080/ | grep -q "${APP} ok" && break
  sleep 2
done

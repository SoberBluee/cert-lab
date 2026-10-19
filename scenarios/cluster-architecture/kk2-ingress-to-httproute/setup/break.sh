#!/usr/bin/env bash
set -euo pipefail

kubectl get gatewayclass traefik >/dev/null 2>&1 || {
  echo "this cluster image has no Traefik or Gateway API: rebuild images with ./cka images build --force" >&2
  exit 1
}

kubectl create namespace "${NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl -n "${NS}" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
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
          ports: [{ containerPort: 80, name: http }]
          command: ["/bin/sh","-c"]
          args:
            - echo '${APP} ok' >/usr/share/nginx/html/index.html; exec nginx -g 'daemon off;'
---
apiVersion: v1
kind: Service
metadata:
  name: ${APP}
spec:
  selector: { app: ${APP} }
  ports: [{ port: 80, targetPort: http }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${APP}
spec:
  ingressClassName: traefik
  rules:
    - host: ${APP}.${NS}.lab
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: ${APP}, port: { number: 80 } }
EOF
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s
for _ in $(seq 1 60); do
  curl -s -m 3 -H "Host: ${APP}.${NS}.lab" http://controlplane:30080/ | grep -q "${APP} ok" && exit 0
  sleep 2
done
echo "ingress not serving yet" >&2
exit 1

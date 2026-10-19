#!/usr/bin/env bash
set -euo pipefail

kubectl get gatewayclass traefik >/dev/null 2>&1 || {
  echo "this cluster image has no Traefik or Gateway API: rebuild images with ./cka images build --force" >&2
  exit 1
}

kubectl create namespace "${Q4_NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${Q4_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl -n "${Q4_NS}" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q4_APP}
spec:
  replicas: 2
  selector:
    matchLabels: { app: ${Q4_APP} }
  template:
    metadata:
      labels: { app: ${Q4_APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80, name: http }]
          command: ["/bin/sh","-c"]
          args:
            - echo '${Q4_APP} ok' >/usr/share/nginx/html/index.html; exec nginx -g 'daemon off;'
---
apiVersion: v1
kind: Service
metadata:
  name: ${Q4_APP}
spec:
  selector: { app: ${Q4_APP} }
  ports: [{ port: 80, targetPort: http }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${Q4_APP}
spec:
  ingressClassName: traefik
  rules:
    - host: ${Q4_APP}.${Q4_NS}.lab
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: ${Q4_APP}, port: { number: 80 } }
EOF
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
for _ in $(seq 1 60); do
  curl -s -m 3 -H "Host: ${Q4_APP}.${Q4_NS}.lab" http://controlplane:30080/ | grep -q "${Q4_APP} ok" && exit 0
  sleep 2
done
echo "ingress not serving yet" >&2
exit 1

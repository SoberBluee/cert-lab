#!/usr/bin/env bash
set -euo pipefail

# A namespace with an nginx Deployment and Service.
web_site() {
  local ns="$1"
  kubectl get ingressclass traefik >/dev/null 2>&1 || {
    echo "this cluster image has no traefik: rebuild images with ./cka images build --force" >&2
    exit 1
  }
  kubectl create namespace "$ns" >/dev/null 2>&1 || kubectl get namespace "$ns" >/dev/null
  timeout 60 bash -c "until kubectl -n '$ns' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
  kubectl -n "$ns" create deployment web --image=nginx:1.27-alpine --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl -n "$ns" expose deployment web --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl -n "$ns" rollout status deployment/web --timeout=180s >/dev/null
}

host="${Q1_SUB}.${Q1_NS}.lab"
web_site "${Q1_NS}"
mkdir -p "/opt/course/tls/${Q1_NS}"
chown -R ubuntu:ubuntu /opt/course
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: ${Q1_NS}
spec:
  ingressClassName: traefik
  rules:
    - host: ${host}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port: { number: 80 }
EOF

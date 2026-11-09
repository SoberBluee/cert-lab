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

host="${Q2_SUB}.${Q2_NS}.lab"
web_site "${Q2_NS}"
kubectl create namespace cert-store >/dev/null 2>&1 || kubectl get namespace cert-store >/dev/null
work="$(mktemp -d)"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/tls.key" -out "$work/tls.crt" -days 365 -subj "/CN=${host}" -addext "subjectAltName=DNS:${host}" 2>/dev/null
kubectl -n cert-store create secret tls site-tls --cert="$work/tls.crt" --key="$work/tls.key" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
rm -rf "$work"
kubectl -n cert-store get secret site-tls -o jsonpath='{.metadata.uid}/{.metadata.resourceVersion}' > /var/tmp/cka-q2.secret
chmod 644 /var/tmp/cka-q2.secret
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: ${Q2_NS}
spec:
  ingressClassName: traefik
  tls:
    - hosts: [${host}]
      secretName: site-tls
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
for _ in $(seq 1 30); do
  openssl s_client -servername "${host}" -connect controlplane:30443 </dev/null 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | grep -q 'TRAEFIK DEFAULT CERT' && exit 0
  sleep 2
done
echo "expected Traefik's default certificate" >&2
exit 1

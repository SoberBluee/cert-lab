#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root.
set -euo pipefail

kubectl -n "$NS" patch networkpolicy "${APP}-web-egress" --type=json -p '[{"op":"add","path":"/spec/egress/-","value":{"to":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":"kube-system"}}}],"ports":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}}]'
kubectl -n "$NS" patch deployment "${APP}-api" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/env/0/valueFrom/secretKeyRef/key","value":"token"}]'
kubectl -n "$NS" patch service "${APP}-api" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'

kubectl -n "$NS" rollout status "deployment/${APP}-api" --timeout=180s
kubectl -n "$NS" rollout restart "deployment/${APP}-web"
kubectl -n "$NS" rollout status "deployment/${APP}-web" --timeout=180s

cat > /opt/course/chain/causes.txt <<EOF
networkpolicy/${APP}-web-egress: egress did not allow DNS (UDP/TCP 53), so nginx could not resolve ${APP}-api
deployment/${APP}-api: secretKeyRef key api-token does not exist in Secret ${APP}-api-creds (key is token)
service/${APP}-api: targetPort api-http does not match the container port name http
EOF

#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root.
set -euo pipefail

P="${APP}-web-egress"
case "$DNS_FAULT" in
  no-dns)
    kubectl -n "$NS" patch networkpolicy "$P" --type=json -p '[{"op":"add","path":"/spec/egress/-","value":{"to":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":"kube-system"}}}],"ports":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}}]'
    egress="networkpolicy/${P}: egress did not allow DNS (UDP/TCP 53), so nginx could not resolve ${APP}-api"
    ;;
  dns-port)
    kubectl -n "$NS" patch networkpolicy "$P" --type=json -p '[{"op":"replace","path":"/spec/egress/1/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
    egress="networkpolicy/${P}: the DNS egress rule allowed port 5353 instead of 53, so nginx could not resolve ${APP}-api"
    ;;
  api-port)
    kubectl -n "$NS" patch networkpolicy "$P" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"TCP","port":8080}]}]'
    egress="networkpolicy/${P}: egress to the API Pods allowed port 80 instead of the container port 8080"
    ;;
esac

case "$API_FAULT" in
  secret-key)
    kubectl -n "$NS" patch deployment "${APP}-api" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/env/0/valueFrom/secretKeyRef/key","value":"token"}]'
    api="deployment/${APP}-api: secretKeyRef key api-token does not exist in Secret ${APP}-api-creds (key is token)"
    ;;
  secret-name)
    kubectl -n "$NS" patch deployment "${APP}-api" --type=json -p "[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/env/0/valueFrom/secretKeyRef/name\",\"value\":\"${APP}-api-creds\"}]"
    api="deployment/${APP}-api: secretKeyRef name ${APP}-api-credentials does not exist (the Secret is ${APP}-api-creds)"
    ;;
  image-tag)
    kubectl -n "$NS" set image "deployment/${APP}-api" api=busybox:1.36
    api="deployment/${APP}-api: image tag busybox:1.366 does not exist"
    ;;
esac

case "$SVC_FAULT" in
  target-port)
    kubectl -n "$NS" patch service "${APP}-api" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
    svc="service/${APP}-api: targetPort api-http does not match the container port name http"
    ;;
  selector)
    kubectl -n "$NS" patch service "${APP}-api" --type=json -p "[{\"op\":\"replace\",\"path\":\"/spec/selector\",\"value\":{\"app\":\"${APP}-api\"}}]"
    svc="service/${APP}-api: selector app=${APP}-apis matched no Pods, so it had no endpoints"
    ;;
  port)
    kubectl -n "$NS" patch service "${APP}-api" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":80}]'
    svc="service/${APP}-api: Service port was 8080 but nginx proxies to port 80"
    ;;
esac

kubectl -n "$NS" rollout status "deployment/${APP}-api" --timeout=180s
kubectl -n "$NS" rollout restart "deployment/${APP}-web"
kubectl -n "$NS" rollout status "deployment/${APP}-web" --timeout=180s

printf '%s\n' "$egress" "$api" "$svc" > /opt/course/chain/causes.txt

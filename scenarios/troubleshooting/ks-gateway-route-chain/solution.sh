#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root.
set -euo pipefail

case "$PARENT_FAULT" in
  section-name) kubectl -n "$NS" patch httproute "$APP" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]' ;;
  namespace) kubectl -n "$NS" patch httproute "$APP" --type=json -p '[{"op":"add","path":"/spec/parentRefs/0/namespace","value":"traefik"}]' ;;
  gateway-name) kubectl -n "$NS" patch httproute "$APP" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/name","value":"traefik-gateway"}]' ;;
esac

case "$ROUTE_FAULT" in
  hostname) kubectl -n "$NS" patch httproute "$APP" --type=json -p "[{\"op\":\"replace\",\"path\":\"/spec/hostnames\",\"value\":[\"${HOST}\"]}]" ;;
  backend-port) kubectl -n "$NS" patch httproute "$APP" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]' ;;
  path) kubectl -n "$NS" patch httproute "$APP" --type=json -p '[{"op":"replace","path":"/spec/rules/0/matches/0/path/value","value":"/"}]' ;;
esac

case "$BACKEND_FAULT" in
  probe-path) kubectl -n "$NS" patch deployment "$APP" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]' ;;
  probe-port) kubectl -n "$NS" patch deployment "$APP" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":80}]' ;;
  port-name) kubectl -n "$NS" patch deployment "$APP" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"}]' ;;
esac
kubectl -n "$NS" rollout status "deployment/${APP}" --timeout=180s

for _ in $(seq 1 30); do
  curl -s -m 5 -H "Host: ${HOST}" http://controlplane:30080/ | grep -q "${APP} ok" && exit 0
  sleep 3
done
echo "the route still does not serve ${HOST}" >&2
exit 1

#!/usr/bin/env bash
set -euo pipefail
kubectl -n "${NS}" create configmap "${APP}-content-fixed" --from-literal=index.html="<h1>${APP} is up</h1>"
kubectl -n "${NS}" patch deployment "${APP}" --type=json \
  -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"'"${APP}"'-content-fixed"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s
kubectl -n "${NS}" delete configmap "${APP}-content" --ignore-not-found

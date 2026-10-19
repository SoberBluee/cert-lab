#!/usr/bin/env bash
set -euo pipefail
kubectl -n "${NS}" patch deployment "${APP}" --type=json \
  -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"'"${APP}"'-config"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=180s

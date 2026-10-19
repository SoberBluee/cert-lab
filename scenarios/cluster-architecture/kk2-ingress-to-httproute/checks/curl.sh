#!/usr/bin/env bash
set -uo pipefail
if ! kubectl -n "${NS}" get httproute "${APP}-route" >/dev/null 2>&1; then
  echo no-route
  exit 0
fi
if kubectl -n "${NS}" get ingress "${APP}" >/dev/null 2>&1; then
  echo ingress-still-present
  exit 0
fi
if curl -s -m 5 -H "Host: ${APP}.${NS}.lab" "http://controlplane:30080/" | grep -q "${APP} ok"; then
  echo ok
else
  echo fail
fi

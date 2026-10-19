#!/usr/bin/env bash
set -uo pipefail
if ! kubectl -n "${Q4_NS}" get httproute "${Q4_APP}-route" >/dev/null 2>&1; then
  echo no-route
  exit 0
fi
if kubectl -n "${Q4_NS}" get ingress "${Q4_APP}" >/dev/null 2>&1; then
  echo ingress-still-present
  exit 0
fi
if curl -s -m 5 -H "Host: ${Q4_APP}.${Q4_NS}.lab" "http://controlplane:30080/" | grep -q "${Q4_APP} ok"; then
  echo ok
else
  echo fail
fi

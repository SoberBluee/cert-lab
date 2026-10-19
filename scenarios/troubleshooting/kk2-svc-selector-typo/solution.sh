#!/usr/bin/env bash
set -euo pipefail
kubectl -n "${NS}" delete svc "${APP}-svc" --ignore-not-found
kubectl -n "${NS}" expose pod "${APP}" --name="${APP}-svc" --port=80 --target-port=80
for _ in $(seq 1 30); do
  kubectl -n "${NS}" exec curlpod -- wget -qO- -T 3 "http://${APP}-svc" 2>/dev/null | grep -q nginx && break
  sleep 2
done

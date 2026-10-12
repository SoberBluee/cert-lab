#!/usr/bin/env bash
set -euo pipefail

kubectl -n "$NS" set image "deployment/$DEPLOY" nginx=nginx:1.27-alpine
kubectl -n "$NS" rollout status "deployment/$DEPLOY" --timeout=180s

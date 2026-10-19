#!/usr/bin/env bash
set -euo pipefail
kubectl -n "${NS}" patch deployment "${APP}" --type=strategic -p '{"spec":{"paused":false,"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":"25%","maxUnavailable":"25%"}}}}'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s

#!/usr/bin/env bash
set -euo pipefail
kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/topologySpreadConstraints"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s

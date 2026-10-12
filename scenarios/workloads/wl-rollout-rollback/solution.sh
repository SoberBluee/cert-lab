#!/usr/bin/env bash
set -euo pipefail

kubectl -n prod rollout undo deployment/web
kubectl -n prod rollout status deployment/web --timeout=180s

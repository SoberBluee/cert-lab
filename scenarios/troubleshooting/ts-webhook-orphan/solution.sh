#!/usr/bin/env bash
set -euo pipefail
kubectl delete validatingwebhookconfiguration orphan-validate --ignore-not-found
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s

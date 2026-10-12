#!/usr/bin/env bash
# NS, DEPLOY and BAD_TAG come from the scenario variables.
set -euo pipefail

kubectl create namespace "$NS"
timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl -n "$NS" create deployment "$DEPLOY" --image=nginx:1.27-alpine --replicas=2
kubectl -n "$NS" rollout status "deployment/$DEPLOY" --timeout=240s
kubectl -n "$NS" set image "deployment/$DEPLOY" nginx="nginx:$BAD_TAG"
sleep 5

#!/usr/bin/env bash
# NS, DEPLOY, CM and MODE come from the scenario variables.
set -euo pipefail

kubectl create namespace "$NS"
# Pods are rejected until the controller-manager creates the namespace's default ServiceAccount.
timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl -n "$NS" create configmap "$CM" --from-literal=mode="$MODE" --from-literal=log_level=info
kubectl -n "$NS" create deployment "$DEPLOY" --image=nginx:1.27-alpine --replicas=1 --port=80
kubectl -n "$NS" rollout status "deployment/$DEPLOY" --timeout=240s

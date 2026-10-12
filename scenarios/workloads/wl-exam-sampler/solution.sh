#!/usr/bin/env bash
# All names come from the scenario variables.
set -euo pipefail

# Q1
kubectl -n "$NS" scale deployment "$DEPLOY" --replicas="$REPLICAS"

# Q2
kubectl -n "$NS" expose deployment "$DEPLOY" --name="$DEPLOY-np" --type=NodePort --port=80 --target-port=80
kubectl -n "$NS" patch service "$DEPLOY-np" --type=json \
  -p "[{\"op\":\"replace\",\"path\":\"/spec/ports/0/nodePort\",\"value\":$NODEPORT}]"

# Q3
kubectl -n "$NS" patch deployment "$DEPLOY" --type=json -p "[{\"op\":\"add\",\"path\":\"/spec/template/spec/containers/0/env\",\"value\":[{\"name\":\"APP_MODE\",\"valueFrom\":{\"configMapKeyRef\":{\"name\":\"$CM\",\"key\":\"mode\"}}}]}]"
kubectl -n "$NS" rollout status "deployment/$DEPLOY" --timeout=180s

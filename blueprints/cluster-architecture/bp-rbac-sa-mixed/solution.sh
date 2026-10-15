#!/usr/bin/env bash
set -euo pipefail

kubectl -n "$NS" create serviceaccount "$SA"
kubectl -n "$NS" create role "${SA}-role" --verb=get,list,watch,create,update,patch --resource=deployments.apps
kubectl -n "$NS" patch role "${SA}-role" --type=json -p '[{"op":"add","path":"/rules/-","value":{"apiGroups":[""],"resources":["pods"],"verbs":["get","list"]}}]'
kubectl -n "$NS" create rolebinding "${SA}-role" --role="${SA}-role" --serviceaccount="${NS}:${SA}"
kubectl create clusterrole "${SA}-cluster" --verb=get,list --resource="$CLUSTER_RES"
kubectl create clusterrolebinding "${SA}-cluster" --clusterrole="${SA}-cluster" --serviceaccount="${NS}:${SA}"
kubectl -n "$NS" create deployment "${SA}-probe" --image=nginx:1.27-alpine --dry-run=client -o json \
  | jq --arg sa "$SA" '.spec.template.spec.serviceAccountName = $sa' | kubectl apply -f -
kubectl -n "$NS" rollout status "deployment/${SA}-probe" --timeout=120s

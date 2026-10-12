#!/usr/bin/env bash
# NS and SA come from the scenario variables.
set -euo pipefail

kubectl -n "$NS" create serviceaccount "$SA"
kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: $SA-role
  namespace: $NS
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "update", "delete"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
EOF
kubectl -n "$NS" create rolebinding "$SA-binding" --role="$SA-role" --serviceaccount="$NS:$SA"

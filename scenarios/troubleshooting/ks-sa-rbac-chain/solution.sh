#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root.
set -euo pipefail

kubectl patch clusterrole "${SA}-read" --type=json -p '[{"op":"replace","path":"/rules/0","value":{"apiGroups":[""],"resources":["pods"],"verbs":["get","list","watch"]}}]'
kubectl patch clusterrolebinding "${SA}-read" --type=json \
  -p "[{\"op\":\"replace\",\"path\":\"/subjects/0\",\"value\":{\"kind\":\"ServiceAccount\",\"name\":\"${SA}\",\"namespace\":\"${NS}\"}}]"

if [[ "$WORKLOAD_FAULT" == sa-missing ]]; then
  kubectl -n "$NS" create serviceaccount "$SA"
else
  kubectl -n "$NS" set serviceaccount "deployment/${SA}" "$SA"
fi
kubectl -n "$NS" rollout status "deployment/${SA}" --timeout=180s

kubectl auth can-i list pods -A --as="system:serviceaccount:${NS}:${SA}" > /opt/course/6/can-i.txt || true

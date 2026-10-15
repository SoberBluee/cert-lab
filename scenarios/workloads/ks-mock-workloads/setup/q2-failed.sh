#!/usr/bin/env bash
# Revisions 1 and 2 work; revision 3 points at a missing image and exceeds its progress deadline.
set -euo pipefail

kubectl delete namespace "$Q2_NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$Q2_NS" >/dev/null
timeout 60 bash -c "until kubectl -n '$Q2_NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
rm -f /opt/course/q2/image.txt /opt/course/q2/reason.txt

kubectl -n "$Q2_NS" create deployment "$Q2_DEPLOY" --image=nginx:1.25-alpine --replicas=3 >/dev/null
kubectl -n "$Q2_NS" patch deployment "$Q2_DEPLOY" -p '{"spec":{"progressDeadlineSeconds":30}}' >/dev/null
kubectl -n "$Q2_NS" annotate deployment "$Q2_DEPLOY" kubernetes.io/change-cause="initial release" --overwrite >/dev/null
kubectl -n "$Q2_NS" rollout status "deployment/$Q2_DEPLOY" --timeout=180s >/dev/null

kubectl -n "$Q2_NS" set image "deployment/$Q2_DEPLOY" nginx=nginx:1.26-alpine >/dev/null
kubectl -n "$Q2_NS" annotate deployment "$Q2_DEPLOY" kubernetes.io/change-cause="bump nginx to 1.26" --overwrite >/dev/null
kubectl -n "$Q2_NS" rollout status "deployment/$Q2_DEPLOY" --timeout=180s >/dev/null

kubectl -n "$Q2_NS" set image "deployment/$Q2_DEPLOY" nginx=nginx:1.26-alpine-slim2 >/dev/null
kubectl -n "$Q2_NS" annotate deployment "$Q2_DEPLOY" kubernetes.io/change-cause="switch to the slim image" --overwrite >/dev/null

for _ in $(seq 1 60); do
  reason="$(kubectl -n "$Q2_NS" get deployment "$Q2_DEPLOY" -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}')"
  [[ "$reason" == ProgressDeadlineExceeded ]] && break
  sleep 3
done
[[ "$reason" == ProgressDeadlineExceeded ]] || { echo "revision 3 did not exceed its progress deadline (reason: $reason)" >&2; exit 1; }
[[ "$(kubectl -n "$Q2_NS" get deployment "$Q2_DEPLOY" -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}')" == 3 ]]

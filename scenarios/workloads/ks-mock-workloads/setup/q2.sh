#!/usr/bin/env bash
# Builds four revisions; revision $Q2_TARGET is the approved one, revision 4 is broken.
set -euo pipefail

kubectl delete namespace "$Q2_NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$Q2_NS" >/dev/null
timeout 60 bash -c "until kubectl -n '$Q2_NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
rm -f /opt/course/q2/image.txt

images=(nginx:1.25-alpine nginx:1.26-alpine nginx:1.27-alpine nginx:1.27-alpine-hardened)
causes=("initial release" "bump nginx for CVE fixes" "minor nginx upgrade - security review pending" "switch to hardened image")
causes[$((Q2_TARGET - 1))]="${causes[$((Q2_TARGET - 1))]} - security-approved"

kubectl -n "$Q2_NS" create deployment "$Q2_DEPLOY" --image="${images[0]}" --replicas=3 >/dev/null
kubectl -n "$Q2_NS" annotate deployment "$Q2_DEPLOY" kubernetes.io/change-cause="${causes[0]}" --overwrite >/dev/null
kubectl -n "$Q2_NS" rollout status "deployment/$Q2_DEPLOY" --timeout=180s >/dev/null
for i in 1 2 3; do
  kubectl -n "$Q2_NS" set image "deployment/$Q2_DEPLOY" "nginx=${images[$i]}" >/dev/null
  kubectl -n "$Q2_NS" annotate deployment "$Q2_DEPLOY" kubernetes.io/change-cause="${causes[$i]}" --overwrite >/dev/null
  [[ $i == 3 ]] || kubectl -n "$Q2_NS" rollout status "deployment/$Q2_DEPLOY" --timeout=180s >/dev/null
done

# Revision 4 must be visibly stuck.
for _ in $(seq 1 40); do
  kubectl -n "$Q2_NS" get pods -l "app=$Q2_DEPLOY" -o jsonpath='{.items[*].status.containerStatuses[0].state.waiting.reason}' | grep -Eq 'ErrImagePull|ImagePullBackOff' && break
  sleep 3
done
[[ "$(kubectl -n "$Q2_NS" get deployment "$Q2_DEPLOY" -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}')" == 4 ]]
kubectl -n "$Q2_NS" rollout history "deployment/$Q2_DEPLOY" | grep -q security-approved

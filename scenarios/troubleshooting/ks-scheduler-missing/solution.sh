#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root on controlplane.
set -euo pipefail

M=/etc/kubernetes/manifests/kube-scheduler.yaml

kubectl -n "$NS" get pod "manual-${APP}" -o json \
  | jq 'del(.metadata.resourceVersion, .metadata.uid, .metadata.creationTimestamp, .status) | .spec.nodeName = "controlplane"' \
  > /tmp/manual.json
kubectl replace --force -f /tmp/manual.json
kubectl -n "$NS" wait --for=condition=Ready "pod/manual-${APP}" --timeout=120s

case "$SCHED_FAULT" in
  moved) mv "$HIDE_DIR/kube-scheduler.yaml" "$M" ;;
  kubeconfig-path) sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\.config$#\1.conf#' "$M" ;;
  image-tag) sed -i -E 's#^([[:space:]]*image: [^[:space:]]*kube-scheduler:[^[:space:]]+)-patched$#\1#' "$M" ;;
  command) sed -i -E 's#^([[:space:]]*- kube-)schedular$#\1scheduler#' "$M" ;;
esac

for _ in $(seq 1 100); do
  [[ "$(kubectl -n kube-system get pod kube-scheduler-controlplane -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)" == True ]] && break
  sleep 3
done
kubectl -n "$NS" rollout status "deployment/${APP}" --timeout=240s

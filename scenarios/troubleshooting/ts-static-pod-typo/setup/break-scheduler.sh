#!/usr/bin/env bash
set -euo pipefail

M=/etc/kubernetes/manifests/kube-scheduler.yaml
sed -i -E 's|^(\s*)- kube-scheduler$|\1- kube-schedular|' "$M"
grep -qE -- '- kube-schedular$' "$M" || { echo "could not modify $M" >&2; exit 1; }

ready() {
  kubectl -n kube-system get pod kube-scheduler-controlplane \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true
}
for _ in $(seq 1 60); do
  [[ "$(ready)" != "True" ]] && break
  sleep 3
done
[[ "$(ready)" != "True" ]] || { echo "scheduler still Ready after manifest change" >&2; exit 1; }
sleep 5

kubectl create deployment web --image=nginx:1.27-alpine --replicas=2

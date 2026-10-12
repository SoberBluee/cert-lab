#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace prod
kubectl -n prod create deployment web --image=nginx:1.27-alpine --replicas=3
kubectl -n prod rollout status deployment/web --timeout=240s

install -d -m 700 /root/.cka
kubectl -n prod get deployment web -o jsonpath='{.metadata.uid}' > /root/.cka/web-uid

kubectl -n prod annotate deployment web kubernetes.io/change-cause="upgrade to the new build" --overwrite
kubectl -n prod set image deployment/web nginx=nginx:1.27-alpine-build42

for _ in $(seq 1 60); do
  kubectl -n prod get pods -l app=web -o jsonpath='{range .items[*]}{.status.containerStatuses[0].state.waiting.reason}{"\n"}{end}' \
    | grep -qE 'ErrImagePull|ImagePullBackOff' && exit 0
  sleep 2
done
echo "the broken rollout did not show an image pull error" >&2
exit 1

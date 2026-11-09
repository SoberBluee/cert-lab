#!/usr/bin/env bash
set -euo pipefail

if ! kubectl -n local-path-storage get deployment local-path-provisioner >/dev/null 2>&1; then
  [[ -f /opt/cka/addons/local-path-storage.yaml ]] || { echo "these lab images have no local-path provisioner: run ./cka images extras (or rebuild the images)" >&2; exit 1; }
  kubectl apply -f /opt/cka/addons/local-path-storage.yaml >/dev/null
fi
kubectl -n local-path-storage rollout status deployment/local-path-provisioner --timeout=180s >/dev/null
kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

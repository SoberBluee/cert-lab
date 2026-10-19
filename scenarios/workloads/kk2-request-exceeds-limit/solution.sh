#!/usr/bin/env bash
set -euo pipefail
sed -i 's/memory: 1Gi/memory: 100Mi/' "/opt/course/app-wl/${POD}.yaml"
kubectl apply -f "/opt/course/app-wl/${POD}.yaml"
kubectl wait --for=condition=Ready "pod/${POD}" --timeout=120s

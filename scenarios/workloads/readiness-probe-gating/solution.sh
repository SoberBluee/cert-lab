#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s

# Question 2
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/readinessProbe","value":{"exec":{"command":["sh","-c","test ! -e /tmp/drain"]},"periodSeconds":2,"failureThreshold":1}}]'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=180s
pod="$(kubectl -n "${Q2_NS}" get pods -l "app=${Q2_APP}" -o json | jq -r '[.items[] | select(.metadata.deletionTimestamp == null)][0].metadata.name')"
kubectl -n "${Q2_NS}" exec "$pod" -- touch /tmp/drain
kubectl -n "${Q2_NS}" wait --for=condition=Ready=false "pod/$pod" --timeout=30s

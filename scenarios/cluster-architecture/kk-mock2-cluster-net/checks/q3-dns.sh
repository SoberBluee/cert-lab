#!/usr/bin/env bash
set -euo pipefail
kubectl delete pod q3dns-check --ignore-not-found --wait=false >/dev/null 2>&1 || true
sleep 1
out=$(kubectl run q3dns-check --rm -i --restart=Never --image=busybox:1.36 -- nslookup kubernetes.default.svc.cluster.local 2>&1 || true)
echo "$out" | grep -qi NXDOMAIN && { echo fail; exit 0; }
echo "$out" | grep -qE '^Address:[[:space:]]*[0-9]' && echo ok || echo fail

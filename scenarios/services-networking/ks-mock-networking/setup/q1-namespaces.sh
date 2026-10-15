#!/usr/bin/env bash
# Two client namespaces next to $Q1_NS: <ns>-mon (team=monitoring, Pods probe and other) and <ns>-dev (Pod probe).
# Both probe Pods carry role=probe, so only a namespace AND Pod selector tells them apart.
set -euo pipefail

for ns in "$Q1_NS-mon" "$Q1_NS-dev"; do
  kubectl delete namespace "$ns" --ignore-not-found --wait=true >/dev/null
  kubectl create namespace "$ns" >/dev/null
  timeout 60 bash -c "until kubectl -n '$ns' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
done
kubectl label namespace "$Q1_NS-mon" team=monitoring >/dev/null
kubectl label namespace "$Q1_NS-dev" team=dev >/dev/null

kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata: { name: probe, namespace: ${Q1_NS}-mon, labels: { role: probe } }
spec:
  containers: [{ name: probe, image: busybox:1.36, command: ["sleep", "infinity"] }]
---
apiVersion: v1
kind: Pod
metadata: { name: other, namespace: ${Q1_NS}-mon, labels: { role: other } }
spec:
  containers: [{ name: other, image: busybox:1.36, command: ["sleep", "infinity"] }]
---
apiVersion: v1
kind: Pod
metadata: { name: probe, namespace: ${Q1_NS}-dev, labels: { role: probe } }
spec:
  containers: [{ name: probe, image: busybox:1.36, command: ["sleep", "infinity"] }]
EOF

kubectl -n "$Q1_NS-mon" wait --for=condition=Ready pod/probe pod/other --timeout=180s >/dev/null
kubectl -n "$Q1_NS-dev" wait --for=condition=Ready pod/probe --timeout=180s >/dev/null

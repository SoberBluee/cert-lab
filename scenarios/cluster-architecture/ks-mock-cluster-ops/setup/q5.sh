#!/usr/bin/env bash
# A PDB-protected Deployment spread over both workers, plus an unmanaged Pod on the node to drain.
set -euo pipefail

kubectl delete namespace "$Q5_NS" --ignore-not-found --wait=true >/dev/null
kubectl create namespace "$Q5_NS" >/dev/null
timeout 60 bash -c "until kubectl -n '$Q5_NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata: { name: ${Q5_APP}, namespace: ${Q5_NS} }
spec:
  replicas: 4
  selector: { matchLabels: { app: ${Q5_APP} } }
  template:
    metadata: { labels: { app: ${Q5_APP} } }
    spec:
      topologySpreadConstraints:
        - { maxSkew: 1, topologyKey: kubernetes.io/hostname, whenUnsatisfiable: ScheduleAnyway, labelSelector: { matchLabels: { app: ${Q5_APP} } } }
      containers:
        - name: app
          image: nginx:1.27-alpine
          readinessProbe: { httpGet: { path: /, port: 80 }, periodSeconds: 3 }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: ${Q5_APP}-pdb, namespace: ${Q5_NS} }
spec:
  minAvailable: 3
  selector: { matchLabels: { app: ${Q5_APP} } }
---
apiVersion: v1
kind: Pod
metadata: { name: scratch, namespace: ${Q5_NS} }
spec:
  nodeName: ${Q5_NODE}
  containers: [{ name: scratch, image: busybox:1.36, command: ["sleep", "infinity"] }]
EOF

kubectl -n "$Q5_NS" rollout status "deployment/$Q5_APP" --timeout=240s >/dev/null
kubectl -n "$Q5_NS" wait --for=condition=Ready pod/scratch --timeout=120s >/dev/null
[[ "$(kubectl -n "$Q5_NS" get pods -l "app=$Q5_APP" --field-selector "spec.nodeName=$Q5_NODE" -o name | wc -l)" -ge 1 ]]

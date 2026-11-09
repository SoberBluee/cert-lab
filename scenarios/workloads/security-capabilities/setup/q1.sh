#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
  labels: { app: ${Q1_APP} }
spec:
  replicas: 2
  selector:
    matchLabels: { app: ${Q1_APP} }
  template:
    metadata:
      labels: { app: ${Q1_APP} }
    spec:
      initContainers:
        - name: net-setup
          image: busybox:1.36
          command: ["sh", "-c", "ip addr add 10.99.0.1/32 dev lo"]
          securityContext:
            capabilities: { drop: [ALL] }
      containers:
        - name: app
          image: busybox:1.36
          command: ["sleep", "infinity"]
          securityContext:
            capabilities: { drop: [ALL] }
EOF
kubectl -n "${Q1_NS}" get deployment "${Q1_APP}" -o jsonpath='{.metadata.uid} {.spec.replicas} {.spec.template.spec.initContainers[0].command[2]}' > /var/tmp/cka-q1.uid
chmod 644 /var/tmp/cka-q1.uid
for _ in $(seq 1 60); do
  kubectl -n "${Q1_NS}" get pods -l "app=${Q1_APP}" --no-headers 2>/dev/null | grep -qE 'Init:(Error|CrashLoopBackOff)' && exit 0
  sleep 2
done
echo "expected the init container to fail" >&2
exit 1
